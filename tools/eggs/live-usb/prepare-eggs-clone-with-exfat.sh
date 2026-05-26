#!/usr/bin/env bash
set -euo pipefail

# Bake WO-47 (exFAT + boot sync + media bind + highascg.service ordering) into the host
# that will become the penguins-eggs --clone squashfs snapshot. Operators then use USB
# data partition LABEL=HIGHASCGEXF as the sticky “source of truth” (see EXFAT_DATA_ZERO_TOUCH.md).
#
# Usage (on dev / imaging host):
#   sudo bash tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh [casparcg]
#
# Optional env:
#   HIGHASCG_ROOT=/home/casparcg/highascg   deployed tree path (must contain package.json)
#   HIGHASCG_ISO_EMBED_SERVER=1             bake server+node_modules into squashfs (default 1)
#   HIGHASCG_ISO_BUILD_WEB=0                skip dist-web on ISO (default 0; UI via Electron)
#   HIGHASCG_ISO_BUILD_WEB=1                legacy: build dist-web on imaging host before clone
#   HIGHASCG_ISO_EMBED_SERVER=0             WO-47 only: omit Node tree; use exFAT drop-update/
#   SKIP_APT=1                               skip apt install (you already installed packages)
#   SKIP_MERGE_EGGS_EXCLUDES=1              do not merge penguins-eggs exclude fragment
#   SKIP_HIGHASCG_SYSTEMD_RESTART=1         skip systemctl restart highascg.service at end

if [[ "$(id -u)" -ne 0 ]]; then
	echo "Run as root: sudo bash $0" >&2
	exit 1
fi

USER_CASPAR="${1:-casparcg}"
getent passwd "$USER_CASPAR" >/dev/null 2>&1 || {
	echo "Unknown user: $USER_CASPAR" >&2
	exit 1
}

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
HIGHASCG_ROOT="${HIGHASCG_ROOT:-/home/casparcg/highascg}"

if [[ ! -f "${HIGHASCG_ROOT}/package.json" ]]; then
	echo "Expected HighAsCG at ${HIGHASCG_ROOT} (package.json missing). Clone or symlink the repo there, or set HIGHASCG_ROOT." >&2
	exit 1
fi

if [[ ! -f "${REPO_ROOT}/package.json" ]]; then
	echo "This script must live inside the highascg repository (missing ${REPO_ROOT}/package.json)." >&2
	exit 1
fi

SKIP_APT="${SKIP_APT:-0}"
SKIP_MERGE_EGGS_EXCLUDES="${SKIP_MERGE_EGGS_EXCLUDES:-0}"
SKIP_HIGHASCG_SYSTEMD_RESTART="${SKIP_HIGHASCG_SYSTEMD_RESTART:-0}"
HIGHASCG_ISO_EMBED_SERVER="${HIGHASCG_ISO_EMBED_SERVER:-1}"
HIGHASCG_ISO_BUILD_WEB="${HIGHASCG_ISO_BUILD_WEB:-0}"
SKIP_STRIP_HOST_SWAP="${SKIP_STRIP_HOST_SWAP:-0}"

if [[ "$SKIP_STRIP_HOST_SWAP" != "1" ]]; then
	echo "==> strip host swap from live USB payload (prepare; restore after eggs produce)"
	bash "${HERE}/strip-host-swap-for-live-iso.sh" prepare
fi

if [[ "$SKIP_APT" != "1" ]]; then
	echo "==> apt: packages for WO-47 + stick tooling (offline-safe on target)"
	export DEBIAN_FRONTEND=noninteractive
	apt-get update -qq
	apt-get install -y --no-install-recommends exfatprogs parted python3 rsync
fi

echo "==> ISO defaults (Caspar config + optional embedded server)"
bash "${HERE}/install-iso-defaults.sh"

echo "==> eggs GRUB/isolinux theme (persistence on default boot entry)"
bash "${HERE}/install-eggs-live-grub-theme.sh"

echo "==> empty mount stubs for squashfs (${HIGHASCG_ROOT}/media *, ~/exfat)"
bash "${HERE}/ensure-empty-live-usb-dirs.sh"

echo "==> companion dirs under ${HIGHASCG_ROOT}"
GRP=$(id -gn "$USER_CASPAR")
mkdir -p "${HIGHASCG_ROOT}/"{bin,media,media/drive,media/exfat,log,template,data,cef-cache,lib}

mkdir -p /home/casparcg/exfat
bash "${HERE}/seed-exfat-operator-layout.sh" /home/casparcg/exfat
mkdir -p /etc/highascg
install -m 0755 -o "$USER_CASPAR" -g "$GRP" -d "${HIGHASCG_ROOT}/media" "${HIGHASCG_ROOT}/media/drive" \
	"${HIGHASCG_ROOT}/media/exfat" /home/casparcg/exfat 2>/dev/null || true
chown -h "$USER_CASPAR:$GRP" /home/casparcg/exfat 2>/dev/null || true
chown -R "$USER_CASPAR:$GRP" "${HIGHASCG_ROOT}/media" 2>/dev/null || true

EXMAP="${REPO_ROOT}/config/exfat-sync.json"
if [[ -f "$EXMAP" ]] && [[ ! -f /etc/highascg/exfat-sync.json ]]; then
	install -m 0644 -o root -g root "$EXMAP" /etc/highascg/exfat-sync.json
	echo "  installed /etc/highascg/exfat-sync.json"
fi

echo "==> WO-47 systemd units (mount + bind + boot sync)"
bash "${REPO_ROOT}/scripts/install-exfat-systemd-units.sh" "$USER_CASPAR"

echo "==> HighAsCG service unit ordering (depends on WO-47 when present)"
bash "${REPO_ROOT}/scripts/write-highascg-systemd-unit.sh" "$USER_CASPAR"

if [[ "$SKIP_MERGE_EGGS_EXCLUDES" != "1" ]]; then
	if [[ "$HIGHASCG_ISO_EMBED_SERVER" == "1" ]]; then
		export HIGHASCG_EGGS_EXCLUDE_FRAGMENT="${HERE}/penguins-eggs-exclude-highascg-embed-server.list"
		echo "==> merge HighAsCG eggs excludes (embed server on ISO — standalone boot)"
	else
		export HIGHASCG_EGGS_EXCLUDE_FRAGMENT="${HERE}/penguins-eggs-exclude-highascg-fragment.list"
		echo "==> merge HighAsCG eggs excludes (WO-47 — server from exFAT drop-update/)"
	fi
	bash "${HERE}/merge-penguins-eggs-exclude-highascg.sh" --replace || {
		echo >&2 ""
		echo >&2 "If merge failed because ${EGGS_EXCLUDE_LIST:-/etc/penguins-eggs.d/exclude.list} does not exist yet,"
		echo >&2 "run eggs configuration once, then re-run this script with SKIP_MERGE_EGGS_EXCLUDES=1 for the WO-47 part only,"
		echo >&2 "or manually create the exclude file and merge again."
		exit 1
	}
fi

echo ""
echo "==> Ready for clone snapshot:"
echo "    sudo eggs produce --nointeractive --clone --max --excludes static --basename \"yourname\""
echo "    Or: sudo bash ${HERE}/build-highascg-egg.sh"
echo ""

if [[ "$SKIP_HIGHASCG_SYSTEMD_RESTART" != "1" ]]; then
	systemctl restart highascg.service 2>/dev/null || true
fi

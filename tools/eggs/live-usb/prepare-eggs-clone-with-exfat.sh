#!/usr/bin/env bash
set -euo pipefail

# INSTALL/configure WO-47 (exFAT + boot sync + media bind + highascg.service ordering) on the host.
# Not the check-only prepare step — use work/run-eggs-prepare-safe.sh to verify readiness.
#
# Usage (on dev / imaging host):
#   sudo bash tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh [casparcg]
#
# Optional env:
#   HIGHASCG_ROOT=/home/casparcg/highascg   deployed tree path (must contain package.json)
#   HIGHASCG_ISO_EMBED_SERVER=1             bake server+node_modules into squashfs (default 1)
#   HIGHASCG_ISO_EMBED_COMPANION=1          bake Companion + highpass-highascg module (default 1)
#   HIGHASCG_ISO_EMBED_CALAMARES=1          bake Calamares for install-to-disk (default 1)
#   HIGHASCG_ISO_BUILD_WEB=1                bake dist-web/ on squashfs (default — UI works at first boot)
#   HIGHASCG_ISO_BUILD_WEB=0                omit dist-web; deploy UI via exFAT drop-update/ only
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
HIGHASCG_ISO_BUILD_WEB="${HIGHASCG_ISO_BUILD_WEB:-1}"
SKIP_STRIP_HOST_SWAP="${SKIP_STRIP_HOST_SWAP:-0}"

# Swap is stripped in pre-produce-preflight.sh (or build-highascg-egg.sh) immediately before
# eggs produce — NOT here. swapoff at prepare start caused OOM during npm ci / vite build when
# Companion/highascg were still running (kernel log: swapoff invoked oom-killer).

if [[ "$SKIP_APT" != "1" ]]; then
	echo "==> apt: packages for WO-47 + stick tooling (offline-safe on target)"
	# shellcheck source=apt-with-stale-eggs-repo-fallback.sh
	source "${HERE}/apt-with-stale-eggs-repo-fallback.sh"
	highascg_apt_update
	highascg_apt_install exfatprogs parted python3 rsync v4l-utils
fi

echo "==> ISO defaults (Caspar config + optional embedded server)"
bash "${HERE}/install-iso-defaults.sh"

echo "==> dist-web for ISO squashfs + optional stick drop-update seed"
bash "${HERE}/ensure-dist-web-for-stick-seed.sh" "$USER_CASPAR"

if [[ "${HIGHASCG_SKIP_BOOT_BRANDING_IN_PREPARE:-0}" != "1" ]]; then
	echo "==> eggs GRUB/isolinux theme (persistence on default boot entry)"
	bash "${HERE}/install-eggs-live-grub-theme.sh"
else
	echo "==> Skip GRUB/Plymouth in prepare (build-highascg-egg.sh runs finalize once)"
fi

echo "==> empty mount stubs for squashfs (${HIGHASCG_ROOT}/media *, ~/exfat)"
bash "${HERE}/ensure-empty-live-usb-dirs.sh"

echo "==> Companion + highpass-highascg module (clone into squashfs)"
bash "${REPO_ROOT}/tools/eggs/companion/prepare-companion-for-eggs-clone.sh"

echo "==> Calamares (install-to-disk GUI on live ISO)"
bash "${HERE}/install-eggs-calamares.sh"

echo "==> GRUB BIOS + EFI (Calamares bootloader on Legacy and UEFI)"
bash "${HERE}/install-grub-for-calamares-iso.sh"

echo "==> Storage drivers (NVMe/VMD for Calamares partition page)"
bash "${HERE}/install-storage-drivers-for-iso.sh"

echo "==> Hardware hostname boot (highascg#### from MAC, WO-78)"
bash "${REPO_ROOT}/scripts/setup/16-hardware-hostname-boot.sh" "$USER_CASPAR"

echo "==> Kernel headers + DKMS tools (DeckLink / NVIDIA on installed playout)"
bash "${HERE}/install-kernel-headers-for-dkms-iso.sh"

echo "==> playout mount stubs under ${HIGHASCG_ROOT}"
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
touch /etc/highascg/server-update-retain-drop
echo "  installed /etc/highascg/server-update-retain-drop (live USB — keep drop-update/ across boots)"

echo "==> HighAsCG service unit ordering (depends on WO-47 when present)"
bash "${REPO_ROOT}/scripts/write-highascg-systemd-unit.sh" "$USER_CASPAR"

# WO-498: the nginx :80 proxy was removed — the operator UI is served directly on :4200, and a
# stale proxy would only shadow it. Clear it on clones that were prepared before that change.
if [[ -x "${REPO_ROOT}/scripts/runtime/remove-highascg-web-proxy.sh" ]]; then
	echo "==> operator UI on :4200 (removing any old nginx port-80 proxy)"
	bash "${REPO_ROOT}/scripts/runtime/remove-highascg-web-proxy.sh" || true
fi

if [[ "${SKIP_HIGHASCG_POWER_BUTTON:-0}" != "1" ]]; then
	echo "==> power button (short=network reset, hold 3s=shutdown)"
	bash "${REPO_ROOT}/scripts/setup/14-power-button-network-reset.sh"
fi

LIVE_BOOT_DROPIN="${HERE}/systemd/highascg.service.d-20-live-boot.conf.example"
if [[ -f "$LIVE_BOOT_DROPIN" ]]; then
	install -d /etc/systemd/system/highascg.service.d
	install -m 0644 "$LIVE_BOOT_DROPIN" /etc/systemd/system/highascg.service.d/20-live-boot.conf
	echo "  installed 20-live-boot.conf (faster AMCP settle + startup testcard)"
fi

API_AUTH_DROPIN="${HERE}/systemd/highascg.service.d-25-api-auth.conf.example"
if [[ "${HIGHASCG_EGG_ENFORCE_AUTH:-0}" == "1" ]] && [[ -f "$API_AUTH_DROPIN" ]]; then
	install -d /etc/systemd/system/highascg.service.d
	install -m 0644 "$API_AUTH_DROPIN" /etc/systemd/system/highascg.service.d/25-api-auth.conf
	echo "  installed 25-api-auth.conf (HIGHASCG_ENFORCE_AUTH=1 — token in .private/api-token on first boot)"
fi

if [[ "$SKIP_MERGE_EGGS_EXCLUDES" != "1" ]]; then
	if [[ "$HIGHASCG_ISO_EMBED_SERVER" == "1" ]]; then
		export HIGHASCG_EGGS_EXCLUDE_FRAGMENT="${HERE}/penguins-eggs-exclude-highascg-embed-server.list"
		echo "==> merge HighAsCG eggs excludes (embed server on ISO — standalone boot)"
	else
		export HIGHASCG_EGGS_EXCLUDE_FRAGMENT="${HERE}/penguins-eggs-exclude-highascg-fragment.list"
		echo "==> merge HighAsCG eggs excludes (WO-47 — server from exFAT drop-update/)"
	fi
	bash "${HERE}/merge-penguins-eggs-exclude-highascg.sh" --replace
	echo "==> merge DeckLink excludes (WO-92 — mask BMD on build host, omit from ISO)"
	HIGHASCG_EGGS_EXCLUDE_FRAGMENT="${HERE}/penguins-eggs-exclude-decklink.list" \
		bash "${HERE}/merge-penguins-eggs-exclude-highascg.sh"
fi

echo "==> clone host audit (swap inactive, no nvidia-pool, exclude.list)"
bash "${HERE}/audit-eggs-clone-host.sh"

echo "==> Caspar supervisor wiring (systemd owns run.sh; Openbox trimmed)"
bash "${REPO_ROOT}/scripts/setup/sync-caspar-supervisor-wiring.sh" "$USER_CASPAR"

echo "==> passwordless sudo (Nuclear Install to disk + Calamares on :0)"
bash "${REPO_ROOT}/scripts/setup/12-passwordless-sudo.sh" "$USER_CASPAR"

echo "==> Tailscale apt daemon (mask snap unit from build host clone)"
bash "${REPO_ROOT}/scripts/setup/install-tailscale-deb-for-iso.sh"

echo "==> fast boot (cap network wait-online; mask networkd-wait-online)"
bash "${REPO_ROOT}/scripts/boot/install-fast-boot-network.sh"

echo "==> post-boot QA scripts (tools/startup → squashfs; tools/eggs is excluded)"
bash "${HERE}/verify-startup-on-host.sh"

echo ""
echo "==> Ready for clone snapshot:"
echo "    sudo eggs produce --nointeractive --clone --max --excludes static --basename \"yourname\""
echo "    Or: sudo bash ${HERE}/build-highascg-egg.sh"
echo ""

if [[ "$SKIP_HIGHASCG_SYSTEMD_RESTART" != "1" ]]; then
	systemctl restart highascg.service 2>/dev/null || true
fi

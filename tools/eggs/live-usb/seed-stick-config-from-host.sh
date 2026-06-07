#!/usr/bin/env bash
# After flash + exFAT format: copy running playout config onto fresh HIGHASCGEXF.
#
# Skipped when HIGHASCG_SEED_STICK_CONFIG=0 (empty configs/ for field prep elsewhere).
#
# Usage:
#   sudo bash tools/eggs/live-usb/seed-stick-config-from-host.sh [/dev/sdX]
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"
MP="${HIGHASCG_EXFAT_ROOT:-/home/casparcg/exfat}"
DEV="${1:-}"

if [[ "${HIGHASCG_SEED_STICK_CONFIG:-1}" == "0" ]]; then
	echo "==> Skip stick config seed (HIGHASCG_SEED_STICK_CONFIG=0)"
	exit 0
fi

if [[ -n "$DEV" ]] && [[ -b "$DEV" ]]; then
	bash "${HERE}/unmount-usb-for-partitioning.sh" "$DEV" 2>/dev/null || true
fi

if ! blkid -L HIGHASCGEXF &>/dev/null; then
	echo "WARN: no LABEL=HIGHASCGEXF — skip config seed (exFAT partition missing?)" >&2
	exit 0
fi

mkdir -p "$MP"
if ! findmnt -n "$MP" &>/dev/null; then
	uid="$(id -u "$USER_CASPAR" 2>/dev/null || echo 1000)"
	gid="$(id -g "$USER_CASPAR" 2>/dev/null || echo 1000)"
	mount -t exfat -o "defaults,uid=${uid},gid=${gid},umask=002" -L HIGHASCGEXF "$MP"
fi

echo "==> Push playout config → ${MP}/configs/ (fresh stick seed)"
sudo -u "$USER_CASPAR" -H env HIGHASCG_ROOT="${REPO_ROOT}" \
	node "${REPO_ROOT}/tools/runtime/exfat-sync-cli.js" --push

n="$(find "${MP}/configs" -maxdepth 1 -type f 2>/dev/null | wc -l)"
echo "OK: stick configs/ has ${n} file(s) — $(findmnt -n -o SOURCE "$MP")"

#!/usr/bin/env bash
# After flash + exFAT format: write factory starter configs onto fresh HIGHASCGEXF.
# Does not copy the eggs build host's GPU map / device graph.
#
# Usage:
#   sudo bash tools/eggs/live-usb/seed-stick-factory-config.sh [/dev/sdX]
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"
DEV="${1:-}"

if [[ -n "$DEV" ]] && [[ -b "$DEV" ]]; then
	bash "${HERE}/unmount-usb-for-partitioning.sh" "$DEV" 2>/dev/null || true
fi

if ! blkid -L HIGHASCGEXF &>/dev/null; then
	echo "WARN: no LABEL=HIGHASCGEXF — skip factory config seed (exFAT partition missing?)" >&2
	exit 0
fi

MP="$(mktemp -d /tmp/highascg-exfat-factory-seed.XXXXXX)"
cleanup() {
	umount "$MP" 2>/dev/null || true
	rmdir "$MP" 2>/dev/null || true
}
trap cleanup EXIT

uid="$(id -u "$USER_CASPAR" 2>/dev/null || echo 1000)"
gid="$(id -g "$USER_CASPAR" 2>/dev/null || echo 1000)"
mount -t exfat -o "defaults,uid=${uid},gid=${gid},umask=002" -L HIGHASCGEXF "$MP"

echo "==> Write factory starter configs → ${MP}/configs/ (not build-host GPU layout)"
node "${HERE}/write-exfat-starter-bundle.js" "$MP"

n="$(find "${MP}/configs" -maxdepth 1 -type f 2>/dev/null | wc -l)"
echo "OK: stick configs/ has ${n} file(s) — $(findmnt -n -o SOURCE "$MP")"

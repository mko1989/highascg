#!/usr/bin/env bash
# Apply WO-52 bridge label HIGHASCGDAT on this host (systemd + sync map + layout).
# Run: sudo bash scripts/apply-bridge-label-highascgdat.sh [service_user]
set -euo pipefail

USER_CASPAR="${1:-casparcg}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL=HIGHASCGDAT
DEV="/dev/disk/by-label/${LABEL}"
MP="/home/casparcg/bridge"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo bash scripts/apply-bridge-label-highascgdat.sh" >&2
	exit 1
}

if ! blkid -L "$LABEL" &>/dev/null; then
	echo "ERROR: no block device with LABEL=${LABEL}. Format with:" >&2
	echo "  sudo mkfs.exfat -L ${LABEL} /dev/sdXN" >&2
	exit 1
fi
echo "OK: $(blkid -L "$LABEL")"

# Release desktop auto-mount so systemd can own the mount point.
if command -v udisksctl &>/dev/null; then
	udisksctl unmount -b "$(readlink -f "$DEV")" 2>/dev/null || true
fi

bash "${REPO}/scripts/install-exfat-systemd-units.sh" "$USER_CASPAR"
bash "${REPO}/tools/eggs/live-usb/install-exfat-sync-map.sh"
bash "${REPO}/scripts/write-highascg-systemd-unit.sh" "$USER_CASPAR" 2>/dev/null || true

bash "${REPO}/tools/eggs/live-usb/seed-bridge-operator-layout.sh" "$MP"

systemctl daemon-reload
systemctl enable home-casparcg-bridge.mount highascg-bridge-boot.service
systemctl start highascg-bridge-boot.service

echo ""
echo "Bridge mount:"
findmnt "$MP" || true
findmnt /home/casparcg/highascg/media/bridge || true
echo ""
echo "Sync map:"
grep -E '"version"|HIGHASCG' /etc/highascg/exfat-sync.json | head -5

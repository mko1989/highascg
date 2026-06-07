#!/usr/bin/env bash
# Stop WO-47/52 exFAT + bridge units and unmount volumes before eggs produce.
# Prevents baking stick/bridge disk content into filesystem.squashfs.
#
# Usage:
#   sudo bash tools/eggs/live-usb/stop-and-unmount-wo47-for-eggs-produce.sh
#
# Restore after produce:
#   sudo bash tools/eggs/live-usb/unmask-exfat-systemd.sh
#   sudo bash scripts/highascg-exfat-remount-sync.sh
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

MASK_RUNTIME="${MASK_RUNTIME:-1}"
STRICT="${STRICT:-1}"

# Longest paths first (bind mounts before parents).
WO47_UMOUNT_PATHS=(
	/home/casparcg/highascg/media/exfat
	/home/casparcg/highascg/media/bridge
	/home/casparcg/highascg/media
	/home/casparcg/exfat
	/home/casparcg/bridge
)

log() { echo "==> $*"; }

# findmnt -T matches parent mounts (/) — use only exact mount points.
wo47_is_mount_point() {
	local mp="$1"
	findmnt -n "$mp" >/dev/null 2>&1
}

stop_unit() {
	systemctl stop "$1" 2>/dev/null || true
}

mask_unit() {
	[[ "$MASK_RUNTIME" == "1" ]] || return 0
	systemctl mask --runtime "$1" 2>/dev/null || true
}

log "Stop playout + WO-47/WO-52 services"
systemctl stop highascg.service 2>/dev/null || true

for unit in \
	highascg-exfat-sync.service \
	highascg-exfat-server-update.service \
	highascg-fix-config-permissions.service \
	highascg-exfat-media-prep.service \
	highascg-bridge-media-prep.service \
	home-casparcg-highascg-media-exfat.mount \
	home-casparcg-highascg-media.mount \
	highascg-exfat-boot.service \
	highascg-bridge-boot.service \
	highascg-exfat-arrive.service \
	highascg-bridge-arrive.service \
	home-casparcg-exfat.mount \
	home-casparcg-bridge.mount; do
	stop_unit "$unit"
done

log "Mask runtime automount/arrive (prevent re-mount during produce)"
for unit in \
	highascg-exfat-arrive.service \
	highascg-bridge-arrive.service \
	home-casparcg-exfat.mount \
	home-casparcg-bridge.mount \
	home-casparcg-highascg-media-exfat.mount \
	home-casparcg-highascg-media.mount; do
	mask_unit "$unit"
done

log "Umount WO-47 paths (empty stubs only in squashfs)"
for mp in "${WO47_UMOUNT_PATHS[@]}"; do
	if ! wo47_is_mount_point "$mp"; then
		echo "  skip ${mp} (directory on root fs — not a mount point)"
		continue
	fi
	echo "  umount ${mp}"
	umount "$mp" 2>/dev/null || umount -l "$mp" 2>/dev/null || true
done

sleep 1

FAIL=0
for mp in "${WO47_UMOUNT_PATHS[@]}"; do
	if wo47_is_mount_point "$mp"; then
		echo "FAIL: still a mount point: ${mp}" >&2
		findmnt -n -o TARGET,SOURCE,FSTYPE "$mp" >&2 || true
		FAIL=$((FAIL + 1))
	else
		echo "OK: ${mp} is not mounted (root-fs stub OK for squashfs)"
	fi
done

if [[ "$FAIL" -gt 0 ]]; then
	if [[ "$STRICT" == "1" ]]; then
		echo "ERROR: umount WO-47 paths before eggs produce (or set STRICT=0 to warn only)." >&2
		exit 1
	fi
	echo "WARN: ${FAIL} WO-47 path(s) still mounted — squashfs may bake disk content." >&2
fi

echo "OK: WO-47 volumes stopped/unmounted for eggs produce"

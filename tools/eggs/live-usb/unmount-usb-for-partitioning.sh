#!/usr/bin/env bash
# Stop WO-47 exFAT units and unmount every mount backed by partitions on a whole disk.
# Usage: sudo bash tools/eggs/live-usb/unmount-usb-for-partitioning.sh /dev/sdX
set -euo pipefail

DEV="${1:?pass whole disk e.g. /dev/sda}"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Must run as root (sudo)." >&2
	exit 1
}
[[ -b "$DEV" ]] || {
	echo "Not a block device: $DEV" >&2
	exit 1
}

# Prevent udev arrive + automount from re-attaching the stick during partitioning.
systemctl mask --runtime highascg-exfat-arrive.service 2>/dev/null || true
systemctl mask --runtime home-casparcg-exfat.mount 2>/dev/null || true
systemctl mask --runtime home-casparcg-highascg-media-exfat.mount 2>/dev/null || true

systemctl stop highascg-exfat-sync.service highascg-exfat-arrive.service \
	highascg-exfat-server-update.service 2>/dev/null || true
systemctl stop home-casparcg-highascg-media-exfat.mount 2>/dev/null || true
systemctl stop home-casparcg-exfat.mount 2>/dev/null || true

# Bind mounts and subpaths first (longest TARGET first).
while read -r mnt; do
	[[ -n "$mnt" ]] || continue
	umount "$mnt" 2>/dev/null || umount -l "$mnt" 2>/dev/null || true
done < <(findmnt -rn -S "$DEV" -o TARGET 2>/dev/null | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2-)

while read -r pt; do
	[[ -n "$pt" ]] || continue
	umount "$pt" 2>/dev/null || umount -l "$pt" 2>/dev/null || true
done < <(lsblk -nrpo PATH "$DEV" 2>/dev/null || true)

sleep 1

if findmnt -rn -S "$DEV" &>/dev/null; then
	echo "Still mounted:" >&2
	findmnt -S "$DEV" >&2
	exit 1
fi

echo "OK: no mounts on partitions under $DEV"
echo "Note: exFAT units masked for this session; finish-operator-stick.sh unmasks when done."

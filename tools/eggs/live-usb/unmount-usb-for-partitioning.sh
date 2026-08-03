#!/usr/bin/env bash
# Stop WO-47 exFAT units and unmount every mount backed by partitions on a whole disk.
# Usage: sudo bash tools/eggs/live-usb/unmount-usb-for-partitioning.sh /dev/sdX
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=flash-stick-common.sh
source "${HERE}/flash-stick-common.sh"

DEV="${1:?pass whole disk e.g. /dev/sda}"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Must run as root (sudo)." >&2
	exit 1
}
[[ -b "$DEV" ]] || {
	echo "Not a block device: $DEV" >&2
	exit 1
}

usb_quiesce_stick_for_partitioning "$DEV"

# WO-416: the highascg USB auto-mount poller ticks every 3 s and only sees the
# inhibit file on its next tick — and a udisksctl mount may already be in flight.
# Verify over a window longer than one tick; re-unmount anything that reappears.
for attempt in 1 2 3; do
	sleep 4
	if ! findmnt -rn -S "$DEV" &>/dev/null; then
		break
	fi
	echo "Mount reappeared on $DEV (attempt ${attempt}/3) — unmounting again…" >&2
	usb_umount_disk_partitions "$DEV"
done

if findmnt -rn -S "$DEV" &>/dev/null; then
	echo "Still mounted after quiesce + 3 re-unmount attempts:" >&2
	findmnt -S "$DEV" >&2
	echo "Something keeps re-mounting $DEV — check 'journalctl -u udisks2 -n 20' before re-running." >&2
	exit 1
fi

echo "OK: no mounts on partitions under $DEV (held through a ${SECONDS}s settle window)"
echo "Note: exFAT units masked + auto-mount poller inhibited; finish-operator-stick.sh unmasks when done."

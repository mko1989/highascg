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
sleep 1

if findmnt -rn -S "$DEV" &>/dev/null; then
	echo "Still mounted:" >&2
	findmnt -S "$DEV" >&2
	exit 1
fi

echo "OK: no mounts on partitions under $DEV"
echo "Note: exFAT units masked for this session; finish-operator-stick.sh unmasks when done."

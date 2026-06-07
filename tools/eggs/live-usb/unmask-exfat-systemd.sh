#!/usr/bin/env bash
# Reverse runtime masks from unmount-usb-for-partitioning.sh / stop-and-unmount-wo47-for-eggs-produce.sh
[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}
systemctl unmask \
	highascg-exfat-arrive.service \
	highascg-bridge-arrive.service \
	home-casparcg-exfat.mount \
	home-casparcg-bridge.mount \
	home-casparcg-highascg-media-exfat.mount \
	home-casparcg-highascg-media.mount 2>/dev/null || true
systemctl daemon-reload 2>/dev/null || true

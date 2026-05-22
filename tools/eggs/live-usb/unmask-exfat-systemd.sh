#!/usr/bin/env bash
# Reverse runtime masks from unmount-usb-for-partitioning.sh
systemctl unmask home-casparcg-exfat.mount home-casparcg-highascg-media-exfat.mount highascg-exfat-arrive.service 2>/dev/null || true
systemctl daemon-reload 2>/dev/null || true

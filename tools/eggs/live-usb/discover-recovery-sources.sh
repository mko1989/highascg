#!/usr/bin/env bash
# Bash builtins only — run on broken host over SSH (no ls/grep needed).
shopt -s nullglob
echo "==> recovery source discovery"
for f in \
	/home/eggs/mnt/iso/live/filesystem.squashfs \
	/home/eggs/mnt/*.iso \
	/home/eggs/*.iso; do
	[[ -f "$f" ]] && echo "FOUND_ISO_OR_SQ: $f"
done
[[ -f /home/eggs/liveroot/usr/bin/bash ]] && echo "FOUND_LIVEROOT_USR: /home/eggs/liveroot/usr"
[[ -f /home/casparcg/highascg/package.json ]] && echo "FOUND_REPO: /home/casparcg/highascg"
[[ -x /home/casparcg/busybox ]] && echo "FOUND_BUSYBOX: /home/casparcg/busybox"
[[ -x /root/busybox ]] && echo "FOUND_BUSYBOX: /root/busybox"
echo "done"

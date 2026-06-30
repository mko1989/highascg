#!/usr/bin/env bash
# Stop memory-heavy playout services during npm ci / vite build on the ISO build host.
# Companion alone has been observed at ~60GB RSS; with swap disabled this can OOM the box.
#
#   sudo bash tools/eggs/live-usb/pause-heavy-services-for-iso-build.sh pause
#   sudo bash tools/eggs/live-usb/pause-heavy-services-for-iso-build.sh restore
set -euo pipefail

STATE_DIR=/var/lib/highascg/iso-build-paused-services

pause_services() {
	mkdir -p "$STATE_DIR"
	local unit
	for unit in companion.service highascg.service casparcg-server.service; do
		if systemctl is-active --quiet "$unit" 2>/dev/null; then
			touch "${STATE_DIR}/${unit}"
			echo "==> stopping ${unit} (ISO build — frees RAM for npm/vite)"
			systemctl stop "$unit" || true
		fi
	done
}

restore_services() {
	[[ -d "$STATE_DIR" ]] || return 0
	local unit f
	for f in "$STATE_DIR"/*; do
		[[ -f "$f" ]] || continue
		unit="$(basename "$f")"
		echo "==> restarting ${unit}"
		systemctl start "$unit" 2>/dev/null || true
		rm -f "$f"
	done
	rmdir "$STATE_DIR" 2>/dev/null || true
}

case "${1:-}" in
pause) pause_services ;;
restore) restore_services ;;
-h | --help)
	echo "Usage: sudo $0 pause|restore"
	exit 0
	;;
*)
	echo "Usage: sudo $0 pause|restore" >&2
	exit 1
	;;
esac

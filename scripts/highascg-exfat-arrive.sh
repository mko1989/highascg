#!/usr/bin/env bash
# Mount LABEL=HIGHASCGEXF and run the WO-47 pipeline when the stick appears after boot.
# Invoked by udev (99-highascg-exfat-arrive.rules) and safe to run manually as root.
set -euo pipefail

EXFAT_MP="/home/casparcg/exfat"
LABEL_NODE="/dev/disk/by-label/HIGHASCGEXF"

log() {
	echo "[highascg-exfat-arrive] $*" >&2
}

start_unit() {
	local u="$1"
	if ! systemctl start --no-block "$u"; then
		log "warning: systemctl start --no-block ${u} failed (continuing)"
	fi
}

# udev can fire before the by-label symlink exists.
for _ in $(seq 1 20); do
	[[ -e "$LABEL_NODE" ]] && break
	sleep 0.25
done
if [[ ! -e "$LABEL_NODE" ]]; then
	log "device node missing (${LABEL_NODE}); nothing to do"
	exit 0
fi

if ! mountpoint -q "$EXFAT_MP"; then
	start_unit home-casparcg-exfat.mount
fi
if ! mountpoint -q "$EXFAT_MP"; then
	log "exFAT not mounted at ${EXFAT_MP}"
	exit 0
fi

# Legacy sticks: sim/highascg/ is not used on Linux playout (drop-update/ only).
if [[ -d "${EXFAT_MP}/sim" ]]; then
	log "removing deprecated ${EXFAT_MP}/sim (not synced on current images)"
	rm -rf "${EXFAT_MP}/sim"
	sync 2>/dev/null || true
fi

start_unit highascg-exfat-media-prep.service
if [[ -f /etc/highascg/legacy-usb-media-bind ]]; then
	start_unit home-casparcg-highascg-media-exfat.mount
fi
start_unit highascg-exfat-server-update.service
start_unit highascg-exfat-sync.service

log "pipeline finished for ${EXFAT_MP}"
exit 0

#!/usr/bin/env bash
# Mount LABEL=HIGHASCGDAT and bind media when the internal disk appears after boot (slow NVMe).
# Invoked by udev (99-highascg-bridge-arrive.rules).
set -euo pipefail

BRIDGE_MP="/home/casparcg/bridge"
LABEL_NODE="/dev/disk/by-label/HIGHASCGDAT"

log() {
	echo "[highascg-bridge-arrive] $*" >&2
}

start_unit() {
	local u="$1"
	if ! systemctl start --no-block "$u"; then
		log "warning: systemctl start --no-block ${u} failed (continuing)"
	fi
}

for _ in $(seq 1 40); do
	[[ -e "$LABEL_NODE" ]] && break
	sleep 0.25
done
if [[ ! -e "$LABEL_NODE" ]]; then
	log "device node missing (${LABEL_NODE}); nothing to do"
	exit 0
fi

if mountpoint -q "$BRIDGE_MP"; then
	log "already mounted: ${BRIDGE_MP}"
else
	start_unit home-casparcg-bridge.mount
	if ! mountpoint -q "$BRIDGE_MP"; then
		log "running bridge-boot fallback"
		systemctl start highascg-bridge-boot.service 2>/dev/null || true
	fi
fi

if ! mountpoint -q "$BRIDGE_MP"; then
	log "bridge not mounted at ${BRIDGE_MP}"
	exit 0
fi

start_unit highascg-bridge-media-prep.service
start_unit home-casparcg-highascg-media.mount

# Config sync may have run before bridge was up — safe to run again.
if systemctl is-active highascg.service &>/dev/null; then
	start_unit highascg-exfat-sync.service
fi

log "bridge pipeline finished for ${BRIDGE_MP}"
exit 0

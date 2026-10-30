#!/usr/bin/env bash
# Mount LABEL=HIGHASCGEXF and run the WO-47 pipeline when the stick appears after boot.
# Invoked by udev (99-highascg-exfat-arrive.rules) and safe to run manually as root.
set -euo pipefail

EXFAT_MP="${HIGHASCG_EXFAT_MP:-/home/casparcg/exfat}"
LABEL_NODE="${HIGHASCG_EXFAT_LABEL_NODE:-/dev/disk/by-label/HIGHASCGEXF}"
# WO-842: how long to wait for the queued mount job (see below). Env override is for tests.
MOUNT_WAIT_SEC="${HIGHASCG_EXFAT_ARRIVE_MOUNT_WAIT_SEC:-15}"

log() {
	echo "[highascg-exfat-arrive] $*" >&2
}

start_unit() {
	local u="$1"
	local block="${2:-0}"
	if [[ "$block" == "1" ]]; then
		if ! systemctl start "$u"; then
			log "warning: systemctl start ${u} failed (continuing)"
		fi
	else
		if ! systemctl start --no-block "$u"; then
			log "warning: systemctl start --no-block ${u} failed (continuing)"
		fi
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
	# WO-842 (sweep 5 Ops): `systemctl start --no-block` only QUEUES the job, so the check right after it was almost
	# always false — "exFAT not mounted" + exit 0 and the whole late-plug pipeline (server update, network apply,
	# DeckLink install, sync) never ran (68 "not mounted" vs 46 "finished" in the journal). Poll, as
	# highascg-exfat-boot.sh does for the same race.
	for _ in $(seq 1 $((MOUNT_WAIT_SEC * 4))); do
		mountpoint -q "$EXFAT_MP" && break
		sleep 0.25
	done
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
start_unit home-casparcg-highascg-media-exfat.mount
# Block until drop-update apply finishes — late USB must not start highascg on stale squashfs.
start_unit highascg-exfat-server-update.service 1
start_unit highascg-exfat-network-apply.service 1
start_unit highascg-decklink-install.service 1
start_unit highascg-exfat-sync.service

log "pipeline finished for ${EXFAT_MP}"
exit 0

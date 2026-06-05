#!/usr/bin/env bash
# WO-52: wait for LABEL=HIGHASCGDAT, mount bridge volume, bind media → ~/highascg/media.
set -euo pipefail

LABEL="${BRIDGE_LABEL:-HIGHASCGDAT}"
MP="${HIGHASCG_BRIDGE_ROOT:-/home/casparcg/bridge}"
DEV="/dev/disk/by-label/${LABEL}"
# NVMe often enumerates after USB live boot; 8s was too short on laptop playout boxes.
WAIT_SEC="${HIGHASCG_BRIDGE_BOOT_WAIT_SEC:-45}"
LOG=/var/log/highascg-bridge-boot.log

log() {
	echo "[$(date -Iseconds)] $*" | tee -a "$LOG" >&2
	logger -t highascg-bridge-boot -- "$@"
}

[[ "$(id -u)" -eq 0 ]] || {
	echo "root required" >&2
	exit 1
}

mkdir -p "$(dirname "$LOG")"
touch "$LOG"

if findmnt -n "$MP" &>/dev/null; then
	log "Already mounted: $MP ($(findmnt -n -o SOURCE "$MP"))"
else
	log "Waiting up to ${WAIT_SEC}s for ${DEV} (blk-availability + by-label)"
	found=0
	# Give block layer time (USB boots before internal NVMe on many laptops).
	if systemctl start blk-availability.target 2>>"$LOG"; then
		:
	fi
	for ((i = 0; i < WAIT_SEC; i++)); do
		if [[ -e "$DEV" ]]; then
			found=1
			break
		fi
		sleep 1
	done
	if [[ "$found" -eq 0 ]]; then
		log "No ${LABEL} bridge volume — using local ~/highascg/media only"
		exit 0
	fi
	log "Device present: $(readlink -f "$DEV" 2>/dev/null || echo "$DEV")"
	if ! systemctl start --no-block home-casparcg-bridge.mount 2>>"$LOG"; then
		uid="$(id -u casparcg 2>/dev/null || echo 1000)"
		gid="$(id -g casparcg 2>/dev/null || echo 1000)"
		mkdir -p "$MP"
		mount -t exfat -o "defaults,uid=${uid},gid=${gid},umask=002" "$DEV" "$MP" \
			|| mount -o "defaults,uid=${uid},gid=${gid},umask=002" "$DEV" "$MP" \
			|| {
				log "WARN: mount failed for $DEV on $MP — using local ~/highascg/media only"
				exit 0
			}
	fi
	for ((i = 0; i < 30; i++)); do
		findmnt -n "$MP" &>/dev/null && break
		sleep 1
	done
	if ! findmnt -n "$MP" &>/dev/null; then
		log "WARN: $MP still not mounted — using local ~/highascg/media only"
		exit 0
	fi
	log "Mounted $MP ← $(findmnt -n -o SOURCE,FSTYPE "$MP")"
fi

for unit in highascg-bridge-media-prep.service home-casparcg-highascg-media.mount; do
	if systemctl cat "$unit" &>/dev/null; then
		log "Queueing $unit (--no-block)"
		systemctl start --no-block "$unit" 2>>"$LOG" || log "WARN: queue ${unit} failed"
	fi
done

log "WO-52 bridge media chain finished"
exit 0

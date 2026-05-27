#!/usr/bin/env bash
# WO-47 boot: wait for LABEL=HIGHASCGEXF, mount ~/exfat, queue bind + server-update + sync.
# Installed as highascg-exfat-boot.service.
#
# Do not use blocking `systemctl start` on units listed in this unit's Before= (deadlock).
set -euo pipefail

LABEL="${EXFAT_LABEL:-HIGHASCGEXF}"
MP="${HIGHASCG_EXFAT_ROOT:-/home/casparcg/exfat}"
DEV="/dev/disk/by-label/${LABEL}"
# Short wait when no operator stick (imaging host / internal disk only).
WAIT_SEC="${HIGHASCG_EXFAT_BOOT_WAIT_SEC:-5}"
LOG=/var/log/highascg-exfat-boot.log

log() {
	echo "[$(date -Iseconds)] $*" | tee -a "$LOG" >&2
	logger -t highascg-exfat-boot -- "$@"
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
	log "Waiting up to ${WAIT_SEC}s for ${DEV}"
	found=0
	for ((i = 0; i < WAIT_SEC; i++)); do
		if [[ -e "$DEV" ]]; then
			found=1
			break
		fi
		sleep 1
	done
	if [[ "$found" -eq 0 ]]; then
		log "No ${LABEL} volume — exFAT pipeline skipped (no operator data partition)"
		exit 0
	fi
	log "Device present: $(readlink -f "$DEV" 2>/dev/null || echo "$DEV")"

	if ! systemctl start --no-block home-casparcg-exfat.mount 2>>"$LOG"; then
		log "systemd mount unit failed — trying direct mount"
		uid="$(id -u casparcg 2>/dev/null || echo 1000)"
		gid="$(id -g casparcg 2>/dev/null || echo 1000)"
		mkdir -p "$MP"
		if ! mountpoint -q "$MP"; then
			mount -t exfat -o "defaults,uid=${uid},gid=${gid},umask=002" "$DEV" "$MP" \
				|| mount -o "defaults,uid=${uid},gid=${gid},umask=002" "$DEV" "$MP" \
				|| {
					log "ERROR: mount failed for $DEV on $MP"
					exit 1
				}
		fi
	fi

	for ((i = 0; i < 30; i++)); do
		if findmnt -n "$MP" &>/dev/null; then
			break
		fi
		sleep 1
	done

	if ! findmnt -n "$MP" &>/dev/null; then
		log "ERROR: $MP still not a mount point after mount attempts"
		exit 1
	fi
	log "Mounted $MP ← $(findmnt -n -o SOURCE,FSTYPE "$MP")"
fi

for unit in \
	highascg-exfat-media-prep.service \
	home-casparcg-highascg-media-exfat.mount \
	highascg-exfat-server-update.service; do
	if systemctl cat "$unit" &>/dev/null; then
		log "Queueing $unit (--no-block)"
		systemctl start --no-block "$unit" 2>>"$LOG" || log "WARN: queue ${unit} failed"
	else
		log "Skip missing unit $unit"
	fi
done

if systemctl cat highascg-exfat-sync.service &>/dev/null; then
	log "Starting highascg-exfat-sync.service (blocking)"
	systemctl start highascg-exfat-sync.service 2>>"$LOG" || log "WARN: exfat-sync failed or skipped"
else
	log "Skip missing unit highascg-exfat-sync.service"
fi

log "WO-47 boot chain finished"
exit 0

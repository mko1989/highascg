#!/usr/bin/env bash
# WO-52 bridge (HIGHASCGDAT) then WO-47 USB (HIGHASCGEXF). Both optional — RAM-only boot is fine.
set -euo pipefail

USB_LABEL="${EXFAT_LABEL:-HIGHASCGEXF}"
MP="${HIGHASCG_EXFAT_ROOT:-/home/casparcg/exfat}"
if [[ -d /run/live ]]; then
	WAIT_SEC="${HIGHASCG_EXFAT_BOOT_WAIT_SEC:-30}"
else
	WAIT_SEC="${HIGHASCG_EXFAT_BOOT_WAIT_SEC:-12}"
fi
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
	log "Already mounted: $MP ($(findmnt -n -o SOURCE,FSTYPE "$MP")) — continue pipeline"
else
	log "Waiting up to ${WAIT_SEC}s for USB exFAT label ${USB_LABEL}"
	found=0
	for ((i = 0; i < WAIT_SEC; i++)); do
		if [[ -e "$USB_DEV" ]]; then
			found=1
			break
		fi
		sleep 1
	done
	if [[ "$found" -eq 0 ]]; then
		log "No ${USB_LABEL} USB volume — USB pipeline skipped (RAM / ISO config only)"
		exit 0
	fi
	log "Device present: $(readlink -f "$USB_DEV" 2>/dev/null || echo "$USB_DEV")"

	if ! systemctl start --no-block home-casparcg-exfat.mount 2>>"$LOG"; then
		uid="$(id -u casparcg 2>/dev/null || echo 1000)"
		gid="$(id -g casparcg 2>/dev/null || echo 1000)"
		mkdir -p "$MP"
		if ! mountpoint -q "$MP"; then
			mount -t exfat -o "defaults,uid=${uid},gid=${gid},umask=002" "$USB_DEV" "$MP" \
				|| mount -o "defaults,uid=${uid},gid=${gid},umask=002" "$USB_DEV" "$MP" \
				|| {
					log "WARN: direct mount failed — trying home-casparcg-exfat.mount"
					systemctl reset-failed home-casparcg-exfat.mount 2>>"$LOG" || true
					systemctl start home-casparcg-exfat.mount 2>>"$LOG" || true
				}
		fi
	fi

	for ((i = 0; i < 45; i++)); do
		findmnt -n "$MP" &>/dev/null && break
		sleep 1
	done
	if ! findmnt -n "$MP" &>/dev/null; then
		log "ERROR: $MP still not a mount point after mount attempts"
		exit 1
	fi
	log "Mounted $MP ← $(findmnt -n -o SOURCE,FSTYPE "$MP")"
else
	log "Already mounted: $MP ($(findmnt -n -o SOURCE "$MP"))"
fi

for unit in highascg-exfat-media-prep.service; do
	if systemctl cat "$unit" &>/dev/null; then
		log "Queueing $unit (--no-block)"
		systemctl start --no-block "$unit" 2>>"$LOG" || log "WARN: queue ${unit} failed"
	fi
done

if systemctl cat highascg-exfat-server-update.service &>/dev/null; then
	log "Starting highascg-exfat-server-update.service (blocking — apply drop-update/ before highascg)"
	systemctl start highascg-exfat-server-update.service 2>>"$LOG" || log "WARN: server-update failed or skipped"
fi

if systemctl cat highascg-decklink-install.service &>/dev/null; then
	log "Starting highascg-decklink-install.service (operator Desktop Video debs on decklink/)"
	systemctl start highascg-decklink-install.service 2>>"$LOG" || log "WARN: decklink-install failed or skipped"
fi

if systemctl cat home-casparcg-highascg-media-exfat.mount &>/dev/null; then
	log "Queueing home-casparcg-highascg-media-exfat.mount (~/exfat/media → ~/highascg/media/exfat)"
	systemctl start --no-block home-casparcg-highascg-media-exfat.mount 2>>"$LOG" || log "WARN: queue exfat media bind failed"
fi

if systemctl cat highascg-exfat-sync.service &>/dev/null; then
	# Must be --no-block: exfat-sync.service After=highascg-exfat-boot.service.
	# A blocking start here deadlocks until TimeoutStartSec (90s) then highascg starts late.
	log "Queueing highascg-exfat-sync.service (--no-block; highascg.service waits on it)"
	systemctl start --no-block highascg-exfat-sync.service 2>>"$LOG" || log "WARN: queue exfat-sync failed"
else
	log "Skip missing unit highascg-exfat-sync.service"
fi

log "WO-47 USB + WO-52 bridge boot chain finished"
exit 0

#!/usr/bin/env bash
# WO-52 bridge (HIGHASCGDAT) then WO-47 USB (HIGHASCGEXF). Both optional — RAM-only boot is fine.
set -euo pipefail

USB_LABEL="${EXFAT_LABEL:-HIGHASCGEXF}"
USB_DEV="/dev/disk/by-label/${USB_LABEL}"
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

# Ventoy sticks: the data partition is also the boot medium. Ventoy maps the booted ISO's extents
# out of it with device-mapper, and dm holds the raw partition open O_EXCL — mount(2) on
# /dev/sdX1 then returns EBUSY forever. Ventoy also exposes a 1:1 linear map of the whole
# partition under /dev/mapper/<part>, which is mountable. Pick that when it exists; the smaller
# ISO-extent map (named "ventoy") is skipped by the size check.
SYSFS_BLOCK="${HIGHASCG_SYSFS_BLOCK:-/sys/class/block}"
DEV_MAPPER="${HIGHASCG_DEV_MAPPER:-/dev/mapper}"

resolve_usb_dev() {
	local raw base holder name
	raw="$(readlink -f "$USB_DEV" 2>/dev/null || echo "$USB_DEV")"
	base="${raw#/dev/}"
	[[ -d "${SYSFS_BLOCK}/${base}/holders" ]] || {
		printf '%s' "$raw"
		return 0
	}
	for holder in "${SYSFS_BLOCK}/${base}/holders/"dm-*; do
		[[ -e "${holder}/dm/name" ]] || continue
		[[ "$(cat "${holder}/size" 2>/dev/null || echo 0)" == "$(cat "${SYSFS_BLOCK}/${base}/size" 2>/dev/null || echo -1)" ]] || continue
		name="$(cat "${holder}/dm/name" 2>/dev/null || true)"
		[[ -n "$name" && -e "${DEV_MAPPER}/${name}" ]] || continue
		if [[ "$(blkid -p -s TYPE -o value "${DEV_MAPPER}/${name}" 2>/dev/null || true)" == "exfat" ]]; then
			printf '%s/%s' "$DEV_MAPPER" "$name"
			return 0
		fi
	done
	printf '%s' "$raw"
}

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

	uid="$(id -u casparcg 2>/dev/null || echo 1000)"
	gid="$(id -g casparcg 2>/dev/null || echo 1000)"
	MOUNT_DEV="$(resolve_usb_dev)"
	mkdir -p "$MP"

	# home-casparcg-exfat.mount hardcodes What=/dev/disk/by-label/… so it can only work when the
	# raw partition is mountable.
	#
	# The start MUST stay --no-block. This service is Before=highascg.service with
	# TimeoutStartSec=300, and a blocking systemctl start here has previously delayed the whole
	# stack — that is why the original code used --no-block. WO-458 briefly made it blocking to
	# reach the fallback below; that was the wrong lever. The real defect was that the fallback
	# hung off the systemctl exit code (--no-block always exits 0, so it was dead code). The
	# fallback now hangs off `mountpoint`, which is the actual question, so the start can stay
	# asynchronous. Poll briefly: the unit carries device-timeout=5 / mount-timeout=5.
	if [[ "$MOUNT_DEV" == "${DEV_MAPPER}"/* ]]; then
		log "Raw partition held by device-mapper (Ventoy stick) — mounting ${MOUNT_DEV} directly"
	else
		systemctl start --no-block home-casparcg-exfat.mount 2>>"$LOG" || true
		for ((i = 0; i < 10; i++)); do
			mountpoint -q "$MP" && break
			sleep 1
		done
	fi

	if ! mountpoint -q "$MP"; then
		log "Unit did not mount $MP — direct mount of ${MOUNT_DEV}"
		systemctl reset-failed home-casparcg-exfat.mount 2>>"$LOG" || true
		mount -t exfat -o "defaults,uid=${uid},gid=${gid},umask=002" "$MOUNT_DEV" "$MP" 2>>"$LOG" \
			|| mount -o "defaults,uid=${uid},gid=${gid},umask=002" "$MOUNT_DEV" "$MP" 2>>"$LOG" \
			|| log "WARN: direct mount of ${MOUNT_DEV} failed"
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
fi

for unit in highascg-exfat-media-prep.service; do
	if systemctl cat "$unit" &>/dev/null; then
		log "Queueing $unit (--no-block)"
		systemctl start --no-block "$unit" 2>>"$LOG" || log "WARN: queue ${unit} failed"
	fi
done

if systemctl cat highascg-exfat-network-apply.service &>/dev/null; then
	log "Queueing highascg-exfat-network-apply.service (--no-block)"
	systemctl start --no-block highascg-exfat-network-apply.service 2>>"$LOG" || log "WARN: queue exfat-network-apply failed"
fi

if systemctl cat highascg-exfat-server-update.service &>/dev/null; then
	log "Queueing highascg-exfat-server-update.service (--no-block; exfat-sync waits on it)"
	systemctl start --no-block highascg-exfat-server-update.service 2>>"$LOG" || log "WARN: queue server-update failed"
fi

if systemctl cat highascg-decklink-install.service &>/dev/null; then
	dl_st="$(systemctl is-active highascg-decklink-install.service 2>/dev/null || true)"
	if [[ "$dl_st" == "active" ]]; then
		log "Skip highascg-decklink-install.service (already active this boot)"
	elif [[ "$dl_st" == "activating" ]]; then
		log "Skip highascg-decklink-install.service (still running from earlier start)"
	elif dpkg-query -W -f='${Status}' desktopvideo 2>/dev/null | grep -qE 'install ok installed'; then
		if lspci 2>/dev/null | grep -qi blackmagic && ! lsmod 2>/dev/null | grep -q blackmagic; then
			log "Queueing highascg-decklink-install.service (desktopvideo installed but module missing)"
			systemctl start --no-block highascg-decklink-install.service 2>>"$LOG" || log "WARN: queue decklink-install failed"
		else
			log "Skip queue highascg-decklink-install.service (desktopvideo OK — manual run to upgrade)"
		fi
	else
		log "Queueing highascg-decklink-install.service (--no-block; DKMS may take several minutes)"
		systemctl start --no-block highascg-decklink-install.service 2>>"$LOG" || log "WARN: queue decklink-install failed"
	fi
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

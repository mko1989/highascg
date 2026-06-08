#!/usr/bin/env bash
# DEPRECATED: sim/highascg seed — disabled by default (/etc/highascg/disable-exfat-bootstrap).
# Use drop-update/ via highascg-exfat-server-update.sh instead.
#
# Seed /home/casparcg/highascg from exFAT sim/highascg when the squashfs omitted the Node tree.
# Runs before highascg-exfat-sync (node). Idempotent: skips if ~/highascg/package.json exists.
#
# Environment (set by systemd):
#   HIGHASCG_SERVICE_USER  — casparcg (default)
#
# Optional files:
#   /etc/highascg/disable-exfat-bootstrap     — disable entirely
#   /etc/highascg/force-exfat-bootstrap-once — next boot: run even if package.json exists (removes itself)
#
set -euo pipefail

USER_NAME="${HIGHASCG_SERVICE_USER:-casparcg}"
DISABLE="/etc/highascg/disable-exfat-bootstrap"
SRC="/home/casparcg/exfat/sim/highascg"
DST="/home/casparcg/highascg"
MERGE="${HIGHASCG_BOOTSTRAP_EXCLUDES:-/etc/highascg/bootstrap-rsync-excludes.txt}"
LOCK=/run/highascg/bootstrap.lock

log() {
	echo "[highascg-exfat-bootstrap] $*" >&2
}

main() {
	[[ "$(id -u)" -eq 0 ]] || {
		log "must run as root"; exit 1
	}

	if [[ -f "$DISABLE" ]]; then
		log "disabled ($DISABLE)."
		exit 0
	fi
	if [[ ! -d "$SRC" ]]; then
		log "no $SRC."
		exit 0
	fi
	if [[ ! -f "${SRC}/package.json" ]]; then
		log "stick has no sim/highascg/package.json."
		exit 0
	fi

	getent passwd "$USER_NAME" >/dev/null || {
		log "no such user $USER_NAME."; exit 1
	}

	local force=""
	[[ -f /etc/highascg/force-exfat-bootstrap-once ]] && {
		rm -f /etc/highascg/force-exfat-bootstrap-once
		force=1
		log "force-exfat-bootstrap-once consumed."
	}

	if [[ -f "${DST}/package.json" && -z "$force" ]]; then
		log "destination already seeded (package.json present)."
		exit 0
	fi

	if [[ "${HIGHASCG_BOOTSTRAP_DRY_RUN:-}" == "1" ]]; then
		log "DRY RUN: would rsync $SRC/ → $DST/"
		exit 0
	fi

	mkdir -p /run/highascg "$DST"
	install -o "$USER_NAME" -g "$(id -gn "$USER_NAME")" -d "$DST" 2>/dev/null || \
		chown "$USER_NAME:$(id -gn "$USER_NAME")" "$DST" 2>/dev/null || true

	command -v rsync >/dev/null 2>&1 || {
		log "missing rsync (apt install rsync)."; exit 1
	}

	local grp
	grp="$(id -gn "$USER_NAME")"

	(
		flock -n 200 || {
			log "lock busy — exiting."
			exit 0
		}
		local xtra=()
		[[ -f "$MERGE" ]] && xtra+=(--exclude-from="$MERGE")
		rsync "${xtra[@]}" -rlptgoD "${SRC%/}/" "${DST%/}/"
		chown -R "${USER_NAME}:${grp}" "${DST%/}" || true
		touch "${DST}/.seeded-from-exfat" 2>/dev/null || true
		chown "${USER_NAME}:${grp}" "${DST}/.seeded-from-exfat" 2>/dev/null || true
		log "rsync seed complete ($SRC → $DST)."
	) 200>"$LOCK"

	exit 0
}

main "$@"

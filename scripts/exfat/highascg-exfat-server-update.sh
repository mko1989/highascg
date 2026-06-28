#!/usr/bin/env bash
# Apply a server drop from exFAT: /home/casparcg/exfat/drop-update/
#
# Operators unpack highascg-server_*.tar.gz into drop-update/ on the stick.
# On boot (before highascg.service):
#   1. stop highascg.service
#   2. rsync drop-update/ → ~/highascg/ (includes dist-web/)
#   3. optional npm ci when package-lock.json was in the drop
#   4. retain drop on live USB (WO-66) OR archive to applied/<UTC>/ on persistent install
#   5. start highascg.service
#
# Disable: /etc/highascg/disable-exfat-server-update
# Dry run: HIGHASCG_SERVER_UPDATE_DRY_RUN=1
#
set -euo pipefail

USER_NAME="${HIGHASCG_SERVICE_USER:-casparcg}"
DISABLE="/etc/highascg/disable-exfat-server-update"
EXFAT_ROOT="/home/casparcg/exfat"
DROP_UPDATE="${EXFAT_ROOT}/drop-update"
LEGACY_UPDATE="${EXFAT_ROOT}/update/server"
DST="/home/casparcg/highascg"
EXCLUDES="/etc/highascg/server-update-rsync-excludes.txt"
LOCK=/run/highascg/server-update.lock
SERVICE=highascg.service

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLY_SH="${HIGHASCG_APPLY_SERVER_DROP_SH:-/usr/local/lib/highascg/highascg-apply-server-drop.sh}"
[[ -f "$APPLY_SH" ]] || APPLY_SH="${SCRIPT_DIR}/highascg-apply-server-drop.sh"

log() {
	echo "[highascg-exfat-server-update] $*" >&2
}

resolve_drop_src() {
	if [[ -f "${DROP_UPDATE}/package.json" ]]; then
		echo "$DROP_UPDATE"
		return 0
	fi
	if [[ -f "${LEGACY_UPDATE}/package.json" ]]; then
		log "using legacy ${LEGACY_UPDATE}/ — move future drops to ${DROP_UPDATE}/"
		echo "$LEGACY_UPDATE"
		return 0
	fi
	return 1
}

is_legacy_src() {
	[[ "${1:-}" == "$LEGACY_UPDATE" ]]
}

stop_service() {
	if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
		log "stopping $SERVICE"
		systemctl stop "$SERVICE"
	else
		log "$SERVICE not active (skip stop)"
	fi
}

start_service() {
	if [[ ! -f "${DST}/package.json" ]]; then
		log "no ${DST}/package.json — not starting $SERVICE"
		return 0
	fi
	if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
		log "$SERVICE already active (skip start)"
		return 0
	fi
	# --no-block: avoid deadlock when highascg.service Wants= this unit (legacy units).
	log "queue $SERVICE (--no-block)"
	systemctl start --no-block "$SERVICE" 2>/dev/null || true
}

main() {
	[[ "$(id -u)" -eq 0 ]] || {
		log "must run as root"
		exit 1
	}

	if [[ -f "$DISABLE" ]]; then
		log "disabled ($DISABLE)."
		exit 0
	fi

	if ! mountpoint -q "$EXFAT_ROOT" 2>/dev/null; then
		log "exFAT not mounted at $EXFAT_ROOT."
		exit 0
	fi

	local SRC
	if ! SRC="$(resolve_drop_src)"; then
		log "no pending update (${DROP_UPDATE}/package.json missing)."
		exit 0
	fi

	getent passwd "$USER_NAME" >/dev/null || {
		log "no such user $USER_NAME."
		exit 1
	}

	command -v rsync >/dev/null 2>&1 || {
		log "missing rsync."
		exit 1
	}

	[[ -x "$APPLY_SH" ]] || {
		log "missing apply helper: $APPLY_SH"
		exit 1
	}

	mkdir -p /run/highascg
	(
		flock -n 200 || {
			log "lock busy — exiting."
			exit 0
		}

		local legacy_flag=()
		if is_legacy_src "$SRC"; then
			legacy_flag=(--legacy-src)
		fi

		local apply_args=(
			--source "$SRC"
			--dest "$DST"
			--drop-update-root "$DROP_UPDATE"
			--user "$USER_NAME"
			--excludes "$EXCLUDES"
			--auto-retain
			"${legacy_flag[@]}"
		)
		if [[ "${HIGHASCG_SERVER_UPDATE_ARCHIVE_COPY:-}" == "1" ]]; then
			apply_args+=(--archive-copy)
		fi
		if [[ "${HIGHASCG_SERVER_UPDATE_DRY_RUN:-}" == "1" ]]; then
			apply_args+=(--dry-run)
			log "DRY RUN: would apply ${SRC}/ → ${DST}/"
			"$APPLY_SH" "${apply_args[@]}"
			exit 0
		fi

		stop_service

		if ! "$APPLY_SH" "${apply_args[@]}"; then
			log "apply failed — starting previous tree if present"
			start_service
			exit 1
		fi

		start_service
		log "server update applied."
	) 200>"$LOCK"

	exit 0
}

main "$@"

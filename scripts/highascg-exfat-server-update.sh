#!/usr/bin/env bash
# Apply a server-only drop from exFAT: /home/casparcg/exfat/drop-update/
# Delegates to highascg-apply-server-drop.sh (merge-only — never deletes bin/, lib/, …).
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
LOCK=/run/highascg/server-update.lock
SERVICE=highascg.service

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLY_SH="${SCRIPT_DIR}/exfat/highascg-apply-server-drop.sh"
if [[ ! -x "$APPLY_SH" ]]; then
	APPLY_SH=/usr/local/lib/highascg/highascg-apply-server-drop.sh
fi

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

stop_service() {
	if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
		log "stopping $SERVICE"
		systemctl stop "$SERVICE"
	else
		log "$SERVICE not active (skip stop)"
	fi
}

start_service() {
	if [[ -f "${DST}/package.json" ]]; then
		log "queue $SERVICE (--no-block)"
		systemctl start --no-block "$SERVICE" 2>/dev/null || true
	else
		log "no ${DST}/package.json — not starting $SERVICE"
	fi
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

	if ! SRC="$(resolve_drop_src)"; then
		log "no pending update (${DROP_UPDATE}/package.json missing)."
		exit 0
	fi

	getent passwd "$USER_NAME" >/dev/null || {
		log "no such user $USER_NAME."
		exit 1
	}

	[[ -x "$APPLY_SH" ]] || {
		log "missing apply script: $APPLY_SH"
		exit 1
	}

	(
		flock -n 200 || {
			log "lock busy — exiting."
			exit 0
		}

		if [[ "${HIGHASCG_SERVER_UPDATE_DRY_RUN:-}" == "1" ]]; then
			log "DRY RUN: would apply ${SRC}/ → ${DST}/"
			exit 0
		fi

		stop_service

		local apply_args=(
			--source "$SRC"
			--dest "$DST"
			--drop-update-root "$DROP_UPDATE"
			--auto-retain
			--user "$USER_NAME"
		)
		if [[ "$SRC" == "$LEGACY_UPDATE" ]]; then
			apply_args+=(--legacy-src)
		fi

		bash "$APPLY_SH" "${apply_args[@]}"

		start_service
		log "server update applied."
	) 200>"$LOCK"

	exit 0
}

main "$@"

#!/usr/bin/env bash
# Apply a pre-extracted server drop from the Web UI (WO-66).
# Must run as root via sudo -n from the Node API.
#
# Usage: highascg-webui-server-update.sh --source /var/cache/highascg/updates/extract-<stamp>
#
set -euo pipefail

USER_NAME="${HIGHASCG_SERVICE_USER:-casparcg}"
DST="/home/casparcg/highascg"
EXFAT_ROOT="/home/casparcg/exfat"
BRIDGE_ROOT="/home/casparcg/bridge"
EXCLUDES="/etc/highascg/server-update-rsync-excludes.txt"
SERVICE=highascg.service
CACHE_ROOT="/var/cache/highascg/updates"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLY_SH="${HIGHASCG_APPLY_SERVER_DROP_SH:-/usr/local/lib/highascg/highascg-apply-server-drop.sh}"
[[ -f "$APPLY_SH" ]] || APPLY_SH="${SCRIPT_DIR}/highascg-apply-server-drop.sh"

log() {
	echo "[highascg-webui-server-update] $*" >&2
}

stop_service() {
	if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
		log "stopping $SERVICE"
		systemctl stop "$SERVICE"
	fi
}

start_service() {
	if [[ -f "${DST}/package.json" ]]; then
		log "starting $SERVICE"
		systemctl start "$SERVICE" 2>/dev/null || true
	fi
}

validate_source_path() {
	local src="$1"
	local real cache_real
	[[ -n "$src" && -d "$src" ]] || return 1
	real="$(readlink -f "$src")"
	cache_real="$(readlink -f "$CACHE_ROOT" 2>/dev/null || echo "$CACHE_ROOT")"
	[[ "$real" == "$cache_real"/* ]] || [[ "$real" == /tmp/highascg-updates/* ]]
}

stage_drop_to_volume() {
	local vol_root="$1" src="$2"
	local drop="${vol_root}/drop-update"
	if ! mountpoint -q "$vol_root" 2>/dev/null; then
		log "skip stage — ${vol_root} not mounted"
		return 0
	fi
	mkdir -p "$drop" "${drop}/applied"
	log "staging drop → ${drop}/ (retain)"
	local xtra=()
	[[ -f "$EXCLUDES" ]] && xtra+=(--exclude-from="$EXCLUDES")
	rsync "${xtra[@]}" -rlptgoD --delete "${src%/}/" "${drop%/}/"
	local grp
	grp="$(id -gn "$USER_NAME")"
	chown -R "${USER_NAME}:${grp}" "$drop" 2>/dev/null || true
	if [[ -f "${DST}/BUILD_STAMP" ]]; then
		cp -f "${DST}/BUILD_STAMP" "${drop}/BUILD_STAMP"
		chown "${USER_NAME}:${grp}" "${drop}/BUILD_STAMP" 2>/dev/null || true
	fi
}

push_drop_config() {
	local cli="${DST}/tools/runtime/exfat-sync-cli.js"
	if [[ ! -f "$cli" ]]; then
		log "skip exfat-sync push — ${cli} missing"
		return 0
	fi
	if command -v node >/dev/null 2>&1; then
		log "pushing config to exFAT volumes"
		sudo -u "$USER_NAME" env HOME="$(getent passwd "$USER_NAME" | cut -d: -f6)" \
			node "$cli" --push 2>&1 | while read -r line; do log "sync: $line"; done || {
			log "exfat-sync --push failed (continuing)"
		}
	fi
}

main() {
	[[ "$(id -u)" -eq 0 ]] || {
		log "must run as root"
		exit 1
	}

	local src=""
	while [[ $# -gt 0 ]]; do
		case "$1" in
		--source)
			src="${2:?}"
			shift 2
			;;
		*)
			log "unknown option: $1"
			exit 2
			;;
		esac
	done

	[[ -n "$src" ]] || {
		log "--source required"
		exit 2
	}
	validate_source_path "$src" || {
		log "refusing source outside cache: $src"
		exit 1
	}
	[[ -x "$APPLY_SH" ]] || {
		log "missing ${APPLY_SH}"
		exit 1
	}

	stop_service

	"$APPLY_SH" \
		--source "$src" \
		--dest "$DST" \
		--drop-update-root "${EXFAT_ROOT}/drop-update" \
		--user "$USER_NAME" \
		--excludes "$EXCLUDES" \
		--auto-retain

	stage_drop_to_volume "$EXFAT_ROOT" "$src"
	stage_drop_to_volume "$BRIDGE_ROOT" "$src"
	push_drop_config
	start_service
	log "web UI update complete"
}

main "$@"

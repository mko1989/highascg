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

# WO-455: installed systems ship without /var/cache/highascg (eggs excludes var/cache/*).
# We run as root — create the real cache tree so future updates need no /tmp fallback.
ensure_cache_dirs() {
	install -d -m 0755 /var/cache/highascg /var/cache/highascg/update-staging
	install -d -m 0755 -o "$USER_NAME" -g "$(id -gn "$USER_NAME")" "$CACHE_ROOT" 2>/dev/null \
		|| install -d -m 0755 "$CACHE_ROOT"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"
APPLY_SH="${HIGHASCG_APPLY_SERVER_DROP_SH:-/usr/local/lib/highascg/highascg-apply-server-drop.sh}"
[[ -f "$APPLY_SH" ]] || APPLY_SH="${SCRIPT_DIR}/highascg-apply-server-drop.sh"
LOG_DIR="${HIGHASCG_UPDATE_LOG_DIR:-/var/log/highascg}"

log() {
	echo "[highascg-webui-server-update] $*" >&2
}

SERVICE_WAS_ACTIVE=0

# WO-501: the Web-UI update is launched by Node, which lives INSIDE highascg.service. A sudo child
# inherits that cgroup, so the moment this script runs `systemctl stop highascg.service` it kills
# ITSELF — before the apply, and before WO-499's EXIT trap can restart anything. The box is left
# stopped and un-updated, which is exactly what the owner saw.
#
# `--detach` re-launches this same script inside a TRANSIENT SYSTEMD UNIT. systemd-run places it
# under system.slice, outside highascg.service's cgroup, so stopping the service cannot touch it.
# The detached run does the whole update and restarts the service itself (start_service + the
# WO-499 trap), and it survives even if the caller dies mid-flight.
#
# Output goes to a file rather than the caller's pipe, because the caller WILL disappear: the Web UI
# reads it back after the service returns.
detach_and_exit() {
	local src="$1"
	command -v systemd-run >/dev/null 2>&1 || {
		log "systemd-run unavailable — cannot detach; re-run without --detach from a shell"
		exit 1
	}
	local stamp unit logfile
	stamp="$(date -u +%Y%m%dT%H%M%SZ)"
	unit="highascg-update-${stamp}"
	install -d -m 0755 "$LOG_DIR"
	logfile="${LOG_DIR}/update-${stamp}.log"
	: >"$logfile"
	chmod 0644 "$logfile"
	log "detaching into ${unit}; log: ${logfile}"
	# --collect: reap the unit once it exits. No --wait: return immediately so the caller can answer
	# the HTTP request and then be killed in peace.
	systemd-run \
		--unit="$unit" \
		--collect \
		--description="HighAsCG server update ${stamp}" \
		--property=StandardOutput="append:${logfile}" \
		--property=StandardError="append:${logfile}" \
		"$SELF" --source "$src"
	# Machine-readable last line: the Node side parses this to tell the UI where to look.
	echo "HIGHASCG_UPDATE_DETACHED unit=${unit} log=${logfile}"
	exit 0
}

stop_service() {
	if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
		SERVICE_WAS_ACTIVE=1
		log "stopping $SERVICE"
		systemctl stop "$SERVICE"
	fi
}

start_service() {
	if [[ -f "${DST}/package.json" ]]; then
		log "starting $SERVICE"
		systemctl start "$SERVICE" 2>/dev/null || true
	else
		log "NOT starting $SERVICE — ${DST}/package.json is missing (the install is incomplete)"
	fi
}

# WO-499: this script runs `set -e` and stops the service BEFORE applying. Any non-zero exit after
# that — a failed rsync, a full disk, an exFAT chown refusal while staging to a stick — skipped
# `start_service` and left the playout box DOWN with no operator UI to fix it from. Restarting is
# now unconditional on exit: the box comes back even when the update itself failed, which is always
# better than a dark box, and the non-zero exit still reaches the Web UI job log.
restore_service_on_exit() {
	local rc=$?
	if [[ "$SERVICE_WAS_ACTIVE" == "1" ]] && ! systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
		if [[ $rc -ne 0 ]]; then
			log "update FAILED (exit ${rc}) — restarting $SERVICE so the box does not stay down"
		fi
		start_service
	fi
	exit "$rc"
}
trap restore_service_on_exit EXIT

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
	# WO-499: exFAT has no owner/group, so `-go` makes rsync attempt a chown it cannot do and exit
	# 23 — which under `set -e` used to abort the whole update after the service was already
	# stopped. Drop -goD and widen the timestamp tolerance (exFAT stores 2 s granularity). This is
	# a best-effort convenience copy to a removable volume: it must never fail the update.
	if ! rsync "${xtra[@]}" -rlpt --modify-window=2 --delete "${src%/}/" "${drop%/}/"; then
		log "staging to ${drop} failed (continuing — the server itself is already updated)"
		return 0
	fi
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
	local detach=0
	while [[ $# -gt 0 ]]; do
		case "$1" in
		--source)
			src="${2:?}"
			shift 2
			;;
		--detach)
			detach=1
			shift
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
	ensure_cache_dirs
	validate_source_path "$src" || {
		log "refusing source outside cache: $src"
		exit 1
	}
	# Validate BEFORE detaching, so a bad request still fails synchronously with a useful message.
	[[ $detach -eq 1 ]] && detach_and_exit "$src"
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

	# Best-effort from here on — the server is already updated; nothing below is worth failing for.
	stage_drop_to_volume "$EXFAT_ROOT" "$src" || log "stage ${EXFAT_ROOT} failed (continuing)"
	stage_drop_to_volume "$BRIDGE_ROOT" "$src" || log "stage ${BRIDGE_ROOT} failed (continuing)"
	push_drop_config || log "config push failed (continuing)"
	start_service
	log "web UI update complete"
}

main "$@"

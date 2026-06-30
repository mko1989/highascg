#!/usr/bin/env bash
# One-time / manual fix after snap→deb migration (kills hung firefox, clears stale locks, removes snap).
# Does not delete profile databases — history and saved passwords are kept.
#
#   sudo /usr/local/lib/highascg/highascg-clean-firefox-snap-leftovers.sh [/home/casparcg]
set -euo pipefail

USER_HOME="${1:-/home/casparcg}"
USER_NAME="$(basename "$USER_HOME")"
MOZILLA="${USER_HOME}/.mozilla"
OPERATOR_PROFILE="${USER_HOME}/.highascg/firefox-operator"
SNAP_FIREFOX="${USER_HOME}/snap/firefox"

log() { echo "highascg-clean-firefox: $*"; }

firefox_pids() {
	pgrep -u "$USER_NAME" -x firefox 2>/dev/null || true
	pgrep -u "$USER_NAME" -x firefox-esr 2>/dev/null || true
	pgrep -u "$USER_NAME" -f '/snap/firefox/' 2>/dev/null || true
}

clear_stale_locks_in() {
	local dir="$1"
	[[ -d "$dir" ]] || return 0
	local lock="${dir}/.parentlock"
	[[ -e "$lock" || -e "${dir}/lock" ]] || return 0
	if fuser "$lock" >/dev/null 2>&1; then
		return 0
	fi
	rm -f "${dir}/lock" "${dir}/.parentlock" "${dir}/parent.lock"
	log "cleared stale locks in ${dir}"
}

if [[ ! -d "$USER_HOME" ]]; then
	echo "home missing: $USER_HOME" >&2
	exit 1
fi

# Hung snap or deb instances block profile load ("Firefox is already running" / loading profile).
mapfile -t _pids < <(firefox_pids)
if ((${#_pids[@]})); then
	log "stopping ${#_pids[@]} firefox process(es) for ${USER_NAME}"
	kill -TERM "${_pids[@]}" 2>/dev/null || true
	sleep 1
	mapfile -t _pids < <(firefox_pids)
	if ((${#_pids[@]})); then
		kill -KILL "${_pids[@]}" 2>/dev/null || true
	fi
fi

for root in \
	"${MOZILLA}/firefox" \
	"${MOZILLA}/firefox-esr" \
	"${OPERATOR_PROFILE}"; do
	[[ -d "$root" ]] || continue
	if [[ "$root" == "$OPERATOR_PROFILE" ]]; then
		clear_stale_locks_in "$root"
	else
		for prof in "$root"/*; do
			[[ -d "$prof" ]] || continue
			clear_stale_locks_in "$prof"
		done
	fi
done

if command -v snap >/dev/null 2>&1 && snap list firefox 2>/dev/null | grep -qE '^firefox '; then
	log "removing snap firefox (operator uses firefox-esr .deb)"
	snap remove firefox || log "warn: snap remove firefox failed — remove manually"
fi

if [[ -d "$SNAP_FIREFOX" ]]; then
	log "removing ${SNAP_FIREFOX}"
	rm -rf "$SNAP_FIREFOX"
fi

log "done"

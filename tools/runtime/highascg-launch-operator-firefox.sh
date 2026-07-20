#!/usr/bin/env bash
# Launch Firefox for Settings → Open browser on operator :0 (WO-39).
# Uses a dedicated profile so a stale default-profile snap/hung instance cannot block launch.
#
#   /usr/local/lib/highascg/highascg-launch-operator-firefox.sh
set -euo pipefail

USER_NAME="${HIGHASCG_OPERATOR_USER:-casparcg}"
HOME_DIR="/home/${USER_NAME}"
PROFILE="${HIGHASCG_OPERATOR_FIREFOX_PROFILE:-${HOME_DIR}/.highascg/firefox-operator}"
DISPLAY="${DISPLAY:-:0}"
XAUTHORITY="${XAUTHORITY:-${HOME_DIR}/.Xauthority}"
LOG="${HIGHASCG_OPERATOR_FIREFOX_LOG:-/tmp/highascg-operator-firefox.log}"

export HOME="$HOME_DIR"
export USER="$USER_NAME"
export DISPLAY
export XAUTHORITY
export MOZ_ENABLE_WAYLAND=0
export GDK_BACKEND=x11

BIN="${HIGHASCG_FIREFOX_BIN:-}"
if [[ -z "$BIN" ]]; then
	for c in /usr/bin/firefox-esr /usr/bin/firefox; do
		if [[ -x "$c" ]]; then
			BIN="$c"
			break
		fi
	done
fi
if [[ -z "$BIN" || ! -x "$BIN" ]]; then
	echo "firefox-esr not installed (apt install firefox-esr)" >&2
	exit 1
fi

mkdir -p "$PROFILE"
chmod 700 "$PROFILE" 2>/dev/null || true
if ! [[ -d "$PROFILE" && -w "$PROFILE" ]]; then
	echo "profile not writable: $PROFILE (runs as ${USER_NAME}, HOME=${HOME_DIR})" >&2
	exit 1
fi

clear_stale_profile_locks() {
	local dir="$1"
	[[ -d "$dir" ]] || return 0
	local lock="${dir}/.parentlock"
	[[ -e "$lock" || -e "${dir}/lock" ]] || return 0
	if command -v fuser >/dev/null 2>&1 && fuser "$lock" >/dev/null 2>&1; then
		return 0
	fi
	rm -f "${dir}/lock" "${dir}/.parentlock" "${dir}/parent.lock"
}

# Preserve cookies, history, logins — only drop stale lock files when nothing holds the profile.
if [[ "${HIGHASCG_FIREFOX_RESET_PROFILE:-}" == 1 ]]; then
	rm -rf "$PROFILE"
elif ! pgrep -u "$USER_NAME" -f "firefox.*${PROFILE}" >/dev/null 2>&1; then
	clear_stale_profile_locks "$PROFILE"
fi

# PROFILE IN USE. Firefox does NOT open a window when a second instance is pointed at a profile
# another live process already holds — it opens a modal titled "Close Firefox" and waits. That is
# what the operator hit on 2026-07-20: the button launched, no window ever appeared, and the open
# timed out with a stray modal left on screen.
#
# The caller now REUSES an already-mapped helper window instead of launching at all, so reaching
# here means the holding instance has no usable window (hung, or windowless). In that case a second
# fixed profile is useless too — take a distinct sibling profile and --new-instance so a real
# window is guaranteed to appear. -no-remote/--new-instance also stops this launch from being
# swallowed by the kiosk's remote-control socket.
NEW_INSTANCE=()
if pgrep -u "$USER_NAME" -f "firefox.*${PROFILE}" >/dev/null 2>&1; then
	# Bounded set of alternates, reused in place — never an unbounded pile of new profile dirs.
	ALT=""
	for slot in 1 2 3 4 5; do
		cand="${PROFILE}-alt${slot}"
		if ! pgrep -u "$USER_NAME" -f "firefox.*${cand}" >/dev/null 2>&1; then
			ALT="$cand"
			break
		fi
	done
	if [[ -z "$ALT" ]]; then
		echo "all alternate profiles busy — refusing to open a modal-only Firefox" >&2
		exit 1
	fi
	echo "profile in use by a live process — using alternate profile ${ALT}" >>"$LOG"
	PROFILE="$ALT"
	mkdir -p "$PROFILE"
	clear_stale_profile_locks "$PROFILE"
	chmod 700 "$PROFILE" 2>/dev/null || true
	NEW_INSTANCE=(--new-instance)
fi

{
	echo "=== $(date -Is) launch $BIN profile=$PROFILE DISPLAY=$DISPLAY new_instance=${#NEW_INSTANCE[@]} ==="
	exec "$BIN" "${NEW_INSTANCE[@]+"${NEW_INSTANCE[@]}"}" -profile "$PROFILE" -url "${1:-about:blank}"
} >>"$LOG" 2>&1

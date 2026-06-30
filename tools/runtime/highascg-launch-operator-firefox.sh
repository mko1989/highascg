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

{
	echo "=== $(date -Is) launch $BIN profile=$PROFILE DISPLAY=$DISPLAY ==="
	exec "$BIN" -profile "$PROFILE" -url "${1:-about:blank}"
} >>"$LOG" 2>&1

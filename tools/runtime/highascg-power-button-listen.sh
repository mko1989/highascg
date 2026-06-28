#!/usr/bin/env bash
# Optional kiosk power button: short press = network reset, hold 3s = shutdown.
# Requires logind HandlePowerKey=ignore (see scripts/setup/14-power-button-network-reset.sh).
set -euo pipefail

RESET_SCRIPT="${HIGHASCG_NETWORK_RESET_SCRIPT:-/usr/local/lib/highascg/highascg-network-reset.sh}"
HOLD_SEC="${HIGHASCG_POWER_HOLD_SEC:-3}"
KEY_CODE="${HIGHASCG_POWER_KEY_CODE:-116}" # KEY_POWER

if ! command -v evtest >/dev/null 2>&1; then
	echo "evtest not installed — install evtest package" >&2
	exit 1
fi

find_power_event_dev() {
	local dev
	for dev in /dev/input/event*; do
		[[ -e "$dev" ]] || continue
		if evtest --query "$dev" EV_KEY KEY_POWER >/dev/null 2>&1; then
			echo "$dev"
			return 0
		fi
	done
	return 1
}

DEV="$(find_power_event_dev)" || {
	echo "No input device with KEY_POWER found" >&2
	exit 1
}

logger -t highascg-power "listening on $DEV (short=network reset, ${HOLD_SEC}s=shutdown)"

shutdown_job=""
press_ts=0

cancel_shutdown() {
	if [[ -n "${shutdown_job:-}" ]]; then
		kill "$shutdown_job" 2>/dev/null || true
		wait "$shutdown_job" 2>/dev/null || true
		shutdown_job=""
	fi
}

schedule_shutdown() {
	cancel_shutdown
	(
		sleep "$HOLD_SEC"
		logger -t highascg-power "power held ${HOLD_SEC}s — shutting down"
		systemctl poweroff
	) &
	shutdown_job=$!
}

on_short_press() {
	logger -t highascg-power "short press — network reset"
	if [[ -x "$RESET_SCRIPT" ]]; then
		"$RESET_SCRIPT" || logger -t highascg-power "network reset failed ($?)"
	else
		logger -t highascg-power "missing reset script: $RESET_SCRIPT"
	fi
}

while IFS= read -r line; do
	case "$line" in
	*"EV_KEY"*"code ${KEY_CODE}"*"value 1"*)
		press_ts=$(date +%s)
		schedule_shutdown
		;;
	*"EV_KEY"*"code ${KEY_CODE}"*"value 0"*)
		cancel_shutdown
		if [[ "$press_ts" -gt 0 ]]; then
			held=$(($(date +%s) - press_ts))
			if [[ "$held" -lt "$HOLD_SEC" ]]; then
				on_short_press
			fi
		fi
		press_ts=0
		;;
	esac
done < <(evtest --grab "$DEV" 2>&1)

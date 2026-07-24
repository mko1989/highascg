#!/usr/bin/env bash
# Optional kiosk power button: short press = network reset, hold >=3s = shutdown.
# Shutdown starts once the hold threshold is reached; release anytime after that.
# Requires logind HandlePowerKey=ignore (see scripts/setup/14-power-button-network-reset.sh).
set -euo pipefail

RESET_SCRIPT="${HIGHASCG_NETWORK_RESET_SCRIPT:-/usr/local/lib/highascg/highascg-network-reset.sh}"
SPLASH_IP_REFRESH_SEC="${HIGHASCG_SPLASH_IP_REFRESH_SEC:-5}"
HTTP_PORT="${HIGHASCG_HTTP_PORT:-4200}"
HOLD_SEC="${HIGHASCG_POWER_HOLD_SEC:-3}"
KEY_CODE="${HIGHASCG_POWER_KEY_CODE:-116}" # KEY_POWER
LONG_PRESS_MARK=/run/highascg/power-long-press-fired
HOLD_MS=$((HOLD_SEC * 1000))

if ! command -v evtest >/dev/null 2>&1; then
	echo "evtest not installed — install evtest package" >&2
	exit 1
fi

now_ms() {
	local s ns
	# '+%s %N' — two fields. The old '+%s%N' put all 19 digits in s, and s*1000
	# overflowed 64-bit, so held_ms on release was garbage.
	if read -r s ns < <(date '+%s %N' 2>/dev/null) && [[ -n "${ns:-}" ]]; then
		echo $((s * 1000 + 10#$ns / 1000000))
	else
		echo $(($(date +%s) * 1000))
	fi
}

_event_has_key_power() {
	local dev="$1"
	[[ -e "$dev" ]] && evtest --query "$dev" EV_KEY KEY_POWER >/dev/null 2>&1
}

_find_power_events_from_proc() {
	local pattern="$1"
	awk -v pat="$pattern" '
		$0 ~ pat { tag = 1; next }
		/^H: Handlers=/ && tag {
			for (i = 2; i <= NF; i++)
				if ($i ~ /^event[0-9]+$/)
					print $i
			tag = 0
		}
	' /proc/bus/input/devices | sort -u
}

find_power_event_dev() {
	local ev dev
	for ev in $(_find_power_events_from_proc '^N: Name="Power Button"'); do
		dev="/dev/input/${ev}"
		if _event_has_key_power "$dev"; then
			echo "$dev"
			return 0
		fi
	done
	for ev in $(_find_power_events_from_proc 'PWRBN|PNP0C0C/button'); do
		dev="/dev/input/${ev}"
		if _event_has_key_power "$dev"; then
			echo "$dev"
			return 0
		fi
	done
	for dev in /dev/input/event*; do
		if _event_has_key_power "$dev"; then
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

logger -t highascg-power "listening on $DEV (short=network reset, hold>=${HOLD_SEC}s=shutdown)"

shutdown_job=""
press_ts_ms=0

cancel_shutdown() {
	if [[ -n "${shutdown_job:-}" ]]; then
		kill "$shutdown_job" 2>/dev/null || true
		wait "$shutdown_job" 2>/dev/null || true
		shutdown_job=""
	fi
}

do_shutdown() {
	local reason="${1:-power held >= ${HOLD_SEC}s}"
	cancel_shutdown
	mkdir -p /run/highascg
	touch "$LONG_PRESS_MARK"
	logger -t highascg-power "${reason} — poweroff"
	# Kiosk: bypass inhibitor locks (updates, user sessions).
	systemctl poweroff --force --no-block 2>/dev/null || shutdown -h now
}

schedule_shutdown() {
	cancel_shutdown
	(
		sleep "$HOLD_SEC"
		if [[ ! -f "$LONG_PRESS_MARK" ]]; then
			do_shutdown "power held >= ${HOLD_SEC}s"
		fi
	) &
	shutdown_job=$!
}

schedule_splash_ip_refresh() {
	(
		sleep "$SPLASH_IP_REFRESH_SEC"
		if curl -fsS -X POST "http://127.0.0.1:${HTTP_PORT}/api/system/network/refresh-splash-ip" \
			-H 'Content-Type: application/json' \
			-d '{}' >/dev/null 2>&1; then
			logger -t highascg-power "splash IP refresh ok (${SPLASH_IP_REFRESH_SEC}s after network reset)"
		else
			logger -t highascg-power "splash IP refresh failed (${SPLASH_IP_REFRESH_SEC}s after network reset)"
		fi
	) &
}

on_short_press() {
	logger -t highascg-power "short press — network reset"
	if [[ -x "$RESET_SCRIPT" ]]; then
		"$RESET_SCRIPT" || logger -t highascg-power "network reset failed ($?)"
	else
		logger -t highascg-power "missing reset script: $RESET_SCRIPT"
	fi
	schedule_splash_ip_refresh
}

on_press() {
	rm -f "$LONG_PRESS_MARK"
	press_ts_ms=$(now_ms)
	logger -t highascg-power "press (hold ${HOLD_SEC}s to power off)"
	schedule_shutdown
}

on_release() {
	cancel_shutdown
	if [[ -f "$LONG_PRESS_MARK" ]]; then
		press_ts_ms=0
		return
	fi
	if [[ "$press_ts_ms" -gt 0 ]]; then
		local held_ms=$(( $(now_ms) - press_ts_ms ))
		if [[ "$held_ms" -ge "$HOLD_MS" ]]; then
			do_shutdown "power held ${held_ms}ms (released)"
		else
			on_short_press
		fi
	fi
	press_ts_ms=0
}

# evtest block-buffers stdout when piped (not a TTY), so without stdbuf the read loop
# below saw NO events until ~4KB accumulated — press/hold silently did nothing and the
# only way to power off was the firmware's own long-hold hard-off. Line-buffer it.
EVTEST_CMD=(evtest)
if command -v stdbuf >/dev/null 2>&1; then
	EVTEST_CMD=(stdbuf -oL -eL evtest)
else
	logger -t highascg-power "WARNING: stdbuf missing — evtest output may buffer and delay button handling"
fi

while IFS= read -r line; do
	case "$line" in
	*"EV_KEY"*"code ${KEY_CODE}"*"value 1"*)
		on_press
		;;
	*"EV_KEY"*"code ${KEY_CODE}"*"value 0"*)
		on_release
		;;
	esac
done < <("${EVTEST_CMD[@]}" --grab "$DEV" 2>&1)

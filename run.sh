#!/bin/sh
# CasparCG playout supervisor — one instance, relaunch on AMCP RESTART exit codes.
#
#   CASPAR_ROOT, CASPAR_LIB, CASPAR_BIN, CASPAR_CONFIG_PATH — paths (systemd sets these)
#   DISPLAY, XAUTHORITY — required for screen consumers on :0
#
# Optional:
#   CASPAR_RESTART_EXIT_CODES   default: 5 139 1 134 0 (systemd); +137 143 130 without CASPAR_SYSTEMD_SERVICE=1
#   CASPAR_RESPAWN=1            relaunch after any exit (debug)
#   CASPAR_RESTART_GRACE_SEC    pause before start (default 2)
#   CASPAR_RESTART_SLEEP        pause after crash/restart (default 5)
#   CASPAR_HANG_SEC             kill if AMCP drops after it was up (default 90)
#   CASPAR_BOOT_HANG_SEC        kill if AMCP never comes up (default 180)
#   CASPAR_PORT_FREE_WAIT_SEC   wait for :5250 before start (default 30)
#
set -f

CASPAR_ROOT="${CASPAR_ROOT:-/home/casparcg/highascg}"
CASPAR_LIB="${CASPAR_LIB:-$CASPAR_ROOT/lib}"
export LD_LIBRARY_PATH="$CASPAR_LIB"
unset LD_PRELOAD
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-/home/casparcg/.Xauthority}"

CONFIG_PATH="${CASPAR_CONFIG:-${CASPAR_CONFIG_PATH:-$CASPAR_ROOT/config/casparcg.config}}"
CASPAR_BIN="${CASPAR_BIN:-$CASPAR_ROOT/bin/casparcg}"

exec 9>>"${CASPAR_RUNSH_LOCK:-/tmp/caspar-runsh.lock}"
flock -n 9 || exit 0

# shellcheck source=casparcg-supervisor-lib.sh
. "${CASPAR_ROOT}/tools/runtime/casparcg-supervisor-lib.sh"

_inhibit="${CASPAR_INHIBIT_FILE:-}"
if [ -z "$_inhibit" ]; then
	_inhibit="$(caspar_inhibit_file 2>/dev/null || echo /run/highascg/inhibit-caspar-autostart)"
fi
if [ -f "$_inhibit" ]; then
	caspar_supervisor_log "[run.sh] inhibited ($_inhibit)"
	exit 0
fi

if [ ! -x "$CASPAR_BIN" ]; then
	caspar_supervisor_log "[run.sh] missing or not executable: $CASPAR_BIN"
	exit 127
fi
if [ ! -f "$CONFIG_PATH" ]; then
	caspar_supervisor_log "[run.sh] missing config: $CONFIG_PATH"
	exit 66
fi

if [ "${CASPAR_SYSTEMD_SERVICE:-0}" = "1" ]; then
	# Include 0: X session loss (nodm restart) can exit casparcg cleanly; still relaunch.
	RESTART_CODES="${CASPAR_RESTART_EXIT_CODES:-5 139 1 134 0}"
else
	RESTART_CODES="${CASPAR_RESTART_EXIT_CODES:-5 139 1 134 137 143 130}"
fi

is_restart_code() {
	_ec="$1"
	for _c in $RESTART_CODES; do
		[ "$_c" = "$_ec" ] && return 0
	done
	return 1
}

should_relaunch() {
	_ec="$1"
	[ "${CASPAR_RESPAWN:-0}" = "1" ] && return 0
	is_restart_code "$_ec"
}

stop_caspar_if_running() {
	if caspar_amcp_listening || caspar_any_process_running; then
		caspar_kill_all_processes TERM
		sleep 2
		caspar_kill_all_processes KILL
		caspar_wait_amcp_port_free
	fi
}

run_caspar() {
	"$CASPAR_BIN" "$CONFIG_PATH" "$@" </dev/null &
	_child=$!
	_saw_amcp=0
	_stuck=0
	while kill -0 "$_child" 2>/dev/null; do
		if caspar_amcp_listening; then
			_saw_amcp=1
			_stuck=0
		else
			_stuck=$((_stuck + 1))
			if [ "$_saw_amcp" -eq 1 ]; then
				_limit="${CASPAR_HANG_SEC:-90}"
			else
				_limit="${CASPAR_BOOT_HANG_SEC:-180}"
			fi
			if [ "$_stuck" -ge "$_limit" ]; then
				caspar_supervisor_log "[run.sh] hang (${_limit}s, amcp_seen=${_saw_amcp}) — stopping"
				caspar_kill_all_processes TERM
				sleep 2
				caspar_kill_all_processes KILL
				wait "$_child" 2>/dev/null
				return 5
			fi
		fi
		sleep 1
	done
	wait "$_child" 2>/dev/null
	return $?
}

_restarts=0
_window_start=0

while :; do
	if [ -f "$_inhibit" ]; then
		caspar_supervisor_log "[run.sh] inhibited — exit"
		exit 0
	fi

	caspar_wait_amcp_port_free

	_grace="${CASPAR_RESTART_GRACE_SEC:-2}"
	if [ -n "$_grace" ] && [ "$_grace" != "0" ]; then
		sleep "$_grace"
	fi

	ec=0
	run_caspar "$@" || ec=$?

	if ! should_relaunch "$ec"; then
		exit "$ec"
	fi

	stop_caspar_if_running

	case "$ec" in
	134 | 139) caspar_clear_cef_cache ;;
	esac

	_now="$(date +%s)"
	if [ "$_window_start" -eq 0 ] || [ $((_now - _window_start)) -gt 120 ]; then
		_restarts=0
		_window_start="$_now"
	fi
	_restarts=$((_restarts + 1))

	_sleep="${CASPAR_RESTART_SLEEP:-5}"
	if [ "$_restarts" -ge 6 ]; then
		_sleep=$((_sleep * 2))
		[ "$_sleep" -gt 60 ] && _sleep=60
	fi
	if [ "$_restarts" -ge 18 ]; then
		caspar_supervisor_log "[run.sh] too many rapid failures (last ec=${ec}) — exit"
		exit "$ec"
	fi

	caspar_supervisor_log "[run.sh] exited ${ec} — relaunch in ${_sleep}s"
	sleep "$_sleep"
done

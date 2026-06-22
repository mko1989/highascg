#!/bin/sh
#
# CasparCG launcher with AMCP RESTART support: after `RESTART`, the server exits with a
# dedicated status; this script starts it again. Stock Linux builds typically use exit code 5.
#
# Install (example):
#   sudo install -m 0755 tools/runtime/casparcg-run.sh /home/casparcg/highascg/run.sh
#
# Environment (optional):
#   CASPAR_ROOT           default /home/casparcg/highascg
#   CASPAR_LIB            default $CASPAR_ROOT/lib  → LD_LIBRARY_PATH (CEF + libndi belong here)
#   CASPAR_BIN            default $CASPAR_ROOT/bin/casparcg
#   CASPAR_CONFIG / CASPAR_CONFIG_PATH  config file (default $CASPAR_ROOT/config/casparcg.config)
#   CASPAR_RESTART_EXIT_CODES   space-separated exit codes meaning "relaunch" (default: 5 139)
#   CASPAR_RESTART_GRACE_SEC      sleep before relaunch after RESTART (default: 2; 0 to skip)
#   CASPAR_PORT_FREE_WAIT_SEC     max wait for :5250 to clear before next start (default: 90)
#   CASPAR_RESTART_HANG_SEC       after AMCP was up, kill if port down but process still alive (default: 45)
#   CASPAR_BOOT_HANG_SEC          kill if AMCP never comes up during initial boot (default: 180)
#   CASPAR_RESPAWN=1              relaunch after *any* exit (debug / crash recovery)
#   CASPAR_RESTART_SLEEP          seconds between respawns when CASPAR_RESPAWN=1 (default: 5)
#
# If RESTART hangs inside casparcg (no exit), pkill the main process or reboot.

set -f

CASPAR_ROOT="${CASPAR_ROOT:-/home/casparcg/highascg}"
CASPAR_RUNSH_PIDFILE="${CASPAR_RUNSH_PIDFILE:-/tmp/caspar-runsh.pid}"
printf '%s\n' "$$" >"$CASPAR_RUNSH_PIDFILE" 2>/dev/null || true
trap 'rm -f "$CASPAR_RUNSH_PIDFILE"' EXIT INT TERM
CASPAR_LIB="${CASPAR_LIB:-$CASPAR_ROOT/lib}"
export LD_LIBRARY_PATH="$CASPAR_LIB"
unset LD_PRELOAD

CONFIG_PATH="${CASPAR_CONFIG:-${CASPAR_CONFIG_PATH:-$CASPAR_ROOT/config/casparcg.config}}"
CASPAR_BIN="${CASPAR_BIN:-$CASPAR_ROOT/bin/casparcg}"

# shellcheck source=casparcg-supervisor-lib.sh
. "${CASPAR_ROOT}/tools/runtime/casparcg-supervisor-lib.sh"

# Some builds exit 1 (not 5) after AMCP RESTART when boost logs local_endpoint during teardown.
# 137/143/130: SIGKILL/SIGTERM/HUP from operator or bridge kill — still relaunch via run.sh.
RESTART_CODES="${CASPAR_RESTART_EXIT_CODES:-5 139 1 134 137 143 130}"
RESPAWN_SLEEP="${CASPAR_RESTART_SLEEP:-5}"

is_restart_code() {
	_ec="$1"
	for _c in $RESTART_CODES; do
		if [ "$_c" = "$_ec" ]; then
			return 0
		fi
	done
	return 1
}

prepare_restart() {
	caspar_ensure_fully_stopped
	caspar_clear_cef_cache
}

run_one() {
	_hang_sec="${CASPAR_RESTART_HANG_SEC:-45}"
	_boot_hang_sec="${CASPAR_BOOT_HANG_SEC:-180}"
	"$CASPAR_BIN" "$CONFIG_PATH" "$@" </dev/null &
	_child=$!
	_saw_amcp=0
	_down_n=0
	_boot_n=0
	while kill -0 "$_child" 2>/dev/null; do
		if caspar_amcp_listening; then
			_saw_amcp=1
			_down_n=0
			_boot_n=0
		elif [ "$_saw_amcp" -eq 1 ]; then
			_down_n=$((_down_n + 1))
			if [ "$_down_n" -ge "$_hang_sec" ]; then
				caspar_supervisor_log "[run.sh] hung teardown (${_hang_sec}s without AMCP) — killing pid ${_child}"
				caspar_kill_all_processes TERM
				sleep 2
				caspar_kill_all_processes KILL
				wait "$_child" 2>/dev/null
				return 5
			fi
		else
			_boot_n=$((_boot_n + 1))
			if [ "$_boot_n" -ge "$_boot_hang_sec" ]; then
				caspar_supervisor_log "[run.sh] boot hang (${_boot_hang_sec}s without AMCP) — killing pid ${_child}"
				caspar_kill_all_processes TERM
				sleep 2
				caspar_kill_all_processes KILL
				wait "$_child" 2>/dev/null
				return 5
			fi
		fi
		sleep 1
	done
	wait "$_child"
	return $?
}

caspar_cleanup_after_exit() {
	_ec="$1"
	if caspar_amcp_listening || caspar_any_process_running; then
		caspar_supervisor_log "[run.sh] casparcg still alive after exit ${_ec} — cleaning up"
		caspar_ensure_fully_stopped
	fi
}

if [ "${CASPAR_RESPAWN:-0}" = "1" ]; then
	while true; do
		prepare_restart
		run_one "$@"
		ec=$?
		caspar_cleanup_after_exit "$ec"
		caspar_supervisor_log "[run.sh] casparcg exited ${ec}, respawning in ${RESPAWN_SLEEP}s"
		sleep "$RESPAWN_SLEEP"
	done
else
	while true; do
		prepare_restart
		run_one "$@"
		ec=$?
		if is_restart_code "$ec"; then
			caspar_cleanup_after_exit "$ec"
			caspar_supervisor_log "[run.sh] casparcg exited ${ec} (restart), relaunching"
			continue
		fi
		exit "$ec"
	done
fi

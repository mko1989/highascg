#!/bin/sh
# Kill casparcg main + CEF children when AMCP RESTART hangs in teardown.
#
#   bash tools/runtime/caspar-kill-main.sh
#   CASPAR_ROOT=/home/casparcg/highascg bash tools/runtime/caspar-kill-main.sh

set -f

CASPAR_ROOT="${CASPAR_ROOT:-/home/casparcg/highascg}"
# shellcheck source=casparcg-supervisor-lib.sh
. "${CASPAR_ROOT}/tools/runtime/casparcg-supervisor-lib.sh"

caspar_supervisor_log "[caspar-kill-main] ensuring casparcg fully stopped"
if [ "${CASPAR_KILL_FAST:-}" = "1" ]; then
	# Apply / operator kill: terminate immediately instead of polling AMCP for up to 90s.
	# Live e2e 29.10 (WO-805): the PIDs are listed ONCE, before TERM. Since WO-805, run.sh relaunches ~0.25 s after the
	# old casparcg exits, so listing again for the KILL a second later found the NEW instance and killed it: run.sh
	# exited 137 (not a restart code under systemd), the unit failed and the node started it again via systemd (+~4 s).
	_cache="${CASPAR_CEF_CACHE:-$CASPAR_ROOT/cef-cache}"
	_snap=""
	for _pid in $(caspar_list_main_pids); do
		_snap="$_snap $(pgrep -P "$_pid" 2>/dev/null | tr '\n' ' ') $_pid"
	done
	_snap="$_snap $(pgrep -f "user-data-dir=${_cache}" 2>/dev/null | tr '\n' ' ')"
	caspar_supervisor_log "[caspar-kill-main] fast kill of:${_snap}"
	for _pid in $_snap; do kill -TERM "$_pid" 2>/dev/null; done
	sleep 1
	for _pid in $_snap; do kill -KILL "$_pid" 2>/dev/null; done
	sleep 1
	# A casparcg that is not in the snapshot is the relaunch: it owns :5250 now, and the port-free wait would kill it.
	_new=""
	for _pid in $(caspar_list_main_pids); do
		case " $_snap " in *" $_pid "*) ;; *) _new="$_new $_pid" ;; esac
	done
	if [ -n "$_new" ]; then
		caspar_supervisor_log "[caspar-kill-main] relaunched casparcg already up:${_new} — left running"
	else
		CASPAR_PORT_FREE_WAIT_SEC="${CASPAR_PORT_FREE_WAIT_SEC:-5}" caspar_wait_amcp_port_free
	fi
else
	caspar_ensure_fully_stopped
fi
caspar_supervisor_log "[caspar-kill-main] done"

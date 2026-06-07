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
#   CASPAR_RESPAWN=1              relaunch after *any* exit (debug / crash recovery)
#   CASPAR_RESTART_SLEEP          seconds between respawns when CASPAR_RESPAWN=1 (default: 5)
#
# If RESTART hangs inside casparcg (no exit), pkill the main process or reboot.

set -f

CASPAR_ROOT="${CASPAR_ROOT:-/home/casparcg/highascg}"
CASPAR_LIB="${CASPAR_LIB:-$CASPAR_ROOT/lib}"
export LD_LIBRARY_PATH="$CASPAR_LIB"
unset LD_PRELOAD

CONFIG_PATH="${CASPAR_CONFIG:-${CASPAR_CONFIG_PATH:-$CASPAR_ROOT/config/casparcg.config}}"
CASPAR_BIN="${CASPAR_BIN:-$CASPAR_ROOT/bin/casparcg}"

# shellcheck source=casparcg-supervisor-lib.sh
. "${CASPAR_ROOT}/tools/runtime/casparcg-supervisor-lib.sh"

RESTART_CODES="${CASPAR_RESTART_EXIT_CODES:-5 139}"
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
	caspar_clear_cef_cache
	caspar_wait_amcp_port_free
}

run_one() {
	"$CASPAR_BIN" "$CONFIG_PATH" "$@" </dev/null
}

if [ "${CASPAR_RESPAWN:-0}" = "1" ]; then
	while true; do
		prepare_restart
		run_one "$@"
		ec=$?
		caspar_supervisor_log "[run.sh] casparcg exited ${ec}, respawning in ${RESPAWN_SLEEP}s"
		sleep "$RESPAWN_SLEEP"
	done
else
	while true; do
		prepare_restart
		run_one "$@"
		ec=$?
		if is_restart_code "$ec"; then
			caspar_supervisor_log "[run.sh] casparcg exited ${ec} (restart), relaunching"
			continue
		fi
		exit "$ec"
	done
fi

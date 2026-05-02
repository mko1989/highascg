#!/bin/sh
#
# CasparCG launcher with AMCP RESTART support: after `RESTART`, the server exits with a
# dedicated status; this script starts it again. Stock Linux builds typically use exit code 5.
#
# Install (example):
#   sudo install -m 0755 tools/casparcg-run.sh /opt/casparcg/run.sh
#
# Environment (optional):
#   CASPAR_ROOT           default /opt/casparcg
#   CASPAR_LIB            default $CASPAR_ROOT/lib  → LD_LIBRARY_PATH
#   CASPAR_BIN            default $CASPAR_ROOT/bin/casparcg
#   CASPAR_CONFIG / CASPAR_CONFIG_PATH  config file (default $CASPAR_ROOT/config/casparcg.config)
#   CASPAR_RESTART_EXIT_CODES   space-separated exit codes meaning "relaunch" (default: 5 139)
#                                 — 139 is SIGSEGV (common CEF/teardown bug after AMCP RESTART)
#   CASPAR_RESTART_GRACE_SEC      sleep before relaunch after RESTART (default: 2; 0 to skip)
#   CASPAR_RESPAWN=1              relaunch after *any* exit (debug / crash recovery)
#   CASPAR_RESTART_SLEEP          seconds between respawns when CASPAR_RESPAWN=1 (default: 5)
#
# If RESTART still hangs *inside* casparcg (no exit), the wrapper cannot help — see
# work/potential_autostart_fix.md (CEF teardown, HTML producers, cef-cache).

set -f

CASPAR_ROOT="${CASPAR_ROOT:-/opt/casparcg}"
CASPAR_LIB="${CASPAR_LIB:-$CASPAR_ROOT/lib}"
export LD_LIBRARY_PATH="$CASPAR_LIB"
unset LD_PRELOAD

CONFIG_PATH="${CASPAR_CONFIG:-${CASPAR_CONFIG_PATH:-$CASPAR_ROOT/config/casparcg.config}}"
CASPAR_BIN="${CASPAR_BIN:-$CASPAR_ROOT/bin/casparcg}"

RESTART_CODES="${CASPAR_RESTART_EXIT_CODES:-5 139}"
GRACE="${CASPAR_RESTART_GRACE_SEC:-2}"
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

run_one() {
	# Stdin closed: avoids rare hangs when the parent leaves a pipe/TTY open during shutdown.
	"$CASPAR_BIN" "$CONFIG_PATH" "$@" </dev/null
}

if [ "${CASPAR_RESPAWN:-0}" = "1" ]; then
	while true; do
		run_one "$@"
		ec=$?
		echo "$(date '+%Y-%m-%d %H:%M:%S') casparcg exited ${ec}, respawning in ${RESPAWN_SLEEP}s" >&2
		sleep "$RESPAWN_SLEEP"
	done
else
	while true; do
		run_one "$@"
		ec=$?
		if is_restart_code "$ec"; then
			echo "$(date '+%Y-%m-%d %H:%M:%S') casparcg exited ${ec} (restart), relaunching after ${GRACE}s" >&2
			if [ -n "$GRACE" ] && [ "$GRACE" != "0" ]; then
				sleep "$GRACE"
			fi
			continue
		fi
		exit "$ec"
	done
fi

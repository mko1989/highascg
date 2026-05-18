#!/bin/sh
#
# Install: sudo install -m 0755 work/run.sh /opt/casparcg/run.sh
# (Canonical copy: tools/casparcg-run.sh)
#
# AMCP RESTART normally exits with code 5. Some Linux/CEF builds segfault during
# teardown after shutdown (exit 139 = 128+11). Default restart codes include 139
# so the wrapper still relaunches. Override with CASPAR_RESTART_EXIT_CODES if needed.
#
# CASPAR_RESPAWN=1 — relaunch after any exit (debug / heavy crash recovery).
#   autostart sets this; the old run.sh ignored it, so RESTART→SEGV left Caspar down.

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

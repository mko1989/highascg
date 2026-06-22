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
	caspar_kill_all_processes TERM
	sleep 1
	caspar_kill_all_processes KILL
	sleep 1
	CASPAR_PORT_FREE_WAIT_SEC="${CASPAR_PORT_FREE_WAIT_SEC:-5}" caspar_wait_amcp_port_free
else
	caspar_ensure_fully_stopped
fi
caspar_supervisor_log "[caspar-kill-main] done"

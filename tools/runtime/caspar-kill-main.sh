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
caspar_ensure_fully_stopped
caspar_supervisor_log "[caspar-kill-main] done"

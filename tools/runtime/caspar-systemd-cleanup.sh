#!/usr/bin/env bash
# Kill orphaned casparcg children after systemd stops casparcg-server.service.
# Does not touch inhibit file — safe for ExecStopPost.
set -euo pipefail

PLAYOUT="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"
LIB="${PLAYOUT}/tools/runtime/casparcg-supervisor-lib.sh"
[[ -f "$LIB" ]] || exit 0

# shellcheck source=casparcg-supervisor-lib.sh
. "$LIB"
caspar_ensure_fully_stopped || true

#!/usr/bin/env bash
# Apply highascg#### hostname from primary Ethernet MAC (WO-78).
# Installed to /usr/local/lib/highascg/ by scripts/setup/16-hardware-hostname-boot.sh
set -euo pipefail

PLAYOUT="${HIGHASCG_HOME:-/home/casparcg/highascg}"
LOG=/var/log/highascg-hardware-hostname.log

log() {
	echo "[$(date -Iseconds)] $*" | tee -a "$LOG" >&2
	logger -t highascg-hardware-hostname -- "$@"
}

[[ "$(id -u)" -eq 0 ]] || {
	echo "root required" >&2
	exit 1
}

mkdir -p "$(dirname "$LOG")"
touch "$LOG"

if [[ ! -f "${PLAYOUT}/package.json" ]]; then
	log "skip — no package.json at ${PLAYOUT}"
	exit 0
fi

if [[ ! -f "${PLAYOUT}/tools/runtime/apply-hardware-hostname.js" ]]; then
	log "skip — apply-hardware-hostname.js missing under ${PLAYOUT}"
	exit 0
fi

log "derive + apply from ${PLAYOUT}"
/usr/bin/node "${PLAYOUT}/tools/runtime/apply-hardware-hostname.js" 2>&1 | tee -a "$LOG"
log "finished (current hostname: $(hostname))"

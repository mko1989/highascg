#!/usr/bin/env bash
# Apply highascg#### hostname from primary Ethernet MAC (WO-78).
# Installed to /usr/local/lib/highascg/ by scripts/setup/16-hardware-hostname-boot.sh
# Logging is fail-open: tries /var/log, falls back to /tmp (WO-194).
set -euo pipefail

PLAYOUT="${HIGHASCG_HOME:-/home/casparcg/highascg}"

# Determine log file with fail-open logic
if [[ -n "${LOG_DIR:-}" ]]; then
	LOG="${LOG_DIR}/highascg-hardware-hostname.log"
elif [[ -w /var/log ]]; then
	LOG=/var/log/highascg-hardware-hostname.log
else
	LOG=/tmp/highascg-hardware-hostname.log
fi

log() {
	local msg="$*"
	local timestamp="[$(date -Iseconds)]"
	# Try to log to file (non-fatal on failure)
	if mkdir -p "$(dirname "$LOG")" 2>/dev/null && [[ -w "$(dirname "$LOG")" ]] 2>/dev/null; then
		echo "$timestamp $msg" >> "$LOG" 2>/dev/null || true
	fi
	# Always log to journal (non-fatal on failure)
	logger -t highascg-hostname -- "$msg" 2>/dev/null || true
	# Always output to stderr for visibility
	echo "$timestamp $msg" >&2
}

[[ "$(id -u)" -eq 0 ]] || {
	echo "root required" >&2
	exit 1
}

if [[ ! -f "${PLAYOUT}/package.json" ]]; then
	log "skip — no package.json at ${PLAYOUT}"
	exit 0
fi

if [[ ! -f "${PLAYOUT}/tools/runtime/apply-hardware-hostname.js" ]]; then
	log "skip — apply-hardware-hostname.js missing under ${PLAYOUT}"
	exit 0
fi

log "derive + apply from ${PLAYOUT}"
/usr/bin/node "${PLAYOUT}/tools/runtime/apply-hardware-hostname.js" 2>&1 | {
	while IFS= read -r line || [[ -n "$line" ]]; do
		# Log node output to file if directory is writable
		if mkdir -p "$(dirname "$LOG")" 2>/dev/null && [[ -w "$(dirname "$LOG")" ]] 2>/dev/null; then
			echo "$line" >> "$LOG" 2>/dev/null || true
		fi
		# Always output to stderr
		echo "$line" >&2
	done
}
log "finished (current hostname: $(hostname))"

#!/bin/bash
# Staged CasparCG supervisor: waits for a "ready" file, then runs the same restart loop as a typical Openbox autostart.
#
# Start order on the machine should be:
#   1) casparcg-scanner (background)
#   2) HighAsCG (background) — edit settings / upload config via web UI or SSH
#   3) this script — blocks until the ready file exists, then starts CasparCG
#
# Arm Caspar (allow startup to proceed):
#   touch /opt/casparcg/data/caspar-armed
#   # or: curl -X POST http://127.0.0.1:8080/api/system/caspar-arm
#
# Disarm before reboot if you want to pause Caspar on next boot (optional):
#   rm /opt/casparcg/data/caspar-armed
#
# Environment (optional):
#   CASPAR_BASE          default /opt/casparcg
#   CASPAR_READY_FILE    default $CASPAR_BASE/data/caspar-armed
#   CASPAR_BIN           default /usr/bin/casparcg-server-2.5
#   CONFIG_PATH          default $CASPAR_BASE/config/casparcg.config
#   CASPAR_INITIAL_DELAY_SEC  sleep this many seconds before waiting (grace after login)
#   CASPAR_STAGED_LOG    default /tmp/caspar-staged.log

set -u

CASPAR_BASE="${CASPAR_BASE:-/opt/casparcg}"
READY_FILE="${CASPAR_READY_FILE:-${CASPAR_ARM_FILE:-$CASPAR_BASE/data/caspar-armed}}"
CASPAR_BIN="${CASPAR_BIN:-/usr/bin/casparcg-server-2.5}"
CONFIG_PATH="${CONFIG_PATH:-$CASPAR_BASE/config/casparcg.config}"
LOG="${CASPAR_STAGED_LOG:-/tmp/caspar-staged.log}"
INITIAL_DELAY="${CASPAR_INITIAL_DELAY_SEC:-0}"

log() {
	echo "$(date -Iseconds) [casparcg-staged] $*" | tee -a "$LOG" >&2
}

mkdir -p "$(dirname "$READY_FILE")"

if [ "${INITIAL_DELAY:-0}" -gt 0 ] 2>/dev/null; then
	log "Initial delay ${INITIAL_DELAY}s (CASPAR_INITIAL_DELAY_SEC)"
	sleep "$INITIAL_DELAY"
fi

log "Waiting for ready file: $READY_FILE"
log "Arm with: touch \"$READY_FILE\"  or  POST /api/system/caspar-arm on HighAsCG"
while [ ! -f "$READY_FILE" ]; do
	sleep 2
done

log "Ready file present; starting CasparCG supervisor loop"

while true; do
	cd "$CASPAR_BASE" || { log "Cannot cd to $CASPAR_BASE"; sleep 10; continue; }

	rm -f "$CASPAR_BASE/cef-cache/Singleton"* 2>/dev/null || true
	rm -rf /tmp/.org.chromium.Chromium.* 2>/dev/null || true
	rm -rf /tmp/.com.google.* 2>/dev/null || true

	echo "$(date -Iseconds) Starting CasparCG" >> "$LOG"
	"$CASPAR_BIN" "$CONFIG_PATH" >> "$LOG" 2>&1
	EXIT_CODE=$?
	echo "$(date -Iseconds) CasparCG exited $EXIT_CODE" >> "$LOG"

	if [ "$EXIT_CODE" -eq 0 ]; then
		log "Caspar exited 0 — leaving supervisor loop"
		break
	fi

	while ss -tlnp 2>/dev/null | grep -q 5250; do sleep 1; done
	sleep 5
done

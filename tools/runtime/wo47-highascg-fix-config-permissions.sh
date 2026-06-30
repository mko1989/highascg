#!/usr/bin/env bash
# Ensure ~/highascg/config is writable by casparcg (exfat-sync runs as casparcg).
# Shipped under tools/runtime/ for playout hosts (ISO excludes ~/highascg/scripts/*).
set -uo pipefail

USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"
HIGHASCG_HOME="${HIGHASCG_HOME:-/home/casparcg/highascg}"
CFG="${HIGHASCG_HOME}/config"

log() {
	echo "[highascg-fix-config-permissions] $*" >&2
	logger -t highascg-fix-config-permissions -- "$*" 2>/dev/null || true
}

[[ "$(id -u)" -eq 0 ]] || {
	log "root required"
	exit 1
}
getent passwd "$USER_CASPAR" >/dev/null 2>&1 || {
	log "user ${USER_CASPAR} missing — skip"
	exit 0
}
GRP="$(id -gn "$USER_CASPAR")"

[[ -d "$CFG" ]] || {
	log "no ${CFG} — skip"
	exit 0
}

fail=0
if ! chown -R "${USER_CASPAR}:${GRP}" "$CFG" 2>/dev/null; then
	log "WARN: chown -R ${CFG} had errors (continuing)"
	fail=1
fi
for f in "${HIGHASCG_HOME}/.highascg-state.json" "${HIGHASCG_HOME}/.module-state.json" "${HIGHASCG_HOME}/highascg.config.json"; do
	if [[ -e "$f" ]] && ! chown "${USER_CASPAR}:${GRP}" "$f" 2>/dev/null; then
		log "WARN: chown failed: $f"
		fail=1
	fi
done

if [[ "$fail" -eq 0 ]]; then
	log "ok: ${CFG} owned by ${USER_CASPAR}:${GRP}"
fi
exit 0

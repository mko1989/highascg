#!/usr/bin/env bash
# Ensure ~/highascg/config is writable by casparcg (exfat-sync runs as casparcg).
# ISO snapshots often have root-owned JSON from reset-iso-operator-config on the build host.
#
# Installed by install-exfat-systemd-units.sh; runs before highascg-exfat-sync.service.
set -euo pipefail

USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"
HIGHASCG_HOME="${HIGHASCG_HOME:-/home/casparcg/highascg}"
CFG="${HIGHASCG_HOME}/config"

[[ "$(id -u)" -eq 0 ]] || {
	echo "root required" >&2
	exit 1
}
getent passwd "$USER_CASPAR" >/dev/null 2>&1 || exit 0
GRP="$(id -gn "$USER_CASPAR")"

[[ -d "$CFG" ]] || exit 0

chown -R "${USER_CASPAR}:${GRP}" "$CFG"
for f in "${HIGHASCG_HOME}/.highascg-state.json" "${HIGHASCG_HOME}/.module-state.json" "${HIGHASCG_HOME}/highascg.config.json"; do
	[[ -e "$f" ]] && chown "${USER_CASPAR}:${GRP}" "$f"
done

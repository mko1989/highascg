#!/usr/bin/env bash
# Build dist-web/ on the produce host for exFAT drop-update stick seeding (ISO uses HIGHASCG_ISO_BUILD_WEB=0).
#
# Usage:
#   sudo bash tools/eggs/live-usb/ensure-dist-web-for-stick-seed.sh [casparcg]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
HIGHASCG_ROOT="${HIGHASCG_ROOT:-/home/casparcg/highascg}"
USER_CASPAR="${1:-casparcg}"

if [[ -f "${HIGHASCG_ROOT}/dist-web/index.html" ]]; then
	echo "OK: dist-web already built (${HIGHASCG_ROOT}/dist-web/index.html)"
	exit 0
fi

echo "==> Building dist-web for stick drop-update seed (npm run build:client)"
if [[ "$(id -u)" -eq 0 ]] && getent passwd "$USER_CASPAR" >/dev/null 2>&1; then
	sudo -u "$USER_CASPAR" -H bash -lc "cd '${HIGHASCG_ROOT}' && npm run build:client"
else
	bash -lc "cd '${HIGHASCG_ROOT}' && npm run build:client"
fi

[[ -f "${HIGHASCG_ROOT}/dist-web/index.html" ]] || {
	echo "ERROR: build did not produce ${HIGHASCG_ROOT}/dist-web/index.html" >&2
	exit 1
}
echo "OK: dist-web ready for stick seed"

#!/usr/bin/env bash
# Reset HighAsCG operator config on the eggs build host before squashfs snapshot.
# Does not run npm — safe to call again immediately before `eggs produce`.
#
# Usage:
#   sudo bash tools/eggs/live-usb/reset-iso-operator-config.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
HIGHASCG_ROOT="${HIGHASCG_ROOT:-/home/casparcg/highascg}"
EXFAT_ROOT="${HIGHASCG_EXFAT_ROOT:-/home/casparcg/exfat}"
USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"

[[ -f "${REPO_ROOT}/package.json" ]] || {
	echo "Expected repo at ${REPO_ROOT}" >&2
	exit 1
}

echo "==> Modular config from src/config/defaults.js (not build-host JSON)"
if getent passwd "$USER_CASPAR" >/dev/null 2>&1; then
	sudo -u "$USER_CASPAR" -H env HIGHASCG_ROOT="$HIGHASCG_ROOT" \
		node "${HERE}/write-iso-default-config.js"
	GRP="$(id -gn "$USER_CASPAR")"
	chown -R "${USER_CASPAR}:${GRP}" "${HIGHASCG_ROOT}/config"
else
	node "${HERE}/write-iso-default-config.js"
fi

ISO_CASPAR="${REPO_ROOT}/config/casparcg.config.iso"
LIVE_CASPAR="${HIGHASCG_ROOT}/config/casparcg.config"
[[ -f "$ISO_CASPAR" ]] || {
	echo "Missing ${ISO_CASPAR}" >&2
	exit 1
}
mkdir -p "$(dirname "$LIVE_CASPAR")"
cp -a "$ISO_CASPAR" "$LIVE_CASPAR"
echo "==> Caspar XML: ${LIVE_CASPAR} (from casparcg.config.iso)"

ENV_EXAMPLE="${REPO_ROOT}/.env.example"
if [[ -f "$ENV_EXAMPLE" ]]; then
	install -m 0644 -o root -g root "$ENV_EXAMPLE" "${HIGHASCG_ROOT}/.env"
	if getent passwd "$USER_CASPAR" >/dev/null 2>&1; then
		chown "$USER_CASPAR:$(id -gn "$USER_CASPAR")" "${HIGHASCG_ROOT}/.env" 2>/dev/null || true
	fi
	echo "==> ${HIGHASCG_ROOT}/.env from .env.example (build-host .env not baked)"
else
	rm -f "${HIGHASCG_ROOT}/.env"
	echo "==> Removed ${HIGHASCG_ROOT}/.env"
fi

if [[ -d "${EXFAT_ROOT}/configs" ]]; then
	echo "==> Clear ${EXFAT_ROOT}/configs (avoid exfat-sync pulling build-host settings on first boot)"
	find "${EXFAT_ROOT}/configs" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi
rm -f "${EXFAT_ROOT}/drop-config/highascg.config.json" 2>/dev/null || true

echo "==> Reset projects/ to starter show (New project 1 + PGM-only destination)"
echo "OK: ISO will ship factory defaults + clean starter project, not eggs build-host operator data"

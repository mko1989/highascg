#!/usr/bin/env bash
# Bake ISO-first defaults on the eggs build host before `eggs produce --clone`.
#
# - Caspar: config/casparcg.config from config/casparcg.config.iso
# - HighAsCG: production node_modules for server embed (no dist-web on ISO; UI via Electron)
#
# Usage (repo root):
#   bash tools/eggs/live-usb/install-iso-defaults.sh
#   HIGHASCG_ROOT=/home/casparcg/highascg bash tools/eggs/live-usb/install-iso-defaults.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
HIGHASCG_ROOT="${HIGHASCG_ROOT:-/home/casparcg/highascg}"
EMBED="${HIGHASCG_ISO_EMBED_SERVER:-1}"
BUILD_WEB="${HIGHASCG_ISO_BUILD_WEB:-0}"

if [[ ! -f "${REPO_ROOT}/package.json" ]]; then
	echo "Expected highascg repo at ${REPO_ROOT}" >&2
	exit 1
fi

bash "${HERE}/reset-iso-operator-config.sh"

if [[ "$EMBED" != "1" ]]; then
	echo "==> HIGHASCG_ISO_EMBED_SERVER=0 — skipping npm ci / dist-web (WO-47 exFAT-only server)"
	exit 0
fi

if [[ ! -f "${HIGHASCG_ROOT}/package.json" ]]; then
	echo "HIGHASCG_ROOT missing package.json: ${HIGHASCG_ROOT}" >&2
	exit 1
fi

run_as_caspar() {
	if [[ "$(id -u)" -eq 0 ]] && getent passwd casparcg >/dev/null 2>&1; then
		sudo -u casparcg -H bash -lc "cd '$HIGHASCG_ROOT' && $*"
	else
		bash -lc "cd '$HIGHASCG_ROOT' && $*"
	fi
}

if [[ "$BUILD_WEB" == "1" ]]; then
	echo "==> npm ci (includes devDeps for Vite build)"
	if [[ -f "${HIGHASCG_ROOT}/package-lock.json" ]]; then
		run_as_caspar 'npm ci'
	else
		run_as_caspar 'npm install'
	fi
	echo "==> Vite client build → dist-web/ (dev/Electron only — not baked into ISO by default)"
	run_as_caspar 'npm run build:client'
	echo "==> npm prune --omit=dev --omit=optional (production node_modules for squashfs)"
	run_as_caspar 'export NPM_CONFIG_LOGLEVEL=error; npm prune --omit=dev --omit=optional'
else
	echo "==> Production npm install (omit=dev + optional) for ISO embed"
	# Skip optionalDeps (grapesjs → backbone-undo, onnxruntime-node → boolean) — not needed on playout ISO.
	if [[ -f "${HIGHASCG_ROOT}/package-lock.json" ]]; then
		run_as_caspar 'export NODE_ENV=production NPM_CONFIG_LOGLEVEL=error; npm ci --omit=dev --omit=optional'
	else
		run_as_caspar 'export NODE_ENV=production NPM_CONFIG_LOGLEVEL=error; npm install --omit=dev --omit=optional'
	fi
	echo "==> HIGHASCG_ISO_BUILD_WEB=0 — no dist-web on imaging host (operator UI via Electron launcher)"
fi

echo "==> ISO embed server ready under ${HIGHASCG_ROOT} (package.json + node_modules present)"

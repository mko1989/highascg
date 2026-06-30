#!/usr/bin/env bash
# Bake ISO-first defaults on the eggs build host before `eggs produce --clone`.
#
# - Caspar: config/casparcg.config from config/casparcg.config.iso
# HighAsCG: production node_modules for server embed; dist-web/ baked on ISO (operator UI on :4200)
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
BUILD_WEB="${HIGHASCG_ISO_BUILD_WEB:-1}"

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

PAUSE_HELPER="${HERE}/pause-heavy-services-for-iso-build.sh"
pause_for_build() {
	if [[ "$(id -u)" -eq 0 ]] && [[ -f "$PAUSE_HELPER" ]]; then
		bash "$PAUSE_HELPER" pause
	fi
}
restore_after_build() {
	if [[ "$(id -u)" -eq 0 ]] && [[ -f "$PAUSE_HELPER" ]]; then
		bash "$PAUSE_HELPER" restore
	fi
}

if [[ "$BUILD_WEB" == "1" ]]; then
	pause_for_build
	trap restore_after_build EXIT
	echo "==> npm ci (includes devDeps for Vite build)"
	if [[ -f "${HIGHASCG_ROOT}/package-lock.json" ]]; then
		run_as_caspar 'npm ci'
	else
		run_as_caspar 'npm install'
	fi
	echo "==> npm run build:client (client/ → dist-web/ on ISO squashfs)"
	# Cap Node heap during Vite — full dev graph + source maps can spike RAM on a busy build host.
	run_as_caspar 'export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"; npm run build:client'
	restore_after_build
	trap - EXIT
	[[ -f "${HIGHASCG_ROOT}/dist-web/index.html" ]] || {
		echo "ERROR: dist-web/index.html missing after build:client" >&2
		exit 1
	}
	echo "==> npm prune --omit=dev --omit=optional (production node_modules for squashfs)"
	run_as_caspar 'export NPM_CONFIG_LOGLEVEL=error; npm prune --omit=dev --omit=optional'
else
	echo "==> Production npm install (omit=dev + optional) for ISO embed"
	# Skip optionalDeps (three for legacy monolith previs vendor) — not needed on playout ISO.
	if [[ -f "${HIGHASCG_ROOT}/package-lock.json" ]]; then
		run_as_caspar 'export NODE_ENV=production NPM_CONFIG_LOGLEVEL=error; npm ci --omit=dev --omit=optional'
	else
		run_as_caspar 'export NODE_ENV=production NPM_CONFIG_LOGLEVEL=error; npm install --omit=dev --omit=optional'
	fi
	echo "==> HIGHASCG_ISO_BUILD_WEB=0 — no dist-web on squashfs (use drop-update/ on exFAT for UI)"
fi

echo "==> ISO embed server ready under ${HIGHASCG_ROOT} (package.json + node_modules present)"

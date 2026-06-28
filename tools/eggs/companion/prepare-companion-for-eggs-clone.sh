#!/usr/bin/env bash
# Ensure Bitfocus Companion + highpass-highascg module are on the build host before
# `eggs produce --clone` snapshots the filesystem into the ISO squashfs.
#
# Usage (root, from repo):
#   sudo bash tools/eggs/companion/prepare-companion-for-eggs-clone.sh
#
# Optional env:
#   HIGHASCG_ISO_EMBED_COMPANION=0   skip (default 1)
#   COMPANION_HOME=/home/casparcg/companion
#   COMPANION_MODULE_SRC=/home/casparcg/companion-module-dev/companion-module-highpass-highascg
#   HIGHASCG_SKIP_COMPANION_RESTART=1   install unit only (default during eggs prepare)
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
	echo "Run as root: sudo bash $0" >&2
	exit 1
fi

EMBED="${HIGHASCG_ISO_EMBED_COMPANION:-1}"
if [[ "$EMBED" != "1" ]]; then
	echo "==> HIGHASCG_ISO_EMBED_COMPANION=0 — skipping Companion bake"
	exit 0
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
COMPANION_HOME="${COMPANION_HOME:-/home/casparcg/companion}"
COMPANION_MODULE_SRC="${COMPANION_MODULE_SRC:-/home/casparcg/companion-module-dev/companion-module-highpass-highascg}"
MODULE_INSTALL="${HERE}/install-companion-module.sh"
SERVICE_INSTALL="${HERE}/install-companion-service.sh"

if [[ ! -x "${COMPANION_HOME}/companion_headless.sh" ]]; then
	echo "ERROR: Companion not found at ${COMPANION_HOME}/companion_headless.sh" >&2
	echo "  Extract the Bitfocus Companion headless tarball to ${COMPANION_HOME} before eggs produce." >&2
	exit 1
fi

if [[ ! -f "${COMPANION_MODULE_SRC}/package.json" ]]; then
	echo "ERROR: highpass-highascg module source missing: ${COMPANION_MODULE_SRC}" >&2
	exit 1
fi

echo "==> Companion + highpass-highascg module (eggs clone snapshot)"
echo "    Companion: ${COMPANION_HOME}"
echo "    Module src: ${COMPANION_MODULE_SRC}"

export COMPANION_MODULE_SRC
export MODULES_DIR="${MODULES_DIR:-/home/casparcg/.config/companion/modules}"
export COMPANION_DB="${COMPANION_DB:-/home/casparcg/.config/companion/v5.0/db.sqlite}"

if getent passwd casparcg >/dev/null 2>&1; then
	sudo -u casparcg -H bash "${MODULE_INSTALL}"
else
	bash "${MODULE_INSTALL}"
fi

export COMPANION_HOME
export HIGHASCG_SKIP_COMPANION_RESTART="${HIGHASCG_SKIP_COMPANION_RESTART:-1}"
bash "${SERVICE_INSTALL}"

if [[ ! -d "${MODULES_DIR}/highpass-highascg" ]]; then
	echo "ERROR: packaged module missing after install: ${MODULES_DIR}/highpass-highascg" >&2
	exit 1
fi

echo "OK: Companion + highpass-highascg ready for eggs produce clone"

#!/usr/bin/env bash
# Enable dev-mode workflow for the HighAsCG Companion module.
#
# Companion v5.0 loads extra modules from --extra-module-path, configured on this box by the
# systemd drop-in /etc/systemd/system/companion.service.d/override.conf:
#
#     --extra-module-path /home/casparcg/companion-module-dev
#
# Companion scans that directory for module FOLDERS, so the symlink goes at
# <extra-module-path>/<module-id> and points at the packaged build (pkg/<module-id>).
#
# WHAT THIS SCRIPT DOES NOT DO (WO-372, checklist27 item 40 — "there is no dev to choose"):
# it does not make the dev build selectable on its own. Companion's picker lists VERSIONS of a
# module id; while the dev package and the installed package both declared 1.0.4 there was exactly
# one entry to offer and no way to tell which copy was live. `npm run package:dev` in the module
# repo now stamps a prerelease version (scripts/stamp-dev-manifest.js) so the two are
# distinguishable. This script REFUSES to finish if that stamping did not happen — see the version
# collision check below.
#
# After running this, the workflow is:
#   1. Edit source in <module repo>/src/
#   2. Run: npm run package:dev   (stamps <next patch>-dev.<utc stamp>, isPrerelease)
#   3. sudo systemctl restart companion
#   4. Pick the dev version on the HighAsCG connection (the pin lives in Companion's db.sqlite —
#      an existing connection keeps loading the version it is pinned to until you change it)
#
set -euo pipefail

DEV_MODULES_DIR="${COMPANION_DEV_MODULES_DIR:-/home/casparcg/companion-module-dev}"
MODULE_ID="${COMPANION_MODULE_ID:-highpass-highascg}"
MODULE_REPO="${DEV_MODULES_DIR}/companion-module-${MODULE_ID}"
INSTALLED_MODULE="${COMPANION_INSTALLED_MODULE:-/home/casparcg/.config/companion/modules/${MODULE_ID}}"

echo "=== HighAsCG Companion Module Dev Mode Setup ==="
echo ""

# Verify source repository exists
if [[ ! -d "${MODULE_REPO}/src" ]]; then
	echo "ERROR: Module source not found at: ${MODULE_REPO}/src" >&2
	echo "       Set COMPANION_DEV_MODULES_DIR env var to override" >&2
	exit 1
fi

MODULE_SRC="${MODULE_REPO}/src"
BUILT_MODULE="${MODULE_REPO}/pkg/${MODULE_ID}"
DEV_MODULE_LINK="${DEV_MODULES_DIR}/${MODULE_ID}"
DEV_MANIFEST="${BUILT_MODULE}/companion/manifest.json"

# Check if built output exists
if [[ ! -d "${BUILT_MODULE}" ]]; then
	echo "WARNING: Built module not found at: ${BUILT_MODULE}" >&2
	echo "         You must build the module first:" >&2
	echo "         $ cd '${MODULE_REPO}'" >&2
	echo "         $ npm run package:dev" >&2
	echo "         Then run this script again." >&2
	exit 1
fi

# Check if built module has the expected structure
# manifest lives in companion/, entrypoint is ../main.js relative to it — i.e. pkg/<id>/main.js
if [[ ! -f "${DEV_MANIFEST}" ]] || [[ ! -f "${BUILT_MODULE}/main.js" ]]; then
	echo "ERROR: Built module missing expected files (companion/manifest.json, main.js)" >&2
	echo "       at: ${BUILT_MODULE}" >&2
	exit 1
fi

read_manifest_version() {
	# $1 = manifest path. Node is always present (Companion and highascg both need it).
	node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version||''))" "$1"
}

# WO-372: the failure this script used to hide. Two copies of one module id claiming one version
# means one picker entry and a silent, scan-order-dependent choice between them.
DEV_VERSION="$(read_manifest_version "${DEV_MANIFEST}")"
if [[ -f "${INSTALLED_MODULE}/companion/manifest.json" ]]; then
	INSTALLED_VERSION="$(read_manifest_version "${INSTALLED_MODULE}/companion/manifest.json")"
	if [[ "${DEV_VERSION}" == "${INSTALLED_VERSION}" ]]; then
		echo "ERROR: dev and installed builds both declare ${MODULE_ID}@${DEV_VERSION}." >&2
		echo "       Companion's version picker lists versions of a module id, so there would be" >&2
		echo "       NOTHING to choose and no way to tell which copy is live (WO-372)." >&2
		echo "" >&2
		echo "       Fix: rebuild the dev package so it stamps a dev version:" >&2
		echo "         cd '${MODULE_REPO}' && npm run package:dev" >&2
		exit 1
	fi
	echo "Versions: dev ${DEV_VERSION}  vs  installed ${INSTALLED_VERSION}  ✓ distinguishable"
else
	echo "Versions: dev ${DEV_VERSION} (no installed copy found at ${INSTALLED_MODULE})"
fi
echo ""

# Setup or verify symlink
if [[ ! -e "${DEV_MODULE_LINK}" ]]; then
	echo "Creating symlink: ${DEV_MODULE_LINK}"
	ln -s "${BUILT_MODULE}" "${DEV_MODULE_LINK}"
	echo "  ✓ Symlink created"
elif [[ -L "${DEV_MODULE_LINK}" ]]; then
	current_target=$(readlink "${DEV_MODULE_LINK}")
	if [[ "${current_target}" != "${BUILT_MODULE}" ]]; then
		echo "Updating symlink: ${DEV_MODULE_LINK}"
		rm "${DEV_MODULE_LINK}"
		ln -s "${BUILT_MODULE}" "${DEV_MODULE_LINK}"
		echo "  ✓ Symlink updated to point to: ${BUILT_MODULE}"
	else
		echo "  ✓ Symlink already correct: ${DEV_MODULE_LINK} → ${BUILT_MODULE}"
	fi
else
	echo "ERROR: Unknown state at ${DEV_MODULE_LINK} (exists but is not a symlink)" >&2
	exit 1
fi

echo ""
echo "=== Dev Mode Enabled ==="
echo ""
echo "Module Source:    ${MODULE_SRC}"
echo "Built Module:     ${BUILT_MODULE}  (${DEV_VERSION})"
echo "Companion Path:   ${DEV_MODULE_LINK}"
echo "Service Override: /etc/systemd/system/companion.service.d/override.conf"
echo ""
echo "=== Development Workflow ==="
echo ""
echo "1. Edit source files in:"
echo "   ${MODULE_SRC}/"
echo ""
echo "2. Build the module (stamps a dev version — do NOT use plain 'npm run package' here):"
echo "   cd '${MODULE_REPO}'"
echo "   npm run package:dev"
echo ""
echo "3. Reload Companion to load the updated module:"
echo "   sudo systemctl restart companion"
echo ""
echo "4. Select the dev version in Companion:"
echo "   Connections → HighAsCG → version dropdown → ${DEV_VERSION}"
echo "   (The pin lives in Companion's db.sqlite; an existing connection keeps its pinned"
echo "    version until you change it — see WO-330 and WO-372.)"
echo ""
echo "5. Verify the module loaded:"
echo "   journalctl -u companion --since '1 min ago' | grep -i highpass"
echo ""
echo "=== To Switch Back to Packaged Module ==="
echo ""
echo "Re-select the released version in the same dropdown, or reinstall:"
echo "   cd /home/casparcg/highascg"
echo "   sudo systemctl stop companion"
echo "   ./tools/eggs/companion/install-companion-module.sh"
echo "   sudo systemctl start companion"
echo ""
echo "(Or remove the dev symlink and reinstall the packaged version.)"
echo ""

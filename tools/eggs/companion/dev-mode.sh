#!/usr/bin/env bash
# Enable dev-mode workflow for the HighAsCG Companion module.
#
# Companion v5.0 supports --extra-module-path to load modules from a dev checkout.
# This script sets up a symlink so the built module is discoverable by Companion.
#
# After running this, the workflow is:
#   1. Edit source in companion-module-dev/companion-module-highpass-highascg/src/
#   2. Run: npm run package:dev  (from the module repo)
#   3. Reload Companion (sudo systemctl restart companion)
#
set -euo pipefail

MODULE_SRC="${COMPANION_MODULE_SRC:-/home/casparcg/companion-module-dev/companion-module-highpass-highascg}"
DEV_MODULES_DIR="${COMPANION_DEV_MODULES_DIR:-/home/casparcg/companion-module-dev}"
BUILT_MODULE="${MODULE_SRC}/pkg/highpass-highascg"
DEV_MODULE_LINK="${DEV_MODULES_DIR}/highpass-highascg"

echo "=== HighAsCG Companion Module Dev Mode Setup ==="
echo ""

# Verify source repository exists
if [[ ! -d "${MODULE_SRC}" ]]; then
	echo "ERROR: Module source not found at: ${MODULE_SRC}" >&2
	echo "       Set COMPANION_MODULE_SRC env var to override" >&2
	exit 1
fi

# Check if built output exists
if [[ ! -d "${BUILT_MODULE}" ]]; then
	echo "WARNING: Built module not found at: ${BUILT_MODULE}" >&2
	echo "         You must build the module first:" >&2
	echo "         $ cd '${MODULE_SRC}'" >&2
	echo "         $ npm run package" >&2
	echo "         Then run this script again." >&2
	exit 1
fi

# Check if built module has the expected structure
if [[ ! -f "${BUILT_MODULE}/package.json" ]] || [[ ! -f "${BUILT_MODULE}/main.js" ]]; then
	echo "ERROR: Built module missing expected files (package.json, main.js)" >&2
	echo "       at: ${BUILT_MODULE}" >&2
	exit 1
fi

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
		echo "Symlink already correct: ${DEV_MODULE_LINK}"
		echo "  → ${BUILT_MODULE}"
	fi
elif [[ -d "${DEV_MODULE_LINK}" ]]; then
	echo "ERROR: Directory exists at ${DEV_MODULE_LINK} (not a symlink)" >&2
	echo "       Remove it or set a different dev modules path" >&2
	exit 1
else
	echo "ERROR: Unknown state at ${DEV_MODULE_LINK}" >&2
	exit 1
fi

echo ""
echo "=== Dev Mode Enabled ==="
echo ""
echo "Module Source:    ${MODULE_SRC}"
echo "Built Module:     ${BUILT_MODULE}"
echo "Companion Path:   ${DEV_MODULE_LINK}"
echo "Service Override: /etc/systemd/system/companion.service.d/override.conf"
echo ""
echo "=== Development Workflow ==="
echo ""
echo "1. Edit source files in:"
echo "   ${MODULE_SRC}/src/"
echo ""
echo "2. Build the module:"
echo "   cd '${MODULE_SRC}'"
echo "   npm run package:dev"
echo "   (or: npm run package)"
echo ""
echo "3. Reload Companion to load the updated module:"
echo "   sudo systemctl restart companion"
echo ""
echo "4. Verify the module loaded:"
echo "   journalctl -u companion --since '1 min ago' | grep -i highpass"
echo ""
echo "=== To Switch Back to Packaged Module ==="
echo ""
echo "Run the standard install:"
echo "   cd '${MODULE_SRC}'"
echo "   sudo systemctl stop companion"
echo "   ./tools/eggs/companion/install-companion-module.sh"
echo "   sudo systemctl start companion"
echo ""
echo "(Or remove the dev symlink and reinstall the packaged version.)"
echo ""

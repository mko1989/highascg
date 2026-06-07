#!/usr/bin/env bash
# Re-overlay pinned CEF from GitHub release (install-config.sh URL_CEF_BINARY_TAR).
# Clears cef-cache when libcef.so already exists in ~/highascg/lib/.
#
#   sudo bash scripts/setup/reinstall-cef.sh
#   sudo systemctl restart nodm
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec bash "${SCRIPT_DIR}/08-caspar-cef-scanner.sh"

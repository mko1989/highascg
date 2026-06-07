#!/usr/bin/env bash
# Step 11: Host boot branding (GRUB wallpaper + framebuffer corner throbber).
#
# Default: dmesg visible at boot, Plymouth masked (safe for playout / nodm).
# Plymouth splash instead: HIGHASCG_HOST_BOOT_MODE=plymouth
#
# ISO/USB eggs branding is separate — see tools/eggs/live-usb/branding/README.md
#
#   sudo bash scripts/setup/11-boot-branding.sh
#   sudo reboot
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

exec bash "${SCRIPTS_DIR}/install-host-boot-branding.sh"

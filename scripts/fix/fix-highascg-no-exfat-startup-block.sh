#!/usr/bin/env bash
# Remove ~90s boot/start delay when HIGHASCGEXF is absent (WO-47).
# Prefer: sudo bash scripts/fix-boot-emergency-recovery.sh (also fixes stale /boot/efi fstab).
# Run: sudo bash scripts/fix-highascg-no-exfat-startup-block.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "${REPO_ROOT}/scripts/fix-boot-emergency-recovery.sh" "${1:-casparcg}"

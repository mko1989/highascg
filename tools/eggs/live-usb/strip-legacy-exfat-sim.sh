#!/usr/bin/env bash
# Remove deprecated sim/highascg/ from an exFAT mount (or path). Linux playout uses drop-update/ only.
# Usage: sudo bash tools/eggs/live-usb/strip-legacy-exfat-sim.sh [/home/casparcg/exfat]
set -euo pipefail

ROOT="${1:-/home/casparcg/exfat}"
SIM="${ROOT}/sim"

[[ -d "$SIM" ]] || {
	echo "OK: no ${SIM} (nothing to remove)"
	exit 0
}

if mountpoint -q "$ROOT" 2>/dev/null; then
	echo "Removing deprecated ${SIM} on mounted exFAT ($(df -h "$ROOT" | tail -1 | awk '{print $4}' ) free before)…"
else
	echo "Removing deprecated ${SIM} under ${ROOT} (not a mountpoint — host stub dir)…"
fi

rm -rf "$SIM"
sync 2>/dev/null || true
echo "OK: removed ${SIM}"

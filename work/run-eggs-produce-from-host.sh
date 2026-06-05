#!/usr/bin/env bash
# Full HighAsCG live ISO from this running host (clone + branding + verify).
# Run in a terminal where sudo works (build takes ~20–60 min):
#
#   cd /home/casparcg/highascg
#   sudo HIGHASCG_NVIDIA_DRIVER=595 bash work/run-eggs-produce-from-host.sh
#
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo HIGHASCG_NVIDIA_DRIVER=595 $0" >&2
	exit 1
}

export HIGHASCG_NVIDIA_DRIVER="${HIGHASCG_NVIDIA_DRIVER:-595}"
REPO="/home/casparcg/highascg"
LOG="${REPO}/work/eggs-build-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "${REPO}/work"

exec > >(tee -a "$LOG") 2>&1
echo "==> eggs build log: $LOG"
echo "==> host: $(hostname) driver=${HIGHASCG_NVIDIA_DRIVER} disk=$(df -h / | tail -1)"
echo "==> highascg service: $(systemctl is-active highascg 2>/dev/null || echo n/a)"

cd "$REPO"
bash tools/eggs/live-usb/build-highascg-egg.sh

echo "==> done $(date -Is)"

#!/usr/bin/env bash
# Full HighAsCG live ISO from this running host (clone + branding + verify).
#
# SAFETY: read work/EGGS_PRODUCE_SAFETY.md before running.
# Requires: /etc/highascg/pinned-kernel, no liveroot bind mounts, eggs prepare done.
#
#   cd /home/casparcg/highascg
#   sudo HIGHASCG_NVIDIA_DRIVER=595 bash work/run-eggs-produce-from-host.sh
#
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo HIGHASCG_NVIDIA_DRIVER=595 $0" >&2
	exit 1
}

REPO="/home/casparcg/highascg"
LIVE_USB="${REPO}/tools/eggs/live-usb"
# shellcheck source=../tools/eggs/live-usb/eggs-liveroot-safety.sh
source "${LIVE_USB}/eggs-liveroot-safety.sh"

if eggs_liveroot_has_host_bind_mounts "$(eggs_liveroot_default)"; then
	echo "ERROR: liveroot has live system bind mounts — reboot before produce." >&2
	eggs_liveroot_print_host_bind_mounts "$(eggs_liveroot_default)"
	exit 1
fi

if [[ ! -f /etc/highascg/pinned-kernel ]]; then
	echo "ERROR: missing /etc/highascg/pinned-kernel — run scripts/setup/01-kernel-117.sh first." >&2
	exit 1
fi

echo "==> Pre-produce checks"
echo "  pinned kernel: $(cat /etc/highascg/pinned-kernel)"
echo "  running kernel: $(uname -r)"
echo "  See: ${REPO}/work/EGGS_PRODUCE_SAFETY.md"

export HIGHASCG_NVIDIA_DRIVER="${HIGHASCG_NVIDIA_DRIVER:-595}"
LOG="${REPO}/work/eggs-build-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "${REPO}/work"

exec > >(tee -a "$LOG") 2>&1
echo "==> eggs build log: $LOG"
echo "==> host: $(hostname) driver=${HIGHASCG_NVIDIA_DRIVER} disk=$(df -h / | tail -1)"
echo "==> highascg service: $(systemctl is-active highascg 2>/dev/null || echo n/a)"

cd "$REPO"
bash tools/eggs/live-usb/build-highascg-egg.sh

echo "==> done $(date -Is)"

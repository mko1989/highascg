#!/usr/bin/env bash
# nodm failed: Xorg "no screens found" — usually missing nvidia-driver-595 userspace
# or wrong kernel module flavor after open/closed APT flip-flops.
#
#   sudo bash scripts/fix-nodm-no-screens.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Current state"
dpkg -l nvidia-driver-595 linux-modules-nvidia-595-generic nvidia-utils-595 2>/dev/null \
	| awk '/^../ {print "  ", $1, $2, $3}' || true
command -v nvidia-smi >/dev/null && nvidia-smi -L || echo "  nvidia-smi: not installed"
ls /dev/dri/card0 2>/dev/null || echo "  /dev/dri/card0: missing"
if [[ -r /proc/driver/nvidia/version ]]; then
	echo "  kernel module: $(head -1 /proc/driver/nvidia/version)"
fi

bash "${HERE}/install-nvidia-driver-595-blackwell.sh"

echo
echo "==> Reboot required. After reboot:"
echo "  sudo systemctl reset-failed nodm"
echo "  sudo systemctl start nodm"
echo "  sudo chvt 7"

#!/usr/bin/env bash
# Restore the closed nvidia-driver-595 USERSPACE when kernel modules are already present.
#
# The proprietary prebuilt stack is two halves:
#   linux-modules-nvidia-595-generic   — closed kernel modules (restricted)
#   nvidia-driver-595                  — userspace (nvidia-smi, X driver, libnvidia-*)
#
# APT autoremove during open/closed flip-flops often deletes nvidia-driver-595 and all
# libnvidia-* while leaving linux-modules-nvidia-595-generic on disk. Symptom:
#   - modinfo nvidia shows license NVIDIA (closed module loaded)
#   - nvidia-smi: command not found
#   - no nvidia_drv.so → Xorg "no screens found" → nodm fails
#
#   sudo bash scripts/restore-nvidia-595-closed-userspace.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

BR="${HIGHASCG_NVIDIA_DRIVER:-595}"
DRV="nvidia-driver-${BR}"
KMOD_META="linux-modules-nvidia-${BR}-generic"
USERSPACE=(
	"$DRV"
	"nvidia-utils-${BR}"
	"xserver-xorg-video-nvidia-${BR}"
	"libnvidia-gl-${BR}"
	"libnvidia-compute-${BR}"
)

log() { echo "==> $*"; }

log "Current NVIDIA packages"
dpkg -l "$DRV" "$KMOD_META" nvidia-utils-"${BR}" 2>/dev/null | awk '/^../ {print "  ", $1, $2, $3}' || true

if ! dpkg-query -W "$KMOD_META" &>/dev/null; then
	echo "ERROR: ${KMOD_META} not installed — run install-nvidia-proprietary-595.sh first." >&2
	exit 1
fi

log "Install userspace only (keeps ${KMOD_META}, does not touch kernel modules)"
DEBIAN_FRONTEND=noninteractive apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y "$DRV"

log "Pin userspace packages so autoremove cannot drop them again"
for pkg in "${USERSPACE[@]}"; do
	apt-mark manual "$pkg" 2>/dev/null || true
done
apt-mark manual "$KMOD_META" 2>/dev/null || true

log "Verify"
missing=0
for pkg in "${USERSPACE[@]}"; do
	if ! dpkg-query -W "$pkg" &>/dev/null; then
		echo "  MISSING: $pkg" >&2
		missing=1
	fi
done
if ((missing)); then
	echo "ERROR: userspace install incomplete." >&2
	exit 1
fi

command -v nvidia-smi >/dev/null && nvidia-smi -L || echo "  (nvidia-smi present; GPU list may need reboot/module reload)"

echo
echo "Userspace restored. If nodm still fails:"
echo "  sudo reboot"
echo "  sudo systemctl reset-failed nodm && sudo systemctl start nodm"
echo "  ls /dev/dri/card0 && nvidia-smi"

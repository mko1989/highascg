#!/usr/bin/env bash
# DEPRECATED — use scripts/setup/01-kernel-117.sh (no closed NVIDIA modules).
# This script installs linux-modules-nvidia-595-* which breaks Blackwell.
#
# Pin this host to kernel 6.8.0-117-generic and remove 6.8.0-124 (breaks our NVIDIA stack).
# Closed NVIDIA 595 via prebuilt linux-modules-nvidia-595 (NOT nvidia-dkms-595).
#
#   sudo bash scripts/pin-kernel-6.8.0-117.sh
#   sudo reboot
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=../lib/apt-block-service-starts.sh
source "${REPO_ROOT}/scripts/lib/apt-block-service-starts.sh"

TARGET_KVER="6.8.0-117"
TARGET_KREL="${TARGET_KVER}-generic"

KERNEL_124_PKGS=(
	linux-image-6.8.0-124-generic
	linux-headers-6.8.0-124-generic
	linux-headers-6.8.0-124
	linux-modules-6.8.0-124-generic
	linux-modules-extra-6.8.0-124-generic
	linux-modules-nvidia-595-open-6.8.0-124-generic
	linux-modules-nvidia-595-6.8.0-124-generic
)

META_PULL_124=(
	linux-image-generic
	linux-headers-generic
	linux-generic
	linux-modules-nvidia-595-open-generic
	linux-modules-nvidia-595-generic
)

NVIDIA_USERSPACE=(
	nvidia-kernel-common-595
	libnvidia-gl-595
	libnvidia-compute-595
	libnvidia-extra-595
	nvidia-compute-utils-595
	libnvidia-decode-595
	libnvidia-encode-595
	nvidia-utils-595
	xserver-xorg-video-nvidia-595
	libnvidia-cfg1-595
	libnvidia-fbc1-595
)

log() { echo "==> $*"; }

cleanup() {
	highascg_apt_unblock_service_starts
}
trap cleanup EXIT

log "Block DKMS NVIDIA (prebuilt modules only)"
bash "${REPO_ROOT}/scripts/deprecated/nvidia/fix-nvidia-dkms-prebuilt-conflict.sh" "${TARGET_KREL}" || true

log "Ensure kernel ${TARGET_KREL} (headers + modules before image triggers dkms)"
DEBIAN_FRONTEND=noninteractive apt-get update -y
highascg_apt_block_service_starts
DEBIAN_FRONTEND=noninteractive apt-get install -y \
	"linux-headers-${TARGET_KREL}" \
	"linux-modules-${TARGET_KREL}" \
	"linux-modules-nvidia-595-${TARGET_KREL}" \
	"${NVIDIA_USERSPACE[@]}"

DEBIAN_FRONTEND=noninteractive apt-get install -y "linux-image-${TARGET_KREL}"
DEBIAN_FRONTEND=noninteractive dpkg --configure -a

log "Remove open NVIDIA kernel modules (124 meta / per-kernel)"
for pkg in linux-modules-nvidia-595-open-generic \
	linux-modules-nvidia-595-open-"${TARGET_KREL}" \
	linux-modules-nvidia-595-open-6.8.0-124-generic; do
	dpkg-query -W "$pkg" &>/dev/null &&
		DEBIAN_FRONTEND=noninteractive apt-get remove -y --purge "$pkg" || true
done

log "Purge kernel 6.8.0-124 packages"
for pkg in "${KERNEL_124_PKGS[@]}"; do
	dpkg-query -W "$pkg" &>/dev/null &&
		DEBIAN_FRONTEND=noninteractive apt-get remove -y --purge "$pkg" || true
done

log "Purge meta packages that track latest kernel (currently 124)"
for pkg in "${META_PULL_124[@]}"; do
	dpkg-query -W "$pkg" &>/dev/null &&
		DEBIAN_FRONTEND=noninteractive apt-get remove -y --purge "$pkg" || true
done

DEBIAN_FRONTEND=noninteractive apt-get autoremove -y

log "Hold kernel and NVIDIA userspace at ${TARGET_KREL} / 595 closed"
apt-mark hold \
	"linux-image-${TARGET_KREL}" \
	"linux-headers-${TARGET_KREL}" \
	"linux-modules-${TARGET_KREL}" \
	"linux-modules-nvidia-595-${TARGET_KREL}" \
	nvidia-dkms-595 nvidia-kernel-source-595 nvidia-driver-595 \
	nvidia-utils-595

log "Default GRUB entry -> ${TARGET_KREL}"
GRUB_FILE=/etc/default/grub
if grep -q '^GRUB_DEFAULT=' "$GRUB_FILE"; then
	sed -i 's|^GRUB_DEFAULT=.*|GRUB_DEFAULT=saved|' "$GRUB_FILE"
else
	echo 'GRUB_DEFAULT=saved' >>"$GRUB_FILE"
fi
if grep -q '^GRUB_SAVEDEFAULT=' "$GRUB_FILE"; then
	sed -i 's/^GRUB_SAVEDEFAULT=.*/GRUB_SAVEDEFAULT=true/' "$GRUB_FILE"
else
	echo 'GRUB_SAVEDEFAULT=true' >>"$GRUB_FILE"
fi
grub-set-default 0 2>/dev/null || true

update-grub
update-initramfs -u -k "${TARGET_KREL}"

log "Remove leftover 124 boot artifacts (if any)"
for path in /boot/*6.8.0-124*; do
	[[ -e "$path" ]] || continue
	rm -f "$path"
done

mkdir -p /etc/highascg
echo "${TARGET_KREL}" >/etc/highascg/pinned-kernel
echo closed >/etc/highascg/nvidia-kernel-module-type
chmod 0644 /etc/highascg/pinned-kernel /etc/highascg/nvidia-kernel-module-type

echo
echo "Pinned kernel: ${TARGET_KREL}"
dpkg -l "linux-image-${TARGET_KREL}" "linux-modules-nvidia-595-${TARGET_KREL}" nvidia-utils-595 2>/dev/null \
	| awk '/^ii/ {print "  installed:", $2, $3}' || true
echo
echo "REBOOT required. After reboot:"
echo "  uname -r                    # must show ${TARGET_KREL}"
echo "  nvidia-smi                  # Driver Version: 595.71.05"
echo "  modinfo nvidia | grep filename"

#!/usr/bin/env bash
# Step 3: NVIDIA open kernel modules 595 for Blackwell (RTX PRO 4000).
# Requires 6.8.0-117-generic (run 01 + 02 first).
#
# Closed cuda-drivers / Ubuntu nvidia-driver-595 break Blackwell:
#   NVRM: requires use of the NVIDIA open kernel modules.
#
#   sudo bash scripts/setup/03-nvidia-open-595.sh
#   sudo reboot
#   nvidia-smi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root
setup_trap_apt_cleanup

if [[ "$(uname -r)" != "${TARGET_KREL}" ]]; then
	echo "ERROR: running $(uname -r), expected ${TARGET_KREL}. Run 01-kernel-117.sh and reboot first." >&2
	exit 1
fi

BR="${HIGHASCG_NVIDIA_DRIVER:-595}"
KREL="$(uname -r)"
DISTRO=ubuntu2404
ARCH=x86_64
KEYRING_VER=1.1-1
KEYRING_DEB="cuda-keyring_${KEYRING_VER}_all.deb"
KEYRING_URL="https://developer.download.nvidia.com/compute/cuda/repos/${DISTRO}/${ARCH}/${KEYRING_DEB}"
WORKDIR="${TMPDIR:-/tmp}/highascg-nvidia-cuda-repo"
STAMP=/etc/highascg/nvidia-kernel-module-type
HIGHASCG_PIN=/etc/apt/preferences.d/highascg-nvidia-proprietary.pref

log "Kernel headers for ${KREL}"
DEBIAN_FRONTEND=noninteractive apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y "linux-headers-${KREL}" wget

mkdir -p "$WORKDIR"
if [[ ! -f "${WORKDIR}/${KEYRING_DEB}" ]]; then
	log "Download cuda-keyring"
	wget -q -O "${WORKDIR}/${KEYRING_DEB}" "$KEYRING_URL"
fi

if ! pkg_installed cuda-keyring; then
	log "Install cuda-keyring (enables NVIDIA CUDA apt repo)"
	DEBIAN_FRONTEND=noninteractive dpkg -i "${WORKDIR}/${KEYRING_DEB}"
	DEBIAN_FRONTEND=noninteractive apt-get update -y
fi

log "Remove APT pin that blocks nvidia-open"
rm -f "$HIGHASCG_PIN"

log "Branch pin nvidia-driver-pinning-${BR}"
DEBIAN_FRONTEND=noninteractive apt-get install -y "nvidia-driver-pinning-${BR}"

log "Remove closed kernel stack (cuda-drivers / nvidia-dkms)"
CLOSED_PKGS=()
for p in cuda-drivers nvidia-driver nvidia-dkms nvidia-kernel-source; do
	dpkg-query -W -f='${Package}\n' "$p" 2>/dev/null | grep -q . && CLOSED_PKGS+=("$p") || true
done
if ((${#CLOSED_PKGS[@]} > 0)); then
	DEBIAN_FRONTEND=noninteractive apt-get remove -y "${CLOSED_PKGS[@]}"
fi

highascg_apt_block_service_starts

log "Install open kernel modules: nvidia-open"
DEBIAN_FRONTEND=noninteractive apt-get install -y nvidia-open nvidia-settings

mkdir -p /etc/highascg
echo open >"$STAMP"
echo "$BR" >/etc/highascg/nvidia-iso-driver
echo cuda-repo-open >/etc/highascg/nvidia-install-source
chmod 0644 "$STAMP" /etc/highascg/nvidia-iso-driver /etc/highascg/nvidia-install-source

for pkg in nvidia-open nvidia-driver-open nvidia-dkms-open nvidia-kernel-source-open; do
	apt-mark manual "$pkg" 2>/dev/null || true
done

if [[ -f "${SCRIPTS_DIR}/install-nvidia-persistenced-boot-order.sh" ]]; then
	bash "${SCRIPTS_DIR}/install-nvidia-persistenced-boot-order.sh" || true
fi

update-initramfs -u -k "${KREL}" 2>/dev/null || true

echo
dpkg -l nvidia-open nvidia-driver-open nvidia-dkms-open 2>/dev/null |
	awk '/^ii/ {print "  ok:", $2, $3}' || true
echo
echo "REBOOT required. After reboot:"
echo "  cat /proc/driver/nvidia/version   # Open Kernel Module"
echo "  nvidia-smi"
echo "  ls /dev/dri/card0"
echo "  sudo bash ${SCRIPT_DIR}/04-ndi.sh"

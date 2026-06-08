#!/usr/bin/env bash
# DEPRECATED — closed cuda-drivers; wrong for Blackwell. Use scripts/setup/03-nvidia-open-595.sh
#
# Install proprietary closed NVIDIA driver via the official CUDA network repository.
#
# Ubuntu's nvidia-driver-595 / linux-modules-nvidia-595-generic path does NOT expose
# `cuda-drivers` — that package lives in NVIDIA's repo and requires cuda-keyring first.
#
# Per NVIDIA docs (Ubuntu 24.04 / ubuntu2404):
#   1. linux-headers for running kernel
#   2. cuda-keyring (enables developer.download.nvidia.com APT repo)
#   3. nvidia-driver-pinning-595 (lock branch before driver install)
#   4. cuda-drivers (proprietary closed meta → nvidia-driver + nvidia-dkms + firmware)
#
#   sudo bash scripts/install-nvidia-cuda-repo-595.sh
#
# Verify after reboot:
#   nvidia-smi
#   ls /dev/dri/card0
#   cat /proc/driver/nvidia/version    # no "Open Kernel Module"
#   modinfo nvidia | grep license      # NVIDIA
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=apt-block-service-starts.sh
source "${REPO_ROOT}/scripts/lib/apt-block-service-starts.sh"
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

log() { echo "==> $*"; }

cleanup() {
	highascg_apt_unblock_service_starts
}
trap cleanup EXIT

log "Kernel headers for DKMS (${KREL})"
DEBIAN_FRONTEND=noninteractive apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
	"linux-headers-${KREL}" dkms build-essential

mkdir -p "$WORKDIR"
if [[ ! -f "${WORKDIR}/${KEYRING_DEB}" ]]; then
	log "Download cuda-keyring"
	wget -q -O "${WORKDIR}/${KEYRING_DEB}" "$KEYRING_URL"
fi

if ! dpkg-query -W cuda-keyring &>/dev/null; then
	log "Install cuda-keyring (NVIDIA CUDA APT repository)"
	DEBIAN_FRONTEND=noninteractive dpkg -i "${WORKDIR}/${KEYRING_DEB}"
else
	log "cuda-keyring already installed"
fi

log "Refresh APT (NVIDIA + Ubuntu)"
apt-get update -y

if ! apt-cache show cuda-drivers &>/dev/null; then
	echo "ERROR: cuda-drivers still not in APT after cuda-keyring — check network/repo." >&2
	exit 1
fi

log "Remove Ubuntu nvidia-driver-${BR} stack (conflicts with NVIDIA repo nvidia-driver)"
UBUNTU_PKGS=()
for p in \
	"nvidia-driver-${BR}" "nvidia-driver-${BR}-open" \
	"nvidia-dkms-${BR}" "nvidia-dkms-${BR}-open" \
	"nvidia-kernel-source-${BR}" "nvidia-kernel-source-${BR}-open" \
	"linux-modules-nvidia-${BR}-generic" \
	"linux-modules-nvidia-${BR}-open-generic" \
	"linux-modules-nvidia-${BR}-${KREL}" \
	"linux-modules-nvidia-${BR}-open-${KREL}"; do
	dpkg-query -W -f='${Package}\n' "$p" 2>/dev/null | grep -q . && UBUNTU_PKGS+=("$p") || true
done
while IFS= read -r p; do
	UBUNTU_PKGS+=("$p")
done < <(dpkg-query -W -f='${Package}\n' 2>/dev/null | grep -E \
	'^libnvidia-.+-595$|^nvidia-.+-595$|^nvidia-firmware-595-|^linux-modules-nvidia-|^linux-objects-nvidia-|^linux-signatures-nvidia-' \
	|| true)
# De-dupe
if ((${#UBUNTU_PKGS[@]} > 0)); then
	mapfile -t UBUNTU_PKGS < <(printf '%s\n' "${UBUNTU_PKGS[@]}" | sort -u)
	log "Purge Ubuntu NVIDIA ${BR} packages: ${UBUNTU_PKGS[*]}"
	DEBIAN_FRONTEND=noninteractive apt-get remove -y --purge "${UBUNTU_PKGS[@]}" || true
fi
# nvidia-firmware-595-* blocks NVIDIA-repo nvidia-firmware; apt may refuse if deps are half-broken.
while IFS= read -r p; do
	if dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install'; then
		log "Force-drop conflicting firmware package: ${p}"
		dpkg --purge --force-depends "$p" 2>/dev/null || true
	fi
done < <(dpkg-query -W -f='${Package}\n' 2>/dev/null | grep -E '^nvidia-firmware-595-' || true)

log "Pin NVIDIA driver branch ${BR}"
DEBIAN_FRONTEND=noninteractive apt-get install -y "nvidia-driver-pinning-${BR}"

log "Block Ubuntu open-driver packages (keep NVIDIA repo closed path)"
install -d -m 0755 /etc/apt/preferences.d
cat >"$HIGHASCG_PIN" <<'EOF'
# HighAsCG: never install Ubuntu/NVIDIA open kernel module metapackages.
Package: nvidia-open nvidia-driver-open nvidia-dkms-open nvidia-kernel-source-open
Pin: release *
Pin-Priority: -1

Package: nvidia-*-open
Pin: release *
Pin-Priority: -1
EOF
chmod 0644 "$HIGHASCG_PIN"
apt-get update -y

log "Install proprietary closed driver: cuda-drivers"
log "(blocking service starts — nvidia-persistenced postinst hangs without loaded driver; DKMS build can take minutes)"
highascg_apt_block_service_starts
DEBIAN_FRONTEND=noninteractive apt-get install -y cuda-drivers

mkdir -p /etc/highascg
echo proprietary >"$STAMP"
echo "$BR" >/etc/highascg/nvidia-iso-driver
echo cuda-repo >/etc/highascg/nvidia-install-source
chmod 0644 "$STAMP" /etc/highascg/nvidia-iso-driver /etc/highascg/nvidia-install-source

for pkg in cuda-drivers nvidia-driver nvidia-dkms nvidia-firmware nvidia-utils; do
	apt-mark manual "$pkg" 2>/dev/null || true
done

if [[ -f "${REPO_ROOT}/scripts/deprecated/nvidia/install-nvidia-gsp-rpc-workaround.sh" ]]; then
	log "GSP runtime-PM workaround"
	HIGHASCG_SKIP_INITRAMFS=1 bash "${REPO_ROOT}/scripts/deprecated/nvidia/install-nvidia-gsp-rpc-workaround.sh" || true
fi
if [[ -f "${REPO_ROOT}/scripts/boot/install-nvidia-persistenced-boot-order.sh" ]]; then
	bash "${REPO_ROOT}/scripts/boot/install-nvidia-persistenced-boot-order.sh"
fi
systemctl enable nvidia-persistenced 2>/dev/null || true
# Do not systemctl start — driver not loaded until reboot

log "Update initramfs for ${KREL}"
if command -v update-initramfs >/dev/null 2>&1; then
	update-initramfs -u -k "${KREL}"
fi

echo
dpkg -l cuda-keyring nvidia-driver-pinning-"${BR}" cuda-drivers nvidia-driver nvidia-dkms 2>/dev/null \
	| awk '/^ii/ {print "  installed:", $2, $3}' || true
echo
echo "REBOOT required (DKMS builds/loads proprietary modules on boot)."
echo "After reboot:"
echo "  nvidia-smi"
echo "  ls /dev/dri/card0"
echo "  sudo systemctl reset-failed nodm && sudo systemctl start nodm"

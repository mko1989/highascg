#!/usr/bin/env bash
# Step 3: NVIDIA open kernel modules 595.
# Requires 6.8.0-117-generic (run 01 + 02 first).
#
# Blackwell (RTX PRO 4000): closed cuda-drivers / Ubuntu nvidia-driver-595 fail with
#   NVRM: requires use of the NVIDIA open kernel modules.
# Turing+ (e.g. RTX 2080 SUPER): open modules work fine; closed also works, but we
# standardize on open from the CUDA repo for one ISO/stack across GPU generations.
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

# Ubuntu nvidia-firmware-595-* blocks CUDA-repo nvidia-firmware (gsp_ga10x.bin overlap).
# Must run before any apt install — broken iU packages block apt entirely.
force_drop_pkg() {
	local pkg=$1
	if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install'; then
		log "Force-drop ${pkg}"
		dpkg --remove --force-depends "$pkg" 2>/dev/null || true
		dpkg --purge --force-depends "$pkg" 2>/dev/null || true
	fi
}

recover_nvidia_firmware_conflict() {
	log "Drop Ubuntu firmware/modules that block CUDA-repo nvidia-firmware"
	while IFS= read -r p; do
		force_drop_pkg "$p"
	done < <(dpkg-query -W -f='${Package}\n' 2>/dev/null | grep -E \
		'^nvidia-firmware-595-|^linux-modules-nvidia-|^linux-objects-nvidia-|^linux-signatures-nvidia-' \
		|| true)

	if dpkg-query -W -f='${Status}' nvidia-kernel-common 2>/dev/null | grep -q 'unpacked'; then
		log "Install CUDA-repo nvidia-firmware (--force-overwrite)"
		local fw_deb=""
		for candidate in \
			/var/cache/apt/archives/nvidia-firmware_*_amd64.deb \
			/tmp/apt-dpkg-install-*/nvidia-firmware_*_amd64.deb; do
			[[ -f $candidate ]] && fw_deb=$candidate && break
		done
		if [[ -z "$fw_deb" ]]; then
			apt-get download nvidia-firmware 2>/dev/null || true
			fw_deb=$(ls -t nvidia-firmware_*_amd64.deb 2>/dev/null | head -1 || true)
		fi
		if [[ -n "$fw_deb" && -f "$fw_deb" ]]; then
			dpkg -i --force-overwrite "$fw_deb"
		else
			log "WARN: nvidia-firmware .deb not cached — apt will fetch during configure"
		fi
	fi

	if dpkg-query -W -f='${Status}' nvidia-dkms-open 2>/dev/null | grep -qE 'unpacked|half-configured'; then
		log "Finish interrupted open-driver install (DKMS build may take several minutes)"
		DEBIAN_FRONTEND=noninteractive dpkg --configure -a
		DEBIAN_FRONTEND=noninteractive apt-get install -y -f
	fi
}

highascg_apt_block_service_starts
recover_nvidia_firmware_conflict

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

if [[ -f "${SCRIPTS_BOOT}/install-nvidia-persistenced-boot-order.sh" ]]; then
	bash "${SCRIPTS_BOOT}/install-nvidia-persistenced-boot-order.sh" || true
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

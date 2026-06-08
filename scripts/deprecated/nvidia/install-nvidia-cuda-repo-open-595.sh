#!/usr/bin/env bash
# DEPRECATED — use scripts/setup/03-nvidia-open-595.sh
#
# Install OPEN kernel modules for Blackwell via NVIDIA CUDA repo.
#
# RTX PRO 4000 Blackwell (PCI 10de:2c34) on driver 595.71 CANNOT use closed/proprietary
# kernel modules. The closed module loads but NVRM refuses RmInit:
#
#   NVRM: requires use of the NVIDIA open kernel modules.
#   NVRM: RmInitAdapter failed!
#
# This is not a missing package — cuda-drivers (closed) is fully installed.
# NVIDIA docs: Open Kernel Modules → apt install nvidia-open
#              Proprietary Kernel Modules → apt install cuda-drivers  (Blackwell: fails)
#
# Userspace (nvidia-smi, libnvidia-*, X driver) stays proprietary NVIDIA; only the
# *kernel module flavor* switches to open (Dual MIT/GPL).
#
#   sudo bash scripts/install-nvidia-cuda-repo-open-595.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=apt-block-service-starts.sh
source "${REPO_ROOT}/scripts/lib/apt-block-service-starts.sh"

BR="${HIGHASCG_NVIDIA_DRIVER:-595}"
KREL="$(uname -r)"
STAMP=/etc/highascg/nvidia-kernel-module-type
HIGHASCG_PIN=/etc/apt/preferences.d/highascg-nvidia-proprietary.pref

log() { echo "==> $*"; }

cleanup() {
	highascg_apt_unblock_service_starts
}
trap cleanup EXIT

if ! dpkg-query -W cuda-keyring &>/dev/null; then
	log "cuda-keyring missing — enable CUDA repo first"
	bash "${SCRIPT_DIR}/install-nvidia-cuda-repo-595.sh" || true
	if ! dpkg-query -W cuda-keyring &>/dev/null; then
		echo "ERROR: install cuda-keyring first." >&2
		exit 1
	fi
	highascg_apt_block_service_starts
fi

log "Remove APT pin that blocks nvidia-open (HighAsCG proprietary pref)"
rm -f "$HIGHASCG_PIN"

log "Ensure branch pin stays on ${BR}"
DEBIAN_FRONTEND=noninteractive apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y "nvidia-driver-pinning-${BR}"

log "Remove closed kernel stack (cuda-drivers / nvidia-dkms)"
CLOSED_PKGS=()
for p in cuda-drivers nvidia-driver nvidia-dkms nvidia-kernel-source; do
	dpkg-query -W -f='${Package}\n' "$p" 2>/dev/null | grep -q . && CLOSED_PKGS+=("$p") || true
done
if ((${#CLOSED_PKGS[@]} > 0)); then
	DEBIAN_FRONTEND=noninteractive apt-get remove -y "${CLOSED_PKGS[@]}"
fi

log "Block service starts during package configure"
highascg_apt_block_service_starts

log "Install open kernel modules: nvidia-open (pinned to ${BR} by nvidia-driver-pinning-${BR})"
DEBIAN_FRONTEND=noninteractive apt-get install -y nvidia-open

mkdir -p /etc/highascg
echo open >"$STAMP"
echo "$BR" >/etc/highascg/nvidia-iso-driver
echo cuda-repo-open >/etc/highascg/nvidia-install-source
chmod 0644 "$STAMP" /etc/highascg/nvidia-iso-driver /etc/highascg/nvidia-install-source

for pkg in nvidia-open nvidia-driver-open nvidia-dkms-open nvidia-kernel-source-open; do
	apt-mark manual "$pkg" 2>/dev/null || true
done

if [[ -f "${REPO_ROOT}/scripts/deprecated/nvidia/install-nvidia-gsp-rpc-workaround.sh" ]]; then
	HIGHASCG_SKIP_INITRAMFS=1 bash "${REPO_ROOT}/scripts/deprecated/nvidia/install-nvidia-gsp-rpc-workaround.sh" || true
fi
if [[ -f "${REPO_ROOT}/scripts/boot/install-nvidia-persistenced-boot-order.sh" ]]; then
	bash "${REPO_ROOT}/scripts/boot/install-nvidia-persistenced-boot-order.sh"
fi

log "Update initramfs for ${KREL}"
update-initramfs -u -k "${KREL}" 2>/dev/null || true

echo
echo "Kernel log check (should be empty after reboot):"
journalctl -k -b --no-pager 2>/dev/null | grep -i 'requires use of the NVIDIA open' | tail -3 || echo "  (none this boot — good if already on open)"
dpkg -l nvidia-open nvidia-driver-open nvidia-dkms-open 2>/dev/null | awk '/^ii/ {print "  installed:", $2, $3}' || true
echo
echo "REBOOT required to load open kernel modules."
echo "After reboot verify:"
echo "  cat /proc/driver/nvidia/version   # should contain 'Open Kernel Module'"
echo "  modinfo nvidia | grep license       # Dual MIT/GPL"
echo "  nvidia-smi"
echo "  ls /dev/dri/card0"
echo "  sudo systemctl reset-failed nodm && sudo systemctl start nodm"

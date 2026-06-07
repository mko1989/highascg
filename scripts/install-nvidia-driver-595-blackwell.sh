#!/usr/bin/env bash
# DEPRECATED — use scripts/setup/03-nvidia-open-595.sh
# Restore NVIDIA 595 closed stack on this playout host (RTX PRO 4000 Blackwell).
#
# Pinned kernel: 6.8.0-117-generic (see scripts/pin-kernel-6.8.0-117.sh).
# Installs distro closed stack:
#   nvidia-driver-595 + linux-modules-nvidia-595-<kernel>
#
#   sudo bash scripts/install-nvidia-driver-595-blackwell.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=apt-block-service-starts.sh
source "${SCRIPT_DIR}/apt-block-service-starts.sh"

KREL="$(uname -r)"
STAMP=/etc/highascg/nvidia-kernel-module-type
PINNED=/etc/highascg/pinned-kernel

log() { echo "==> $*"; }

cleanup() {
	highascg_apt_unblock_service_starts
}
trap cleanup EXIT

if [[ -f "$PINNED" ]] && [[ "$(cat "$PINNED")" != "$KREL" ]]; then
	echo "Expected pinned kernel $(cat "$PINNED"), running $KREL." >&2
	echo "Reboot into pinned kernel or run: sudo bash scripts/pin-kernel-6.8.0-117.sh" >&2
	exit 1
fi

log "Purge CUDA-repo driver stacks and mismatched open prebuilt modules"
CLOSED=()
for p in cuda-drivers nvidia-driver nvidia-dkms nvidia-kernel-source nvidia-open \
	nvidia-driver-assistant nvidia-driver-pinning-595 \
	linux-modules-nvidia-595-open-generic "linux-modules-nvidia-595-open-${KREL}" \
	libnvidia-compute libnvidia-gl libnvidia-decode libnvidia-encode libnvidia-fbc1 \
	libnvidia-cfg1 xserver-xorg-video-nvidia nvidia-persistenced nvidia-modprobe \
	nvidia-firmware nvidia-kernel-common nvidia-settings libxnvctrl0; do
	dpkg-query -W -f='${Package}\n' "$p" 2>/dev/null | grep -q . && CLOSED+=("$p") || true
done
if ((${#CLOSED[@]} > 0)); then
	DEBIAN_FRONTEND=noninteractive apt-get remove -y --purge "${CLOSED[@]}" || true
fi
if dpkg-query -W nvidia-firmware &>/dev/null; then
	dpkg --purge --force-depends nvidia-firmware 2>/dev/null || true
fi

log "Refresh APT"
DEBIAN_FRONTEND=noninteractive apt-get update -y

log "Block service starts during package configure"
highascg_apt_block_service_starts

log "Install closed prebuilt modules + userspace (no nvidia-dkms-595)"
bash "${REPO_ROOT}/scripts/fix-nvidia-dkms-prebuilt-conflict.sh" "${KREL}"
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
	"linux-modules-nvidia-595-${KREL}" \
	nvidia-kernel-common-595 \
	libnvidia-gl-595 libnvidia-compute-595 libnvidia-extra-595 \
	nvidia-compute-utils-595 libnvidia-decode-595 libnvidia-encode-595 \
	nvidia-utils-595 xserver-xorg-video-nvidia-595 \
	libnvidia-cfg1-595 libnvidia-fbc1-595 \
	alsa-utils

for pkg in "linux-modules-nvidia-595-${KREL}" nvidia-utils-595 \
	xserver-xorg-video-nvidia-595 nvidia-kernel-common-595; do
	apt-mark manual "$pkg" 2>/dev/null || true
done
apt-mark hold nvidia-dkms-595 nvidia-kernel-source-595 nvidia-driver-595 2>/dev/null || true

if [[ -f "${REPO_ROOT}/scripts/install-nvidia-gsp-rpc-workaround.sh" ]]; then
	log "GSP RPC / blank-screen workaround (playout host)"
	HIGHASCG_SKIP_INITRAMFS=1 bash "${REPO_ROOT}/scripts/install-nvidia-gsp-rpc-workaround.sh" || true
fi
if [[ -f "${REPO_ROOT}/scripts/install-nvidia-persistenced-boot-order.sh" ]]; then
	bash "${REPO_ROOT}/scripts/install-nvidia-persistenced-boot-order.sh"
fi

log "Update initramfs"
update-initramfs -u -k "${KREL}" 2>/dev/null || true

mkdir -p /etc/highascg
echo closed >"$STAMP"
echo 595 >/etc/highascg/nvidia-iso-driver
echo ubuntu-nvidia-driver-595-closed >/etc/highascg/nvidia-install-source
chmod 0644 "$STAMP" /etc/highascg/nvidia-iso-driver /etc/highascg/nvidia-install-source

echo
dpkg -l "linux-modules-nvidia-595-${KREL}" nvidia-utils-595 alsa-utils 2>/dev/null \
	| awk '/^ii/ {print "  installed:", $2, $3}' || true
echo
echo "REBOOT required if kernel modules changed."
echo "After reboot:"
echo "  nvidia-smi"
echo "  ls /dev/dri/"
echo "  sudo systemctl reset-failed nodm && sudo systemctl start nodm"

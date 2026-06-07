#!/usr/bin/env bash
# Prebuilt linux-modules-nvidia-595-* and nvidia-dkms-595 cannot coexist on the same kernel.
# DKMS autoinstall fails with "already installed at version 595.71.05".
#
# Use prebuilt closed modules only (what works on this host).
#
#   sudo bash scripts/fix-nvidia-dkms-prebuilt-conflict.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=apt-block-service-starts.sh
source "${SCRIPT_DIR}/apt-block-service-starts.sh"

TARGET_KREL="${1:-6.8.0-117-generic}"
DKMS_PIN=/etc/apt/preferences.d/highascg-nvidia-no-dkms.pref

log() { echo "==> $*"; }

cleanup() {
	highascg_apt_unblock_service_starts
}
trap cleanup EXIT

log "Block nvidia-dkms from APT (prebuilt kernel modules only)"
mkdir -p /etc/apt/preferences.d
cat >"$DKMS_PIN" <<'EOF'
# HighAsCG: prebuilt linux-modules-nvidia-595-* replaces DKMS on pinned kernels
Package: nvidia-dkms-595 nvidia-kernel-source-595 nvidia-driver-595
Pin: release *
Pin-Priority: -1
EOF

log "Unregister DKMS nvidia builds"
while read -r line; do
	[[ -z "$line" ]] && continue
	mod="${line%%/*}"
	ver="${line#*/}"; ver="${ver%%,*}"
	dkms remove "${mod}/${ver}" --all 2>/dev/null || true
done < <(dkms status 2>/dev/null | grep -E '^nvidia/' || true)

log "Remove DKMS NVIDIA packages"
highascg_apt_block_service_starts
DEBIAN_FRONTEND=noninteractive apt-get remove -y --purge \
	nvidia-dkms-595 nvidia-kernel-source-595 nvidia-driver-595 2>/dev/null || true

log "Configure interrupted packages (linux-image postinst / dkms hook)"
DEBIAN_FRONTEND=noninteractive dpkg --configure -a

log "Install closed prebuilt modules + userspace (no DKMS meta)"
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
	"linux-modules-nvidia-595-${TARGET_KREL}" \
	nvidia-kernel-common-595 \
	libnvidia-gl-595 \
	libnvidia-compute-595 \
	libnvidia-extra-595 \
	nvidia-compute-utils-595 \
	libnvidia-decode-595 \
	libnvidia-encode-595 \
	nvidia-utils-595 \
	xserver-xorg-video-nvidia-595 \
	libnvidia-cfg1-595 \
	libnvidia-fbc1-595

for pkg in "linux-modules-nvidia-595-${TARGET_KREL}" nvidia-utils-595 \
	xserver-xorg-video-nvidia-595 nvidia-kernel-common-595; do
	apt-mark manual "$pkg" 2>/dev/null || true
done
apt-mark hold nvidia-dkms-595 nvidia-kernel-source-595 nvidia-driver-595 2>/dev/null || true

update-initramfs -u -k "${TARGET_KREL}" 2>/dev/null || true

echo
dpkg -l "linux-image-${TARGET_KREL}" "linux-modules-nvidia-595-${TARGET_KREL}" nvidia-utils-595 2>/dev/null \
	| awk '/^ii/ {print "  ok:", $2, $3}' || true
dpkg -l nvidia-dkms-595 nvidia-driver-595 2>/dev/null \
	| awk '/^ii/ {print "  WARN still installed:", $2, $3}' || true
echo
echo "If linux-image is still broken, re-run: sudo dpkg --configure -a"

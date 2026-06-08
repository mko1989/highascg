#!/usr/bin/env bash
# Recover from cuda-drivers install failing on nvidia-firmware file conflict:
#
#   trying to overwrite '/lib/firmware/nvidia/595.71.05/gsp_ga10x.bin',
#   which is also in package nvidia-firmware-595-595.71.05
#
# apt-get remove fails here because half-installed nvidia-dkms already Depends on
# NVIDIA-repo nvidia-firmware — use dpkg --force-depends to drop the Ubuntu package first.
#
# nvidia-persistenced postinst tries to START the service during dpkg — that hangs
# when the driver is not loaded yet. policy-rc.d blocks that.
#
#   sudo bash scripts/fix-nvidia-firmware-dpkg-conflict.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
# shellcheck source=../../lib/apt-block-service-starts.sh
source "${REPO_ROOT}/scripts/lib/apt-block-service-starts.sh"

log() { echo "==> $*"; }

cleanup() {
	highascg_apt_unblock_service_starts
}
trap cleanup EXIT

force_drop() {
	local pkg=$1
	if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install'; then
		log "Force-remove ${pkg} (bypass apt dep check)"
		dpkg --remove --force-depends "$pkg" 2>/dev/null || true
		dpkg --purge --force-depends "$pkg" 2>/dev/null || true
	fi
}

log "Drop Ubuntu packages that block NVIDIA-repo nvidia-firmware"
while IFS= read -r p; do
	force_drop "$p"
done < <(dpkg-query -W -f='${Package}\n' 2>/dev/null | grep -E \
	'^nvidia-firmware-595-|^linux-modules-nvidia-|^linux-objects-nvidia-|^linux-signatures-nvidia-' \
	|| true)

log "Install NVIDIA-repo nvidia-firmware (overwrite stale files if needed)"
FW_DEB=""
for candidate in \
	/var/cache/apt/archives/nvidia-firmware_*_amd64.deb \
	/tmp/apt-dpkg-install-*/09-nvidia-firmware_*_amd64.deb; do
	[[ -f $candidate ]] && FW_DEB=$candidate && break
done
if [[ -z "$FW_DEB" ]]; then
	apt-get download nvidia-firmware 2>/dev/null || true
	FW_DEB=$(ls -t nvidia-firmware_*_amd64.deb 2>/dev/null | head -1 || true)
fi
if [[ -n "$FW_DEB" && -f "$FW_DEB" ]]; then
	log "dpkg -i --force-overwrite ${FW_DEB}"
	dpkg -i --force-overwrite "$FW_DEB"
else
	log "WARN: nvidia-firmware .deb not in cache — apt will fetch it"
fi

log "Block service starts during dpkg (nvidia-persistenced hangs without driver)"
highascg_apt_block_service_starts

log "Finish interrupted dpkg transaction (DKMS build may take several minutes — not a hang)"
DEBIAN_FRONTEND=noninteractive dpkg --configure -a
DEBIAN_FRONTEND=noninteractive apt-get install -y -f

log "Complete cuda-drivers install"
DEBIAN_FRONTEND=noninteractive apt-get install -y cuda-drivers

echo
dpkg -l nvidia-firmware cuda-drivers nvidia-driver nvidia-dkms nvidia-persistenced 2>/dev/null \
	| awk '/^ii/ {print "  OK:", $2, $3}' || true
dpkg -l nvidia-firmware-595-595.71.05 2>/dev/null | awk '/^ii/ {print "  STILL PRESENT (bad):", $2}' || true
echo
echo "Reboot to load DKMS modules — do NOT start nvidia-persistenced before reboot:"
echo "  sudo reboot"
echo "After reboot: nvidia-smi && sudo systemctl start nvidia-persistenced"

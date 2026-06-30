#!/usr/bin/env bash
# Bake linux-headers + DKMS build tools into the eggs clone host (→ live ISO / Calamares target).
# DeckLink desktopvideo postinst runs DKMS; without headers you get:
#   "Your kernel headers for kernel … cannot be found"
#
#   sudo bash tools/eggs/live-usb/install-kernel-headers-for-dkms-iso.sh
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=eggs-kernel-lib.sh
source "${HERE}/eggs-kernel-lib.sh"
# shellcheck source=apt-with-stale-eggs-repo-fallback.sh
source "${HERE}/apt-with-stale-eggs-repo-fallback.sh"

highascg_apt_update

KVER="$(uname -r)"
if [[ -f /etc/highascg/pinned-kernel ]]; then
	KVER="$(tr -d '[:space:]' </etc/highascg/pinned-kernel)"
fi

HDR="linux-headers-${KVER}"
echo "==> DKMS build deps for ISO squashfs (kernel ${KVER})"
highascg_apt_install "${HDR}" build-essential dkms gcc make

if [[ ! -e "/lib/modules/${KVER}/build/Makefile" ]]; then
	echo "ERROR: ${HDR} missing build tree at /lib/modules/${KVER}/build" >&2
	exit 1
fi

# Keep headers on playout kernel when apt upgrades generic meta-packages.
apt-mark hold "${HDR}" 2>/dev/null || true
base_hdr="${HDR%-generic}"
if [[ "$base_hdr" != "$HDR" ]] && dpkg-query -W -f='${Status}' "$base_hdr" 2>/dev/null | grep -qE '(install|hold) ok'; then
	apt-mark hold "$base_hdr" 2>/dev/null || true
fi

echo "OK: ${HDR} + build-essential + dkms ready for eggs produce"

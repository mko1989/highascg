#!/usr/bin/env bash
# Bare eggs produce --clone only (no prepare, inject, flash, hostname/netplan changes).
#
#   cd ~/highascg
#   sudo bash work/run-eggs-produce-clone-only.sh
#
# Uses existing /etc/penguins-eggs.d/exclude.list and eggs.yaml kernel.
# After produce, optionally:
#   sudo bash tools/eggs/live-usb/inject-iso-boot-branding.sh
#   bash tools/eggs/live-usb/verify-iso-squashfs-excludes.sh
#   bash tools/eggs/live-usb/verify-iso-boot-branding.sh
#
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

REPO="/home/casparcg/highascg"
LIVE_USB="${REPO}/tools/eggs/live-usb"
# shellcheck source=../tools/eggs/live-usb/eggs-liveroot-safety.sh
source "${LIVE_USB}/eggs-liveroot-safety.sh"

LIVEROOT="$(eggs_liveroot_default)"
if eggs_liveroot_produce_in_progress; then
	echo "ERROR: eggs produce / mksquashfs still running — wait or reboot if you interrupted it." >&2
	exit 1
fi
if eggs_liveroot_has_host_bind_mounts "$LIVEROOT"; then
	echo "ERROR: ${LIVEROOT} has live bind mounts — reboot before produce." >&2
	echo "  rm -rf ${LIVEROOT} in this state erases /usr on the real host." >&2
	eggs_liveroot_print_host_bind_mounts "$LIVEROOT"
	exit 1
fi

BR="$(cat /etc/highascg/nvidia-iso-driver 2>/dev/null || echo 595)"
BASENAME="${BASENAME:-highascg-nvidia-${BR}}"
THEME_ABS="$(cd "${LIVE_USB}/highascg-eggs-theme" && pwd)"
LOG="${REPO}/work/eggs-produce-clone-$(date +%Y%m%d-%H%M%S).log"

echo "==> eggs produce --clone only"
echo "    basename: ${BASENAME}"
echo "    theme:    ${THEME_ABS}"
echo "    log:      ${LOG}"
echo "    kernel pin: $(cat /etc/highascg/pinned-kernel 2>/dev/null || echo none)"

bash "${LIVE_USB}/pre-produce-preflight.sh"

exec > >(tee -a "$LOG") 2>&1
eggs produce --nointeractive --clone --max --excludes static \
	--basename "${BASENAME}" --theme "${THEME_ABS}"

echo "==> Remount bridge/USB + config sync"
bash "${LIVE_USB}/unmask-exfat-systemd.sh"
bash "${REPO}/scripts/highascg-exfat-remount-sync.sh" casparcg 2>/dev/null || {
	echo "WARN: remount/sync skipped — run: sudo bash ${REPO}/scripts/highascg-exfat-remount-sync.sh" >&2
}

echo "==> done $(date -Is)"
echo "ISO under /home/eggs/ — name starts with ${BASENAME}_"

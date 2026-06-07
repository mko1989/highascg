#!/usr/bin/env bash
# Apply HighAsCG kernel cmdline from grub.main.cfg onto eggs-produced grub.cfg on the ISO tree.
#
# Usage: patch-iso-grub-kernel-cmdline.sh [iso-staging-dir]
set -euo pipefail

ISO_WORK="${1:-${EGGS_ISO_WORK:-/home/eggs/mnt/iso}}"

[[ -d "$ISO_WORK" ]] || {
	echo "Missing ISO staging: $ISO_WORK" >&2
	exit 1
}

# Default Live: full early kernel dmesg (nosplash). Optional Plymouth entry patched separately.
LIVE_EXTRA='console=tty0 fbcon=nodefer nosplash loglevel=7 ignore_loglevel systemd.show_status=true nvidia-drm.modeset=1 nvidia-drm.fbdev=1'
PLYMOUTH_EXTRA='splash systemd.show_status=true loglevel=4 nvidia-drm.modeset=1 nvidia-drm.fbdev=1'
VERBOSE_EXTRA='console=tty1 nosplash systemd.show_status=true loglevel=7 ignore_loglevel nvidia-drm.modeset=1 nvidia-drm.fbdev=1'
SAFE_EXTRA='nomodeset quiet splash'
TEXT_EXTRA='console=tty1 systemd.show_status=true systemd.unit=multi-user.target'

patch_one() {
	local f="$1"
	[[ -f "$f" ]] || return 0
	cp -a "$f" "${f}.bak.highascg"
	sed -i \
		-e 's/set gfxpayload=keep/set gfxpayload=auto/g' \
		-e "s| console=tty1 fbcon=nodefer splash loglevel=4 rd.udev.log_level=3 systemd.show_status=auto nvidia-drm.modeset=1 nvidia-drm.fbdev=1| ${LIVE_EXTRA}|g" \
		-e "s| console=tty1 splash loglevel=3 rd.udev.log_level=3 systemd.show_status=auto nvidia-drm.modeset=1 nvidia-drm.fbdev=1 vt.global_cursor_default=0| ${LIVE_EXTRA}|g" \
		-e "s| console=tty1 splash loglevel=3 nvidia-drm.modeset=1 nvidia-drm.fbdev=1 vt.global_cursor_default=0| ${LIVE_EXTRA}|g" \
		-e "s| quiet splash nvidia-drm.modeset=1 nvidia-drm.fbdev=1| ${LIVE_EXTRA}|g" \
		-e "s| quiet splash loglevel=3 rd.udev.log_level=3 systemd.show_status=auto nvidia-drm.modeset=1| ${LIVE_EXTRA}|g" \
		-e "s| quiet splash loglevel=2 nvidia-drm.modeset=1| ${LIVE_EXTRA}|g" \
		-e "s| nomodeset quiet splash loglevel=3 systemd.show_status=false| ${SAFE_EXTRA}|g" \
		-e "s| nomodeset quiet splash loglevel=2| ${SAFE_EXTRA}|g" \
		-e "s| quiet splash loglevel=3 systemd.show_status=false systemd.unit=multi-user.target| ${TEXT_EXTRA}|g" \
		-e "s| quiet splash loglevel=2 systemd.unit=multi-user.target| ${TEXT_EXTRA}|g" \
		"$f"
	echo "  patched $f"
}

for f in \
	"${ISO_WORK}/boot/grub/grub.cfg" \
	"${ISO_WORK}/EFI/ubuntu/grub.cfg" \
	"${ISO_WORK}/isolinux/isolinux.cfg" \
	"${ISO_WORK}/boot/isolinux/isolinux.cfg"; do
	patch_one "$f"
done

echo "OK: ISO kernel cmdline (default Live = full dmesg nosplash; Plymouth splash is alternate menuentry)"

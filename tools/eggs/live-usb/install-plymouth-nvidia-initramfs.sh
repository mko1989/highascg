#!/usr/bin/env bash
# Plymouth on NVIDIA live ISO needs proprietary modules in the initramfs *before*
# plymouthd runs, plus nvidia-drm.fbdev=1 on the kernel cmdline.
#
# Without this, the highascg script theme is in initrd but DRM open fails → black boot, no animation.
#
# Usage: sudo bash tools/eggs/live-usb/install-plymouth-nvidia-initramfs.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

MODULES_D=/etc/initramfs-tools/modules.d
MODPROBE_D=/etc/modprobe.d

mkdir -p "$MODULES_D" "$MODPROBE_D"

cat >"${MODULES_D}/highascg-nvidia-plymouth.conf" <<'EOF'
# Early load for Plymouth DRM/fbdev on HighAsCG NVIDIA live ISO (mkinitramfs includes these).
nvidia
nvidia_modeset
nvidia_uvm
nvidia_drm
EOF

cat >"${MODPROBE_D}/highascg-nvidia-plymouth.conf" <<'EOF'
# Plymouth needs a stable DRM fbdev on proprietary NVIDIA (driver 545+).
options nvidia_drm modeset=1
EOF

for m in nvidia nvidia_modeset nvidia_uvm nvidia_drm; do
	if ! modinfo "$m" &>/dev/null; then
		echo "ERROR: kernel module $m not found on this build host — install NVIDIA driver before eggs produce." >&2
		exit 1
	fi
done

# modules.d alone is not enough on Noble+ (DKMS ships nvidia-drm.ko.zst).
MODULES_FILE=/etc/initramfs-tools/modules
touch "$MODULES_FILE"
for m in nvidia nvidia_modeset nvidia_uvm nvidia_drm; do
	grep -qxF "$m" "$MODULES_FILE" 2>/dev/null || echo "$m" >>"$MODULES_FILE"
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SRC="${HERE}/etc-initramfs-tools-hooks-highascg-nvidia.sh"
HOOK_DEST=/etc/initramfs-tools/hooks/highascg-nvidia
install -m 0755 -o root -g root "$HOOK_SRC" "$HOOK_DEST"

echo "OK: initramfs will embed nvidia{,_modeset,_uvm,_drm} for Plymouth"
echo "     ${MODULES_D}/highascg-nvidia-plymouth.conf"
echo "     ${MODULES_FILE} (module names)"
echo "     ${HOOK_DEST} (copies .ko / .ko.zst from modinfo)"
echo "     ${MODPROBE_D}/highascg-nvidia-plymouth.conf"
echo "     GRUB/isolinux must include: nvidia-drm.modeset=1 nvidia-drm.fbdev=1"

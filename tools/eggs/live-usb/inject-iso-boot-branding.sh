#!/usr/bin/env bash
# Work around penguins-eggs makeEfi ordering: splash.png is copied after rsync to iso/
# so it never appears on the ISO. Also rebuild /live/initrd with highascg Plymouth.
#
# Run immediately after `eggs produce`, before verify-iso-boot-branding.sh.
# Re-runs eggs' xorriso mkisofs from /home/eggs/mnt/iso (same as /home/eggs/bin/mkisofs).
#
# Usage:
#   sudo bash tools/eggs/live-usb/inject-iso-boot-branding.sh [/path/to.iso]
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THEME_ROOT="${HERE}/highascg-eggs-theme"
EGGS_YAML="${EGGS_YAML:-/etc/penguins-eggs.d/eggs.yaml}"
ISO_WORK="${EGGS_ISO_WORK:-/home/eggs/mnt/iso}"
MKISOFS="${EGGS_MKISOFS:-/home/eggs/bin/mkisofs}"

BRANDING="${HERE}/branding"
THEME_ABS="$(cd "$THEME_ROOT" && pwd)"
LIVE="${THEME_ABS}/theme/livecd"

echo "==> Prepare boot-ready splash + Plymouth frames"
bash "${HERE}/prepare-branding-assets.sh"
if [[ -f "${BRANDING}/splash.boot.jpg" ]]; then
	install -m 0644 -o root -g root "${BRANDING}/splash.boot.jpg" "${LIVE}/splash.jpg"
	install -m 0644 -o root -g root "${BRANDING}/splash.boot.png" "${LIVE}/splash.png"
fi
SPLASH_JPG="${LIVE}/splash.jpg"
SPLASH_PNG="${LIVE}/splash.png"
if [[ ! -f "$SPLASH_JPG" && -f "${BRANDING}/splash.boot.jpg" ]]; then
	SPLASH_JPG="${BRANDING}/splash.boot.jpg"
fi
if [[ ! -f "$SPLASH_PNG" && -f "${BRANDING}/splash.boot.png" ]]; then
	SPLASH_PNG="${BRANDING}/splash.boot.png"
fi
[[ -f "$SPLASH_PNG" ]] || {
	echo "Missing splash.boot.png — run prepare-branding-assets.sh (needs branding/splash.png)" >&2
	exit 1
}
[[ -d "$ISO_WORK" ]] || {
	echo "ISO staging dir missing: $ISO_WORK (eggs produce not run?)" >&2
	exit 1
}
[[ -f "$MKISOFS" ]] || {
	echo "Missing $MKISOFS — eggs produce did not write mkisofs helper." >&2
	exit 1
}

VM="$(grep '^vmlinuz:' "$EGGS_YAML" | awk '{print $2}')"
[[ -n "$VM" && -f "$VM" ]] || {
	echo "vmlinuz from eggs.yaml not found: ${VM:-?}" >&2
	exit 1
}
KVER="${VM##*/vmlinuz-}"

INITRD_NAME="initrd.img-${KVER}"
INITRD_STAGING="${ISO_WORK}/live/${INITRD_NAME}"
[[ -f "${ISO_WORK}/live/vmlinuz-${KVER}" ]] || {
	echo "Missing ${ISO_WORK}/live/vmlinuz-${KVER}" >&2
	exit 1
}

echo "==> Refresh Plymouth theme files (skip host initramfs — rebuild ISO /live/initrd only)"
HIGHASCG_SKIP_HOST_INITRAMFS=1 bash "${HERE}/install-highascg-plymouth-theme.sh"

SQ_CHECK="${ISO_WORK}/live/filesystem.squashfs"
if [[ -f "$SQ_CHECK" ]]; then
	sq_mib="$(du -sm "$SQ_CHECK" | awk '{print $1}')"
	if [[ "$sq_mib" -lt 2000 ]]; then
		echo "ERROR: squashfs is only ${sq_mib} MiB — ISO is broken (need ~3000+ MiB)." >&2
		echo "       inject cannot fix a truncated live OS. Run full build:" >&2
		echo "       sudo HIGHASCG_NVIDIA_DRIVER=595 bash tools/eggs/live-usb/build-highascg-egg.sh" >&2
		exit 1
	fi
fi
# Default: skip squashfs rebuild (inject only patches GRUB + initrd). Full OS root comes from eggs produce.
if [[ "${HIGHASCG_FORCE_SQUASHFS_REFRESH:-0}" == "1" || "${HIGHASCG_SKIP_SQUASHFS_REFRESH:-1}" == "0" ]]; then
	echo "ERROR: squashfs refresh removed (was unsafe under /home/eggs/liveroot)." >&2
	echo "       Run full eggs produce instead: sudo bash work/run-eggs-produce-from-host.sh" >&2
	exit 1
else
	echo "==> Skip squashfs refresh (default — Plymouth in initrd; OS root unchanged)"
fi

THEME_ALT="$(update-alternatives --query default.plymouth 2>/dev/null | sed -n 's/^Value: //p' || true)"
[[ "$THEME_ALT" == *highascg* ]] || {
	echo "ERROR: default.plymouth is not highascg: ${THEME_ALT:-unset}" >&2
	exit 1
}

echo "==> GRUB/isolinux splash + theme.cfg → ISO tree"
install -m 0644 -o root -g root "${HERE}/highascg-eggs-theme/theme/livecd/grub.theme.cfg" \
	"${ISO_WORK}/boot/grub/theme.cfg"
if [[ -f "$SPLASH_JPG" ]]; then
	install -m 0644 -o root -g root "$SPLASH_JPG" "${ISO_WORK}/boot/grub/splash.jpg"
	install -m 0644 -o root -g root "$SPLASH_JPG" "${ISO_WORK}/isolinux/splash.jpg"
fi
if [[ -f "$SPLASH_PNG" ]]; then
	install -m 0644 -o root -g root "$SPLASH_PNG" "${ISO_WORK}/boot/grub/splash.png"
	install -m 0644 -o root -g root "$SPLASH_PNG" "${ISO_WORK}/isolinux/splash.png"
elif [[ -f "$SPLASH" ]]; then
	install -m 0644 -o root -g root "$SPLASH" "${ISO_WORK}/boot/grub/splash.png"
	install -m 0644 -o root -g root "$SPLASH" "${ISO_WORK}/isolinux/splash.png"
fi
install -m 0644 -o root -g root "${HERE}/isolinux.theme.cfg" "${ISO_WORK}/isolinux/isolinux.theme.cfg" 2>/dev/null || true

echo "==> GRUB font.pf2 (theme text invisible without matching Unifont on ISO)"
FONT_SRC="${HIGHASCG_GRUB_FONT:-/boot/grub/font.pf2}"
if [[ -f "$FONT_SRC" ]]; then
	install -m 0644 -o root -g root "$FONT_SRC" "${ISO_WORK}/boot/grub/font.pf2"
	echo "OK: copied ${FONT_SRC} → boot/grub/font.pf2"
else
	echo "WARN: missing ${FONT_SRC} — GRUB menu may show a blank black panel (install grub-common on build host)" >&2
fi

echo "==> GRUB gfx preamble + theme fonts (Unifont — avoids generic text menu)"
bash "${HERE}/ensure-iso-grub-gfx-theme.sh" "$ISO_WORK"

echo "==> GRUB menu timeout + gfx fallbacks on ISO grub.cfg"
for f in "${ISO_WORK}/boot/grub/grub.cfg" "${ISO_WORK}/EFI/ubuntu/grub.cfg"; do
	[[ -f "$f" ]] || continue
	sed -i \
		-e 's/^set timeout=3/set timeout=5/' \
		-e 's/^set timeout=10/set timeout=5/' \
		-e 's/set gfxmode=1920x1080$/set gfxmode=1920x1080,1680x1050,1600x900,1366x768,1280x1024,1024x768,800x600,auto/' \
		-e 's/set gfxmode=auto/set gfxmode=1920x1080,1680x1050,1600x900,1366x768,1280x1024,1024x768,800x600,auto/' \
		"$f"
done

echo "==> GRUB kernel cmdline (console + splash + nvidia-drm.fbdev=1)"
bash "${HERE}/patch-iso-grub-kernel-cmdline.sh" "$ISO_WORK"

bash "${HERE}/install-initramfs-eggs-build-conf.sh"

if modinfo nvidia_drm &>/dev/null; then
	bash "${HERE}/install-plymouth-nvidia-initramfs.sh"
else
	echo "WARN: nvidia_drm not on build host — live Plymouth may be black on NVIDIA GPUs" >&2
fi

echo "==> Rebuild live initrd (${KVER}) → ${INITRD_STAGING} (2–8 min — ISO only, not a loop)"
TMP_INITRD="$(mktemp)"
trap 'rm -f "$TMP_INITRD"' EXIT
mkinitramfs -o "$TMP_INITRD" "$KVER"
install -m 0644 -o root -g root "$TMP_INITRD" "$INITRD_STAGING"

echo "==> Re-pack ISO (xorriso, ISO 9660 volume id HIGHASCG)"
# eggs writes -V highascg (lowercase) → xorriso warns; patch before pack.
if grep -q -- '-V highascg ' "$MKISOFS" 2>/dev/null; then
	cp -a "$MKISOFS" "${MKISOFS}.bak.highascg"
	sed -i 's/-V highascg /-V HIGHASCG /g' "$MKISOFS"
fi
# shellcheck disable=SC1090
bash "$MKISOFS" 2> >(grep -vE 'xorriso : WARNING|libisofs: WARNING' >&2 || true)

ISO_OUT="${1:-}"
if [[ -z "$ISO_OUT" ]]; then
	ISO_OUT="$(grep -oE '/home/eggs[^ ]+\.iso' "$MKISOFS" | tail -1 || true)"
fi
if [[ -n "$ISO_OUT" && -f "$ISO_OUT" ]]; then
	echo "OK: ${ISO_OUT}"
else
	echo "OK: ISO re-packed (see ${MKISOFS} for output path)"
fi

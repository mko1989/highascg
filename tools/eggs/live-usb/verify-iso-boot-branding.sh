#!/usr/bin/env bash
# Post-build checks: ISO GRUB splash + persistence + Plymouth theme inside live initrd.
#
# Usage:
#   sudo bash tools/eggs/live-usb/verify-iso-boot-branding.sh [/path/to/highascg*.iso]
#
# Env:
#   HIGHASCG_ISO_BOOT_BRANDING_VERIFY_FAST=1  — grub.cfg + splash only (skip slow initrd lsinitramfs)
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=flash-stick-common.sh
source "${HERE}/flash-stick-common.sh"

# lsinitramfs | grep -q triggers SIGPIPE (141); with pipefail that looks like failure.
initrd_contains() {
	local img="$1" needle="$2"
	local list
	list="$(mktemp)"
	lsinitramfs "$img" 2>/dev/null >"$list" || {
		rm -f "$list"
		return 1
	}
	grep -qF "$needle" "$list"
	local rc=$?
	rm -f "$list"
	return "$rc"
}

# DKMS uses nvidia-drm.ko.zst; modinfo name is nvidia_drm.
initrd_has_nvidia_drm_module() {
	local img="$1"
	local list
	list="$(mktemp)"
	lsinitramfs "$img" 2>/dev/null >"$list" || {
		rm -f "$list"
		return 1
	}
	grep -qE 'nvidia[_-]drm\.ko(\.zst)?$' "$list"
	local rc=$?
	rm -f "$list"
	return "$rc"
}

BRANDING="${HERE}/branding"
EGGS_PENGUINS="/usr/lib/penguins-eggs/addons/eggs/theme/livecd/splash.png"
ISO="${1:-}"

if [[ -z "$ISO" ]]; then
	ISO="$(find_latest_iso 2>/dev/null || true)"
fi
[[ -f "$ISO" ]] || {
	echo "No ISO found. Pass path or build under /home/eggs/ first." >&2
	exit 1
}

MNT="$(mktemp -d)"
INITRD_LOCAL=""
INITRD_TMPDIR=""
cleanup() {
	umount "$MNT" 2>/dev/null || true
	rmdir "$MNT" 2>/dev/null || true
	rm -rf "$INITRD_TMPDIR"
}
trap cleanup EXIT

mount -o loop,ro "$ISO" "$MNT"

fail=0
warn() {
	echo "WARN: $*" >&2
}
bad() {
	echo "FAIL: $*" >&2
	fail=1
}
ok() {
	echo "OK: $*"
}

echo "==> ISO: $ISO"

GRUB_CFG=""
for c in "$MNT/boot/grub/grub.cfg" "$MNT/EFI/ubuntu/grub.cfg"; do
	[[ -f "$c" ]] && GRUB_CFG="$c" && break
done
[[ -n "$GRUB_CFG" ]] || bad "grub.cfg not found on ISO"
if [[ -n "$GRUB_CFG" ]]; then
	first_linux="$(grep -m1 '^[[:space:]]*linux ' "$GRUB_CFG" || true)"
	if [[ -z "$first_linux" ]]; then
		bad "grub.cfg has no linux line ($(basename "$GRUB_CFG"))"
	elif grep -qE '(^|[[:space:]])persistence([[:space:]]|$)' <<<"$first_linux"; then
		warn "default grub line still has persistence (exFAT-only sticks — rebuild ISO after grub.main.cfg update)"
	else
		ok "default grub linux line is plain Live (no union persistence) ($(basename "$GRUB_CFG"))"
	fi
	if grep -q 'Live/Installation' "$GRUB_CFG"; then
		bad "grub.cfg is stock eggs Live/Installation (rebuild with --theme highascg-eggs-theme)"
	fi
	if grep -qE '(^|[[:space:]])nosplash([[:space:]]|$)' <<<"$first_linux"; then
		ok "grub.cfg default linux line has nosplash (full early dmesg)"
	elif grep -qE '(^|[[:space:]])splash([[:space:]]|$)' <<<"$first_linux"; then
		warn "default grub line uses splash (Plymouth) — expected nosplash for default Live"
	else
		bad "grub.cfg default linux line missing nosplash (or splash alternate)"
	fi
	if grep -qE '(^|[[:space:]])systemd\.show_status=true([[:space:]]|$)' <<<"$first_linux"; then
		ok "grub.cfg default linux line has systemd.show_status=true (RPi-style status log)"
	else
		bad "grub.cfg default linux line missing systemd.show_status=true"
	fi
	if grep -qE '(^|[[:space:]])nvidia-drm\.fbdev=1([[:space:]]|$)' <<<"$first_linux"; then
		ok "grub.cfg has nvidia-drm.fbdev=1 (Plymouth framebuffer on NVIDIA)"
	else
		bad "grub.cfg missing nvidia-drm.fbdev=1 — Plymouth animation will not show on NVIDIA GPU"
	fi
	if grep -q 'Live (Plymouth splash)' "$GRUB_CFG" && \
		grep -qE '(^|[[:space:]])splash([[:space:]]|$)' "$GRUB_CFG"; then
		ok "grub.cfg has alternate Live (Plymouth splash) menuentry"
	else
		warn "grub.cfg missing alternate Plymouth splash menuentry"
	fi
	if grep -qE 'menuentry "[^"]+ Live"' "$GRUB_CFG"; then
		ok "grub.cfg has custom Live menuentry (highascg-eggs-theme)"
	else
		bad "grub.cfg missing custom Live menuentry — stock eggs menu or wrong theme"
	fi
	GRUB_MAIN="$MNT/boot/grub/grub.cfg"
	if grep -q 'insmod gfxterm' "$GRUB_MAIN" 2>/dev/null; then
		ok "grub.cfg loads gfxterm (themed menu + splash.png)"
	else
		bad "grub.cfg missing gfxterm — GRUB falls back to generic text menu"
	fi
	if grep -q 'gfxmode=1920x1080' "$GRUB_MAIN" 2>/dev/null; then
		ok "grub.cfg sets gfxmode=1920x1080 (matches splash.boot.png)"
	elif grep -q 'gfxmode=auto' "$GRUB_MAIN" 2>/dev/null; then
		warn "grub.cfg uses gfxmode=auto — may show centred black letterbox after menu select"
	else
		warn "grub.cfg missing gfxmode=1920x1080"
	fi
	_live_gfx="$(awk '/menuentry ".* Live"/ && !/Plymouth/ {p=1} p{print} p && /^}/ {exit}' "$GRUB_MAIN" 2>/dev/null || true)"
	if grep -q 'gfxpayload=text' <<<"$_live_gfx"; then
		ok "default Live menuentry uses gfxpayload=text (clean kernel handoff)"
	elif grep -q 'gfxpayload=auto' <<<"$_live_gfx"; then
		warn "default Live uses gfxpayload=auto — expect ~2s frozen splash before dmesg"
	fi
	THEME_CFG="$MNT/boot/grub/theme.cfg"
	if [[ -f "$THEME_CFG" ]]; then
		if grep -q 'Sans Regular' "$THEME_CFG"; then
			bad "theme.cfg uses Sans fonts but ISO font.pf2 is GNU Unifont — GRUB theme will not render"
		elif grep -q 'GNU Unifont' "$THEME_CFG"; then
			ok "theme.cfg fonts match GNU Unifont (font.pf2)"
		fi
		if grep -q 'menu_bg_color' "$THEME_CFG"; then
			ok "theme.cfg sets boot_menu menu_bg_color (visible labels on dark splash)"
		fi
	fi
	if [[ -f "${MNT}/boot/grub/font.pf2" ]]; then
		ok "boot/grub/font.pf2 present on ISO"
	else
		bad "missing boot/grub/font.pf2 — GRUB gfx menu labels will not render"
	fi
	if grep -qE '^set timeout=5' "$GRUB_MAIN" 2>/dev/null; then
		ok "grub.cfg timeout=5"
	elif grep -qE '^set timeout=' "$GRUB_MAIN" 2>/dev/null; then
		warn "grub.cfg timeout is not 5 — rebuild with updated grub.main.cfg / inject"
	fi
fi

THEME_CFG="$MNT/boot/grub/theme.cfg"
if [[ -f "$THEME_CFG" ]] && grep -q 'desktop-image: "splash.jpg"' "$THEME_CFG"; then
	bad "theme.cfg uses splash.jpg — GRUB rejects subsampled JPEG; use splash.png"
fi
SPLASH_JPG="$MNT/boot/grub/splash.jpg"
SPLASH_PNG="$MNT/boot/grub/splash.png"
if [[ -f "$SPLASH_PNG" ]]; then
	if [[ -f "$EGGS_PENGUINS" ]] && cmp -s "$SPLASH_PNG" "$EGGS_PENGUINS"; then
		bad "ISO GRUB splash is still stock eggs penguins"
	elif [[ -f "${BRANDING}/splash.boot.png" ]] && cmp -s "$SPLASH_PNG" "${BRANDING}/splash.boot.png"; then
		ok "GRUB splash matches branding/splash.boot.png"
	elif [[ -f "${BRANDING}/splash.png" ]] && cmp -s "$SPLASH_PNG" "${BRANDING}/splash.png"; then
		ok "GRUB splash matches branding/splash.png"
	else
		ok "GRUB splash.png present ($(stat -c '%s bytes' "$SPLASH_PNG"))"
	fi
	if file -b "$SPLASH_PNG" | grep -q RGBA; then
		bad "GRUB splash.png has alpha — re-run prepare-branding-assets.sh (RGB only)"
	fi
elif [[ -f "$SPLASH_JPG" ]]; then
	bad "ISO has splash.jpg but GRUB theme must use splash.png (JPEG subsampling breaks GRUB gfx)"
else
	bad "missing boot/grub/splash.png on ISO"
fi
if [[ -f "$MNT/isolinux/splash.jpg" || -f "$MNT/isolinux/splash.png" ]]; then
	ok "isolinux splash present"
else
	warn "isolinux splash missing (BIOS boot menu may have no wallpaper)"
fi

# Prefer versioned initrd (initrd.img-6.8.0-…). Do not use initrd*.img glob: initrd.img sorts
# before initrd.img-* and is usually missing on the mounted ISO.
INITRD=""
shopt -s nullglob
for f in "$MNT"/live/initrd.img-*; do
	INITRD="$f"
done
[[ -z "$INITRD" && -f "$MNT/live/initrd.img" ]] && INITRD="$MNT/live/initrd.img"
shopt -u nullglob
[[ -n "$INITRD" && -f "$INITRD" ]] || bad "no live/initrd*.img on ISO"
if [[ "${HIGHASCG_ISO_BOOT_BRANDING_VERIFY_FAST:-0}" == "1" ]]; then
	ok "fast verify — skipped initrd lsinitramfs (Plymouth/NVIDIA initrd checks)"
elif [[ -n "$INITRD" ]]; then
	# ISO9660 loop mounts often break lsinitramfs on large initrds; use a normal file path.
	INITRD_BASENAME="$(basename "$INITRD")"
	EGGS_STAGING="${EGGS_ISO_WORK:-/home/eggs/mnt/iso}/live/${INITRD_BASENAME}"
	if [[ -f "$EGGS_STAGING" ]]; then
		INITRD_LOCAL="$EGGS_STAGING"
	elif command -v xorriso >/dev/null 2>&1; then
		INITRD_TMPDIR="$(mktemp -d)"
		INITRD_LOCAL="${INITRD_TMPDIR}/${INITRD_BASENAME}"
		xorriso -osirrox on -indev "$ISO" \
			-extract "/live/${INITRD_BASENAME}" "$INITRD_LOCAL" 2>/dev/null || true
		if [[ ! -s "$INITRD_LOCAL" ]]; then
			cp -f "$INITRD" "$INITRD_LOCAL"
		fi
	else
		INITRD_TMPDIR="$(mktemp -d)"
		INITRD_LOCAL="${INITRD_TMPDIR}/${INITRD_BASENAME}"
		cp -f "$INITRD" "$INITRD_LOCAL"
	fi
	[[ -s "$INITRD_LOCAL" ]] || bad "could not read live initrd (${INITRD_BASENAME})"

	if initrd_contains "$INITRD_LOCAL" 'usr/share/plymouth/themes/highascg'; then
		ok "live initrd contains plymouth theme highascg"
	else
		bad "live initrd missing usr/share/plymouth/themes/highascg (text boot likely)"
	fi
	if initrd_contains "$INITRD_LOCAL" 'usr/bin/plymouth'; then
		ok "live initrd contains plymouth binary"
	else
		bad "live initrd missing plymouth — kernel will show console text"
	fi
	if initrd_contains "$INITRD_LOCAL" 'usr/share/plymouth/themes/highascg/highascg.script'; then
		ok "live initrd contains highascg.script (status log + corner throbber)"
	elif initrd_contains "$INITRD_LOCAL" 'usr/share/plymouth/themes/highascg/throbber-0001.png'; then
		ok "live initrd contains throbber-0001.png (small spinner)"
	else
		bad "live initrd missing throbber-0001.png — run install-highascg-plymouth-theme.sh + inject"
	fi
	if initrd_contains "$INITRD_LOCAL" 'usr/share/plymouth/themes/highascg/throbber-0004.png'; then
		ok "live initrd has 4 throbber frames (animation 1,2,29,30)"
	else
		warn "live initrd missing throbber-0004.png (expected 4 frames from 1 2 29 30)"
	fi
	if modinfo nvidia_drm &>/dev/null; then
		if initrd_has_nvidia_drm_module "$INITRD_LOCAL"; then
			ok "live initrd contains nvidia_drm module (Plymouth can use GPU fbdev)"
		else
			bad "live initrd missing nvidia_drm — run install-plymouth-nvidia-initramfs.sh then inject"
		fi
	fi
fi

if ((fail)); then
	echo >&2
	echo "Rebuild after fixing the build host:" >&2
	echo "  sudo bash ${HERE}/finalize-boot-branding-for-eggs-produce.sh" >&2
	echo "  sudo bash ${HERE}/build-highascg-egg.sh" >&2
	echo "  (or only re-pack: sudo bash ${HERE}/inject-iso-boot-branding.sh)" >&2
	exit 1
fi

echo "All boot branding checks passed."

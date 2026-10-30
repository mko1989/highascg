#!/usr/bin/env bash
# Post-build checks on the ISO itself: GRUB/isolinux menus + splash, UEFI boot path, live kernel/initrd,
# Plymouth theme inside the live initrd, Calamares slideshow inside the squashfs.
#
# Usage:
#   bash tools/eggs/live-usb/verify-iso-boot-branding.sh [/path/to/highascg*.iso]   (default: newest ISO in the nest)
#
# WO-870 Phase 5: reads ONLY the built ISO (iso-read-lib.sh: xorriso or bsdtar, squashfs via unsquashfs -o) — no
# loop mount, no root, never the /home/eggs/isodir or mnt/iso staging tree. The layout comes from the image:
#   new     eggs 26.10 `remaster`: volume id OA_LIVE + EFI/BOOT/{BOOTX64.EFI,efi.img,grub.cfg} label trampoline,
#           unversioned live/{vmlinuz,initrd.img}, Calamares overlay at etc/penguins-eggs.d/branding/calamares/
#   legacy  eggs `produce`: live/{vmlinuz,initrd.img}-<kver>, EFI/ubuntu/grub.cfg, etc/calamares/branding/…
# HIGHASCG_ISO_LAYOUT=new|legacy overrides the detection.
#
# Env:
#   HIGHASCG_ISO_BOOT_BRANDING_VERIFY_FAST=1  — menus, splash and layout only (skip initrd lsinitramfs + squashfs)
#   HIGHASCG_PINNED_KERNEL (else /etc/highascg/pinned-kernel)  — kernel release the ISO must carry
#   HIGHASCG_NVIDIA_DRIVER (else the ISO name, else /etc/highascg/nvidia-iso-driver) — branch in the menu titles
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=flash-stick-common.sh
source "${HERE}/flash-stick-common.sh"
# shellcheck source=iso-read-lib.sh
source "${HERE}/iso-read-lib.sh"

# One lsinitramfs per run (a 200 MB initrd takes seconds); grep the cached list. lsinitramfs | grep -q would
# SIGPIPE (141), which pipefail reports as failure.
INITRD_LIST=""
initrd_contains() {
	local img="$1" needle="$2"
	initrd_list_once "$img" || return 1
	grep -qF "$needle" "$INITRD_LIST"
}

# DKMS uses nvidia-drm.ko.zst; modinfo name is nvidia_drm.
initrd_has_nvidia_drm_module() {
	local img="$1"
	initrd_list_once "$img" || return 1
	grep -qE 'nvidia[_-]drm\.ko(\.zst)?$' "$INITRD_LIST"
}

initrd_list_once() {
	[[ -n "$INITRD_LIST" ]] && return 0
	INITRD_LIST="${WORK}/initrd.list"
	lsinitramfs "$1" 2>/dev/null >"$INITRD_LIST" || {
		rm -f "$INITRD_LIST"
		INITRD_LIST=""
		return 1
	}
}

BRANDING="${HERE}/branding"
# WO-832: stock eggs penguin splash lives in /etc/penguins-eggs.d/branding.default on eggs >= 26.10.
# shellcheck source=eggs-theme-lib.sh
source "${HERE}/eggs-theme-lib.sh"
EGGS_PENGUINS="$(highascg_eggs_theme_dir 2>/dev/null || echo /etc/penguins-eggs.d/branding.default)/livecd/splash.png"
ISO="${1:-}"

if [[ -z "$ISO" ]]; then
	ISO="$(find_latest_iso 2>/dev/null || true)"
fi
[[ -f "$ISO" ]] || {
	echo "No ISO found. Pass path or build under /home/eggs/ first." >&2
	exit 1
}
[[ -r "$ISO" ]] || {
	echo "Cannot read ${ISO} — run with sudo, or copy it somewhere readable." >&2
	exit 1
}

# MNT keeps its old name: it is the extracted copy of the ISO's small boot files, same relative paths.
WORK="$(mktemp -d)"
MNT="${WORK}/iso"
cleanup() {
	iso_read_close
	rm -rf "$WORK"
}
trap cleanup EXIT

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

iso_read_open "$ISO" || exit 1
fetch() {
	local p="${1:-}"
	[[ -n "$p" ]] && iso_has "$p" || return 1
	mkdir -p "$(dirname "${MNT}/${p}")"
	iso_extract "$ISO" "$p" "${MNT}/${p}"
}
for p in boot/grub/grub.cfg boot/grub/theme.cfg boot/grub/splash.png boot/grub/splash.jpg boot/grub/font.pf2 \
	EFI/ubuntu/grub.cfg isolinux/isolinux.cfg isolinux/isolinux.theme.cfg isolinux/splash.png isolinux/splash.jpg; do
	fetch "$p" || true
done
EFI_CFG_MEMBER="$(iso_find_ci EFI/BOOT/grub.cfg || true)"
fetch "$EFI_CFG_MEMBER" || true

LAYOUT="${HIGHASCG_ISO_LAYOUT:-}"
if [[ -z "$LAYOUT" ]]; then
	if iso_grep '^live/initrd\.img-' >/dev/null; then LAYOUT=legacy; else LAYOUT=new; fi
fi

echo "==> ISO: $ISO (layout ${LAYOUT}, read with ${ISO_READ_TOOL})"

# --- WO-870 Phase 5: volume id + UEFI trampoline, file set, unrendered placeholders, menu titles ---
VOLID="$(iso_volume_id "$ISO")"
EFI_LABEL=""
if [[ -n "$EFI_CFG_MEMBER" && -f "${MNT}/${EFI_CFG_MEMBER}" ]]; then
	EFI_LABEL="$(sed -n 's/.*search .*--label[[:space:]]\{1,\}\([^[:space:]]\{1,\}\).*/\1/p' "${MNT}/${EFI_CFG_MEMBER}" | head -1)"
fi
if [[ "$LAYOUT" == "new" ]]; then
	case "${VOLID^^}" in
	OA_LIVE | HIGHASCG*) ok "volume id ${VOLID}" ;;
	*) bad "volume id '${VOLID}' — expected OA_LIVE (eggs 26.10) or HIGHASCG*" ;;
	esac
	if [[ -z "$EFI_LABEL" ]]; then
		bad "${EFI_CFG_MEMBER:-EFI/BOOT/grub.cfg} has no 'search --label' trampoline — UEFI boot cannot find the ISO"
	elif [[ "$EFI_LABEL" != "$VOLID" ]]; then
		bad "EFI trampoline searches --label ${EFI_LABEL} but the volume id is '${VOLID}' — UEFI stops at grub>"
	else
		ok "EFI trampoline --label ${EFI_LABEL} = volume id"
	fi
	for p in EFI/BOOT/BOOTX64.EFI EFI/BOOT/efi.img; do
		m="$(iso_find_ci "$p" || true)"
		if [[ -n "$m" ]]; then ok "${m} present"; else bad "missing ${p} — no UEFI boot"; fi
	done
	for p in boot/grub/theme.cfg isolinux/isolinux.cfg isolinux/isolinux.theme.cfg isolinux/vesamenu.c32 \
		live/vmlinuz live/initrd.img live/filesystem.squashfs; do
		if iso_has "$p"; then ok "${p} present"; else bad "missing ${p}"; fi
	done
else
	ok "legacy layout — volume id '${VOLID}'"
	m="$(iso_find_ci EFI/BOOT/BOOTX64.EFI || true)"
	if [[ -n "$m" ]]; then ok "${m} present"; else bad "missing EFI/BOOT/BOOTX64.EFI — no UEFI boot"; fi
fi

BRANCH="${HIGHASCG_NVIDIA_DRIVER:-}"
[[ -z "$BRANCH" && "$(basename "$ISO")" =~ highascg-nvidia-([0-9]{3}) ]] && BRANCH="${BASH_REMATCH[1]}"
[[ -n "$BRANCH" ]] || BRANCH="$(tr -d '[:space:]' </etc/highascg/nvidia-iso-driver 2>/dev/null || true)"
TITLE="HIGHASCG NVIDIA ${BRANCH:-<branch>} Live"
for p in boot/grub/grub.cfg isolinux/isolinux.cfg; do
	if [[ ! -f "${MNT}/${p}" ]]; then
		bad "missing ${p} on ISO"
		continue
	fi
	if grep -q '{{{' "${MNT}/${p}"; then
		bad "${p} has unrendered placeholders: $(grep -o '{{{[^}]*}}}' "${MNT}/${p}" | sort -u | tr '\n' ' ')"
	else
		ok "${p}: no {{{ placeholders"
	fi
	if grep -qE "HIGHASCG NVIDIA ${BRANCH:-[0-9]+} Live" "${MNT}/${p}"; then
		ok "${p} has a '${TITLE}' entry"
	else
		bad "${p} has no '${TITLE}' entry (stock eggs menu, or built for another branch)"
	fi
	# Every kernel/initrd a menu names must be on the image (eggs 26.10 dropped the -<kver> suffix).
	for f in $(sed -nE 's/^[[:space:]]*(linux|initrd)[[:space:]]+(\/live\/[^[:space:]]+).*/\2/p; s/.*initrd=(\/live\/[^[:space:]]+).*/\1/p' "${MNT}/${p}" | sort -u); do
		iso_has "$f" || bad "${p} boots ${f}, which is not on the ISO"
	done
done

GRUB_CFG=""
for c in "$MNT/boot/grub/grub.cfg" "$MNT/EFI/ubuntu/grub.cfg"; do
	[[ -f "$c" ]] && GRUB_CFG="$c" && break
done
[[ -n "$GRUB_CFG" ]] || bad "grub.cfg not found on ISO"
if [[ -n "$GRUB_CFG" ]]; then
	first_linux="$(grep -m1 '^[[:space:]]*linux ' "$GRUB_CFG" || true)"
	# plymouth's initramfs script honours the LAST splash/nosplash token (eggs 26.10 prepends "splash").
	last_splash="$(grep -oE '(^|[[:space:]])(no)?splash([[:space:]]|$)' <<<"$first_linux" | tr -d ' \t' | tail -1)"
	if [[ -z "$first_linux" ]]; then
		bad "grub.cfg has no linux line ($(basename "$GRUB_CFG"))"
	elif grep -qE '(^|[[:space:]])persistence([[:space:]]|$)' <<<"$first_linux"; then
		warn "default grub line still has persistence (exFAT-only sticks — rebuild ISO after grub.main.cfg update)"
	else
		ok "default grub linux line is plain Live (no union persistence) ($(basename "$GRUB_CFG"))"
	fi
	if grep -q 'Live/Installation' "$GRUB_CFG"; then
		bad "grub.cfg is stock eggs Live/Installation (branding not applied — install-eggs-config.sh / --theme)"
	fi
	if [[ "$last_splash" == "nosplash" ]]; then
		ok "grub.cfg default linux line ends in nosplash (full early dmesg)"
	elif [[ "$last_splash" == "splash" ]]; then
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
		# WO-461: GRUB's boot_menu has no background COLOUR properties — menu_bg_color and
		# selected_item_bg_color are silently ignored (only *_pixmap_style paints a background).
		# The old check rewarded menu_bg_color and so passed an ISO whose selected entry was
		# drawn in desktop-color, i.e. invisible. Selection is text colour only — assert contrast.
		_desk="$(sed -n 's/^desktop-color:[[:space:]]*"\([^"]*\)".*/\1/p' "$THEME_CFG" | head -1)"
		_sel="$(sed -n 's/^[[:space:]]*selected_item_color[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$THEME_CFG" | head -1)"
		_item="$(sed -n 's/^[[:space:]]*item_color[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$THEME_CFG" | head -1)"
		if [[ -z "$_sel" ]]; then
			bad "theme.cfg has no selected_item_color — the highlighted menu entry has no colour of its own"
		elif [[ "${_sel,,}" == "${_desk,,}" ]]; then
			bad "theme.cfg selected_item_color (${_sel}) equals desktop-color — highlighted entry is INVISIBLE"
		elif [[ "${_sel,,}" == "${_item,,}" ]]; then
			bad "theme.cfg selected_item_color equals item_color (${_sel}) — selection is indistinguishable"
		else
			ok "theme.cfg selected_item_color ${_sel} contrasts desktop ${_desk} and items ${_item}"
		fi
		# Assignments only — the theme carries a comment naming these properties to warn people off.
		if grep -qE '^[[:space:]]*(menu_bg_color|selected_item_bg_color)[[:space:]]*=' "$THEME_CFG"; then
			bad "theme.cfg sets menu_bg_color/selected_item_bg_color — GRUB ignores both; they hide missing contrast"
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

# Live kernel + initrd: new = unversioned live/{vmlinuz,initrd.img}; legacy = the last live/*-<kver>.
if [[ "$LAYOUT" == "new" ]]; then
	KERNEL_M=live/vmlinuz
	INITRD_M=live/initrd.img
else
	KERNEL_M="$(iso_grep '^live/vmlinuz-' | sort | tail -1 || true)"
	INITRD_M="$(iso_grep '^live/initrd\.img-' | sort | tail -1 || true)"
	[[ -z "$INITRD_M" ]] && iso_has live/initrd.img && INITRD_M=live/initrd.img
fi
PIN="${HIGHASCG_PINNED_KERNEL:-$(tr -d '[:space:]' </etc/highascg/pinned-kernel 2>/dev/null || true)}"
KREL=""
if [[ -n "$KERNEL_M" ]] && iso_has "$KERNEL_M" && iso_extract "$ISO" "$KERNEL_M" "${WORK}/vmlinuz"; then
	KREL="$(bzimage_release "${WORK}/vmlinuz" || true)"
	if [[ -z "$KREL" ]]; then
		warn "cannot read the kernel release from ${KERNEL_M}"
	elif [[ -z "$PIN" ]]; then
		ok "${KERNEL_M} is ${KREL} (no /etc/highascg/pinned-kernel to compare)"
	elif [[ "$KREL" == "$PIN" ]]; then
		ok "${KERNEL_M} is ${KREL} = pinned kernel"
	elif [[ "$LAYOUT" == "new" ]]; then
		bad "${KERNEL_M} is ${KREL} but the pin is ${PIN} — eggs 26.10 clones the RUNNING kernel; reboot into the pin"
	else
		warn "${KERNEL_M} is ${KREL}, pin is ${PIN} (legacy ISO — built before the current pin?)"
	fi
else
	bad "no live kernel on ISO (${KERNEL_M:-live/vmlinuz*})"
fi

[[ -n "$INITRD_M" ]] && iso_has "$INITRD_M" || bad "no live/initrd*.img on ISO"
if [[ "${HIGHASCG_ISO_BOOT_BRANDING_VERIFY_FAST:-0}" == "1" ]]; then
	ok "fast verify — skipped initrd lsinitramfs (Plymouth/NVIDIA initrd checks)"
elif [[ -n "$INITRD_M" ]] && iso_has "$INITRD_M"; then
	# lsinitramfs wants a normal file: copy the member out of the image (never the staging tree).
	INITRD_LOCAL="${WORK}/$(basename "$INITRD_M")"
	iso_extract "$ISO" "$INITRD_M" "$INITRD_LOCAL" || bad "could not read live initrd (${INITRD_M})"

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
	# The initrd's modules must belong to the kernel next to it (WO-870: built in the liveroot chroot).
	if [[ -n "$KREL" && -n "$INITRD_LIST" ]]; then
		irels="$(sed -nE 's#^(usr/)?lib/modules/([^/]+)/.*#\2#p' "$INITRD_LIST" | sort -u | tr '\n' ' ')"
		if [[ " ${irels}" == *" ${KREL} "* ]]; then
			ok "live initrd modules are for ${KREL}"
		else
			bad "live initrd has modules for '${irels% }', kernel is ${KREL}"
		fi
	fi
fi

# WO-148: Calamares installer slideshow inside the squashfs must be HighAsCG, not penguins.
SQUASHFS_M=live/filesystem.squashfs
if [[ "$LAYOUT" == "new" ]]; then
	SHOW_QML_PATH="etc/penguins-eggs.d/branding/calamares/branding/show.qml"
else
	SHOW_QML_PATH="etc/calamares/branding/highascg-eggs-theme/show.qml"
fi
if [[ "${HIGHASCG_ISO_BOOT_BRANDING_VERIFY_FAST:-0}" == "1" ]]; then
	ok "fast verify — skipped Calamares slideshow check (squashfs)"
elif [[ "${HIGHASCG_ISO_EMBED_CALAMARES:-1}" != "1" ]]; then
	ok "HIGHASCG_ISO_EMBED_CALAMARES=0 — skipped Calamares slideshow check"
elif ! iso_has "$SQUASHFS_M"; then
	bad "missing live/filesystem.squashfs on ISO"
elif ! command -v unsquashfs >/dev/null 2>&1; then
	warn "unsquashfs not available — cannot check Calamares slideshow (apt install squashfs-tools)"
elif ! iso_file_offset "$ISO" "$SQUASHFS_M" >/dev/null; then
	warn "cannot locate the squashfs inside the ISO (needs xorriso) — Calamares slideshow not checked"
else
	show_qml="$(iso_squashfs_cat "$ISO" "$SQUASHFS_M" "$SHOW_QML_PATH" || true)"
	if [[ -z "$show_qml" ]]; then
		bad "squashfs missing ${SHOW_QML_PATH} (Calamares slideshow) — apply the branding overlay on the host, then rebuild"
	elif grep -q 'penguins-eggs' <<<"$show_qml"; then
		bad "Calamares slideshow in squashfs is stock penguins-eggs (show.qml) — apply the HighAsCG overlay, then rebuild"
	elif grep -qiE 'broadcast|playout' <<<"$show_qml"; then
		# Owner (todos03.08 §30, todos10.08 §1): the product is a MEDIA SERVER. No "broadcast"
		# or "playout" wording anywhere operator-facing, and this slideshow is the one surface
		# that only shows up mid-install, so nobody catches it by looking at the running box.
		bad "Calamares slideshow says 'broadcast'/'playout' — must read 'media server' ($(grep -inE 'broadcast|playout' <<<"$show_qml" | head -3 | tr '\n' ' '))"
	elif grep -q 'HighAsCG' <<<"$show_qml"; then
		ok "Calamares slideshow in squashfs is HighAsCG-branded, no broadcast/playout wording (show.qml)"
	else
		bad "Calamares show.qml in squashfs has no HighAsCG branding"
	fi
fi

if ((fail)); then
	echo >&2
	echo "Rebuild after fixing the build host:" >&2
	if [[ "$LAYOUT" == "new" ]]; then
		echo "  sudo bash ${HERE}/install-eggs-config.sh --apply   (branding/livecd from the repo theme)" >&2
		echo "  sudo bash ${HERE}/build-highascg-egg.sh" >&2
	else
		echo "  sudo bash ${HERE}/finalize-boot-branding-for-eggs-produce.sh" >&2
		echo "  sudo bash ${HERE}/build-highascg-egg.sh" >&2
		echo "  (or only re-pack: sudo bash ${HERE}/inject-iso-boot-branding.sh)" >&2
	fi
	exit 1
fi

echo "All boot branding checks passed."

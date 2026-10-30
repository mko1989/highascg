#!/usr/bin/env bash
# Last-mile boot branding on the eggs build host, immediately before `eggs remaster` (legacy: `eggs produce`).
#
# - GRUB/isolinux splash in the repo theme (+ theme path in eggs.yaml, legacy eggs only)
# - Plymouth default theme + initramfs hooks for the running kernel
#
# Usage:
#   sudo bash tools/eggs/live-usb/finalize-boot-branding-for-eggs-produce.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THEME_ROOT="${HERE}/highascg-eggs-theme"
BRANDING="${HERE}/branding"
EGGS_YAML="${EGGS_YAML:-/etc/penguins-eggs.d/eggs.yaml}"
# shellcheck source=eggs-kernel-lib.sh
source "${HERE}/eggs-kernel-lib.sh"
highascg_resolve_eggs_kernel

echo "==> GRUB theme + Plymouth files (single host initramfs rebuild after this)"
HIGHASCG_SKIP_HOST_INITRAMFS=1 bash "${HERE}/install-eggs-live-grub-theme.sh"

echo "==> Framebuffer corner throbber (default Live nosplash + corner animation)"
bash "${HERE}/install-fb-corner-throbber.sh"

THEME_ABS="$(cd "$THEME_ROOT" && pwd)"
LIVE_SPLASH="${THEME_ABS}/theme/livecd/splash.png"
# WO-832: stock eggs penguin splash lives in /etc/penguins-eggs.d/branding.default on eggs >= 26.10.
# shellcheck source=eggs-theme-lib.sh
source "${HERE}/eggs-theme-lib.sh"
EGGS_PENGUINS="$(highascg_eggs_theme_dir 2>/dev/null || echo /etc/penguins-eggs.d/branding.default)/livecd/splash.png"

bash "${HERE}/prepare-branding-assets.sh"
if [[ -f "${BRANDING}/splash.boot.png" ]]; then
	install -m 0644 -o root -g root "${BRANDING}/splash.boot.png" "${LIVE_SPLASH}"
	[[ -f "${BRANDING}/splash.boot.jpg" ]] && \
		install -m 0644 -o root -g root "${BRANDING}/splash.boot.jpg" "${THEME_ABS}/theme/livecd/splash.jpg"
elif [[ -f "${BRANDING}/splash.png" ]]; then
	install -m 0644 -o root -g root "${BRANDING}/splash.png" "${LIVE_SPLASH}"
fi

if [[ ! -f "$LIVE_SPLASH" ]]; then
	echo "ERROR: Missing ${LIVE_SPLASH} — add ${BRANDING}/splash.png before building the ISO." >&2
	exit 1
fi
if [[ -L "$LIVE_SPLASH" ]]; then
	echo "ERROR: ${LIVE_SPLASH} is a symlink (likely eggs penguins). Use a real splash.png file." >&2
	exit 1
fi
if [[ -f "$EGGS_PENGUINS" ]] && cmp -s "$LIVE_SPLASH" "$EGGS_PENGUINS"; then
	echo "ERROR: splash.png is still the stock eggs penguins image — copy your branding/splash.png." >&2
	exit 1
fi

# WO-870: legacy eggs reads eggs.yaml `theme:`; the new one reads <conf>/branding/livecd/, which
# install-eggs-config.sh --apply copies from this repo theme right before `eggs remaster` and verify-eggs-config.sh
# then gates (byte-equal). Here — before that apply — a difference is only reported, never fatal.
# shellcheck source=eggs-cli-lib.sh
source "${HERE}/eggs-cli-lib.sh"
EGGS_FLAVOR="$(highascg_eggs_flavor)"
if [[ "$EGGS_FLAVOR" != "legacy" ]]; then
	BRAND_LIVECD="$(highascg_eggs_branding_dir)/livecd"
	for f in grub.theme.cfg isolinux.theme.cfg splash.png; do
		if ! cmp -s "${THEME_ABS}/theme/livecd/${f}" "${BRAND_LIVECD}/${f}"; then
			echo "NOTE: ${BRAND_LIVECD}/${f} differs from the repo theme (or is missing) — install-eggs-config.sh --apply updates it before eggs remaster"
		fi
	done
elif ! grep -q "^theme: ${THEME_ABS}\$" "$EGGS_YAML"; then
	echo "ERROR: eggs.yaml theme is not ${THEME_ABS}" >&2
	grep '^theme:' "$EGGS_YAML" >&2 || true
	exit 1
fi

THEME_ALT="$(update-alternatives --query default.plymouth 2>/dev/null | sed -n 's/^Value: //p' || true)"
if [[ "$THEME_ALT" != *highascg* ]]; then
	echo "ERROR: Plymouth default is not highascg (got: ${THEME_ALT:-unset})" >&2
	exit 1
fi

if [[ ! -f "/boot/initrd.img-${KVER}" || ! -f "/boot/vmlinuz-${KVER}" ]]; then
	echo "ERROR: Missing /boot/vmlinuz-${KVER} or initrd for ${KVER}" >&2
	exit 1
fi

highascg_rebuild_host_initramfs "$KVER" "finalize before eggs remaster/produce"

echo "OK: boot branding ready for eggs ${EGGS_FLAVOR}"
if [[ "$EGGS_FLAVOR" == "legacy" ]]; then
	echo "     theme: $(grep '^theme:' "$EGGS_YAML")"
else
	echo "     theme: ${THEME_ABS}/theme/livecd → $(highascg_eggs_branding_dir)/livecd"
fi
echo "     splash: $(stat -c '%s bytes %n' "$LIVE_SPLASH")"
echo "     plymouth: ${THEME_ALT}"
echo "     kernel: ${KVER}"

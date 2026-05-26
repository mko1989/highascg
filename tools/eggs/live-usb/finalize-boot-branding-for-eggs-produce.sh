#!/usr/bin/env bash
# Last-mile boot branding on the eggs build host, immediately before `eggs produce`.
#
# - GRUB/isolinux splash + theme path in eggs.yaml
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
KVER="$(uname -r)"

echo "==> GRUB theme + Plymouth (eggs.yaml, splash.png, initramfs)"
bash "${HERE}/install-eggs-live-grub-theme.sh"

THEME_ABS="$(cd "$THEME_ROOT" && pwd)"
LIVE_SPLASH="${THEME_ABS}/theme/livecd/splash.png"
EGGS_PENGUINS="/usr/lib/penguins-eggs/addons/eggs/theme/livecd/splash.png"

if [[ -f "${BRANDING}/splash.png" ]]; then
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

if ! grep -q "^theme: ${THEME_ABS}\$" "$EGGS_YAML"; then
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

echo "==> initramfs for ${KVER} (eggs produce runs mkinitramfs again into ISO /live/)"
update-initramfs -u -k "$KVER"

echo "OK: boot branding ready for eggs produce"
echo "     theme: $(grep '^theme:' "$EGGS_YAML")"
echo "     splash: $(stat -c '%s bytes %n' "$LIVE_SPLASH")"
echo "     plymouth: ${THEME_ALT}"
echo "     kernel: ${KVER}"

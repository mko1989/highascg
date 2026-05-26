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

THEME_ABS="$(cd "$THEME_ROOT" && pwd)"
SPLASH="${THEME_ABS}/theme/livecd/splash.png"

[[ -f "$SPLASH" ]] || {
	echo "Missing $SPLASH — run finalize-boot-branding-for-eggs-produce.sh" >&2
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

echo "==> Plymouth + initramfs hooks (highascg in /live/initrd)"
bash "${HERE}/install-highascg-plymouth-theme.sh"

THEME_ALT="$(update-alternatives --query default.plymouth 2>/dev/null | sed -n 's/^Value: //p' || true)"
[[ "$THEME_ALT" == *highascg* ]] || {
	echo "ERROR: default.plymouth is not highascg: ${THEME_ALT:-unset}" >&2
	exit 1
}

echo "==> GRUB splash → ${ISO_WORK}/boot/grub/splash.png"
install -m 0644 -o root -g root "$SPLASH" "${ISO_WORK}/boot/grub/splash.png"

echo "==> Rebuild live initrd (${KVER}) → ${INITRD_STAGING}"
TMP_INITRD="$(mktemp)"
trap 'rm -f "$TMP_INITRD"' EXIT
mkinitramfs -o "$TMP_INITRD" "$KVER"
install -m 0644 -o root -g root "$TMP_INITRD" "$INITRD_STAGING"

echo "==> Re-pack ISO (xorriso via eggs mkisofs)"
# shellcheck disable=SC1090
bash "$MKISOFS"

ISO_OUT="${1:-}"
if [[ -z "$ISO_OUT" ]]; then
	ISO_OUT="$(grep -oE '/home/eggs[^ ]+\.iso' "$MKISOFS" | tail -1 || true)"
fi
if [[ -n "$ISO_OUT" && -f "$ISO_OUT" ]]; then
	echo "OK: ${ISO_OUT}"
else
	echo "OK: ISO re-packed (see ${MKISOFS} for output path)"
fi

#!/usr/bin/env bash
# After dd + finish-operator-stick: confirm HIGHASCG GRUB branding is on the block device.
#
# Usage: sudo bash tools/eggs/live-usb/verify-operator-stick-branding.sh /dev/sdX [/path/to.iso]
set -euo pipefail

DEV="${1:?Usage: sudo $0 /dev/sdX [/path/to.iso]}"
ISO="${2:-}"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0 $DEV" >&2
	exit 1
}
[[ -b "$DEV" ]] || {
	echo "Not a block device: $DEV" >&2
	exit 1
}

fail=0
bad() {
	echo "FAIL: $*" >&2
	fail=1
}
ok() {
	echo "OK: $*"
}
warn() {
	echo "WARN: $*" >&2
}

echo "==> Stick: $DEV"
lsblk -f "$DEV" || true

# Sample first ~4 GiB (covers hybrid ISO + GRUB cfg strings)
sample="$(mktemp)"
trap 'rm -f "$sample"' EXIT
dd if="$DEV" of="$sample" bs=1M count=4096 status=none 2>/dev/null || \
	dd if="$DEV" of="$sample" bs=1M count=2048 status=none

if grep -aq 'HIGHASCG Live' "$sample"; then
	ok "block device contains HIGHASCG GRUB menu text"
else
	bad "no HIGHASCG Live string on stick — wrong ISO flashed or hybrid ISO damaged (re-dd)"
fi

if grep -aq 'set theme=/boot/grub/theme.cfg' "$sample"; then
	ok "GRUB theme.cfg reference present on stick"
else
	bad "missing set theme=/boot/grub/theme.cfg — stock/generic GRUB likely"
fi

if grep -aq 'insmod gfxterm' "$sample"; then
	ok "GRUB gfxterm module load present (gfx menu enabled)"
else
	warn "no insmod gfxterm on stick — GRUB may show text-only menu (rebuild with ensure-iso-grub-gfx-theme)"
fi

if grep -aq 'GNU Unifont Regular 16' "$sample"; then
	ok "GRUB theme uses GNU Unifont (matches font.pf2 on Ubuntu eggs host)"
elif grep -aq 'Sans Regular' "$sample"; then
	bad "GRUB theme still references Sans fonts (not in font.pf2) — rebuild ISO after grub.theme.cfg fix"
fi

if grep -aq 'desktop-image: "splash.png"' "$sample"; then
	ok "GRUB theme references splash.png (not subsampled JPEG)"
elif grep -aq 'desktop-image: "splash.jpg"' "$sample"; then
	bad "GRUB theme still uses splash.jpg — causes invalid JPEG sampling error at boot"
elif grep -aq 'splash.png' "$sample"; then
	ok "splash.png present on stick"
else
	warn "splash.png not found in stick sample — gfx wallpaper may be missing"
fi

if [[ -n "$ISO" && -f "$ISO" ]]; then
	echo "==> Compare ISO: $ISO"
	iso_sample="$(mktemp)"
	trap 'rm -f "$sample" "$iso_sample"' EXIT
	dd if="$ISO" of="$iso_sample" bs=1M count=4096 status=none 2>/dev/null || true
	if cmp -s <(strings "$sample" | grep -E 'HIGHASCG|gfxterm|GNU Unifont' | sort -u) \
		<(strings "$iso_sample" | grep -E 'HIGHASCG|gfxterm|GNU Unifont' | sort -u) 2>/dev/null; then
		ok "stick branding strings match ISO file"
	else
		warn "stick branding strings differ from ISO — confirm you flashed this ISO path"
	fi
fi

if ((fail)); then
	echo "Stick branding verification failed — re-dd the latest ISO, then re-run this script." >&2
	exit 1
fi
echo "Stick branding verification passed."

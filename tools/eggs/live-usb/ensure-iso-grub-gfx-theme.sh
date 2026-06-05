#!/usr/bin/env bash
# Prepend gfxterm + loadfont before set theme= on ISO staging grub.cfg (inject + produce).
#
# Usage: ensure-iso-grub-gfx-theme.sh [iso-staging-dir]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ISO_WORK="${1:-${EGGS_ISO_WORK:-/home/eggs/mnt/iso}}"
GRUB_CFG="${ISO_WORK}/boot/grub/grub.cfg"
PREAMBLE="${HERE}/grub-gfx-preamble.cfg"

[[ -f "$GRUB_CFG" ]] || {
	echo "Missing $GRUB_CFG" >&2
	exit 1
}
[[ -f "$PREAMBLE" ]] || {
	echo "Missing $PREAMBLE" >&2
	exit 1
}

if grep -q 'insmod gfxterm' "$GRUB_CFG" 2>/dev/null; then
	echo "OK: grub.cfg already has gfxterm (gfx theme enabled)"
	exit 0
fi

body="$(mktemp)"
trap 'rm -f "$body"' EXIT
grep -v '^set theme=/boot/grub/theme.cfg' "$GRUB_CFG" >"$body" || true

{
	cat "$PREAMBLE"
	echo 'set theme=/boot/grub/theme.cfg'
	cat "$body"
} >"${GRUB_CFG}.new"
mv "${GRUB_CFG}.new" "$GRUB_CFG"
echo "OK: prepended gfx preamble to boot/grub/grub.cfg"

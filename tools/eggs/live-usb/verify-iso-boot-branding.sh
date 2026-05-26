#!/usr/bin/env bash
# Post-build checks: ISO GRUB splash + persistence + Plymouth theme inside live initrd.
#
# Usage:
#   sudo bash tools/eggs/live-usb/verify-iso-boot-branding.sh [/path/to/highascg*.iso]
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
		ok "default grub linux line includes persistence ($(basename "$GRUB_CFG"))"
	else
		bad "default grub linux line missing persistence (stock eggs theme? use eggs produce --theme)"
		echo "       line: ${first_linux}" >&2
	fi
	if grep -q 'Live/Installation' "$GRUB_CFG" && ! grep -qE '(^|[[:space:]])persistence([[:space:]]|$)' <<<"${first_linux:-}"; then
		bad "grub.cfg is stock eggs Live/Installation (rebuild with --theme highascg-eggs-theme)"
	fi
	if grep -q 'quiet splash' "$GRUB_CFG"; then
		ok "grub.cfg has quiet splash"
	else
		warn "grub.cfg missing quiet splash on default entry"
	fi
fi

SPLASH="$MNT/boot/grub/splash.png"
[[ -f "$SPLASH" ]] || bad "missing boot/grub/splash.png on ISO"
if [[ -f "$SPLASH" ]]; then
	if [[ -f "$EGGS_PENGUINS" ]] && cmp -s "$SPLASH" "$EGGS_PENGUINS"; then
		bad "ISO GRUB splash is still stock eggs penguins"
	elif [[ -f "${BRANDING}/splash.png" ]] && cmp -s "$SPLASH" "${BRANDING}/splash.png"; then
		ok "GRUB splash matches branding/splash.png"
	else
		ok "GRUB splash present ($(stat -c '%s bytes' "$SPLASH"))"
	fi
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
if [[ -n "$INITRD" ]]; then
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

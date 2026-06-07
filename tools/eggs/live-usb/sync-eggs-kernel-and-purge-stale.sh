#!/usr/bin/env bash
# Keep one kernel on the eggs build host: newest linux-image-*-generic for eggs.yaml + ISO,
# purge older packages (faster initramfs, smaller clone).
#
# Usage:
#   sudo bash tools/eggs/live-usb/sync-eggs-kernel-and-purge-stale.sh
#   sudo HIGHASCG_ENSURE_LATEST_KERNEL=1 bash ...   # apt install linux-image-generic first
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=eggs-kernel-lib.sh
source "${HERE}/eggs-kernel-lib.sh"

EGGS_YAML="${EGGS_YAML:-/etc/penguins-eggs.d/eggs.yaml}"
[[ -f "$EGGS_YAML" ]] || {
	echo "Missing $EGGS_YAML" >&2
	exit 1
}

highascg_resolve_eggs_kernel

echo "==> eggs.yaml → latest kernel ${KVER} (running: $(uname -r))"
if grep -q '^vmlinuz:' "$EGGS_YAML"; then
	sed -i "s|^vmlinuz:.*|vmlinuz: ${VM}|" "$EGGS_YAML"
else
	echo "vmlinuz: ${VM}" >>"$EGGS_YAML"
fi
if grep -q '^initrd_img:' "$EGGS_YAML"; then
	sed -i "s|^initrd_img:.*|initrd_img: ${IR}|" "$EGGS_YAML"
else
	echo "initrd_img: ${IR}" >>"$EGGS_YAML"
fi
grep -E '^(vmlinuz|initrd_img):' "$EGGS_YAML"

purge_kernel_pkg() {
	local kpkg="$1"
	[[ -n "$kpkg" ]] || return 0
	echo "==> Purge ${kpkg} (+ headers/modules/tools)"
	apt-get -y purge "$kpkg" || true
	local ver="${kpkg#linux-image-}"
	apt-get -y purge \
		"linux-headers-${ver}" \
		"linux-modules-${ver}" \
		"linux-modules-extra-${ver}" \
		"linux-tools-${ver}" 2>/dev/null || true
}

mapfile -t installed < <(dpkg -l 'linux-image-[0-9]*-generic' 2>/dev/null | awk '/^ii/{print $2}' | sort -V)
keep="linux-image-${KVER}"
if [[ -f /etc/highascg/pinned-kernel ]]; then
	echo "==> Pinned kernel — keep ${keep} only"
fi
for kpkg in "${installed[@]}"; do
	[[ "$kpkg" == "$keep" ]] && continue
	purge_kernel_pkg "$kpkg"
done

export DEBIAN_FRONTEND=noninteractive
apt-get -y autoremove --purge || true
# Host initramfs runs once in finalize-boot-branding (avoids duplicate "live-boot:" lines).
if [[ "${HIGHASCG_SKIP_HOST_INITRAMFS:-0}" == "1" ]]; then
	echo "==> Skip host initramfs here (will run once before eggs produce)"
else
	echo "==> update-initramfs + grub default → ${KVER}"
	update-initramfs -u -k "$KVER"
fi
if command -v grub-set-default >/dev/null 2>&1 && [[ -f /boot/grub/grub.cfg ]]; then
	menu="$(grep -E "^menuentry " /boot/grub/grub.cfg 2>/dev/null | grep -F "${KVER}" | head -1 | sed -n "s/^menuentry '\([^']*\)'.*/\1/p" || true)"
	if [[ -n "$menu" ]]; then
		grub-set-default "$menu" 2>/dev/null || true
	fi
fi
update-grub 2>/dev/null || true

echo "OK: eggs produce will use ${KVER} (only this image package should remain)"
dpkg -l 'linux-image-[0-9]*-generic' 2>/dev/null | awk '/^ii/{print $2, $3}' || true

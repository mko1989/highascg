#!/usr/bin/env bash
# Keep one kernel on the eggs build host: align eggs.yaml with the running kernel,
# purge other linux-image-* packages (faster initramfs, unambiguous ISO).
#
# Usage:
#   sudo bash tools/eggs/live-usb/sync-eggs-kernel-and-purge-stale.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

EGGS_YAML="${EGGS_YAML:-/etc/penguins-eggs.d/eggs.yaml}"
KVER="$(uname -r)"
VM="/boot/vmlinuz-${KVER}"
IR="/boot/initrd.img-${KVER}"

[[ -f "$VM" && -f "$IR" ]] || {
	echo "Missing $VM or $IR — boot a valid kernel first." >&2
	exit 1
}
[[ -f "$EGGS_YAML" ]] || {
	echo "Missing $EGGS_YAML" >&2
	exit 1
}

echo "==> eggs.yaml → kernel ${KVER}"
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
	echo "==> Purge ${kpkg} (+ headers/modules)"
	apt-get -y purge "$kpkg" || true
	local ver="${kpkg#linux-image-}"
	apt-get -y purge \
		"linux-headers-${ver}" \
		"linux-modules-${ver}" \
		"linux-modules-extra-${ver}" 2>/dev/null || true
}

mapfile -t installed < <(dpkg -l 'linux-image-[0-9]*-generic' 2>/dev/null | awk '/^ii/{print $2}' | sort -V)
keep="linux-image-${KVER}"
for kpkg in "${installed[@]}"; do
	[[ "$kpkg" == "$keep" ]] && continue
	purge_kernel_pkg "$kpkg"
done

export DEBIAN_FRONTEND=noninteractive
apt-get -y autoremove --purge || true
echo "==> update-initramfs (single kernel)"
update-initramfs -u -k "$KVER"
update-grub 2>/dev/null || true

echo "OK: only ${KVER} should remain for eggs produce"
dpkg -l 'linux-image-[0-9]*-generic' 2>/dev/null | awk '/^ii/{print $2, $3}' || true

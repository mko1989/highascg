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

# WO-870: eggs 26.10 never reads eggs.yaml (it always ships the running kernel) — no yaml edits, and the pin
# becomes a hard assertion (pin == uname -r). The purge logic below is unchanged for both flavors.
EGGS_FLAVOR="$(highascg_eggs_flavor)"
EGGS_YAML="${EGGS_YAML:-/etc/penguins-eggs.d/eggs.yaml}"
if [[ "$EGGS_FLAVOR" != "new" ]]; then
	[[ -f "$EGGS_YAML" ]] || {
		echo "Missing $EGGS_YAML" >&2
		exit 1
	}
fi

if [[ "$EGGS_FLAVOR" == "new" ]]; then
	highascg_assert_pin_valid && highascg_assert_running_is_pin || {
		echo "ERROR: kernel pin check failed (see above) — nothing was changed." >&2
		exit 1
	}
fi
highascg_resolve_eggs_kernel || {
	echo "ERROR: cannot resolve the eggs kernel (see above) — nothing was changed." >&2
	exit 1
}

# WO-832: decide the purge set BEFORE touching eggs.yaml, and never include the running kernel.
# (A stale pin used to make this purge the kernel the box was booted on.)
mapfile -t installed < <(dpkg -l 'linux-image-[0-9]*-generic' 2>/dev/null | awk '/^ii/{print $2}' | sort -V)
keep="linux-image-${KVER}"
for kpkg in "${installed[@]}"; do
	[[ "$kpkg" == "$keep" ]] && continue
	highascg_refuse_purge_running "$kpkg" || {
		echo "       Nothing was changed." >&2
		exit 1
	}
done

if [[ "$EGGS_FLAVOR" == "new" ]]; then
	echo "==> eggs 26.10: no eggs.yaml edit — the ISO uses the running kernel ${KVER}"
else
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
fi

purge_kernel_pkg() {
	local kpkg="$1"
	[[ -n "$kpkg" ]] || return 0
	highascg_refuse_purge_running "$kpkg" || return 1
	echo "==> Purge ${kpkg} (+ headers/modules/tools)"
	apt-get -y purge "$kpkg" || true
	local ver="${kpkg#linux-image-}"
	apt-get -y purge \
		"linux-headers-${ver}" \
		"linux-modules-${ver}" \
		"linux-modules-extra-${ver}" \
		"linux-tools-${ver}" 2>/dev/null || true
}

if [[ -f "${HIGHASCG_PIN_FILE:-/etc/highascg/pinned-kernel}" ]]; then
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

echo "OK: eggs will use ${KVER} (only this image package should remain)"
dpkg -l 'linux-image-[0-9]*-generic' 2>/dev/null | awk '/^ii/{print $2, $3}' || true

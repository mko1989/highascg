#!/usr/bin/env bash
# Full production USB stick: dd ISO → exFAT (HIGHASCGEXF, slot 3) → seed layout.
# No union persistence partition (exFAT-only).
#
# Usage:
#   sudo bash tools/eggs/live-usb/create-operator-stick-from-dd.sh /dev/sdX
#   sudo bash tools/eggs/live-usb/create-operator-stick-from-dd.sh /dev/sdX --iso /path/to.iso
#
# Destructive: overwrites the whole disk. Double-check DEVICE.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=usb-env.sh
source "${HERE}/usb-env.sh"
DEV=""
ISO=""
ASSUME_YES=false

usage() {
	echo "Usage: sudo $0 /dev/sdX [--iso /path/to.iso] [-y]" >&2
	echo "  Layout (32 GiB typical): hybrid ISO ~5 GiB · exFAT remainder on MBR slot 3." >&2
	exit 1
}

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0 /dev/sdX" >&2
	exit 1
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		-h | --help) usage ;;
		-y | --yes) ASSUME_YES=true ;;
		--iso)
			ISO="${2:?}"
			shift
			;;
		/dev/*) DEV="$1" ;;
		*) echo "Unknown: $1" >&2; usage ;;
	esac
	shift
done

[[ -n "$DEV" ]] || usage
[[ -b "$DEV" ]] || {
	echo "Not a block device: $DEV" >&2
	exit 1
}
typ=$(lsblk -ndo TYPE "$DEV" 2>/dev/null || true)
[[ "$typ" == disk ]] || {
	echo "Refusing $DEV (TYPE=$typ) — use whole disk e.g. /dev/sda" >&2
	exit 1
}

if [[ -z "$ISO" ]]; then
	# shellcheck source=flash-stick-common.sh
	source "${HERE}/flash-stick-common.sh"
	ISO="$(find_latest_iso)" || {
		echo "No ISO under /home/eggs/ — pass --iso" >&2
		exit 1
	}
fi
[[ -f "$ISO" ]] || {
	echo "ISO not found: $ISO" >&2
	exit 1
}

USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"
if getent passwd "$USER_CASPAR" >/dev/null 2>&1; then
	grp="$(id -gn "$USER_CASPAR")"
	mkdir -p /home/casparcg/exfat "/home/casparcg/highascg/media/exfat"
	chown "${USER_CASPAR}:${grp}" /home/casparcg/exfat /home/casparcg/highascg/media/exfat
fi

ISO_BYTES="$(stat -c%s "$ISO")"
ISO_HUMAN="$(numfmt --to=iec-i --suffix=B "$ISO_BYTES" 2>/dev/null || echo "${ISO_BYTES} bytes")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "DEVICE: $DEV  ($(lsblk -dno SIZE,MODEL "$DEV" 2>/dev/null || true))"
echo "ISO:    $ISO  ($ISO_HUMAN)"
echo "This ERASES all data on $DEV."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ "$ASSUME_YES" != true ]]; then
	read -r -p "Type YES to continue: " ok
	[[ "$ok" == "YES" ]] || {
		echo "Aborted."
		exit 1
	}
else
	echo "(-y) Skipping interactive confirmation."
fi

echo "==> 1/3 Unmount and flash ISO (dd)"
bash "${HERE}/unmount-usb-for-partitioning.sh" "$DEV" 2>/dev/null || true
umount "${DEV}"?* 2>/dev/null || true
sync
dd if="$ISO" of="$DEV" bs=4M status=progress oflag=sync conv=fsync
sync
partprobe "$DEV"
sleep 2
lsblk -f "$DEV"

echo "==> 2/3 exFAT + seed (finish-operator-stick, no persistence)"
export HIGHASCG_EXFAT_ONLY=1
export EXFAT_FILL_DISK=1
bash "${HERE}/install-exfat-sync-map.sh"
bash "${HERE}/finish-operator-stick.sh" "$DEV" --iso "$ISO" --prune-stale

echo "==> 3/3 Verify boot layout"
bash "${HERE}/usb-restore-esp-flags.sh" "$DEV"
if ! "$PARTED" -s "$DEV" unit MiB print 2>/dev/null | grep -qi esp; then
	echo "WARNING: no ESP flag in partition table — stick may not boot. Re-dd and rerun." >&2
fi
lsblk -f "$DEV"
echo "Expected: ESP on slot 2, exFAT HIGHASCGEXF on slot 3 (sda3) — no persistence partition."
echo "Boot GRUB → Live (config/state on exFAT only)"
echo "Operator data on LABEL=HIGHASCGEXF (drop-update/, configs/, media/, …)"

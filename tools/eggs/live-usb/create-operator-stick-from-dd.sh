#!/usr/bin/env bash
# Full production USB stick: dd ISO → 2 GiB persistence → exFAT (rest) → seed layout.
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

usage() {
	echo "Usage: sudo $0 /dev/sdX [--iso /path/to.iso]" >&2
	echo "  Layout (32 GiB typical): hybrid ISO ~5 GiB · persistence 2 GiB · exFAT remainder." >&2
	exit 1
}

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0 /dev/sdX" >&2
	exit 1
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		-h | --help) usage ;;
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

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "DEVICE: $DEV  ($(lsblk -dno SIZE,MODEL "$DEV" 2>/dev/null || true))"
echo "ISO:    $ISO  ($(numfmt --to=iec-i --suffix=B "$(stat -c%s "$ISO")" 2>/dev/null || stat -c%s "$ISO") bytes)"
echo "This ERASES all data on $DEV."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "Type YES to continue: " ok
[[ "$ok" == "YES" ]] || {
	echo "Aborted."
	exit 1
}

echo "==> 1/3 Unmount and flash ISO (dd)"
bash "${HERE}/unmount-usb-for-partitioning.sh" "$DEV" 2>/dev/null || true
umount "${DEV}"?* 2>/dev/null || true
sync
dd if="$ISO" of="$DEV" bs=4M status=progress oflag=sync conv=fsync
sync
partprobe "$DEV"
sleep 2
lsblk -f "$DEV"

echo "==> 2/3 Persistence + exFAT + seed (finish-operator-stick)"
export PERSIST_SIZE_MIB="${PERSIST_SIZE_MIB:-2048}"
export EXFAT_FILL_DISK=1
bash "${HERE}/install-exfat-sync-map.sh"
bash "${HERE}/finish-operator-stick.sh" "$DEV" --iso "$ISO" --prune-stale

echo "==> 3/3 Verify boot layout"
bash "${HERE}/usb-restore-esp-flags.sh" "$DEV"
if ! "$PARTED" -s "$DEV" unit MiB print 2>/dev/null | grep -qi esp; then
	echo "WARNING: no ESP flag in partition table — stick may not boot. Re-dd and rerun." >&2
fi
lsblk -f "$DEV"
echo "Expected: persistence on MBR slot 3 (sda3), exFAT on slot 4 (sda4), ESP on slot 2."
echo "Boot GRUB → Live with persistence"
echo "Operator data on LABEL=HIGHASCGEXF (drop-update/, drop-config/, media/, …)"

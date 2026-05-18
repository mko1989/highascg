#!/usr/bin/env bash
# Flash a live ISO to a whole disk using ISO path + device from a small config file.
#
# Usage:
#   sudo bash tools/live-usb/flash-iso-from-config.sh [OPTIONS] [CONFIG.txt]
#   sudo bash tools/live-usb/flash-iso-from-config.sh [CONFIG.txt] [OPTIONS]
#
# If CONFIG.txt is omitted, uses tools/live-usb/flash-iso.conf next to this script.
#
# Config keys (first match wins; case-insensitive keys):
#   ISO, ISO_PATH          — path to the .iso file
#   DEVICE, DEV, USB, DISK — whole-disk path (e.g. /dev/sda), not a partition
#
# Options:
#   -y, --yes   Skip interactive confirmation (dangerous)
#   -h, --help  Show this help
#
# After dd: run add-exfat-data-partition.sh then add-union-persistence-partition.sh
# if needed — see tools/live-usb/FLASH_AND_PERSIST.md
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_CONF="${HERE}/flash-iso.conf"

usage() {
	sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

ASSUME_YES=false
POS=()

while [[ $# -gt 0 ]]; do
	case "$1" in
	-h | --help) usage 0 ;;
	-y | --yes) ASSUME_YES=true; shift ;;
	-*)
		echo "Unknown option: $1" >&2
		usage 1
		;;
	*)
		POS+=("$1")
		shift
		;;
	esac
done

[[ ${#POS[@]} -le 1 ]] || {
	echo "Extra arguments: ${POS[*]:1}" >&2
	usage 1
}

CONF="${POS[0]:-}"
[[ -n "$CONF" ]] || CONF="$DEFAULT_CONF"

need_root() {
	[[ "$(id -u)" -eq 0 ]] || {
		echo "Run as root: sudo $0 …" >&2
		exit 1
	}
}

# shellcheck source=flash-iso-conf-lib.sh
source "${HERE}/flash-iso-conf-lib.sh"
die() { flash_iso_die "$@"; }

confirm_flash() {
	local iso="$1" dev="$2"
	echo
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "About to overwrite **entire disk** $dev"
	echo "ISO: $iso"
	echo "This erases all data on that device."
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	if [[ "$ASSUME_YES" != true ]]; then
		local w w2
		read -r -p "Type YES to continue: " w
		[[ "$w" == "YES" ]] || {
			echo "Aborted." >&2
			exit 1
		}
		read -r -p "Confirm device path (type $dev again): " w2
		[[ "$w2" == "$dev" ]] || {
			echo "Confirmation mismatch." >&2
			exit 1
		}
	fi
}

run_dd() {
	local iso="$1" dev="$2" bs="${3:-4M}"
	[[ -f "$iso" ]] || die "ISO is not a regular file: $iso"
	[[ -b "$dev" ]] || die "Not a block device: $dev"
	local typ
	typ=$(lsblk -ndo TYPE "$dev" 2>/dev/null || true)
	[[ "$typ" == "disk" ]] || die "Refusing: $dev is TYPE=$typ (use a whole disk like /dev/sda, not /dev/sda1)"

	if [[ "$iso" -ef "$dev" ]]; then
		die "ISO path and device are the same node — refusing."
	fi

	local isos devs
	isos=$(stat -c%s "$iso" 2>/dev/null) || die "Cannot stat ISO: $iso"
	devs=$(blockdev --getsize64 "$dev" 2>/dev/null) || die "Cannot read size of $dev"
	if (( isos > devs )); then
		die "ISO ($isos bytes) is larger than $dev ($devs bytes)."
	fi

	echo "Unmounting any partitions on $dev …"
	systemctl daemon-reload 2>/dev/null || true
	umount "${dev}"* 2>/dev/null || true

	echo "Writing ISO → $dev (bs=$bs) …"
	dd if="$iso" of="$dev" bs="$bs" status=progress oflag=sync conv=fsync
	sync
	partprobe "$dev"
	sleep 1
	lsblk "$dev"
	echo "Done."
}

need_root
flash_iso_load_conf "$CONF"

ISO=""
ISO=$(flash_iso_get ISO ISO_PATH) || die "Config must set ISO= or ISO_PATH= (file: $CONF)"
DEVICE=""
DEVICE=$(flash_iso_get DEVICE DEV USB DISK TARGET) || die "Config must set DEVICE= (or DEV= / USB= / DISK= / TARGET=) (file: $CONF)"

ISO=$(flash_iso_expand_tilde "$(flash_iso_trim "$ISO")")
DEVICE=$(flash_iso_trim "$DEVICE")

[[ -e "$ISO" ]] || die "ISO path does not exist: $ISO"
[[ -n "$DEVICE" ]] || die "DEVICE is empty."

BS_RAW=""
BS_RAW=$(flash_iso_get BS DD_BS) || true
BS_RAW=$(flash_iso_trim "${BS_RAW:-4M}")
[[ -n "$BS_RAW" ]] || BS_RAW=4M

echo "Using config: $CONF"
echo "  ISO     = $ISO"
echo "  DEVICE  = $DEVICE"
echo "  BS      = $BS_RAW"

confirm_flash "$ISO" "$DEVICE"
run_dd "$ISO" "$DEVICE" "$BS_RAW"

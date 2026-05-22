#!/usr/bin/env bash
# Build HighAsCG eggs ISO, flash to USB, add exFAT (HIGHASCGEXF) + union persistence + seed layout.
#
# Usage (all heavy steps require root — run the whole script with sudo):
#   sudo bash tools/live-usb/build-flash-and-persist.sh
#
# Options:
#   --flash-only           Skip eggs build; use latest ISO under /home/eggs/
#   --build-only           Run build-highascg-egg.sh only; do not flash
#   --iso PATH             ISO to flash (default: newest *.iso under /home/eggs/ and /home/eggs/mnt/)
#   --usb /dev/sdX         Flash this whole disk non-interactively (still needs confirmation unless -y)
#   --no-exfat             Skip add-exfat-data-partition.sh (not for production sticks)
#   --no-persist           Skip add-union-persistence-partition.sh (not for production sticks)
#   --prune-stale          Remove leftover partitions 2+ before exFAT (re-flashed sticks)
#   --dry-run-persist      Pass --dry-run to add-union-persistence-partition.sh only
#   --dry-run-exfat        Pass --dry-run to add-exfat-data-partition.sh only
#   -y, --yes              Skip interactive YES/device re-type confirmation before dd (dangerous)
#
# Env (forwarded to build-highascg-egg.sh when build runs):
#   BASENAME, NVIDIA_BRANCHES
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=flash-stick-common.sh
source "${HERE}/flash-stick-common.sh"

BUILD_SCRIPT="${HERE}/build-highascg-egg.sh"
EXFAT_SCRIPT="${HERE}/add-exfat-data-partition.sh"
PERSIST_SCRIPT="${HERE}/add-union-persistence-partition.sh"
SEED_SCRIPT="${HERE}/seed-exfat-operator-layout.sh"

DO_BUILD=true
DO_FLASH=true
DO_EXFAT=true
DO_PERSIST=true
PRUNE_STALE=false
DRY_PERSIST=false
DRY_EXFAT=false
ISO=""
USB=""
ASSUME_YES=false

usage() {
	sed -n '1,25p' "$0" | tail -n +2
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	-h | --help) usage 0 ;;
	--flash-only) DO_BUILD=false ;;
	--build-only) DO_FLASH=false; DO_EXFAT=false; DO_PERSIST=false ;;
	--iso)
		ISO="${2:?}"
		shift
		;;
	--usb)
		USB="${2:?}"
		shift
		;;
	--no-exfat) DO_EXFAT=false ;;
	--no-persist) DO_PERSIST=false ;;
	--prune-stale) PRUNE_STALE=true ;;
	--dry-run-persist) DRY_PERSIST=true ;;
	--dry-run-exfat) DRY_EXFAT=true ;;
	-y | --yes) ASSUME_YES=true ;;
	*)
		echo "Unknown option: $1" >&2
		usage 1
		;;
	esac
	shift
done

need_root() {
	[[ "$(id -u)" -eq 0 ]] || {
		echo "Run as root: sudo $0" >&2
		exit 1
	}
}

die() {
	echo "Error: $*" >&2
	exit 1
}

prune_stale_usb_partitions() {
	local dev="$1"
	local pcount
	pcount=$(lsblk -nrpo NAME "$dev" | grep -cv "^${dev}$" || true)
	[[ "${pcount:-0}" -gt 1 ]] || return 0
	echo "==> Prune stale partitions 2..${pcount} on $dev (keep partition 1 = ISO)"
	for ((i = pcount; i >= 2; i--)); do
		LC_ALL=C parted -s "$dev" rm "$i" 2>/dev/null || true
	done
	partprobe "$dev"
	sleep 1
}

finish_exfat_seed() {
	local mp
	mp=$(mktemp -d /tmp/highascg-exfat-seed.XXXXXX)
	mount -L HIGHASCGEXF "$mp"
	bash "$SEED_SCRIPT" "$mp"
	sync
	umount "$mp"
	rmdir "$mp" 2>/dev/null || true
}

if "$DO_BUILD"; then
	need_root
	echo "==> Build phase: $BUILD_SCRIPT"
	bash "$BUILD_SCRIPT"
fi

if "$DO_FLASH"; then
	need_root
	if [[ -z "$ISO" ]]; then
		ISO="$(find_latest_iso)" || exit 1
	fi
	[[ -f "$ISO" ]] || die "ISO is not a file: $ISO"
	echo "Using ISO: $ISO"

	if [[ -z "$USB" ]]; then
		pick_usb_interactive || exit 1
	fi
	[[ -b "$USB" ]] || die "Invalid device: $USB"
	typ=$(lsblk -ndo TYPE "$USB" 2>/dev/null || true)
	[[ "$typ" == disk ]] || die "Refusing $USB: expected whole disk (TYPE=disk), got TYPE=$typ"

	local_dd_note="After dd: ${PERSIST_SIZE_MIB:-2048} MiB persistence, then exFAT (rest of disk), seed folders."
	export PERSIST_SIZE_MIB="${PERSIST_SIZE_MIB:-2048}"
	export EXFAT_FILL_DISK="${EXFAT_FILL_DISK:-1}"
	if ! "$DO_EXFAT" && ! "$DO_PERSIST"; then
		local_dd_note="After dd: exFAT and persistence skipped (not for production sticks)."
	fi
	confirm_dd_flash "$ISO" "$USB" "$ASSUME_YES" "$local_dd_note" || exit 1
	run_dd_flash "$ISO" "$USB"

	if "$PRUNE_STALE"; then
		prune_stale_usb_partitions "$USB"
	fi

	export EXFAT_ISO_PATH="$ISO"
	export PERSIST_ISO_PATH="$ISO"

	if "$DO_PERSIST"; then
		echo "==> Persistence (${PERSIST_SIZE_MIB} MiB): $PERSIST_SCRIPT $USB"
		if "$DRY_PERSIST"; then
			bash "$PERSIST_SCRIPT" --dry-run "$USB"
		else
			bash "$PERSIST_SCRIPT" "$USB"
		fi
	fi

	if "$DO_EXFAT"; then
		echo "==> exFAT (fill disk): $EXFAT_SCRIPT $USB"
		if "$DRY_EXFAT"; then
			bash "$EXFAT_SCRIPT" --dry-run "$USB"
		else
			bash "$EXFAT_SCRIPT" "$USB"
			finish_exfat_seed
		fi
	fi

	echo
	echo "Done."
	echo "- Boot GRUB → **Live with persistence** (not plain Live)."
	echo "- Doc: tools/eggs/live-usb/FLASH_AND_PERSIST.md"
	echo "- Client handout: for_client/USB_STICK_AFTER_FLASH.md"
fi

if ! "$DO_BUILD" && ! "$DO_FLASH"; then
	die "Nothing to do (enable build and/or flash)"
fi

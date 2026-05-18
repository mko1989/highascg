#!/usr/bin/env bash
# Build HighAsCG eggs ISO, flash it to a USB stick, add Debian Live / union persistence.
#
# Usage (all heavy steps require root — run the whole script with sudo):
#   sudo bash tools/live-usb/build-flash-and-persist.sh
#
# Options:
#   --flash-only           Skip eggs build; use latest ISO under /home/eggs/
#   --build-only           Run build-highascg-egg.sh only; do not flash
#   --iso PATH             ISO to flash (default: newest *.iso under /home/eggs/ and /home/eggs/mnt/)
#   --usb /dev/sdX         Flash this whole disk non-interactively (still needs confirmation unless -y)
#   --no-persist           Do not run add-union-persistence-partition.sh after dd
#   --dry-run-persist      Pass --dry-run to add-union-persistence-partition.sh only
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
PERSIST_SCRIPT="${HERE}/add-union-persistence-partition.sh"

DO_BUILD=true
DO_FLASH=true
DO_PERSIST=true
DRY_PERSIST=false
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
	--build-only) DO_FLASH=false; DO_PERSIST=false ;;
	--iso)
		ISO="${2:?}"
		shift
		;;
	--usb)
		USB="${2:?}"
		shift
		;;
	--no-persist) DO_PERSIST=false ;;
	--dry-run-persist) DRY_PERSIST=true ;;
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

	local_dd_note=""
	if "$DO_PERSIST"; then
		local_dd_note="After dd: add persistence (+ persistence.conf / union)."
	else
		local_dd_note="After dd: persistence step skipped (--no-persist)."
	fi
	confirm_dd_flash "$ISO" "$USB" "$ASSUME_YES" "$local_dd_note" || exit 1
	run_dd_flash "$ISO" "$USB"

	if "$DO_PERSIST"; then
		echo "==> Persistence: $PERSIST_SCRIPT $USB"
		if "$DRY_PERSIST"; then
			bash "$PERSIST_SCRIPT" --dry-run "$USB"
		else
			bash "$PERSIST_SCRIPT" "$USB"
		fi
	fi

	echo
	echo "Done."
	echo "- Boot GRUB → **Live with persistence** (not plain Live)."
	echo "- Doc: tools/live-usb/FLASH_AND_PERSIST.md"
fi

if ! "$DO_BUILD" && ! "$DO_FLASH"; then
	die "Nothing to do (enable build and/or flash)"
fi

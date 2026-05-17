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

find_latest_iso() {
	local latest="" t=0 f ts
	shopt -s nullglob
	local candidates=(/home/eggs/*.iso /home/eggs/mnt/*.iso)
	shopt -u nullglob
	[[ ${#candidates[@]} -gt 0 ]] || {
		echo "No *.iso found under /home/eggs/ or /home/eggs/mnt/. Build first or pass --iso." >&2
		return 1
	}
	for f in "${candidates[@]}"; do
		[[ -f "$f" ]] || continue
		ts=$(stat -c %Y "$f" 2>/dev/null) || continue
		if (( ts >= t )); then
			t=$ts
			latest=$f
		fi
	done
	[[ -n "$latest" ]] || return 1
	printf '%s' "$latest"
}

list_flash_candidates() {
	# Prefer USB-transport or removable whole disks; if none, list all disks with a warning.
	local -a buf=()
	local path tran rm typ
	while read -r path tran rm; do
		[[ -n "$path" && -b "$path" ]] || continue
		typ=$(lsblk -ndo TYPE "$path" 2>/dev/null || true)
		[[ "$typ" == disk ]] || continue
		if [[ "$tran" == "usb" || "$rm" == "1" ]]; then
			buf+=("$path")
		fi
	done < <(lsblk -dnrpo PATH,TRAN,RM 2>/dev/null || true)
	if [[ ${#buf[@]} -eq 0 ]]; then
		echo "No drive with TRAN=usb or RM=1; listing all whole disks (be careful):" >&2
		while read -r path _; do
			[[ -n "$path" && -b "$path" ]] || continue
			typ=$(lsblk -ndo TYPE "$path" 2>/dev/null || true)
			[[ "$typ" == disk ]] || continue
			buf+=("$path")
		done < <(lsblk -dnrpo PATH,TRAN,RM 2>/dev/null || true)
	fi
	printf '%s\n' "${buf[@]}" | sort -u
}

pick_usb_interactive() {
	local -a opts=()
	mapfile -t opts < <(list_flash_candidates)
	if [[ ${#opts[@]} -eq 0 ]]; then
		echo "No block devices found." >&2
		return 1
	fi
	echo "Removable / USB candidates (whole disks only):"
	local i=1 p sz model tran
	for p in "${opts[@]}"; do
		sz=$(lsblk -dnro SIZE "$p" 2>/dev/null || echo "?")
		model=$(lsblk -dnro MODEL "$p" 2>/dev/null | head -1 || echo "")
		tran=$(lsblk -dnro TRAN "$p" 2>/dev/null | head -1 || echo "")
		printf '  %2d) %-12s %8s  TRAN=%-6s  %s\n' "$i" "$p" "$sz" "$tran" "$model"
		((i++)) || true
	done
	local choice
	read -r -p "Enter number (1-${#opts[@]}): " choice || true
	[[ "$choice" =~ ^[0-9]+$ ]] || {
		echo "Invalid choice." >&2
		return 1
	}
	((choice >= 1 && choice <= ${#opts[@]})) || {
		echo "Out of range." >&2
		return 1
	}
	USB="${opts[$((choice - 1))]}"
}

confirm_dd() {
	local iso="$1" dev="$2"
	echo
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "About to overwrite **entire disk** $dev"
	echo "ISO: $iso"
	echo "This erases all data on that device."
	if "$DO_PERSIST"; then
		echo "After dd: add persistence partition (+ persistence.conf with / union)."
	else
		echo "After dd: persistence step skipped (--no-persist)."
	fi
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	if [[ "$ASSUME_YES" != true ]]; then
		local w
		read -r -p "Type YES to continue: " w
		[[ "$w" == "YES" ]] || {
			echo "Aborted." >&2
			return 1
		}
		local w2
		read -r -p "Confirm device path (type $dev again): " w2
		[[ "$w2" == "$dev" ]] || {
			echo "Confirmation mismatch." >&2
			return 1
		}
	fi
	return 0
}

run_dd() {
	local iso="$1" dev="$2"
	need_root
	[[ -f "$iso" ]] || die "ISO not found: $iso"
	[[ -b "$dev" ]] || die "Not a block device: $dev"

	echo "Unmounting any partitions on $dev …"
	systemctl daemon-reload 2>/dev/null || true
	umount "${dev}"* 2>/dev/null || true

	echo "Writing ISO → $dev (bs=4M) …"
	dd if="$iso" of="$dev" bs=4M status=progress oflag=sync conv=fsync
	sync
	partprobe "$dev"
	sleep 1
	lsblk "$dev"
	echo "dd finished."
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

	confirm_dd "$ISO" "$USB" || exit 1
	run_dd "$ISO" "$USB"

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

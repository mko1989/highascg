#!/usr/bin/env bash
# Full pipeline: eggs produce → dd ISO → exFAT (slot 3, rest of disk) → seed layout.
#
# Default target disk: /dev/sda (override with --usb or USB_DEVICE=).
# ISO path: newest file under /home/eggs/ (+ mnt/) from this build (BASENAME prefix).
#
# Usage:
#   sudo bash tools/eggs/live-usb/build-produce-flash-stick.sh
#   sudo bash tools/eggs/live-usb/build-produce-flash-stick.sh -y
#   sudo bash tools/eggs/live-usb/build-produce-flash-stick.sh --build-only
#   sudo bash tools/eggs/live-usb/build-produce-flash-stick.sh --flash-only -y
#
# Options:
#   --usb /dev/sdX     Whole disk to overwrite (default: /dev/sda)
#   --build-only       Run build-highascg-egg.sh only
#   --flash-only       Skip build; flash newest matching ISO
#   --iso PATH         ISO for flash phase (default: ISO from latest build)
#   -y, --yes          Skip YES prompt before dd (still shows device summary)
#
# Env (build phase): BASENAME, NVIDIA_BRANCHES, SKIP_STRIP_HOST_SWAP
# Env (flash phase): PERSIST_SIZE_MIB, HIGHASCG_SERVICE_USER
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=flash-stick-common.sh
source "${HERE}/flash-stick-common.sh"

BUILD_SCRIPT="${HERE}/build-highascg-egg.sh"
FLASH_SCRIPT="${HERE}/create-operator-stick-from-dd.sh"

BASENAME="${BASENAME:-highascg}"
USB="${USB_DEVICE:-/dev/sda}"
ISO=""
DO_BUILD=true
DO_FLASH=true
ASSUME_YES=false

usage() {
	sed -n '2,22p' "$0" | tail -n +2
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		-h | --help) usage 0 ;;
		--build-only) DO_FLASH=false ;;
		--flash-only) DO_BUILD=false ;;
		--usb)
			USB="${2:?}"
			shift
			;;
		--iso)
			ISO="${2:?}"
			shift
			;;
		-y | --yes) ASSUME_YES=true ;;
		*)
			echo "Unknown option: $1" >&2
			usage 1
			;;
	esac
	shift
done

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo bash $0" >&2
	exit 1
}

REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"

BUILD_START_EPOCH=0
if "$DO_BUILD"; then
	BUILD_START_EPOCH=$(date +%s)
	# WO-432: stamp the produce so Updates shows the ISO build date. Without this,
	# clones report the ancient package.json-era .highascg-build-stamp (2026.05.20) —
	# only the GitHub-release flow ever wrote BUILD_STAMP, never eggs produce.
	# BUILD_STAMP outranks the legacy file (src/system/build-stamp.js) and is
	# deliberately NOT in the eggs exclude fragments, so it rides into the squashfs.
	PRODUCE_STAMP="$(date -u +%Y-%m-%d_%H%M%S)"
	echo "$PRODUCE_STAMP" >"${REPO_ROOT}/BUILD_STAMP"
	chown --reference="$REPO_ROOT" "${REPO_ROOT}/BUILD_STAMP" 2>/dev/null || true
	echo "==> BUILD_STAMP=${PRODUCE_STAMP}"
	echo "==> Phase 1/2: eggs produce (BASENAME=${BASENAME})"
	bash "$BUILD_SCRIPT"
	echo
	# WO-432 (owner 05.08): install-iso-defaults.sh prunes the LIVE repo's node_modules
	# to production for the squashfs — restore the dev tree immediately (not after the
	# flash phase, so --build-only and a failed flash still leave the box usable).
	echo "==> npm install (restore dev+optional node_modules after produce prune)"
	repo_user="$(stat -c %U "$REPO_ROOT")"
	runuser -u "$repo_user" -- bash -c "cd '$REPO_ROOT' && npm install --include=optional --no-audit --no-fund" \
		|| echo "WARN: node_modules restore failed — run 'npm install --include=optional' in $REPO_ROOT as $repo_user" >&2
	echo
fi

if "$DO_FLASH"; then
	[[ -b "$USB" ]] || {
		echo "Not a block device: $USB" >&2
		exit 1
	}
	typ=$(lsblk -ndo TYPE "$USB" 2>/dev/null || true)
	[[ "$typ" == disk ]] || {
		echo "Refusing $USB — expected whole disk (TYPE=disk), got TYPE=${typ:-?}" >&2
		exit 1
	}

	if [[ -z "$ISO" ]]; then
		if ((BUILD_START_EPOCH > 0)); then
			ISO="$(find_newest_iso_since "$BUILD_START_EPOCH" "$BASENAME")" || true
		fi
		[[ -n "$ISO" ]] || ISO="$(find_latest_iso)" || {
			echo "No ISO found — run build first or pass --iso" >&2
			exit 1
		}
	fi
	[[ -f "$ISO" ]] || {
		echo "ISO not found: $ISO" >&2
		exit 1
	}

	echo "==> Phase 2/2: flash + partition stick"
	echo "     DEVICE: $USB"
	echo "     ISO:    $ISO"
	echo

	if [[ "$ASSUME_YES" == true ]]; then
		bash "$FLASH_SCRIPT" -y "$USB" --iso "$ISO"
	else
		bash "$FLASH_SCRIPT" "$USB" --iso "$ISO"
	fi

	echo
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "Production stick ready on $USB"
	echo "  ISO:         $ISO"
	echo "  Boot:        default GRUB Live (persistence on kernel line in ISO)"
	echo "  Operator:    LABEL=HIGHASCGEXF (configs/, drop-update/, media/, …)"
	echo "  Verify:      bash tools/eggs/live-usb/verify-config-persistence.sh"
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi

if ! "$DO_BUILD" && ! "$DO_FLASH"; then
	echo "Nothing to do." >&2
	exit 1
fi

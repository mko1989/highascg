#!/usr/bin/env bash
# Invoked via pkexec from stick_studio.py — destructive USB / partition ops only.
set -euo pipefail

ACTION="${1:-}"
shift || true
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
# shellcheck source=../live-usb/flash-stick-common.sh
source "${REPO}/tools/eggs/live-usb/flash-stick-common.sh"

usage() {
	echo "Usage: sudo $0 flash <iso> <blockdev>" >&2
	echo "       sudo $0 exfat [--iso-path ISO] [--fill-disk] /dev/sdX" >&2
	echo "       sudo $0 partprobe </dev/sdX>" >&2
	exit 1
}

[[ "$(id -u)" -eq 0 ]] || {
	echo "This helper must run as root (use pkexec)." >&2
	exit 1
}

case "$ACTION" in
flash)
	iso="${1:?}"
	dev="${2:?}"
	run_dd_flash "$iso" "$dev"
	;;
exfat)
	ISO_ARG=""
	FILL_DISK=""
	dev=""
	while [[ $# -gt 0 ]]; do
		case "$1" in
		--iso-path)
			ISO_ARG="${2:?}"
			shift 2
			;;
		--fill-disk)
			FILL_DISK="1"
			shift
			;;
		*)
			dev="$1"
			shift
			;;
		esac
	done
	[[ -n "$dev" && -b "$dev" ]] || usage
	if [[ -n "$ISO_ARG" ]]; then
		export EXFAT_ISO_PATH="$ISO_ARG"
	else
		unset EXFAT_ISO_PATH || true
	fi
	[[ "$FILL_DISK" == "1" ]] && export EXFAT_FILL_DISK=1 || unset EXFAT_FILL_DISK || true
	bash "${REPO}/tools/eggs/live-usb/add-exfat-data-partition.sh" "$dev"
	;;
partprobe)
	dev="${1:?}"
	[[ -b "$dev" ]] || {
		echo "Not a block device: $dev" >&2
		exit 1
	}
	partprobe "$dev"
	sleep 1
	lsblk "$dev"
	;;
*) usage ;;
esac

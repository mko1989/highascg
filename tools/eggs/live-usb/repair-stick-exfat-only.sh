#!/usr/bin/env bash
# Fix a stick that already has union persistence: remove sda3 persistence, recreate exFAT on slot 3.
# Does NOT re-dd the ISO (keeps existing flash).
#
# Usage:
#   sudo bash tools/eggs/live-usb/repair-stick-exfat-only.sh /dev/sdX [--iso /path/to.iso]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV=""
ISO=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--iso)
			ISO="${2:?}"
			shift
			;;
		/dev/*) DEV="$1" ;;
		-h | --help)
			echo "Usage: sudo $0 /dev/sdX [--iso PATH]" >&2
			exit 0
			;;
		*) echo "Unknown: $1" >&2; exit 1 ;;
	esac
	shift
done

[[ -n "$DEV" ]] || {
	echo "Pass whole disk e.g. /dev/sda" >&2
	exit 1
}

ARGS=("$DEV")
[[ -n "$ISO" ]] && ARGS+=(--iso "$ISO")

export HIGHASCG_EXFAT_ONLY=1
export EXFAT_FILL_DISK=1

echo "==> Repair $DEV → exFAT-only (removes LABEL=persistence, recreates HIGHASCGEXF on slot 3)"
bash "${HERE}/finish-operator-stick.sh" "${ARGS[@]}"
lsblk -f "$DEV"

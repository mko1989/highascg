#!/usr/bin/env bash
# Create a primary partition in an explicit MBR slot (3=persistence, 4=exFAT on isohybrid sticks).
# Usage: usb-mkpart-numbered.sh /dev/sdX PARTNUM ext4|exfat START_MIB END_MIB
#
# isohybrid USB sticks use an msdos table: use sfdisk (parted cannot assign slot 3/4 here;
# sgdisk breaks hybrid layouts). Preserves existing /dev/sdXN entries from sfdisk -d.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=usb-env.sh
source "${HERE}/usb-env.sh"
# shellcheck source=flash-stick-common.sh
source "${HERE}/flash-stick-common.sh"

DEV="${1:?}"
NUM="${2:?}"
FSTYPE="${3:?}"
STARTMIB="${4:?}"
ENDMIB="${5:?}"
STARTMIB="${STARTMIB%%.*}"
ENDMIB="${ENDMIB%%.*}"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Must run as root (sudo)." >&2
	exit 1
}
[[ "$NUM" -ge 1 && "$NUM" -le 4 ]] || {
	echo "PARTNUM must be 1–4 (use 3=persistence, 4=exFAT on isohybrid sticks)." >&2
	exit 1
}
if [[ "$NUM" -eq 1 ]]; then
	echo "Refusing MBR slot 1 — isohybrid boot uses partition table entry 1." >&2
	exit 1
fi

[[ "$ENDMIB" -gt "$STARTMIB" ]] || {
	echo "Invalid range ${STARTMIB}–${ENDMIB} MiB" >&2
	exit 1
}

command -v sfdisk >/dev/null 2>&1 || {
	echo "sfdisk required (install util-linux)." >&2
	exit 1
}

PTTYPE=""
PTTYPE="$("$PARTED" -s "$DEV" print 2>/dev/null | awk -F': ' '/^Partition Table:/ {print $2; exit}')" || true
PTTYPE="${PTTYPE:-msdos}"

echo "mkpart slot ${NUM} on ${DEV}: ${STARTMIB}–${ENDMIB} MiB (${FSTYPE}, table=${PTTYPE})" >&2

case "$FSTYPE" in
	ext4) TYP_ID="83" ;;
	exfat) TYP_ID="07" ;;
	*)
		echo "Unknown FSTYPE: $FSTYPE" >&2
		exit 1
		;;
esac

START_SEC=$((STARTMIB * 2048))
SIZE_SEC=$(((ENDMIB - STARTMIB) * 2048))
PART_NODE="${DEV}${NUM}"

if [[ "$PTTYPE" == "gpt" ]] && command -v sgdisk >/dev/null 2>&1; then
	END_SEC=$((ENDMIB * 2048 - 1))
	sgdisk -n "${NUM}:${START_SEC}:${END_SEC}" -t "${NUM}:8300" "$DEV" 2>/dev/null || \
		sgdisk -n "${NUM}:${START_SEC}:${END_SEC}" -t "${NUM}:0700" "$DEV"
else
	# Only touch MBR slot NUM. A full `sfdisk <dump>` re-validates every entry and
	# rejects the isohybrid layout (ESP slot 2 overlaps ISO slot 1 → "No space left").
	if [[ -b "$PART_NODE" ]]; then
		echo "sfdisk: clearing prior slot ${NUM} (${PART_NODE})…" >&2
		sfdisk --delete "$DEV" "$NUM" 2>/dev/null || true
		partprobe "$DEV" 2>/dev/null || true
		sleep 1
	fi
	echo "sfdisk: applying slot ${NUM} (${PART_NODE})…" >&2
	printf 'start=%s, size=%s, type=%s\n' "$START_SEC" "$SIZE_SEC" "$TYP_ID" | \
		sfdisk --force -w never -W never -N "$NUM" "$DEV" || {
		echo "sfdisk -N ${NUM} failed; current layout:" >&2
		sfdisk -l "$DEV" >&2 || true
		exit 1
	}
fi

sync
# Kernel may return EBUSY on isohybrid sticks; retry until ${DEV}${NUM} appears.
for _try in 1 2 3 4 5 6 7 8 9 10; do
	blockdev --flushbufs "$DEV" 2>/dev/null || true
	blockdev --rereadpt "$DEV" 2>/dev/null || true
	partprobe "$DEV" 2>/dev/null || true
	partx -u "$DEV" 2>/dev/null || partx --update "$DEV" 2>/dev/null || true
	udevadm settle --timeout=15 2>/dev/null || true
	[[ -b "$PART_NODE" ]] && break
	sleep 1
done

if [[ ! -b "$PART_NODE" ]]; then
	echo "Partition node ${PART_NODE} missing after sfdisk; current layout:" >&2
	sfdisk -l "$DEV" >&2 || true
	timeout 15 "$PARTED" -s "$DEV" unit MiB print >&2 || true
	usb_lsblk_safe "$DEV" 5 >&2 || true
	exit 1
fi
# stdout is only the device path (callers capture with $(...)).
echo "$PART_NODE"

#!/usr/bin/env bash
# Print MBR sector numbers for exFAT after a hybrid ISO (read-only — does not change the disk).
#
# Usage:
#   bash client/tools/live-usb/macos/calc-exfat-mbr-sectors.sh disk2
#   EXFAT_START_MIB=7168 bash client/tools/live-usb/macos/calc-exfat-mbr-sectors.sh disk2
#
set -euo pipefail

DISK=${1:-}
[[ -n "$DISK" ]] || {
	echo "Usage: bash $0 diskN   (e.g. disk2 from: diskutil list external physical)" >&2
	exit 1
}
DISK=${DISK#/dev/}
DISK=${DISK#dev/}

START_MIB="${EXFAT_START_MIB:-6144}"
START_SEC=$((START_MIB * 2048))

BYTES=$(python3 -c "
import plistlib, subprocess, sys
disk = sys.argv[1]
pl = plistlib.loads(subprocess.check_output(['diskutil', 'info', '-plist', disk]))
for key in ('TotalSize', 'Size', 'DiskSize'):
    v = pl.get(key)
    if isinstance(v, int) and v > 0:
        print(v)
        break
else:
    print(0)
" "/dev/${DISK}")

[[ "$BYTES" -gt 0 ]] || {
	echo "Could not read disk size for ${DISK}." >&2
	exit 1
}

END_SEC=$((BYTES / 512 - 1))
SIZE_SEC=$((END_SEC - START_SEC + 1))

if [[ "$SIZE_SEC" -le 0 ]]; then
	echo "START sector ${START_SEC} is past end of disk (${END_SEC}). Lower EXFAT_START_MIB." >&2
	exit 1
fi

echo "Disk:        ${DISK}  (${BYTES} bytes)"
echo "ISO margin:  start exFAT at ${START_MIB} MiB"
echo "START_SECTOR=${START_SEC}    # fdisk: edit last free MBR slot (often 4), sector mode"
echo "END_SECTOR=${END_SEC}        # last sector of the new partition"
echo "SIZE_SECTORS=${SIZE_SEC}"

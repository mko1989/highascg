#!/usr/bin/env bash
# Add exFAT volume HIGHASCGEXF on a hybrid-ISO USB (MBR / FDisk_partition_scheme).
#
# Uses macOS built-in tools only (no Homebrew parted — not available on macOS).
# Launcher guide documents the same steps manually with fdisk -e.
#
# Usage: sudo bash client/tools/live-usb/macos/add-highascg-exfat-mbr.sh disk2
#
set -euo pipefail

EXFAT_LABEL="${EXFAT_LABEL:-HIGHASCGEXF}"
SAFE_START_MIB="${EXFAT_START_MIB:-6144}"

usage() {
	echo "Usage: sudo $0 diskN   (whole USB, e.g. disk2 from: diskutil list external physical)" >&2
	exit 1
}

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run with sudo." >&2
	exit 1
}
[[ $# -eq 1 ]] || usage

DISK=$1
DISK=${DISK#/dev/}
DISK=${DISK#dev/}
[[ "$DISK" == disk* ]] || usage
[[ "$DISK" == *s[0-9]* ]] && {
	echo "Pass the whole disk (diskN), not a slice (${DISK})." >&2
	exit 1
}

DISK_DEV="/dev/${DISK}"
RDISK_DEV="/dev/r${DISK}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Layout before:"
diskutil list "$DISK_DEV" || true

echo ""
echo "==> Sector layout (ISO-safe start ${SAFE_START_MIB} MiB):"
EXFAT_START_MIB=$SAFE_START_MIB bash "$HERE/calc-exfat-mbr-sectors.sh" "$DISK"

echo ""
echo "==> Unmounting ${DISK} …"
diskutil unmountDisk "$DISK_DEV" || true

echo ""
echo "==> Writing MBR entry for exFAT (built-in — no parted) …"
EXFAT_START_MIB=$SAFE_START_MIB python3 - "$RDISK_DEV" <<'PY'
import plistlib, struct, subprocess, sys

rdisk = sys.argv[1]
disk = rdisk.replace("/dev/r", "/dev/", 1)
start_mib = int(__import__("os").environ.get("EXFAT_START_MIB", "6144"))
start_sec = start_mib * 2048

disk_id = rdisk.rsplit("/", 1)[-1].lstrip("r")
pl = plistlib.loads(subprocess.check_output(["diskutil", "info", "-plist", f"/dev/{disk_id}"]))
total = 0
for key in ("TotalSize", "Size", "DiskSize"):
    v = pl.get(key)
    if isinstance(v, int) and v > 0:
        total = v
        break
if total <= 0:
    raise SystemExit("Could not read disk size from diskutil")

end_sec = total // 512 - 1
size_sec = end_sec - start_sec + 1
if size_sec <= 0:
    raise SystemExit(f"Start sector {start_sec} is past end of disk")

def lba_to_chs(lba: int) -> bytes:
    heads, spt = 255, 63
    cyl = lba // (heads * spt)
    if cyl >= 1024:
        return bytes([254, 255, 255])
    head = (lba // spt) % heads
    sector = (lba % spt) + 1
    return bytes([head, ((cyl >> 2) & 0xC0) | (sector & 0x3F), cyl & 0xFF])

with open(rdisk, "r+b", buffering=0) as f:
    mbr = bytearray(f.read(512))
    if mbr[510:512] != b"\x55\xAA":
        raise SystemExit("No MBR signature at byte 510 — refusing.")
    slot = None
    for i in range(4):
        off = 446 + i * 16
        if mbr[off + 4] == 0:
            slot = i
            break
    if slot is None:
        raise SystemExit("No free MBR primary slot (4/4 used).")
    off = 446 + slot * 16
    mbr[off] = 0x00
    mbr[off + 1 : off + 4] = lba_to_chs(start_sec)
    mbr[off + 4] = 0x07
    mbr[off + 5 : off + 8] = lba_to_chs(end_sec)
    struct.pack_into("<I", mbr, off + 8, start_sec)
    struct.pack_into("<I", mbr, off + 12, size_sec)
    f.seek(0)
    f.write(mbr)
    f.flush()
    __import__("os").fsync(f.fileno())

print(f"MBR slot {slot + 1}: type 0x07, start {start_sec}, size {size_sec} sectors")
PY

sleep 2
echo ""
echo "==> Layout after MBR update:"
diskutil list "$DISK_DEV" || true

SLICE=$(diskutil list -plist "$DISK_DEV" | python3 -c "
import plistlib, sys
pl = plistlib.load(sys.stdin.buffer)
parts = pl.get('Partitions') or []
nums = [p.get('PartitionNumber', 0) for p in parts if isinstance(p.get('PartitionNumber'), int)]
print(f\"${DISK}s{max(nums)}\" if nums else '')
")

if [[ -z "$SLICE" ]]; then
	echo "Could not detect new slice on ${DISK}. Check diskutil list and run:" >&2
	echo "  sudo newfs_exfat -v ${EXFAT_LABEL} /dev/r${SLICE}" >&2
	exit 1
fi

echo ""
echo "==> Format ${SLICE} as exFAT (${EXFAT_LABEL}) …"
RSLICE="/dev/r${SLICE}"
if ! newfs_exfat -v "$EXFAT_LABEL" "$RSLICE" 2>/dev/null; then
	# eraseVolume often fails (-5343) on fdisk-only MBR entries; newfs_exfat is reliable.
	if ! diskutil eraseVolume ExFAT "$EXFAT_LABEL" "$SLICE" 2>/dev/null; then
		echo "Format failed. Run manually:" >&2
		echo "  sudo newfs_exfat -v ${EXFAT_LABEL} ${RSLICE}" >&2
		exit 1
	fi
fi
diskutil mount "$SLICE" 2>/dev/null || true

echo ""
echo "==> Seeding folders under /Volumes/${EXFAT_LABEL}"
VOL="/Volumes/${EXFAT_LABEL}"
for _ in $(seq 1 40); do
	[[ -d "$VOL" ]] && break
	sleep 0.25
done
if [[ ! -d "$VOL" ]]; then
	for try in "/Volumes/${EXFAT_LABEL}"*; do
		[[ -d "$try" ]] || continue
		VOL=$try
		break
	done
fi
if [[ -d "$VOL" && "$(basename "$VOL")" != "$EXFAT_LABEL" ]]; then
	diskutil rename "$(basename "$VOL")" "$EXFAT_LABEL" 2>/dev/null && VOL="/Volumes/${EXFAT_LABEL}" || true
fi
[[ -d "$VOL" ]] || {
	echo "Volume not mounted at ${VOL} — open Disk Utility or re-plug the stick." >&2
	exit 0
}
mkdir -p "$VOL/sim/highascg" "$VOL/drop-config" "$VOL/media" "$VOL/templates" "$VOL/configs" "$VOL/snapshots/rear-panels"
echo "Done. Copy release to ${VOL}/sim/highascg (package.json at root of that folder)."

#!/usr/bin/env bash
# LEGACY: Add Debian Live union persistence (/ union) after flashing an ISO with dd.
# Removed from default operator workflow — use finish-operator-stick.sh (exFAT-only).
# Set HIGHASCG_LEGACY_UNION_PERSIST=1 to run this script intentionally.
#
# Add Debian Live union persistence (/ union) after flashing an ISO with dd/gnome-disks.
# Default workflow for HighAsCG USB sticks — keeps /home/casparcg/highascg + rest of writable root.
#
# Usage:
#   sudo bash tools/live-usb/add-union-persistence-partition.sh [/dev/sdX]
#   sudo bash tools/live-usb/add-union-persistence-partition.sh --dry-run [/dev/sdX]
# Omit /dev/sdX to use DEVICE= from tools/live-usb/flash-iso.conf (override path: FLASH_ISO_CONF).
#
# Optional env:
#   PERSIST_SIZE_MIB=4096     — fixed overlay size (default 4 GiB; not the whole tail)
#   PERSIST_ISO_PATH / EXFAT_ISO_PATH — ISO file for safe start after hybrid image
#   PERSIST_AFTER_ISO_MARGIN_MIB / EXFAT_AFTER_ISO_MARGIN_MIB — default 1536
#
# Run **before** add-exfat-data-partition.sh on production sticks (exFAT then fills the rest).
#
# Requires: parted util-linux blkid mount
set -euo pipefail

DRY=false
DEV=""

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=usb-env.sh
source "${HERE}/usb-env.sh"
MKPART_SH="${HERE}/usb-mkpart-numbered.sh"
RESTORE_ESP_SH="${HERE}/usb-restore-esp-flags.sh"
SLOTS_PY="${HERE}/usb-partition-slots.py"

usage() {
  echo "Usage: sudo $0 [--dry-run] [/dev/sdX]" >&2
  echo "If /dev/sdX is omitted, reads DEVICE= from tools/live-usb/flash-iso.conf (or FLASH_ISO_CONF)." >&2
  echo "Adds ext4 labelled 'persistence' + persistence.conf with '/ union'" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || { echo "Must run as root (sudo)." >&2; exit 1; }

if [[ "${HIGHASCG_LEGACY_UNION_PERSIST:-0}" != "1" ]]; then
	echo "Union persistence partitions were removed from HighAsCG (exFAT-only operator sticks)." >&2
	echo "Use: sudo bash tools/eggs/live-usb/finish-operator-stick.sh /dev/sdX --iso /path/to.iso" >&2
	echo "To force this legacy script: HIGHASCG_LEGACY_UNION_PERSIST=1 sudo $0 …" >&2
	exit 2
fi
export HIGHASCG_EXFAT_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=true; shift ;;
    -h|--help) usage ;;
    *) DEV="$1"; shift ;;
  esac
done

if [[ -z "$DEV" ]]; then
  CONF_PATH="${FLASH_ISO_CONF:-$HERE/flash-iso.conf}"
  if [[ ! -f "$CONF_PATH" ]]; then
    echo "No device argument and no $CONF_PATH — pass /dev/sdX or copy flash-iso.conf.example." >&2
    usage
  fi
  # shellcheck source=flash-iso-conf-lib.sh
  source "${HERE}/flash-iso-conf-lib.sh"
  DEV="$(flash_iso_read_device "$CONF_PATH")"
  echo "Using DEVICE from ${CONF_PATH} → ${DEV}" >&2
fi

[[ -n "$DEV" ]] || usage

[[ -b "$DEV" ]] || { echo "Not a block device: $DEV" >&2; exit 1; }
while read -r pt; do
	[[ -n "$pt" ]] || continue
	if findmnt -n "$pt" &>/dev/null; then
		echo "Refusing: $pt is mounted. Unmount first." >&2
		findmnt "$pt"
		exit 1
	fi
done < <(lsblk -nrpo PATH "$DEV")

calc_start_python() {
  python3 - "$DEV" <<'PY'
import os
import subprocess, sys, math, re

import shutil

parted = os.environ.get("PARTED") or shutil.which("parted") or "/usr/sbin/parted"
PARTED_ENV = {**os.environ, "LC_ALL": "C"}


def to_mib(s: str) -> float:
    s = s.strip()
    m = re.match(r'^([\d.]+)\s*(KiB|MiB|GiB|kB|MB|GB)$', s)
    if not m:
        raise ValueError(f"unexpected size {s!r}")
    v = float(m.group(1))
    u = m.group(2)
    if u in ("KiB", "kB"):
        return v / 1024.0
    if u in ("MiB", "MB"):
        return v
    return v * 1024.0


def split_fields(line):
    return [p.strip() for p in line.rstrip(";").strip().split(":")]


def disk_mib_from_print(dev):
    out = subprocess.check_output(
        [parted, "-sm", dev, "unit", "MiB", "print"],
        text=True,
        env=PARTED_ENV,
    ).strip().splitlines()
    for line in out:
        if not line or line.strip() == "BYT":
            continue
        parts = split_fields(line)
        if parts and parts[0].startswith("/") and len(parts) > 1 and "MiB" in parts[1]:
            try:
                return to_mib(parts[1])
            except ValueError:
                return None
    return None


def max_partition_end_mib(dev):
    """Largest end coordinate of any numbered partition row (strip fields — leading spaces break isdigit())."""
    out = subprocess.check_output(
        [parted, "-sm", dev, "unit", "MiB", "print"],
        text=True,
        env=PARTED_ENV,
    ).strip().splitlines()
    max_end = 1.0
    for line in out:
        if not line or line.strip() == "BYT":
            continue
        parts = split_fields(line)
        if parts and parts[0].startswith("/"):
            continue
        if parts and parts[0].isdigit() and len(parts) >= 3:
            try:
                end_mib = to_mib(parts[2])
                max_end = max(max_end, end_mib)
            except ValueError:
                continue
    return max_end


def logical_bs(dev):
    base = os.path.basename(os.path.realpath(dev))
    p = f"/sys/block/{base}/queue/logical_block_size"
    try:
        with open(p) as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return 512


def max_partition_end_mib_sysfs(dev):
    base = os.path.basename(os.path.realpath(dev))
    sysdir = f"/sys/block/{base}"
    if not os.path.isdir(sysdir):
        return 0.0
    sec = logical_bs(dev)
    max_byte = 0.0
    for ent in os.listdir(sysdir):
        if ent == base or not ent.startswith(base):
            continue
        suffix = ent[len(base) :]
        if not suffix.isdigit():
            continue
        try:
            with open(os.path.join(sysdir, ent, "start")) as f:
                start = int(f.read().strip())
            with open(os.path.join(sysdir, ent, "size")) as f:
                size = int(f.read().strip())
        except (OSError, ValueError):
            continue
        if size <= 0:
            continue
        max_byte = max(max_byte, float(start + size) * float(sec))
    return max_byte / (1024.0 * 1024.0)


def snapshot_partition_flags(dev):
    out = subprocess.check_output(
        [parted, "-sm", dev, "unit", "MiB", "print"],
        text=True,
        env=PARTED_ENV,
    ).strip().splitlines()
    rows = []
    for line in out:
        parts = split_fields(line)
        if not parts or not parts[0].isdigit():
            continue
        flags = parts[6] if len(parts) > 6 else ""
        if not flags:
            continue
        for raw in flags.split(","):
            fl = raw.strip()
            if fl:
                rows.append((int(parts[0]), fl))
    return rows


dev = sys.argv[1]
min_persist_mib = float(os.environ.get("MIN_PERSIST_MIB", "512"))
persist_size_mib = float(os.environ.get("PERSIST_SIZE_MIB", "4096"))

disk_mib = disk_mib_from_print(dev)
if disk_mib is None:
    print("Could not read disk size from parted -sm print.", file=sys.stderr)
    sys.exit(2)

parted_max = max_partition_end_mib(dev)
sys_max = max_partition_end_mib_sysfs(dev)
max_end = max(parted_max, sys_max)
if sys_max > parted_max + 1.0:
    print(
        f"Note: sysfs last-partition end {sys_max:.1f} MiB > parted {parted_max:.1f} MiB — "
        "using the larger value so persistence is not placed inside the hybrid ISO.",
        file=sys.stderr,
    )

gap = disk_mib - max_end - 2

# IMPORTANT (isohybrid): `parted print free` often shows a huge "Free Space" band
# starting just after the ESP (~16 MiB) even though MBR partition 1 still covers the
# whole ISO image (~5 GiB). Starting persistence there overlaps the live image and
# breaks boot. Always place the new partition strictly after the furthest partition end
# (parted and sysfs — use the max of both).
if gap < min_persist_mib:
    print(
        f"No usable space >= {min_persist_mib:.0f} MiB after last partition end ({max_end:.1f} MiB) "
        f"on a {disk_mib:.1f} MiB disk).\n"
        f"Use a USB larger than the ISO image, or set START_MIB manually "
        f"(see tools/live-usb/FLASH_AND_PERSIST.md).",
        file=sys.stderr,
    )
    sys.exit(3)

start_mib = math.ceil(max_end + 1)

iso_path = (
    os.environ.get("PERSIST_ISO_PATH", "").strip()
    or os.environ.get("EXFAT_ISO_PATH", "").strip()
)
if iso_path:
    try:
        iso_sz = os.path.getsize(iso_path)
    except OSError as e:
        print(f"PERSIST_ISO_PATH/EXFAT_ISO_PATH unreadable ({iso_path}): {e}", file=sys.stderr)
        sys.exit(8)
    margin_mib = float(
        os.environ.get(
            "PERSIST_AFTER_ISO_MARGIN_MIB",
            os.environ.get("EXFAT_AFTER_ISO_MARGIN_MIB", "1536"),
        )
    )
    iso_mib_ceil = math.ceil(iso_sz / float(1024 * 1024))
    # sysfs already reflects the hybrid ISO extent → small tail only (large margin is for
    # broken parted layouts that stop at the ESP).
    if sys_max >= iso_mib_ceil - 64:
        tail_mib = float(
            os.environ.get(
                "PERSIST_AFTER_ISO_TAIL_MIB",
                os.environ.get("EXFAT_AFTER_ISO_TAIL_MIB", "64"),
            )
        )
        iso_floor = iso_mib_ceil + tail_mib
        margin_note = f"{tail_mib:.0f} MiB tail"
    else:
        iso_floor = iso_mib_ceil + margin_mib
        margin_note = f"{margin_mib:.0f} MiB margin"
    if iso_floor > start_mib:
        print(
            f"Note: persistence starts at {iso_floor:.0f} MiB (ISO ceil + {margin_note}) "
            f"instead of hybridextent {math.ceil(max_end + 1):.0f} MiB.",
            file=sys.stderr,
        )
        start_mib = iso_floor

start_mib = int(math.ceil(start_mib))
end_mib = start_mib + persist_size_mib
if end_mib > disk_mib - 2:
    end_mib = disk_mib - 2

if end_mib - start_mib < min_persist_mib:
    print(
        f"Persistence slice too small ({end_mib - start_mib:.1f} MiB). "
        f"Lower PERSIST_SIZE_MIB or use a larger USB.",
        file=sys.stderr,
    )
    sys.exit(4)

min_exfat_tail = float(os.environ.get("MIN_EXFAT_TAIL_MIB", "256"))
if disk_mib - end_mib - 2 < min_exfat_tail:
    print(
        f"Not enough space after {persist_size_mib:.0f} MiB persistence for exFAT "
        f"(need >= {min_exfat_tail:.0f} MiB tail on {disk_mib:.1f} MiB disk).",
        file=sys.stderr,
    )
    sys.exit(5)

print(f"{start_mib} {end_mib}")
for num, fl in snapshot_partition_flags(dev):
    print(f"F\t{num}\t{fl}")
PY
}

calc_start_legacy() {
  # User can export START_MIB (integer MiB) from: parted "$DEV" unit MiB print free
  if [[ -n "${START_MIB+x}" && "${START_MIB:-}" != "" ]]; then
    printf '%s' "$START_MIB"
    return
  fi
  echo "Unable to derive start MiB automatically; install python3," >&2
  echo "or set START_MIB (see parted \"$DEV\" unit MiB print free) and rerun." >&2
  exit 5
}

if command -v python3 >/dev/null 2>&1; then
  META=$(mktemp)
  trap 'rm -f "$META"' EXIT
  calc_start_python >"$META" || exit $?
  read -r STARTMIB ENDMIB < <(head -n1 "$META")
else
  META=""
  STARTMIB="$(calc_start_legacy)" || exit $?
  ENDMIB=$((STARTMIB + ${PERSIST_SIZE_MIB:-4096}))
fi

PERSIST_SIZE_MIB="${PERSIST_SIZE_MIB:-4096}"
read -r PERSIST_NUM _EXFAT_NUM < <(python3 "$SLOTS_PY" "$DEV")
echo "Disk $DEV → MBR slot ${PERSIST_NUM} persistence ${STARTMIB}–${ENDMIB} MiB (/ union; slot 1=ISO slot 2=ESP)"

if [[ "$DRY" == true ]]; then
  echo "[dry-run] would run: usb-mkpart-numbered.sh slot ${PERSIST_NUM} ; mkfs.ext4 -L persistence"
  exit 0
fi

LASTPART="$(bash "$MKPART_SH" "$DEV" "$PERSIST_NUM" ext4 "$STARTMIB" "$ENDMIB" | tail -n1)"
FALLBACK_PART="${DEV}${PERSIST_NUM}"
if [[ -z "$LASTPART" || ! -b "$LASTPART" ]]; then
  if [[ -b "$FALLBACK_PART" ]]; then
    echo "Note: using ${FALLBACK_PART} (mkpart output was not a single device path)." >&2
    LASTPART="$FALLBACK_PART"
  fi
fi
bash "$RESTORE_ESP_SH" "$DEV"

if [[ -n "${META:-}" ]] && [[ "$(wc -l <"$META")" -gt 1 ]]; then
  while IFS=$'\t' read -r tag partnum flg; do
    [[ "$tag" == "F" ]] || continue
    "$PARTED" -s "$DEV" set "$partnum" "$flg" on 2>/dev/null || true
  done < <(tail -n +2 "$META")
  bash "$RESTORE_ESP_SH" "$DEV"
fi

if [[ -z "$LASTPART" || ! -b "$LASTPART" ]]; then
  echo "Could not resolve persistence partition (slot ${PERSIST_NUM}) under $DEV." >&2
  lsblk "$DEV"
  exit 6
fi

echo "Formatting $LASTPART → ext4 LABEL=persistence"
wipefs -a "$LASTPART" 2>/dev/null || true
mkfs.ext4 -F -L persistence "$LASTPART"

MP=$(mktemp -d /tmp/highascg-persist.XXXXXX)
mount "$LASTPART" "$MP"
echo '/ union' >"$MP/persistence.conf"
sync
umount "$MP"
rmdir "$MP" 2>/dev/null || true

echo "Done. LABEL=persistence at $LASTPART contains persistence.conf (/ union)."
echo "Boot GRUB → **Live with persistence** so /home/casparcg/highascg survives reboot."

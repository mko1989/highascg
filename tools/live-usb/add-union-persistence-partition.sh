#!/usr/bin/env bash
# Add Debian Live union persistence (/ union) after flashing an ISO with dd/gnome-disks.
# Default workflow for HighAsCG USB sticks — keeps /home/casparcg/highascg + rest of writable root.
#
# Usage:
#   sudo bash tools/live-usb/add-union-persistence-partition.sh /dev/sdX
#   sudo bash tools/live-usb/add-union-persistence-partition.sh --dry-run /dev/sdX
#
# Requires: parted util-linux blkid mount
set -euo pipefail

DRY=false
DEV=""

usage() {
  echo "Usage: sudo $0 [--dry-run] /dev/sdX" >&2
  echo "Adds ext4 labelled 'persistence' + persistence.conf with '/ union'" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || { echo "Must run as root (sudo)." >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=true; shift ;;
    -h|--help) usage ;;
    *) DEV="$1"; shift ;;
  esac
done

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
import subprocess, sys, math, re

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

dev = sys.argv[1]
out = subprocess.check_output(["parted", "-sm", dev, "unit", "MiB", "print"], text=True).strip().splitlines()
disk_mib = None
max_end = 1.0
for line in out:
    line = line.rstrip(";").strip()
    if not line or line == "BYT":
        continue
    parts = line.split(":")
    if parts and parts[0].startswith("/") and len(parts) > 1 and "MiB" in parts[1]:
        try:
            disk_mib = to_mib(parts[1])
        except ValueError:
            pass
        continue
    # partition row: num : start : end : size : fstype ...
    if parts and parts[0].isdigit() and len(parts) >= 3:
        try:
            end_mib = to_mib(parts[2])
            max_end = max(max_end, end_mib)
        except ValueError:
            continue

if disk_mib is None:
    print("", file=sys.stderr)
    sys.exit(2)

gap = disk_mib - max_end
# reserve ~2 MiB at end for alignment / GPT backup margin
gap -= 2
min_persist_mib = 512
if gap < min_persist_mib:
    print(
        f"Only {gap:.1f} MiB free after last partition "
        f"(need >= {min_persist_mib} MiB for persistence). Larger USB or reclaim space.",
        file=sys.stderr,
    )
    sys.exit(3)

start_mib = math.ceil(max_end + 1)
if start_mib + min_persist_mib > disk_mib - 2:
    print("Cannot fit persistence safely; check parted layout.", file=sys.stderr)
    sys.exit(4)

print(f"{start_mib}")
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
  STARTMIB="$(calc_start_python)" || exit $?
else
  STARTMIB="$(calc_start_legacy)" || exit $?
fi

echo "Disk $DEV → persistence partition starts at ${STARTMIB} MiB (/ union)"

if [[ "$DRY" == true ]]; then
  echo "[dry-run] would run: parted mkpart … ; mkfs.ext4 -L persistence … ; persistence.conf"
  exit 0
fi

echo "Creating partition (${STARTMIB}MiB … 100%)"
parted -s "$DEV" unit MiB mkpart primary ext4 "${STARTMIB}MiB" 100%
partprobe "$DEV"
sleep 1

BASE="${DEV#/dev/}"
PN=$(lsblk -nrpo NAME "$DEV" | awk -v b="$BASE" '$1 != b { print $1 }' | sort -V | tail -1)
LASTPART=""
if [[ -n "$PN" ]]; then
	LASTPART="/dev/$PN"
fi

if [[ -z "$LASTPART" || "$LASTPART" == "$DEV" ]]; then
  echo "Could not resolve new partition under $DEV; check parted manually." >&2
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

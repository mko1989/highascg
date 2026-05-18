#!/usr/bin/env bash
# Add exFAT data partition (LABEL=HIGHASCGEXF) after the last existing partition — hybrid ISO safe
# used by add-union-persistence-partition.sh (never start from bogus "free space" after ESP only).
#
# Usage:
#   sudo bash tools/live-usb/add-exfat-data-partition.sh [/dev/sdX]
#   sudo bash tools/live-usb/add-exfat-data-partition.sh --dry-run [/dev/sdX]
# Omit /dev/sdX to use DEVICE= from tools/live-usb/flash-iso.conf (override path: FLASH_ISO_CONF).
#
# Optional: EXFAT_ISO_PATH + EXFAT_AFTER_ISO_MARGIN_MIB — never place exFAT before ceil(ISO MiB)+margin (safe gap after dd).
# Optional: EXFAT_LABEL (≤11 chars; default HIGHASCGEXF matches systemd WO-47).
#
# Requires: parted util-linux blkid mkfs.exfat (exfatprogs) python3 wipefs
set -euo pipefail

DRY=false
DEV=""

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
	echo "Usage: sudo $0 [--dry-run] [/dev/sdX]" >&2
	echo "If /dev/sdX is omitted, reads DEVICE= from tools/live-usb/flash-iso.conf (or FLASH_ISO_CONF)." >&2
	echo "Creates a primary exFAT partition after the last MBR partition (LABEL=HIGHASCGEXF)." >&2
	echo "Default size EXFAT_SIZE_MIB=4096 so add-union-persistence-partition.sh can use the tail." >&2
	echo "ExFAT-only stick: EXFAT_FILL_DISK=1 sudo $0 /dev/sdX" >&2
	exit 1
}

[[ "$(id -u)" -eq 0 ]] || {
	echo "Must run as root (sudo)." >&2
	exit 1
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--dry-run) DRY=true; shift ;;
		-h | --help) usage ;;
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

[[ -b "$DEV" ]] || {
	echo "Not a block device: $DEV" >&2
	exit 1
}
while read -r pt; do
	[[ -n "$pt" ]] || continue
	if findmnt -n "$pt" &>/dev/null; then
		echo "Refusing: $pt is mounted. Unmount first." >&2
		findmnt "$pt"
		exit 1
	fi
done < <(lsblk -nrpo PATH "$DEV")

command -v mkfs.exfat >/dev/null 2>&1 || {
	echo "Missing mkfs.exfat (install package exfatprogs on Debian/Ubuntu)." >&2
	exit 1
}

EXFAT_LABEL="${EXFAT_LABEL:-HIGHASCGEXF}"
if [[ "${#EXFAT_LABEL}" -gt 11 ]]; then
	echo "exFAT volume labels are at most 11 characters (got ${#EXFAT_LABEL}: \"$EXFAT_LABEL\")." >&2
	echo "WO-47 expects HIGHASCGEXF (a longer human name like \"highascg-data\" does not fit on exFAT)." >&2
	exit 1
fi

calc_exfat_layout() {
	python3 - "$DEV" <<'PY'
import os
import subprocess, sys, math, re

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
		["parted", "-sm", dev, "unit", "MiB", "print"],
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


def partition_table_type(dev):
	out = subprocess.check_output(["parted", "-sm", dev, "print"], text=True, env=PARTED_ENV).strip().splitlines()
	for line in out:
		parts = split_fields(line)
		if parts and parts[0].startswith("/") and len(parts) >= 6:
			return parts[5]
	return ""


def max_partition_end_mib(dev):
	out = subprocess.check_output(
		["parted", "-sm", dev, "unit", "MiB", "print"],
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
	"""Largest byte-offset end of any existing partition (kernel sysfs).

	Hybrid ISO layouts sometimes show a too-small last end in `parted` while
	sysfs still reflects the real ISO extent — using max(parted, sysfs) avoids
	placing exFAT inside the live image (which bricks the stick).
	"""
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


def count_primary_partitions(dev):
	out = subprocess.check_output(["parted", "-sm", dev, "print"], text=True, env=PARTED_ENV).strip().splitlines()
	n = 0
	for line in out:
		if not line or line.strip() == "BYT":
			continue
		parts = split_fields(line)
		if parts and parts[0].isdigit():
			n += 1
	return n


def snapshot_partition_flags(dev):
	out = subprocess.check_output(
		["parted", "-sm", dev, "unit", "MiB", "print"],
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
min_exfat_mib = float(os.environ.get("MIN_EXFAT_MIB", "256"))
exfat_size_mib = float(os.environ.get("EXFAT_SIZE_MIB", "4096"))
fill_disk = os.environ.get("EXFAT_FILL_DISK", "").strip().lower() in ("1", "true", "yes")

pttype = partition_table_type(dev)
if pttype == "msdos" and count_primary_partitions(dev) >= 4:
	print("MBR already has 4 primary partitions — cannot add another.", file=sys.stderr)
	sys.exit(7)

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
		"using the larger value so exFAT is not placed inside the hybrid ISO.",
		file=sys.stderr,
	)

gap = disk_mib - max_end - 2

if gap < min_exfat_mib:
	print(
		f"No usable space >= {min_exfat_mib:.0f} MiB after last partition end ({max_end:.1f} MiB) "
		f"on a {disk_mib:.1f} MiB disk).",
		file=sys.stderr,
	)
	sys.exit(3)

start_mib = math.ceil(max_end + 1)

iso_path = os.environ.get("EXFAT_ISO_PATH", "").strip()
if iso_path:
	try:
		iso_sz = os.path.getsize(iso_path)
	except OSError as e:
		print(f"EXFAT_ISO_PATH unreadable ({iso_path}): {e}", file=sys.stderr)
		sys.exit(8)
	margin_mib = float(os.environ.get("EXFAT_AFTER_ISO_MARGIN_MIB", "1536"))
	iso_floor = math.ceil(iso_sz / float(1024 * 1024)) + margin_mib
	if iso_floor > start_mib:
		print(
			f"Note: exFAT slice starts at {iso_floor:.0f} MiB (ISO ceil + {margin_mib:.0f} MiB margin) "
			f"instead of hybridextent {math.ceil(max_end + 1):.0f} MiB.",
			file=sys.stderr,
		)
		start_mib = iso_floor

start_mib = int(math.ceil(start_mib))
if fill_disk:
	end_mib = disk_mib - 2
else:
	end_mib = start_mib + exfat_size_mib
	if end_mib > disk_mib - 2:
		end_mib = disk_mib - 2

if end_mib - start_mib < min_exfat_mib:
	print(
		f"exFAT slice too small ({end_mib - start_mib:.1f} MiB). "
		f"Lower MIN_EXFAT_MIB / EXFAT_SIZE_MIB or set EXFAT_FILL_DISK=1 for exFAT-only sticks.",
		file=sys.stderr,
	)
	sys.exit(4)

print(f"{start_mib} {end_mib}")
for num, fl in snapshot_partition_flags(dev):
	print(f"F\t{num}\t{fl}")
PY
}

META=$(mktemp)
trap 'rm -f "$META"' EXIT
calc_exfat_layout >"$META" || exit $?
read -r STARTMIB ENDMIB < <(head -n1 "$META")

echo "Disk $DEV → exFAT partition ${STARTMIB}–${ENDMIB} MiB (LABEL=$EXFAT_LABEL; leave room for persistence unless EXFAT_FILL_DISK=1)"

if [[ "$DRY" == true ]]; then
	echo "[dry-run] would run: parted mkpart primary ntfs ${STARTMIB}MiB ${ENDMIB}MiB ; mkfs.exfat -L $EXFAT_LABEL …"
	exit 0
fi

echo "Creating partition (${STARTMIB}MiB … ${ENDMIB}MiB; parted type ntfs → 0x07 for exFAT)"
LC_ALL=C parted -s "$DEV" unit MiB mkpart primary ntfs "${STARTMIB}MiB" "${ENDMIB}MiB"
partprobe "$DEV"
sleep 1

while IFS=$'\t' read -r tag partnum flg; do
	[[ "$tag" == "F" ]] || continue
	LC_ALL=C parted -s "$DEV" set "$partnum" "$flg" on 2>/dev/null || true
done < <(tail -n +2 "$META")
partprobe "$DEV"
sleep 1

PN=$(lsblk -nrpo NAME "$DEV" | grep -v "^${DEV}$" | sort -V | tail -1)
LASTPART=""
if [[ -n "$PN" ]]; then
	if [[ "$PN" == /* ]]; then
		LASTPART="$PN"
	else
		LASTPART="/dev/$PN"
	fi
fi

if [[ -z "$LASTPART" || "$LASTPART" == "$DEV" ]]; then
	echo "Could not resolve new partition under $DEV; check parted manually." >&2
	lsblk "$DEV"
	exit 6
fi

echo "Formatting $LASTPART → exFAT LABEL=$EXFAT_LABEL"
wipefs -a "$LASTPART" 2>/dev/null || true
mkfs.exfat -L "$EXFAT_LABEL" "$LASTPART"
partprobe "$DEV"
sleep 1
blkid "$LASTPART" || true

echo "Done. WO-47 expects LABEL=HIGHASCGEXF in home-casparcg-exfat.mount (install via install-phase4 / install-exfat-systemd-units.sh)."
if [[ "$EXFAT_LABEL" != "HIGHASCGEXF" ]]; then
	echo "Warning: WO-47 default is LABEL=HIGHASCGEXF; home-casparcg-exfat.mount will not attach this volume until you regenerate units or edit What=." >&2
fi

echo "Reboot or: sudo systemctl start home-casparcg-exfat.mount && sudo systemctl start highascg-exfat-sync.service"

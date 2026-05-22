#!/usr/bin/env bash
# Remove operator data slices (exFAT HIGHASCGEXF, persistence) — not ESP / hybrid ISO.
# Usage: sudo bash tools/eggs/live-usb/prune-operator-data-partitions.sh /dev/sdX
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=usb-env.sh
source "${HERE}/usb-env.sh"

DEV="${1:?whole disk e.g. /dev/sda}"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Must run as root (sudo)." >&2
	exit 1
}
[[ -b "$DEV" ]] || {
	echo "Not a block device: $DEV" >&2
	exit 1
}

BASE="${DEV#/dev/}"

echo "==> Partition table before prune:"
"$PARTED" -s "$DEV" unit MiB print || true

export PARTED
# Resolve parted row numbers by matching sysfs start sectors (sdXN order != parted # on hybrid sticks).
python3 - "$DEV" "$BASE" <<'PY'
import glob
import os
import re
import shutil
import subprocess
import sys

dev, base = sys.argv[1], sys.argv[2]
parted = os.environ.get("PARTED") or shutil.which("parted") or "/usr/sbin/parted"
PARTED_ENV = {**os.environ, "LC_ALL": "C"}


def parted_rows():
    out = subprocess.check_output(
        [parted, "-sm", dev, "unit", "MiB", "print"],
        text=True,
        env=PARTED_ENV,
    )
    rows = []
    for line in out.strip().splitlines():
        if line.strip() == "BYT":
            continue
        parts = [p.strip() for p in line.rstrip(";").split(":")]
        if not parts or not parts[0].isdigit():
            continue
        num = int(parts[0])
        flags = parts[6] if len(parts) > 6 else ""
        rows.append((num, flags))
    return rows


def sysfs_start(part_path):
    name = os.path.basename(part_path)
    p = f"/sys/block/{base}/{name}/start"
    try:
        with open(p) as f:
            return int(f.read().strip())
    except OSError:
        return None


def blkid_label_type(part_path):
    try:
        out = subprocess.check_output(
            ["blkid", "-o", "value", "-s", "LABEL", part_path],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except subprocess.CalledProcessError:
        out = ""
    try:
        typ = subprocess.check_output(
            ["blkid", "-o", "value", "-s", "TYPE", part_path],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except subprocess.CalledProcessError:
        typ = ""
    return out, typ


esp_nums = {n for n, fl in parted_rows() if "esp" in fl.lower()}
to_rm = set()

for part in sorted(glob.glob(f"{dev}[0-9]*")):
    if not os.path.exists(part):
        continue
    lab, typ = blkid_label_type(part)
    if lab in ("HIGHASCGEXF", "persistence") or typ == "exfat":
        start = sysfs_start(part)
        matched = None
        if start is not None:
            out = subprocess.check_output(
                [parted, "-sm", dev, "unit", "s", "print"],
                text=True,
                env=PARTED_ENV,
            )
            for line in out.strip().splitlines():
                parts = [p.strip() for p in line.rstrip(";").split(":")]
                if not parts or not parts[0].isdigit():
                    continue
                try:
                    pstart = int(parts[1])
                except ValueError:
                    continue
                if abs(pstart - start) <= 64:
                    matched = int(parts[0])
                    break
        if matched is None:
            matched = int(os.path.basename(part)[len(base) :])
        if matched == 1:
            print(f"Skip {part}: MBR slot 1 is isohybrid boot", file=sys.stderr)
            continue
        if matched in esp_nums:
            print(
                f"Skip {part} (LABEL={lab} TYPE={typ}): parted #{matched} is ESP",
                file=sys.stderr,
            )
            continue
        print(f"Prune candidate: {part} → parted rm {matched} (LABEL={lab} TYPE={typ})")
        to_rm.add(matched)

for num in sorted(to_rm, reverse=True):
    print(f"parted rm {num}")
    subprocess.run(
        [parted, "-s", dev, "rm", str(num)],
        env=PARTED_ENV,
        check=False,
    )
PY

partprobe "$DEV"
sleep 1
echo "==> Partition table after prune:"
"$PARTED" -s "$DEV" unit MiB print || true

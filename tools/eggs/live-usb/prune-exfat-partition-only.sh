#!/usr/bin/env bash
# Remove only exFAT operator slice(s) (LABEL=HIGHASCGEXF / TYPE=exfat), keep persistence intact.
# Usage: sudo bash tools/eggs/live-usb/prune-exfat-partition-only.sh /dev/sdX
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=usb-env.sh
source "${HERE}/usb-env.sh"

DEV="${1:?whole disk e.g. /dev/sda}"
BASE="${DEV#/dev/}"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Must run as root (sudo)." >&2
	exit 1
}

export PARTED
python3 - "$DEV" "$BASE" <<'PY'
import glob
import os
import shutil
import subprocess
import sys

dev, base = sys.argv[1], sys.argv[2]
parted = os.environ.get("PARTED") or shutil.which("parted") or "/usr/sbin/parted"
PARTED_ENV = {**os.environ, "LC_ALL": "C"}


def parted_esp_nums():
    out = subprocess.check_output(
        [parted, "-sm", dev, "unit", "MiB", "print"],
        text=True,
        env=PARTED_ENV,
    )
    esp = set()
    for line in out.strip().splitlines():
        if line.strip() == "BYT":
            continue
        parts = [p.strip() for p in line.rstrip(";").split(":")]
        if parts and parts[0].isdigit() and len(parts) > 6 and "esp" in parts[6].lower():
            esp.add(int(parts[0]))
    return esp


def blkid_label_type(part):
    lab = typ = ""
    try:
        lab = subprocess.check_output(
            ["blkid", "-o", "value", "-s", "LABEL", part],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except subprocess.CalledProcessError:
        pass
    try:
        typ = subprocess.check_output(
            ["blkid", "-o", "value", "-s", "TYPE", part],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except subprocess.CalledProcessError:
        pass
    return lab, typ


def sysfs_start(part):
    name = os.path.basename(part)
    try:
        with open(f"/sys/block/{base}/{name}/start") as f:
            return int(f.read().strip())
    except OSError:
        return None


def parted_num_for_start(start_sec):
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
        if abs(pstart - start_sec) <= 64:
            return int(parts[0])
    return int(os.path.basename(part)[len(base) :])


esp = parted_esp_nums()
to_rm = set()
for part in sorted(glob.glob(f"{dev}[0-9]*")):
    if not os.path.exists(part):
        continue
    lab, typ = blkid_label_type(part)
    if lab == "persistence":
        continue
    if lab != "HIGHASCGEXF" and typ != "exfat":
        continue
    num = parted_num_for_start(sysfs_start(part) or 0)
    if num in esp:
        print(f"Skip {part}: parted #{num} is ESP", file=sys.stderr)
        continue
    print(f"Remove exFAT slice {part} → parted rm {num} (LABEL={lab} TYPE={typ})")
    to_rm.add(num)

for num in sorted(to_rm, reverse=True):
    subprocess.run([parted, "-s", dev, "rm", str(num)], env=PARTED_ENV, check=False)
PY

partprobe "$DEV"
sleep 1
echo "OK: exFAT slice(s) removed; persistence (if any) kept"

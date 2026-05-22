#!/usr/bin/env bash
# Remove mistaken data partitions on isohybrid sticks (MBR slots in the ISO tail — not ESP).
# Keeps ESP (parted flag) and low-offset boot slices; drops e.g. parted #1 at 6667 MiB from old scripts.
#
# Usage: sudo bash tools/eggs/live-usb/prune-hybrid-data-partitions.sh /dev/sdX [--iso /path/to.iso]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=usb-env.sh
source "${HERE}/usb-env.sh"

DEV="${1:?}"
ISO_ARG=""
shift || true
while [[ $# -gt 0 ]]; do
	case "$1" in
		--iso) ISO_ARG="${2:?}"; shift 2 ;;
		*) echo "Unknown: $1" >&2; exit 1 ;;
	esac
done

[[ "$(id -u)" -eq 0 ]] || {
	echo "Must run as root (sudo)." >&2
	exit 1
}

export EXFAT_ISO_PATH="${ISO_ARG:-${EXFAT_ISO_PATH:-}}"
export PARTED

echo "==> Before prune-hybrid-data-partitions:"
"$PARTED" -s "$DEV" unit MiB print || true

python3 - "$DEV" <<'PY'
import os
import re
import shutil
import subprocess
import sys

dev = sys.argv[1]
parted = os.environ.get("PARTED") or shutil.which("parted") or "/usr/sbin/parted"
env = {**os.environ, "LC_ALL": "C"}

iso_path = os.environ.get("EXFAT_ISO_PATH", "").strip()
min_drop_mib = 512.0
if iso_path and os.path.isfile(iso_path):
    import math

    iso_sz = os.path.getsize(iso_path)
    margin = float(os.environ.get("EXFAT_AFTER_ISO_MARGIN_MIB", "1536"))
    min_drop_mib = math.ceil(iso_sz / (1024 * 1024)) + margin - 256

def split_fields(line):
    return [p.strip() for p in line.rstrip(";").strip().split(":")]


def to_mib(s):
    m = re.match(r"^([\d.]+)\s*(KiB|MiB|GiB|kB|MB|GB)$", s.strip())
    if not m:
        return None
    v = float(m.group(1))
    u = m.group(2)
    if u in ("KiB", "kB"):
        return v / 1024.0
    if u in ("MiB", "MB"):
        return v
    return v * 1024.0


out = subprocess.check_output(
    [parted, "-sm", dev, "unit", "MiB", "print"],
    text=True,
    env=env,
).strip().splitlines()

to_rm = []
for line in out:
    if not line or line.strip() == "BYT":
        continue
    parts = split_fields(line)
    if not parts or not parts[0].isdigit():
        continue
    num = int(parts[0])
    flags = parts[6] if len(parts) > 6 else ""
    if "esp" in flags.lower():
        print(f"Keep partition {num} (ESP)", file=sys.stderr)
        continue
    try:
        start_mib = to_mib(parts[1])
    except (ValueError, IndexError):
        continue
    if start_mib is None:
        continue
    if start_mib < min_drop_mib:
        print(f"Keep partition {num} (start {start_mib:.1f} MiB < data band)", file=sys.stderr)
        continue
    print(f"Remove partition {num} (data slice at {start_mib:.1f} MiB — not isohybrid boot)", file=sys.stderr)
    to_rm.append(num)

for num in sorted(to_rm, reverse=True):
    subprocess.run([parted, "-s", dev, "rm", str(num)], env=env, check=False)
PY

partprobe "$DEV" 2>/dev/null || true
sleep 1
echo "==> After prune-hybrid-data-partitions:"
"$PARTED" -s "$DEV" unit MiB print || true

#!/usr/bin/env bash
# Re-apply ESP (and boot) flags on hybrid-ISO USB sticks after parted/sgdisk edits.
# Usage: sudo bash tools/eggs/live-usb/usb-restore-esp-flags.sh /dev/sdX
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=usb-env.sh
source "${HERE}/usb-env.sh"

DEV="${1:?}"

[[ "$(id -u)" -eq 0 ]] || exit 1

export PARTED
python3 - "$DEV" <<'PY' | while read -r num; do
import os
import shutil
import subprocess
import sys

dev = sys.argv[1]
parted = os.environ.get("PARTED") or shutil.which("parted") or "/usr/sbin/parted"
out = subprocess.check_output(
    [parted, "-sm", dev, "unit", "MiB", "print"],
    text=True,
    env={"LC_ALL": "C"},
)
for line in out.strip().splitlines():
    if not line or line.strip() == "BYT":
        continue
    parts = [p.strip() for p in line.rstrip(";").split(":")]
    if not parts or not parts[0].isdigit():
        continue
    flags = parts[6] if len(parts) > 6 else ""
    if "esp" in flags.lower():
        print(parts[0])
PY
	[[ -n "$num" ]] || continue
	echo "ESP flags on partition ${num}"
	"$PARTED" -s "$DEV" set "$num" esp on 2>/dev/null || true
	"$PARTED" -s "$DEV" set "$num" boot on 2>/dev/null || true
done

partprobe "$DEV" 2>/dev/null || true

#!/usr/bin/env python3
"""MBR slot plan for HighAsCG USB sticks (isohybrid-safe).

After dd, isohybrid uses MBR entry 1 for the live image. The ESP is often entry 2 (~16 MiB).
Data partitions must use slot 3 (persistence) and slot 4 (exFAT) — never slot 1.

Prints one line: PERSIST_NUM EXFAT_NUM
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys

PARTED_BIN = os.environ.get("PARTED") or shutil.which("parted") or "/usr/sbin/parted"
PARTED_ENV = {**os.environ, "LC_ALL": "C"}


def split_fields(line: str) -> list[str]:
    return [p.strip() for p in line.rstrip(";").strip().split(":")]


def parted_rows(dev: str) -> list[tuple[int, str]]:
    out = subprocess.check_output(
        [PARTED_BIN, "-sm", dev, "unit", "MiB", "print"],
        text=True,
        env=PARTED_ENV,
    ).strip().splitlines()
    rows = []
    for line in out:
        if not line or line.strip() == "BYT":
            continue
        parts = split_fields(line)
        if not parts or not parts[0].isdigit():
            continue
        flags = parts[6] if len(parts) > 6 else ""
        rows.append((int(parts[0]), flags))
    return rows


def main() -> int:
    dev = sys.argv[1]
    rows = parted_rows(dev)
    nums = {n for n, _ in rows}
    esp = {n for n, fl in rows if "esp" in fl.lower()}

    # Isohybrid: never place operator data in MBR slot 1.
    if 2 in esp or (2 in nums and not esp):
        persist_num, exfat_num = 3, 4
    elif 1 in esp:
        persist_num, exfat_num = 2, 3
    else:
        persist_num, exfat_num = 3, 4

    if persist_num in nums and persist_num != 1:
        # persistence already created on correct slot
        pass
    if 1 in nums and 1 not in esp:
        print(
            f"Note: MBR partition 1 already exists — data will use slots "
            f"{persist_num} and {exfat_num} only (slot 1 left for isohybrid).",
            file=sys.stderr,
        )

    print(f"{persist_num} {exfat_num}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

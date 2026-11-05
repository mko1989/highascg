#!/usr/bin/env python3
"""Summarise a pgm_probe.py CSV: frame gaps, single-frame jumps (cut / flash), ramp restarts, and a coarse timeline.
Usage: pgm_probe_report.py <csv> [jump_threshold]"""
import csv, sys

rows = [(int(r["ms"]), int(r["frame"]), int(r["r"]), int(r["g"]), int(r["b"])) for r in csv.DictReader(open(sys.argv[1]))]
thr = int(sys.argv[2]) if len(sys.argv) > 2 else 40
gaps = [(a[0], b[1] - a[1]) for a, b in zip(rows, rows[1:]) if b[1] - a[1] != 1]
jumps, restarts = [], []
for a, b in zip(rows, rows[1:]):
    d = max(abs(b[2] - a[2]), abs(b[3] - a[3]), abs(b[4] - a[4]))
    if d > thr:
        jumps.append((b[0], a[2:], b[2:]))
    # the ramp clip: blue ~200, green ~0 → red is the playhead; a drop > 12 is the clip going backwards
    if a[4] > 150 and b[4] > 150 and a[3] < 40 and b[3] < 40 and a[2] - b[2] > 12:
        restarts.append((b[0], a[2], b[2]))
print(f"{len(rows)} frames, {rows[-1][0] - rows[0][0]} ms; frame-number gaps: {gaps[:8] or 'none'}")
print(f"single-frame jumps > {thr}: {len(jumps)}")
for j in jumps[:12]:
    print(f"  at {j[0]} ms: rgb {j[1]} -> {j[2]}")
print(f"ramp restarts (red going back): {len(restarts)}")
for r in restarts[:8]:
    print(f"  at {r[0]} ms: red {r[1]} -> {r[2]}")
step = max(1, len(rows) // 24)
print("timeline (ms: r,g,b):", "  ".join(f"{r[0]}:{r[2]},{r[3]},{r[4]}" for r in rows[::step]))

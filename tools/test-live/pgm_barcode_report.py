#!/usr/bin/env python3
"""Summarise a pgm_barcode.py CSV: every place the clip did not advance exactly one frame per channel frame.
Usage: pgm_barcode_report.py <csv> [clip_frames=500]
A clean loop prints no discontinuities; a mix prints a run of blended frames and the offset it landed on."""
import csv, sys

N = int(sys.argv[2]) if len(sys.argv) > 2 else 500
rows = [(int(r["ms"]), int(r["frame"]), int(r["clip"])) for r in csv.DictReader(open(sys.argv[1]))]
gaps = sum(1 for a, b in zip(rows, rows[1:]) if b[1] - a[1] != 1)
print(f"{len(rows)} channel frames over {rows[-1][0] - rows[0][0]} ms; channel-frame gaps: {gaps}")
events, prev, blend = [], None, None
for ms, ch, clip in rows:
    if clip < 0:
        blend = blend or [ms, 0]
        blend[1] += 1
        continue
    if prev is not None:
        want = (prev[1] + (ch - prev[0])) % N
        d = (clip - want + N // 2) % N - N // 2
        if blend or d != 0:
            what = f"{blend[1]} blended frames, then " if blend else ""
            events.append(f"  {blend[0] if blend else ms} ms: {what}clip frame {clip}, continuous = {want} ({d:+d} frames)")
    blend = None
    prev = (ch, clip)
print("discontinuities:" if events else "discontinuities: none — the clip advanced one frame per channel frame")
print("\n".join(events[:40]))

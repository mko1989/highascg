#!/usr/bin/env python3
"""Barcode probe (WO-956): reads which frame of a barcode clip is on air, for every published channel frame.

The clip has N stripes side by side (each `stripe_w` px wide). Stripe i is white when bit i of the clip frame number is
set; the last stripe is always white (the reference). Make one, 1280×720 @ 50 fps, 500 frames:
  ffmpeg -f lavfi -i color=c=black:s=1280x720:r=50:d=10 -vf "geq=lum='if(eq(floor(X/128),9),235,
    if(bitand(N,pow(2,floor(X/128))),235,16))':cb=128:cr=128,format=yuv420p" -c:v libx264 -crf 10 clip.mp4
Attach a temporary SHM consumer first (`ADD <ch>-749 SHM NAME <name>`, REMOVE it after).
Usage: pgm_barcode.py <name> <seconds> <out.csv> <x of stripe 0's left edge> <y> [stripe_w=128] [stripes=10]
CSV: ms, channel frame, clip frame (-1 = a stripe is grey: a mix / fade is blending two frames), lowest stripe margin.
"""
import mmap, os, struct, sys, time

OFF_LATEST, OFF_WIDTH, OFF_HEIGHT, OFF_STRIDE, OFF_SLOT_OFFSET = 96, 16, 20, 24, 48
SLOT_HEADER_SIZE = 4096
U32, U64 = struct.Struct("<I"), struct.Struct("<Q")

name, seconds, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
x0, y = int(sys.argv[4]), int(sys.argv[5])
sw = int(sys.argv[6]) if len(sys.argv) > 6 else 128
ns = int(sys.argv[7]) if len(sys.argv) > 7 else 10
fd = os.open(f"/dev/shm/highascg-{name}", os.O_RDONLY)
mm = mmap.mmap(fd, os.fstat(fd).st_size, mmap.MAP_SHARED, mmap.PROT_READ)
os.close(fd)
w, h, stride = (U32.unpack_from(mm, o)[0] for o in (OFF_WIDTH, OFF_HEIGHT, OFF_STRIDE))
slots = [U64.unpack_from(mm, OFF_SLOT_OFFSET + 8 * s)[0] for s in range(3)]
# 3 × 3 points around each stripe's centre
pts = [[(x0 + i * sw + sw // 2 + dx, y + dy) for dx in (-20, 0, 20) for dy in (-20, 0, 20)] for i in range(ns)]
rows, last, t0 = [], 0, time.monotonic()
while time.monotonic() - t0 < seconds:
    latest = U64.unpack_from(mm, OFF_LATEST)[0]
    if latest == 0 or latest == last:
        time.sleep(0.002)
        continue
    n, slot = latest >> 8, latest & 0xFF
    base = slots[slot]
    if U64.unpack_from(mm, base)[0] != 2 * n:
        continue
    pix = base + SLOT_HEADER_SIZE
    fnum = U64.unpack_from(mm, base + 16)[0]
    lum = []
    for sp in pts:
        s = 0
        for x, yy in sp:
            o = pix + yy * stride + x * 4
            s += (mm[o] + mm[o + 1] + mm[o + 2]) / 3
        lum.append(s / len(sp))
    if U64.unpack_from(mm, base)[0] != 2 * n:
        continue
    last = latest
    ref = lum[-1]
    margin = min(min(abs(v - 0), abs(v - ref)) for v in lum[:-1])
    frame = -1 if ref < 150 or margin > 50 else sum(1 << i for i, v in enumerate(lum[:-1]) if v > ref / 2)
    rows.append((int((time.monotonic() - t0) * 1000), fnum, frame, round(margin)))
with open(out, "w") as f:
    f.write("ms,frame,clip,margin\n")
    for row in rows:
        f.write(",".join(map(str, row)) + "\n")
print(f"{len(rows)} frames in {seconds}s ({w}x{h}) -> {out}")

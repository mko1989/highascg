#!/usr/bin/env python3
"""Frame-accurate PGM probe (WO-949): catches one-frame cuts, flashes and restarts that screenshots miss.
Attach a temporary SHM consumer first (`ADD <ch>-749 SHM NAME zzprobe`, REMOVE after); pgm_probe_report.py summarises.

Reads a Caspar SHM consumer segment (/dev/shm/highascg-<name>, ABI from tools/hshm-bridge/hshm_abi.py) and, for every
published frame, averages a grid of pixels in the centre of the picture. Writes CSV: wall_ms, frame_number, r, g, b.
Usage: pgm_probe.py <name> <seconds> <out.csv> [x0 x1 y0 y1 as fractions of the frame]
"""
import mmap, os, struct, sys, time

HEADER_SIZE = 4096
SLOT_HEADER_SIZE = 4096
OFF_GENERATION, OFF_LATEST = 80, 96
OFF_WIDTH, OFF_HEIGHT, OFF_STRIDE, OFF_SLOT_OFFSET = 16, 20, 24, 48
U32, U64 = struct.Struct("<I"), struct.Struct("<Q")

name, seconds, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
path = f"/dev/shm/highascg-{name}"
fd = os.open(path, os.O_RDONLY)
mm = mmap.mmap(fd, os.fstat(fd).st_size, mmap.MAP_SHARED, mmap.PROT_READ)
os.close(fd)
w, h, stride = (U32.unpack_from(mm, o)[0] for o in (OFF_WIDTH, OFF_HEIGHT, OFF_STRIDE))
slots = [U64.unpack_from(mm, OFF_SLOT_OFFSET + 8 * s)[0] for s in range(3)]
# a 12 x 6 grid over the middle 60 % x 50 % of the frame
x0, x1, y0, y1 = (float(v) for v in sys.argv[4:8]) if len(sys.argv) >= 8 else (0.2, 0.8, 0.25, 0.75)
pts = [(int(w * (x0 + (x1 - x0) * i / 11)), int(h * (y0 + (y1 - y0) * j / 5))) for i in range(12) for j in range(6)]
last = 0
rows = []
t0 = time.monotonic()
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
    r = g = b = 0
    for x, y in pts:
        o = pix + y * stride + x * 4
        b += mm[o]; g += mm[o + 1]; r += mm[o + 2]
    if U64.unpack_from(mm, base)[0] != 2 * n:  # torn while sampling: drop
        continue
    last = latest
    k = len(pts)
    rows.append((int((time.monotonic() - t0) * 1000), fnum, round(r / k), round(g / k), round(b / k)))
with open(out, "w") as f:
    f.write("ms,frame,r,g,b\n")
    for row in rows:
        f.write(",".join(map(str, row)) + "\n")
print(f"{len(rows)} frames in {seconds}s ({w}x{h}) -> {out}")

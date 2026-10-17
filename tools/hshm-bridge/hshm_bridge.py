#!/usr/bin/env python3
"""hshm_bridge — WO-595 step 0: publish frames into a HighAsCG shm segment WITHOUT the Caspar consumer.

Sources:
  pattern  built-in test pattern (no dependencies): 4 coloured quadrants (atlas test), a sweeping bar
           (motion/tearing), the frame number as 32 bit-blocks top-left (torn-frame + gap check by
           hshm_probe.py --check-pattern), and a white flash square once per second (glass-to-glass).
  stdin    raw BGRA frames on stdin, e.g. from ffmpeg:
             ffmpeg -re -f lavfi -i testsrc2=size=1920x1080:rate=50 -pix_fmt bgra -f rawvideo - \
               | hshm_bridge.py --name opgui --source stdin
           or (on the box) Caspar ch5 → NVENC → decode, see godot/spikes/m0/README.md.

The segment path defaults to /dev/shm/highascg-<name> on Linux (what the Caspar consumer creates)
and $TMPDIR/highascg-shm/highascg-<name> elsewhere. Ctrl+C unlinks it (use --keep to leave it).
"""
import argparse
import os
import signal
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hshm_abi  # noqa: E402

QUADRANT_COLORS = [  # BGRA
    bytes((90, 40, 20, 255)),   # top-left: blue-ish
    bytes((30, 90, 30, 255)),   # top-right: green
    bytes((30, 30, 110, 255)),  # bottom-left: red
    bytes((90, 30, 80, 255)),   # bottom-right: purple
]
WHITE = bytes((255, 255, 255, 255))
BLACK = bytes((0, 0, 0, 255))
BIT_BLOCK, BIT_GAP, BIT_X0, BIT_Y0, BITS = 20, 4, 24, 24, 32


def bit_block_origin(i):
    """Top-left of the block for bit i (MSB first). Shared with hshm_probe.py."""
    return BIT_X0 + i * (BIT_BLOCK + BIT_GAP), BIT_Y0


def build_background(w, h):
    hw, hh = w // 2, h // 2
    top = QUADRANT_COLORS[0] * hw + QUADRANT_COLORS[1] * (w - hw)
    bottom = QUADRANT_COLORS[2] * hw + QUADRANT_COLORS[3] * (w - hw)
    frame = bytearray(top * hh + bottom * (h - hh))
    stride = w * 4
    white_row = WHITE * w
    for y in (0, 1, hh - 2, hh - 1, hh, hh + 1, h - 2, h - 1):
        frame[y * stride:(y + 1) * stride] = white_row
    for y in range(h):
        for x in (0, 1, hw - 2, hw - 1, hw, hw + 1, w - 2, w - 1):
            frame[y * stride + x * 4:y * stride + x * 4 + 4] = WHITE
    return bytes(frame)


def draw_pattern(mm, off, w, h, background, n, fps):
    stride = w * 4
    mm[off:off + len(background)] = background
    bar_w = 32
    bar = WHITE * bar_w
    x = (n * 12) % (w - bar_w)
    for y in range(h):
        p = off + y * stride + x * 4
        mm[p:p + bar_w * 4] = bar
    on, off_ = WHITE * BIT_BLOCK, BLACK * BIT_BLOCK
    value = n & 0xFFFFFFFF
    for i in range(BITS):
        bx, by = bit_block_origin(i)
        block = on if (value >> (BITS - 1 - i)) & 1 else off_
        for yy in range(by, by + BIT_BLOCK):
            p = off + yy * stride + bx * 4
            mm[p:p + BIT_BLOCK * 4] = block
    if fps and n % fps == 0:  # once per second: 240 px white square, centre — glass-to-glass marker
        s = 240
        sq = WHITE * s
        x0, y0 = (w - s) // 2, (h - s) // 2
        for yy in range(y0, y0 + s):
            p = off + yy * stride + x0 * 4
            mm[p:p + s * 4] = sq


def read_exact_into(stream, mv):
    got = 0
    while got < len(mv):
        k = stream.readinto(mv[got:])
        if not k:
            return False
        got += k
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", default="opgui")
    ap.add_argument("--path", help="explicit segment path (overrides --name)")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--fps", type=int, default=50)
    ap.add_argument("--channel", type=int, default=5)
    ap.add_argument("--source", choices=("pattern", "stdin"), default="pattern")
    ap.add_argument("--duration", type=float, default=0, help="seconds, 0 = until Ctrl+C / EOF")
    ap.add_argument("--keep", action="store_true", help="do not unlink the segment on exit")
    a = ap.parse_args()

    path = a.path or hshm_abi.default_path(a.name)
    wr = hshm_abi.Writer(path, a.width, a.height, a.fps, 1, a.channel)
    print(f"[hshm-bridge] {a.source} {a.width}x{a.height}@{a.fps} -> {path}", flush=True)
    stop = {"flag": False}
    signal.signal(signal.SIGINT, lambda *_: stop.update(flag=True))
    signal.signal(signal.SIGTERM, lambda *_: stop.update(flag=True))

    background = build_background(a.width, a.height) if a.source == "pattern" else None
    frame_bytes = a.width * a.height * 4
    period = 1.0 / a.fps
    t0 = next_t = time.monotonic()
    last_report, frames, work_s = t0, 0, 0.0
    n = 0
    try:
        while not stop["flag"]:
            if a.duration and time.monotonic() - t0 >= a.duration:
                break
            n += 1
            w0 = time.monotonic()
            off = wr.begin()
            if a.source == "pattern":
                draw_pattern(wr.mm, off, a.width, a.height, background, n, a.fps)
            else:
                if not read_exact_into(sys.stdin.buffer, memoryview(wr.mm)[off:off + frame_bytes]):
                    break
            wr.commit(n)
            work_s += time.monotonic() - w0
            frames += 1
            now = time.monotonic()
            if now - last_report >= 5:
                print(f"[hshm-bridge] frames={n} fps={frames / (now - last_report):.1f} "
                      f"work_ms={1000 * work_s / max(frames, 1):.2f}", flush=True)
                last_report, frames, work_s = now, 0, 0.0
            if a.source == "pattern":
                next_t += period
                delay = next_t - time.monotonic()
                if delay > 0:
                    time.sleep(delay)
                else:
                    next_t = time.monotonic()  # fell behind: do not burst
    finally:
        wr.close(unlink=not a.keep)
        print(f"[hshm-bridge] stopped after {n} frames", flush=True)


if __name__ == "__main__":
    main()

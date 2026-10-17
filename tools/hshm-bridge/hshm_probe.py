#!/usr/bin/env python3
"""hshm_probe — read a HighAsCG shm segment and report fps, gaps, laps, latency (WO-594 T3 / WO-595).

  hshm_probe.py --name opgui                 # /dev/shm/highascg-opgui on Linux
  hshm_probe.py --name opgui --check-pattern # also decode the bridge's frame-number bits (torn check)
  hshm_probe.py --name opgui --duration 30 --json   # one JSON summary line at the end

Latency = reader CLOCK_REALTIME − slot publish_realtime_ns (same machine ⇒ same clock).
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hshm_abi  # noqa: E402
from hshm_bridge import BIT_BLOCK, BITS, bit_block_origin  # noqa: E402


def decode_counter(data, w):
    stride = w * 4
    v = 0
    for i in range(BITS):
        bx, by = bit_block_origin(i)
        p = (by + BIT_BLOCK // 2) * stride + (bx + BIT_BLOCK // 2) * 4
        v = (v << 1) | (1 if data[p] > 127 else 0)
    return v


def pct(values, q):
    if not values:
        return 0.0
    s = sorted(values)
    return s[min(len(s) - 1, int(q * len(s)))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="opgui")
    ap.add_argument("--path")
    ap.add_argument("--duration", type=float, default=0)
    ap.add_argument("--check-pattern", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--poll-ms", type=float, default=2.0)
    a = ap.parse_args()
    path = a.path or hshm_abi.default_path(a.name)

    rd = None
    t_start = time.monotonic()
    while rd is None:
        try:
            rd = hshm_abi.Reader(path)
        except (FileNotFoundError, ValueError):
            if a.duration and time.monotonic() - t_start > a.duration:
                print(f"[hshm-probe] no segment at {path}", file=sys.stderr)
                return 2
            time.sleep(0.2)
    print(f"[hshm-probe] {path} {rd.width}x{rd.height} @ {rd.fps_num}/{rd.fps_den} gen={rd.generation}",
          file=sys.stderr, flush=True)

    total = {"frames": 0, "gaps": 0, "lapped": 0, "torn": 0, "lat": []}
    win = {"frames": 0, "lat": []}
    last_seq, last_report = 0, time.monotonic()
    t0 = time.monotonic()
    try:
        while not a.duration or time.monotonic() - t0 < a.duration:
            kind, info, data = rd.poll()
            if kind == "frame":
                lat_ms = (time.time_ns() - info["publish_realtime_ns"]) / 1e6
                total["frames"] += 1
                win["frames"] += 1
                total["lat"].append(lat_ms)
                win["lat"].append(lat_ms)
                if last_seq and info["seq"] != last_seq + 1:
                    total["gaps"] += info["seq"] - last_seq - 1
                last_seq = info["seq"]
                if a.check_pattern and decode_counter(data, rd.width) != (info["frame_number"] & 0xFFFFFFFF):
                    total["torn"] += 1
            elif kind == "lapped":
                total["lapped"] += 1
            elif kind == "geometry":
                print("[hshm-probe] generation changed — reopening", file=sys.stderr)
                rd.close()
                rd = hshm_abi.Reader(path)
                last_seq = 0
            now = time.monotonic()
            if now - last_report >= 2 and not a.json:
                el = now - last_report
                print(f"[hshm-probe] fps={win['frames'] / el:5.1f} lat_ms p50={pct(win['lat'], .5):5.2f} "
                      f"p95={pct(win['lat'], .95):5.2f} gaps={total['gaps']} lapped={total['lapped']} "
                      f"torn={total['torn']} writer_dropped={rd.dropped_by_writer()}", flush=True)
                win, last_report = {"frames": 0, "lat": []}, now
            time.sleep(a.poll_ms / 1000)
    except KeyboardInterrupt:
        pass
    el = time.monotonic() - t0
    summary = {
        "path": path, "width": rd.width, "height": rd.height, "seconds": round(el, 2),
        "frames": total["frames"], "fps": round(total["frames"] / el, 2) if el else 0,
        "gaps": total["gaps"], "lapped": total["lapped"], "torn": total["torn"],
        "latency_ms_p50": round(pct(total["lat"], .5), 2), "latency_ms_p95": round(pct(total["lat"], .95), 2),
        "writer_dropped": rd.dropped_by_writer(),
    }
    print(json.dumps(summary) if a.json else f"[hshm-probe] summary {summary}", flush=True)
    return 0 if total["torn"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

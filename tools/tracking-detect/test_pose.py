"""WO-667 T1 — self-test for pose.py (no model needed). Run with the sidecar venv:
    ~/.local/share/highascg/tracking-venv/bin/python tools/tracking-detect/test_pose.py
Driven from tools/smoke/smoke-wo667-posed-dummies.test.js when that venv exists (CI has none: skipped there)."""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pose  # noqa: E402


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + ("  " + detail if detail else ""))
    return ok


def main():
    good = True
    fw, fh = 640, 360  # letterboxed into 640 with pad (0, 140), scale 1
    scale, pad = 1.0, (0, 140)
    rows = np.zeros((2, 5 + 51), np.float32)
    rows[0, :5] = [320, 140 + 180, 100, 300, 0.9]  # a person centred in the frame
    rows[1, :5] = [100, 140 + 100, 40, 80, 0.1]  # below the floor: dropped
    kp = np.zeros((17, 3), np.float32)
    kp[:, 0] = np.linspace(280, 360, 17)
    kp[:, 1] = 140 + np.linspace(40, 320, 17)
    kp[:, 2] = 0.8
    kp[3, 2] = 1.7  # visibility clamps to 1
    rows[0, 5:] = kp.reshape(-1)
    out = pose.decode(rows, 0.3, scale, pad, fw, fh)
    good &= check("one person above the floor", len(out) == 1, str(len(out)))
    k = out[0][5]
    good &= check("keypoints mapped out of the letterbox", np.allclose(k[0, :2], [280 / 640, 40 / 360], atol=1e-5)
        and np.allclose(k[16, :2], [360 / 640, 320 / 360], atol=1e-5), str(k[[0, 16], :2]))
    good &= check("visibility clamped", k[3, 2] == 1.0 and k[0, 2] == np.float32(0.8))
    box = out[0][:4]
    good &= check("box normalised", np.allclose(box, [270 / 640, 30 / 360, 370 / 640, 330 / 360], atol=1e-5), str(box))
    e2e = np.zeros((1, 6 + 51), np.float32)
    e2e[0, :6] = [270, 170, 370, 470, 0.9, 0]
    e2e[0, 6:] = kp.reshape(-1)
    good &= check("end-to-end head", len(pose.decode(e2e, 0.3, scale, pad, fw, fh)) == 1)
    good &= check("other shapes → nothing", pose.decode(np.zeros((3, 84), np.float32), 0.3, scale, pad, fw, fh) == [])
    enc = pose.encode(k)
    good &= check("encode: 51 numbers, xy 4 dp, v 2 dp", len(enc) == 51 and enc[2] == 0.8 and enc[0] == round(280 / 640, 4))
    # attach: the best-overlapping pose goes to each live track, once; coasting tracks get none
    pa = (0.40, 0.20, 0.50, 0.80, 0.9, k)
    pb = (0.10, 0.10, 0.20, 0.50, 0.9, k * 0.5)
    tracks = [{"tid": 1, "box": [0.41, 0.21, 0.51, 0.79], "age_s": 0.0},
        {"tid": 2, "box": [0.40, 0.20, 0.50, 0.80], "age_s": 0.3},
        {"tid": 3, "box": [0.11, 0.1, 0.2, 0.52], "age_s": 0.0},
        {"tid": 4, "box": [0.8, 0.1, 0.9, 0.5], "age_s": 0.0}]
    pose.attach(tracks, [pb, pa])
    good &= check("live track ← its overlapping pose", tracks[0].get("kps") == pose.encode(k))
    good &= check("coasting track gets none", "kps" not in tracks[1])
    good &= check("second person ← the other pose", tracks[2].get("kps") == pose.encode(k * 0.5))
    good &= check("no overlap → none", "kps" not in tracks[3])
    print("PASS" if good else "FAILED")
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())

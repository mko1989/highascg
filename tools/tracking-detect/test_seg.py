"""WO-665 T1 — self-test for seg.py (no model needed). Run with the sidecar venv:
    ~/.local/share/highascg/tracking-venv/bin/python tools/tracking-detect/test_seg.py
Driven from tools/smoke/smoke-wo665-person-cutouts.test.js when that venv exists (CI has none: skipped there)."""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import detector  # noqa: E402
import seg  # noqa: E402

SIZE, MW = 640, 160


def letterboxed(fw, fh):
    scale = min(SIZE / fw, SIZE / fh)
    rw, rh = round(fw * scale), round(fh * scale)
    return scale, ((SIZE - rw) // 2, (SIZE - rh) // 2)


def protos_with_person(fw, fh, person):
    """Prototype 0 = +big inside the person's rectangle (frame-normalised), -big outside; others 0."""
    scale, pad = letterboxed(fw, fh)
    p = np.zeros((32, MW, MW), np.float32)
    p[0] = -20.0
    k = MW / SIZE
    x1, y1 = (person[0] * fw * scale + pad[0]) * k, (person[1] * fh * scale + pad[1]) * k
    x2, y2 = (person[2] * fw * scale + pad[0]) * k, (person[3] * fh * scale + pad[1]) * k
    p[0, int(round(y1)):int(round(y2)), int(round(x1)):int(round(x2))] = 20.0
    return p, scale, pad


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + ("  " + detail if detail else ""))
    return ok


def main():
    good = True
    fw, fh = 640, 360  # a 16:9 frame scaled to fit 640 (what detector.to_rgb hands the model)
    coef = np.zeros(32, np.float32)
    coef[0] = 1.0
    # the person fills the left half of a box twice their width: the mask's left half on, right half off
    person = (0.40, 0.20, 0.45, 0.80)
    box = [0.40, 0.20, 0.50, 0.80]
    protos, scale, pad = protos_with_person(fw, fh, person)
    m = seg.mask_for(box, coef, protos, SIZE, scale, pad, fw, fh)
    good &= check("shape", m.shape == (seg.MASK_H, seg.MASK_W), str(m.shape))
    left, right = m[:, : seg.MASK_W // 2 - 2].mean(), m[:, seg.MASK_W // 2 + 2:].mean()
    good &= check("left half on, right half off (letterbox pad + scale mapped)", left > 0.95 and right < 0.05,
        "left %.2f right %.2f" % (left, right))
    # a box exactly on the person: all on (edges within a pixel)
    m2 = seg.mask_for(list(person), coef, protos, SIZE, scale, pad, fw, fh)
    good &= check("box on the person → filled", m2[2:-2, 2:-2].mean() > 0.97, "%.3f" % m2[2:-2, 2:-2].mean())
    # portrait frame (horizontal letterbox padding)
    protos3, s3, p3 = protos_with_person(360, 640, person)
    m3 = seg.mask_for(box, coef, protos3, SIZE, s3, p3, 360, 640)
    l3, r3 = m3[:, : seg.MASK_W // 2 - 2].mean(), m3[:, seg.MASK_W // 2 + 2:].mean()
    good &= check("portrait frame", l3 > 0.95 and r3 < 0.05, "left %.2f right %.2f" % (l3, r3))
    # wire format
    good &= check("encode → 576 bytes as base64", len(seg.encode(m)) == 768, str(len(seg.encode(m))))
    good &= check("decode(encode(m)) == m", np.array_equal(seg.decode(seg.encode(m)), m))
    # attach: live tracks get the mask of their own detection; coasting ones none
    raw = [(0.40, 0.20, 0.50, 0.80, 0.9, coef), (0.1, 0.1, 0.2, 0.5, 0.8, np.zeros(32, np.float32))]
    tracks = [{"tid": 1, "box": [0.4, 0.2, 0.5, 0.8], "score": 0.9, "age_s": 0.0},
        {"tid": 2, "box": [0.1, 0.1, 0.2, 0.5], "score": 0.8, "age_s": 0.4}]
    seg.attach(tracks, raw, (protos, SIZE, scale, pad, fw, fh))
    good &= check("live track got its mask", "mask" in tracks[0] and np.array_equal(seg.decode(tracks[0]["mask"]), m))
    good &= check("coasting track got none", "mask" not in tracks[1])
    # decode() carries coefficients through both heads and the person filter
    rows = np.zeros((3, 4 + 80), np.float32)
    rows[:, :4] = [[320, 180, 40, 200], [100, 100, 20, 80], [500, 300, 30, 60]]
    rows[:, 4] = [0.9, 0.1, 0.7]
    cf = np.arange(3 * 32, dtype=np.float32).reshape(3, 32)
    out = detector.decode(rows, 0.2, 10, 1.0, (0, 0), 640, 640, cf)
    good &= check("84-col head keeps each row's coefficients", len(out) == 2 and np.array_equal(out[0][5], cf[0])
        and np.array_equal(out[1][5], cf[2]))
    e2e = np.array([[10, 10, 50, 90, 0.8, 0], [10, 10, 50, 90, 0.9, 3]], np.float32)
    out2 = detector.decode(e2e, 0.2, 10, 1.0, (0, 0), 640, 640, cf[:2])
    good &= check("end-to-end head: person only, coefficients kept", len(out2) == 1 and np.array_equal(out2[0][5], cf[0]))
    good &= check("no coefficients → plain 5-tuples", len(detector.decode(rows, 0.2, 10, 1.0, (0, 0), 640, 640)[0]) == 5)
    print("PASS" if good else "FAILED")
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())

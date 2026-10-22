"""WO-675 P2 — self-test for the sidecar's body hook (no model needed: a stub stands in for body.Bodies). Run with the
sidecar venv:
    ~/.local/share/highascg/tracking-venv/bin/python tools/tracking-detect/test_body.py
Driven from tools/smoke/smoke-wo675-presenters.test.js when that venv exists (CI has none: skipped there)."""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import body  # noqa: E402
import sidecar  # noqa: E402


class StubBodies:
    def __init__(self):
        self.batches = []

    def embed_crops(self, crops):
        self.batches.append([c.shape for c in crops])
        v = np.ones(768, np.float32)
        return [v / np.linalg.norm(v) for _ in crops]


def track(tid, box, age=0.0):
    return {"tid": tid, "box": box, "score": 0.9, "age_s": age}


def apart(n, lost=()):
    return [track(i, [0.1 * i, 0.2, 0.1 * i + 0.05, 0.8], 0.5 if i in lost else 0.0) for i in range(1, n + 1)]


def test_throttle_budget_one_batch():
    cam, b = sidecar.Camera("cam_1"), StubBodies()
    bgr = np.zeros((1080, 1920, 3), np.uint8)
    t = apart(6, lost={2})
    sidecar.attach_bodies(b, cam, t, bgr, 10.0)
    assert len(b.batches) == 1 and len(b.batches[0]) == sidecar.BODIES_PER_STEP, b.batches
    assert "body" not in t[1], "a coasting (lost) track gets no body"
    assert len(t[0]["body"]) == 768 and abs(sum(v * v for v in t[0]["body"]) - 1.0) < 1e-3
    t = apart(6, lost={2})
    sidecar.attach_bodies(b, cam, t, bgr, 10.5)
    assert [x["tid"] for x in t if "body" in x] == [6], "the rest next frame; the first ones wait BODY_EVERY_S"
    sidecar.attach_bodies(b, cam, apart(1), bgr, 11.2)
    assert set(cam.body_at) == {1}, "gone tracks are forgotten"


def test_overlap_and_small_skipped():
    cam, b = sidecar.Camera("cam_1"), StubBodies()
    bgr = np.zeros((1080, 1920, 3), np.uint8)
    t = [track(1, [0.40, 0.2, 0.50, 0.8]), track(2, [0.44, 0.25, 0.54, 0.85]), track(3, [0.8, 0.5, 0.802, 0.52])]
    sidecar.attach_bodies(b, cam, t, bgr, 10.0)
    assert not any("body" in x for x in t), "two people in one crop, and a box below MIN_BODY_PX"
    assert b.batches == [], "no forward pass for nothing"


def test_grey_world_and_face_box():
    tinted = np.zeros((10, 10, 3), np.uint8)
    tinted[:] = (40, 80, 160)
    m = body.grey_world(tinted).reshape(-1, 3).mean(0)
    assert max(m) - min(m) < 2, m
    x1, y1, x2, y2 = body.box_from_face([450, 300, 100, 120], 1000, 2000)
    assert abs(x1 - 0.33) < 1e-6 and abs(x2 - 0.67) < 1e-6 and y2 == 1.0 and abs(y1 - 0.135) < 1e-6


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)

"""WO-675 — self-test for the sidecar's face hook (no model needed: a stub stands in for face.Faces). Run with the
sidecar venv:
    ~/.local/share/highascg/tracking-venv/bin/python tools/tracking-detect/test_face.py
Driven from tools/smoke/smoke-wo675-presenters.test.js when that venv exists (CI has none: skipped there)."""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import face  # noqa: E402
import sidecar  # noqa: E402


class StubFaces:
    def __init__(self):
        self.calls = []

    def embed_person(self, bgr, box):
        self.calls.append(tuple(box))
        v = np.ones(128, np.float32)
        return v / np.linalg.norm(v)


def tracks(n, lost=()):
    return [{"tid": i, "box": [0.1, 0.1, 0.2, 0.6], "score": 0.9, "age_s": 0.5 if i in lost else 0.0} for i in range(1, n + 1)]


def test_throttle_and_budget():
    cam, f = sidecar.Camera("cam_1"), StubFaces()
    bgr = np.zeros((1080, 1920, 3), np.uint8)
    t = tracks(5, lost={2})
    sidecar.attach_faces(f, cam, t, bgr, 10.0)
    with_face = [x["tid"] for x in t if "face" in x]
    assert len(f.calls) == sidecar.FACES_PER_STEP, f.calls
    assert 2 not in with_face, "a coasting (lost) track gets no face"
    assert len(t[0]["face"]) == 128 and abs(sum(v * v for v in t[0]["face"]) - 1.0) < 1e-3, "unit feature, 128 floats"
    t = tracks(5, lost={2})
    sidecar.attach_faces(f, cam, t, bgr, 10.5)
    assert [x["tid"] for x in t if "face" in x] == [5], "the rest of the live tracks next frame; the first three wait"
    t = tracks(5, lost={2})
    sidecar.attach_faces(f, cam, t, bgr, 11.1)
    assert len([x for x in t if "face" in x]) == 3, "after FACE_EVERY_S the tracks are due again"
    sidecar.attach_faces(f, cam, tracks(1), bgr, 11.2)
    assert set(cam.face_at) == {1}, "gone tracks are forgotten"


def test_bgra_view():
    w, h, stride = 4, 2, 24
    px = bytearray(stride * h)
    px[0:4] = bytes([10, 20, 30, 255])  # B G R A at (0, 0)
    bgr = face.bgr_from_bgra(bytes(px), w, h, stride)
    assert bgr.shape == (2, 4, 3) and list(bgr[0, 0]) == [10, 20, 30]


def test_small_box_gives_nothing():
    class NoModel(face.Faces):
        def __init__(self):
            pass

        def _largest(self, bgr):
            raise AssertionError("a crop below MIN_FACE_PX never reaches the detector")

    assert NoModel().embed_person(np.zeros((1080, 1920, 3), np.uint8), [0.5, 0.5, 0.505, 0.51]) is None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)

"""WO-1080 — self-test for the tracker's memory (no model needed). Run with the sidecar venv:
    ~/.local/share/highascg/tracking-venv/bin/python tools/tracking-detect/test_bytetrack.py
Driven from tools/smoke/smoke-wo1080-tracking-memory.test.js when that venv exists (CI has none: skipped there)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bytetrack  # noqa: E402
import detector  # noqa: E402

STEP = 0.067
CFG = {"confidence": 0.2, "interval_ms": 67, "max_persons": 10, "grace_ms": 500, "memory_ms": 30000}
A = (0.20, 0.20, 0.26, 0.60)
B = (0.60, 0.20, 0.66, 0.60)


def box(b, score=0.8, dx=0.0):
    return (b[0] + dx, b[1], b[2] + dx, b[3], score)


class Run:
    def __init__(self, cfg=CFG):
        self.det, self.t, self.cfg = detector.CameraDetector(), 0.0, cfg

    def step(self, raw):
        self.t += STEP
        return self.det.step(raw, self.t, self.cfg)

    def steps(self, raw, n):
        out = []
        for _ in range(n):
            out = self.step(raw)
        return out


def tids(out):
    return sorted(t["tid"] for t in out)


def test_confirmation():
    r = Run()
    assert r.step([box(A)]) == [], "one match is not a person yet"
    assert r.step([box(A)]) == []
    assert tids(r.step([box(A)])) == [0], "reported from the third match"
    r = Run()
    r.steps([box(A)], 2)
    assert r.steps([], 40) == [], "a two-frame blip is never reported"
    assert tids(r.steps([box(A)], 1)) == [0], "…but its matches count when it comes back at the same place"


def test_memory_keeps_the_id():
    r = Run()
    r.steps([box(A), box(B)], 10)
    out = r.steps([box(B)], int(10 / STEP))  # A undetected for 10 s
    assert tids(out) == [1], "A is not reported once its coast window is over"
    assert tids(r.step([box(A), box(B)])) == [0, 1], "A back where it stood: the same id, at once"
    assert r.det.tracker._next_id == 2, "no new id was made"


def test_memory_expires_and_can_be_off():
    r = Run()
    r.steps([box(A)], 10)
    r.steps([], int(31 / STEP))
    assert tids(r.steps([box(A)], 3)) == [1], "after memory_ms the person is new"
    r = Run(dict(CFG, memory_ms=0))
    r.steps([box(A)], 10)
    r.steps([], int(3 / STEP))
    assert tids(r.steps([box(A)], 3)) == [1], "memory_ms 0: forgotten after the coast window, as before"


def test_far_away_is_a_new_person():
    r = Run()
    r.steps([box(A)], 10)
    r.steps([], int(5 / STEP))
    assert tids(r.steps([box(B)], 3)) == [1], "a person elsewhere does not get a remembered id"
    assert tids(r.steps([box(A), box(B)], 1)) == [0, 1], "and the remembered one is still there to come back"


def test_live_track_chooses_before_memory_and_coasting():
    r = Run(dict(CFG, grace_ms=2000))
    r.steps([box(A), box(A, dx=0.05)], 10)  # two people side by side, overlapping boxes: ids 0 and 1
    out = r.steps([box(A)], 12)  # the right one drops out and coasts next to the left one
    assert [t["tid"] for t in out if t["age_s"] == 0] == [0], "the measured track keeps its own detection"
    assert 1 in tids(out), "the other is held (Keep lost 2 s)"
    out = r.steps([box(A)], int(4 / STEP))
    assert tids(out) == [0]
    assert tids(r.step([box(A), box(A, dx=0.05)])) == [0, 1], "it returns under its own id"


def test_coasting_slows_down():
    r = Run(dict(CFG, grace_ms=3000))
    for i in range(12):
        r.step([box(A, dx=0.01 * i)])  # walking right, 0.01 per step
    xs = [r.step([])[0]["box"][0] for _ in range(30)]
    first, last = xs[1] - xs[0], xs[-1] - xs[-2]
    assert first > 0.004, "it keeps gliding at first (a short occlusion)"
    assert last < first * 0.05, "and settles instead of sliding on (%.5f → %.5f)" % (first, last)
    assert xs[-1] - xs[0] < 0.01 * 8, "held within a few steps' travel of where it was lost"


def test_constants():
    assert bytetrack.MIN_HITS == 3 and 0.5 < bytetrack.DAMP < 1.0


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
    print("PASS")

"""WO-1086 — self-test for traits.py (no model needed): synthetic figures on a synthetic frame. Run with the sidecar venv:
    ~/.local/share/highascg/tracking-venv/bin/python tools/tracking-detect/test_traits.py
Driven from tools/smoke/smoke-wo1086-avatars.test.js when that venv exists (CI has none: skipped there)."""

import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seg  # noqa: E402
import traits  # noqa: E402

W, H = 1920, 1080
BOX = [0.45, 0.2, 0.55, 0.9]
STAGE = (90, 90, 95)  # RGB
LOOK = {"hair": (30, 24, 24), "skin": (225, 180, 150), "top": (190, 45, 50), "bottom": (35, 45, 85)}
RED, NAVY, WHITE = [200, 40, 44], [30, 40, 80], [236, 236, 232]
FAILS = []


def check(cond, what):
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        FAILS.append(what)


def frame(look=LOOK, box=BOX, bg=STAGE, torso=(0.25, 0.75), noise=0, rng=None):
    """BGR frame with one flat figure in `box`, a 1.75 m person's proportions (rows in box fractions: hair 0–3 %,
    face 3–13.5 %, neck, top 17–52 %, bottom 52–95 %, shoes)."""
    f = np.empty((H, W, 3), np.uint8)
    f[:] = bg[::-1]
    bx1, by1, bx2, by2 = box
    bw, bh = bx2 - bx1, by2 - by1

    def fill(x1, y1, x2, y2, rgb):
        f[int((by1 + y1 * bh) * H):int((by1 + y2 * bh) * H), int((bx1 + x1 * bw) * W):int((bx1 + x2 * bw) * W)] = rgb[::-1]

    fill(0.38, 0.03, 0.62, 0.135, look["skin"])
    fill(0.45, 0.135, 0.55, 0.17, look["skin"])
    fill(0.36, 0.0, 0.64, 0.03, look["hair"])
    fill(torso[0], 0.17, torso[1], 0.52, look["top"])
    fill(0.32, 0.52, 0.68, 0.95, look["bottom"])
    fill(0.32, 0.95, 0.68, 1.0, (20, 20, 20))
    if noise:
        f = np.clip(f.astype(np.int16) + rng.integers(-noise, noise + 1, f.shape), 0, 255).astype(np.uint8)
    return f


def run(cam, f, tracks, now):
    for t in tracks:
        t.pop("traits", None)
    cam.attach(tracks, f, now)
    return tracks


def track(tid=1, box=BOX, age=0.0, **kw):
    return {"tid": tid, "box": list(box), "score": 0.9, "age_s": age, **kw}


def test_solid_figure():
    cam, f = traits.CameraTraits(), frame()
    first_lock = None
    for i in range(20):
        t = run(cam, f, [track()], i * 0.25)[0]
        if first_lock is None and t.get("traits", {}).get("locked"):
            first_lock = i
    tr = t["traits"]
    check(tr["top"] == RED and tr["bottom"] == NAVY, "solid figure: top red, bottom navy (%s, %s)" % (tr["top"], tr["bottom"]))
    check(tr["skin"] in [list(s) for s in traits.SKIN] and tr["hair"] == list(traits.HAIR[0]),
        "skin from the skin palette, hair black (%s, %s)" % (tr["skin"], tr["hair"]))
    check("hair_len" not in tr, "no mask / pose: hair length is not guessed (%s)" % tr.get("hair_len"))
    check(first_lock == traits.MIN_SAMPLES + traits.LOCK_RUN - 2, "locks after %d samples (sample %s)" % (
        traits.MIN_SAMPLES + traits.LOCK_RUN - 1, first_lock))
    t = run(cam, f, [track()], 20 * 0.25 + 0.05)[0]  # 50 ms later: no new sample, traits still sent
    check(t["traits"]["top"] == RED and len(cam.people[1].top.samples) == traits.WINDOW, "between samples: traits sent, nothing sampled")


def test_noise_and_tint_do_not_flicker():
    rng, cam = np.random.default_rng(7), traits.CameraTraits()
    seen = set()
    for i in range(80):
        tint = rng.integers(-10, 11, 3)
        look = {k: tuple(int(np.clip(c + d, 0, 255)) for c, d in zip(v, tint)) for k, v in LOOK.items()}
        t = run(cam, frame(look, noise=14, rng=rng), [track()], i * 0.25)[0]
        if "traits" in t and i >= 5:
            seen.add((tuple(t["traits"]["top"]), tuple(t["traits"]["bottom"]), tuple(t["traits"]["hair"])))
    check(len(seen) == 1, "pixel noise ±14 + tint ±10: one look over 80 samples (%d)" % len(seen))


def test_palette_boundary_hysteresis():
    """A shirt halfway between red and maroon, wobbling either side every sample: the value never flips."""
    cam = traits.CameraTraits()
    mid = (np.array(RED) + np.array([120, 32, 44])) / 2
    vals = []
    for i in range(60):
        top = tuple(int(v) for v in mid + (12 if i % 2 else -12) * np.array([1, 0.1, 0]))
        t = run(cam, frame({**LOOK, "top": top}), [track()], i * 0.25)[0]
        if "top" in t.get("traits", {}):
            vals.append(tuple(t["traits"]["top"]))
    check(len(vals) > 50 and len(set(vals)) == 1, "near-tie shirt: the top never flips (%s over %d)" % (set(vals), len(vals)))


def test_jacket_off_resamples_with_hysteresis():
    cam = traits.CameraTraits()
    for i in range(20):
        run(cam, frame(), [track()], i * 0.25)
    switched = None
    for i in range(20, 60):
        t = run(cam, frame({**LOOK, "top": (235, 235, 230)}), [track()], i * 0.25)[0]
        if switched is None and t["traits"]["top"] == WHITE:
            switched = i - 20
    check(switched is not None and switched >= traits.SWITCH_RUN, "jacket off: top turns white after %s samples (≥ %d)" % (
        switched, traits.SWITCH_RUN))
    check(t["traits"]["locked"] and t["traits"]["bottom"] == NAVY, "still locked, bottom unchanged")
    blip = traits.CameraTraits()
    for i in range(20):
        run(blip, frame(), [track()], i * 0.25)
    for i in range(20, 26):  # 6 samples of something else (somebody walks in front, a lighting change)
        run(blip, frame({**LOOK, "top": (235, 235, 230)}), [track()], i * 0.25)
    t = run(blip, frame(), [track()], 30 * 0.25)[0]
    check(t["traits"]["top"] == RED, "a 1.5 s blip does not change the look")


def test_identity_memory_and_coasting():
    cam = traits.CameraTraits()
    for i in range(20):
        run(cam, frame(), [track()], i * 0.25)
    t = run(cam, frame(), [track(age=0.3)], 5.2)[0]
    check(t["traits"]["top"] == RED and cam.people[1].at == 19 * 0.25, "a coasting track keeps its traits, no sample taken")
    run(cam, frame(), [], 6.0)  # lost (parked in the tracker's memory)
    t = run(cam, frame({**LOOK, "top": (235, 235, 230)}), [track()], 15.0)[0]
    check(t["traits"]["top"] == RED and t["traits"]["locked"], "revived after 9 s: same look at once, locked")
    run(cam, frame(), [], 60.0)
    check(1 not in cam.people, "forgotten keep_s + 5 s after last seen")


def test_overlap_small_and_cut_boxes():
    cam = traits.CameraTraits()
    other = [0.47, 0.25, 0.58, 0.95]
    for i in range(10):
        ts = run(cam, frame(), [track(1), track(2, other)], i * 0.25)
    check(not cam.people and "traits" not in ts[0], "two overlapping people: nobody sampled (crops mix them)")
    small = [0.45, 0.5, 0.47, 0.56]  # 65 px tall
    run(cam, frame(box=small), [track(3, small)], 0.0)
    check(3 not in cam.people, "a box shorter than %d px is not sampled" % traits.MIN_BOX_PX)
    cut = [0.45, 0.0, 0.55, 0.6]
    for i in range(12):
        t = run(cam, frame(box=[0.45, -0.1, 0.55, 0.6]), [track(4, cut)], i * 0.25)[0]
    check("hair" not in t["traits"] and "skin" not in t["traits"] and t["traits"]["top"] == RED,
        "head cut by the frame top: no hair / skin guessed, top still read (%s)" % sorted(t["traits"]))


def test_mask_keeps_background_out():
    """A narrow torso against a loud green set: the box rectangle is mostly set; the seg mask keeps it out."""
    look, green = LOOK, (40, 200, 60)
    m = np.zeros((seg.MASK_H, seg.MASK_W), np.uint8)
    m[:, int(0.36 * seg.MASK_W):int(0.64 * seg.MASK_W)] = 1
    m[: int(0.52 * seg.MASK_H), int(0.42 * seg.MASK_W):int(0.58 * seg.MASK_W)] = 1
    m[int(0.17 * seg.MASK_H):int(0.52 * seg.MASK_H), :] = 0
    m[int(0.17 * seg.MASK_H):int(0.52 * seg.MASK_H), int(0.43 * seg.MASK_W):int(0.57 * seg.MASK_W)] = 1
    f = frame(look, bg=green, torso=(0.42, 0.58))
    with_mask, without = traits.CameraTraits(), traits.CameraTraits()
    for i in range(15):
        a = run(with_mask, f, [track(mask=seg.encode(m))], i * 0.25)[0]
        b = run(without, f, [track()], i * 0.25)[0]
    check(a["traits"]["top"] == RED, "with the mask: the shirt (%s)" % a["traits"]["top"])
    check(b["traits"]["top"] != RED, "without it the set leaks in (%s) — why the mask is used" % b["traits"]["top"])


def kps_for(box, pts):
    """{index: (x, y) in box fractions} → 51 wire numbers (others invisible)."""
    out = [0.0] * 51
    for i, (fx, fy) in pts.items():
        out[i * 3:i * 3 + 3] = [box[0] + fx * (box[2] - box[0]), box[1] + fy * (box[3] - box[1]), 0.9]
    return out


FRONT = {0: (0.5, 0.085), 1: (0.43, 0.062), 2: (0.57, 0.062), 3: (0.36, 0.07), 4: (0.64, 0.07), 5: (0.28, 0.18),
    6: (0.72, 0.18), 11: (0.38, 0.50), 12: (0.62, 0.50), 13: (0.40, 0.72), 14: (0.60, 0.72)}  # eyes 27 px apart


def test_keypoints_arms_up():
    """Arms up: the box reaches the hands; box fractions would read hands as hair. Keypoints put the regions right."""
    tall = [0.45, 0.05, 0.55, 0.9]
    f = frame(box=BOX)
    f[int(0.05 * H):int(0.2 * H), int(0.46 * W):int(0.48 * W)] = LOOK["skin"][::-1]  # raised hands, above the head
    sub = lambda fx, fy: (fx, (BOX[1] + fy * (BOX[3] - BOX[1]) - tall[1]) / (tall[3] - tall[1]))  # noqa: E731
    pts = {i: sub(*p) for i, p in FRONT.items()}
    pts[9], pts[10] = sub(0.15, -0.15), sub(0.85, -0.15)
    cam = traits.CameraTraits()
    for i in range(15):
        t = run(cam, f, [track(box=tall, kps=kps_for(tall, pts))], i * 0.25)[0]
    tr = t["traits"]
    check(tr["top"] == RED and tr["bottom"] == NAVY and tr["hair"] == list(traits.HAIR[0]) and tr["skin"] in [list(s) for s in traits.SKIN],
        "arms up + keypoints: top / bottom / hair / skin right (%s)" % tr)


def test_hair_length():
    long_f = frame()
    bx1, by1, bw, bh = BOX[0], BOX[1], BOX[2] - BOX[0], BOX[3] - BOX[1]
    for x in (0.35, 0.65):  # hair falling beside the neck, ear → shoulder
        long_f[int((by1 + 0.10 * bh) * H):int((by1 + 0.18 * bh) * H), int((bx1 + (x - 0.06) * bw) * W):int((bx1 + (x + 0.06) * bw) * W)] = LOOK["hair"][::-1]
    m = np.zeros((seg.MASK_H, seg.MASK_W), np.uint8)
    m[:, int(0.25 * seg.MASK_W):int(0.75 * seg.MASK_W)] = 1
    k = kps_for(BOX, FRONT)
    res = {}
    for name, f, mask in (("long", long_f, seg.encode(m)), ("short", frame(), seg.encode(m)), ("nomask", long_f, None)):
        cam = traits.CameraTraits()
        for i in range(15):
            t = run(cam, f, [track(kps=k, **({"mask": mask} if mask else {}))], i * 0.25)[0]
        res[name] = t["traits"].get("hair_len")
    check(res == {"long": "long", "short": "short", "nomask": None}, "hair length: told only with mask + pose (%s)" % res)
    cam = traits.CameraTraits()
    for i in range(15):  # black hair over a black suit: the neck sides cannot tell hair from collar
        t = run(cam, frame({**LOOK, "top": (28, 28, 30)}), [track(kps=k, mask=seg.encode(m))], i * 0.25)[0]
    check("hair_len" not in t["traits"], "hair like the top: hair length left out (%s)" % t["traits"].get("hair_len"))
    cam = traits.CameraTraits()
    bald = {**LOOK, "hair": LOOK["skin"]}
    for i in range(15):
        t = run(cam, frame(bald), [track(kps=k)], i * 0.25)[0]
    check(t["traits"].get("hair_len") == "bald", "a skin-coloured crown: bald (%s)" % t["traits"].get("hair_len"))


def test_back_of_head_gives_no_skin():
    back = {**LOOK, "skin": LOOK["hair"]}  # from behind the face patch is hair
    cam = traits.CameraTraits()
    for i in range(15):
        t = run(cam, frame(back), [track()], i * 0.25)[0]
    check("skin" not in t["traits"], "back of the head: no skin tone invented")


def test_cost():
    cam, f = traits.CameraTraits(), frame()
    boxes = [[0.05 + 0.15 * i, 0.2, 0.13 + 0.15 * i, 0.9] for i in range(6)]
    t0 = time.perf_counter()
    n = 50
    for i in range(n):
        run(cam, f, [track(i + 1, b) for i, b in enumerate(boxes)], i * 0.25)
    ms = (time.perf_counter() - t0) * 1000 / n
    print("cost: %.2f ms per step for 6 people sampled (1080p frame)" % ms)
    check(ms < 10.0, "6 people sampled in < 10 ms (%.2f)" % ms)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("FAIL (%d)" % len(FAILS) if FAILS else "PASS")
    sys.exit(1 if FAILS else 0)

"""WO-1086 — a tracked person's look for the previs avatars: top / bottom / skin / hair colour and hair length, read
from the same frame, boxes, WO-665 masks and WO-667 keypoints the sidecar already has. Never a picture: a handful of
palette colours per person, so the previs draws a cartoon character instead of camera pixels.

Per sample (a live, un-overlapped track, at most every SAMPLE_EVERY_S): each body region of the RAW frame (not the
detector's CLAHE copy) is cut down to ≤ 16 × 16 px and restricted to the person's seg mask when there is one; its pixels
vote for their nearest palette entry (CIE Lab) and the winner is the sample. Regions come from the keypoints when the
pose model runs, else from fixed fractions of a standing person's box. Each trait keeps a window of samples, follows
the window's clear majority, locks once that has held LOCK_RUN times running, and once locked changes only after
another entry has held the clear majority SWITCH_RUN times running (a jacket taken off: ~4 s; Vote). State is per camera + track id, so a
person the tracker revives from its WO-1080 memory comes back with the same look.

Hair length is only claimed with evidence: "bald" (crown ≈ skin), "long" / "short" only with seg + pose (the neck
sides are measured inside the mask) and hair that differs from the top; otherwise it is left out.
Deliberately not derived: glasses (a few pixels on stage), build (the box follows arm pose), gender, age, the face.
Wire (on a track): "traits": {"top"?, "bottom"?, "skin"?, "hair"?: [r, g, b] palette sRGB, "hair_len"?: "short" |
"long" | "bald", "locked": bool (every colour present is locked)}.
"""

from collections import deque

import cv2
import numpy as np

import seg

CLOTH = [(28, 28, 30), (64, 66, 72), (128, 130, 134), (190, 192, 196), (236, 236, 232), (226, 214, 180),
    (196, 170, 130), (110, 74, 48), (120, 32, 44), (200, 40, 44), (232, 120, 40), (236, 200, 60), (110, 112, 50),
    (50, 140, 70), (30, 130, 130), (110, 170, 220), (40, 90, 190), (30, 40, 80), (70, 100, 140), (110, 60, 150),
    (230, 130, 170)]  # black … pink: a pleasant flat palette, not the camera's exact shade
HAIR = [(25, 22, 22), (60, 40, 28), (110, 72, 44), (140, 60, 34), (196, 104, 52), (220, 190, 120), (236, 224, 190),
    (150, 150, 150), (230, 230, 226)]  # black, dark brown, brown, auburn, ginger, blonde, platinum, grey, white
SKIN = [(247, 224, 206), (234, 196, 166), (214, 165, 128), (176, 124, 88), (128, 86, 58), (88, 58, 40)]
HAIR_LEN = ["short", "long", "bald"]

SAMPLE_EVERY_S = 0.2
SAMPLES_PER_STEP = 6
WINDOW = 15
MIN_SAMPLES = 5
LOCK_RUN = 8
SWITCH_RUN = 10
MAJORITY = 0.6  # of the window: a clear choice
MIN_SHARE = 0.3  # of a region's pixels the winning palette entry needs, else the sample is a mess and dropped
MIN_BOX_PX = 80  # box height in source pixels; smaller has no usable regions
SKIN_MIN_FRAC = 0.3
KP_VIS = 0.5
# box fractions [x1, y1, x2, y2] of a standing person (no keypoints)
BOX_HAIR, BOX_FACE = (0.38, 0.0, 0.62, 0.035), (0.40, 0.055, 0.60, 0.11)
BOX_TOP, BOX_BOTTOM = (0.32, 0.22, 0.68, 0.45), (0.36, 0.55, 0.64, 0.72)


def to_lab(rgb):
    a = np.asarray(rgb, np.float32).reshape(-1, 1, 3) / 255.0
    return cv2.cvtColor(a, cv2.COLOR_RGB2LAB).reshape(-1, 3)


class Vote:
    """One trait over time: a window of per-sample winners (indices) → the window's choice. It follows a clear
    majority (≥ MAJORITY of the window) at once until it has agreed LOCK_RUN times running (locked); after that another
    entry must hold the clear majority SWITCH_RUN times running (a jacket taken off: ~4 s). A near tie keeps the value."""

    def __init__(self, names):
        self.palette = names
        self.samples = deque(maxlen=WINDOW)
        self.idx, self.locked, self.run, self.rival = None, False, 0, None

    def push(self, i):
        self.samples.append(int(i))
        if len(self.samples) < MIN_SAMPLES:
            return
        votes = np.bincount(np.asarray(self.samples), minlength=len(self.palette))
        best = int(np.argmax(votes))
        clear = votes[best] >= MAJORITY * len(self.samples)
        if self.idx is None:
            self.idx, self.run = best, int(clear)
        elif best == self.idx:
            self.rival = None
            if not self.locked and clear:
                self.run += 1
                self.locked = self.run >= LOCK_RUN
        elif not clear:
            self.rival, self.run = None, (self.run if not self.locked else 0)
        elif not self.locked:
            self.idx, self.run = best, 1
        else:
            self.run = self.run + 1 if self.rival == best else 1
            self.rival = best
            if self.run >= SWITCH_RUN:
                self.idx, self.rival, self.run = best, None, 0

    def value(self):
        if self.idx is None:
            return None
        v = self.palette[self.idx]
        return list(v) if isinstance(v, tuple) else v


class Colour(Vote):
    """A colour trait: each sample's pixels vote for their nearest palette entry (CIE76); the sample is the winner,
    so a mixed region (a strap, an arm across the shirt) gives the colour that covers most of it, never an average."""

    def __init__(self, palette):
        super().__init__(palette)
        self.lab = to_lab(palette)

    def push_px(self, px):
        if px is None:
            return
        lab = to_lab(px[:, ::-1])
        near = np.argmin(np.linalg.norm(lab[:, None, :] - self.lab[None, :, :], axis=2), axis=1)
        votes = np.bincount(near, minlength=len(self.palette))
        if votes.max() >= MIN_SHARE * len(near):
            self.push(int(np.argmax(votes)))


class Person:
    def __init__(self):
        self.top, self.bottom, self.skin, self.hair = Colour(CLOTH), Colour(CLOTH), Colour(SKIN), Colour(HAIR)
        self.hair_len = Vote(HAIR_LEN)
        self.at, self.seen = -1e9, 0.0

    def wire(self):
        out, locks = {}, []
        for k in ("top", "bottom", "skin", "hair"):
            c = getattr(self, k)
            if c.value() is not None:
                out[k] = c.value()
                locks.append(c.locked)
        if not out:
            return None
        if self.hair_len.value() is not None:
            out["hair_len"] = self.hair_len.value()
        out["locked"] = all(locks)
        return out


def region(bgr, box, r, mask=None, frac=False):
    """BGR pixels (n × 3) of box-fraction rectangle r, ≤ 16 × 16, inside the mask grid when given; None if empty.
    frac=True → (pixels, the share of the rectangle inside the mask)."""
    h, w = bgr.shape[:2]
    bw, bh = box[2] - box[0], box[3] - box[1]
    r = (max(0.0, min(r[0], r[2])), max(0.0, min(r[1], r[3])), min(1.0, max(r[0], r[2])), min(1.0, max(r[1], r[3])))
    x1, x2 = int(max(0, (box[0] + r[0] * bw) * w)), int(min(w, (box[0] + r[2] * bw) * w))
    y1, y2 = int(max(0, (box[1] + r[1] * bh) * h)), int(min(h, (box[1] + r[3] * bh) * h))
    if x2 - x1 < 2 or y2 - y1 < 2:
        return (None, 0.0) if frac else None
    sw, sh = min(16, x2 - x1), min(16, y2 - y1)
    px = cv2.resize(np.ascontiguousarray(bgr[y1:y2, x1:x2]), (sw, sh), interpolation=cv2.INTER_AREA).reshape(-1, 3)
    if mask is not None:
        mh, mw = mask.shape
        m = mask[int(r[1] * mh):max(int(r[1] * mh) + 1, int(np.ceil(r[3] * mh))),
            int(r[0] * mw):max(int(r[0] * mw) + 1, int(np.ceil(r[2] * mw)))]
        keep = cv2.resize(m.astype(np.uint8), (sw, sh), interpolation=cv2.INTER_NEAREST).reshape(-1) > 0
        px = px[keep]
    got = px if len(px) >= 4 else None
    return (got, len(px) / float(sw * sh)) if frac else got


def median_lab(px):
    return None if px is None else to_lab(np.median(px, axis=0)[::-1])[0]


def skin_px(px):
    """The skin-like pixels (broad YCrCb range), None when too few are skin (the back of a head)."""
    if px is None:
        return None
    ycc = cv2.cvtColor(px.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_BGR2YCrCb).reshape(-1, 3)
    ok = (ycc[:, 0] > 40) & (ycc[:, 1] >= 133) & (ycc[:, 1] <= 180) & (ycc[:, 2] >= 77) & (ycc[:, 2] <= 135)
    return px[ok] if ok.mean() >= SKIN_MIN_FRAC and ok.sum() >= 4 else None


def regions(t, w=1920, h=1080):
    """Track → {name: box-fraction rect | None} (+ "neck": [rects] for hair length, keypoints only). Head sizes are
    measured across (eye or ear distance, box widths) and turned into box heights with the box's pixel aspect."""
    box = t["box"]
    bw, bh = max(1e-6, box[2] - box[0]), max(1e-6, box[3] - box[1])
    asp = bw * w / (bh * h)  # one box width in box heights
    cut_top, cut_bottom = box[1] <= 0.005, box[3] >= 0.995
    k = t.get("kps")
    if not (isinstance(k, list) and len(k) == 51):
        return {"hair": None if cut_top else BOX_HAIR, "face": None if cut_top else BOX_FACE, "top": BOX_TOP,
            "bottom": None if cut_bottom else BOX_BOTTOM, "neck": []}
    kp = np.asarray(k, np.float32).reshape(17, 3)
    seen = kp[:, 2] >= KP_VIS
    f = np.stack([(kp[:, 0] - box[0]) / bw, (kp[:, 1] - box[1]) / bh], 1)  # keypoints in box fractions
    out = {"hair": None, "face": None, "top": None, "bottom": None, "neck": []}
    if seen[[5, 6, 11, 12]].all():
        xs, ys, yh = f[[5, 6, 11, 12], 0], f[[5, 6], 1].mean(), f[[11, 12], 1].mean()
        a, b = xs.min(), xs.max()
        out["top"] = (a + 0.2 * (b - a), ys + 0.15 * (yh - ys), b - 0.2 * (b - a), yh - 0.1 * (yh - ys))
        if seen[[13, 14]].all():
            yk = f[[13, 14], 1].mean()
            out["bottom"] = (f[[11, 12], 0].min(), yh + 0.1 * (yk - yh), f[[11, 12], 0].max(), yk)
    hand_up = seen[0] and any(seen[w] and kp[w, 1] < kp[0, 1] for w in (9, 10))
    if seen[[0, 1, 2]].all():
        d = max(abs(f[1, 0] - f[2, 0]), 0.02)  # eye distance ≈ 6 cm; the crown is ≈ 1.75 of it above the eyes
        ex, ey = f[[1, 2], 0].mean(), f[[1, 2], 1].mean()
        out["face"] = (ex - 0.6 * d, ey - 0.2 * d * asp, ex + 0.6 * d, f[0, 1] + 0.4 * d * asp)
        out["hair"] = (ex - 0.8 * d, ey - 1.6 * d * asp, ex + 0.8 * d, ey - 1.1 * d * asp)
    elif seen[[3, 4]].all() and not seen[0]:  # the back of the head
        d = max(abs(f[3, 0] - f[4, 0]), 0.03)  # ear distance ≈ head width
        ex, ey = f[[3, 4], 0].mean(), f[[3, 4], 1].mean()
        out["hair"] = (ex - 0.35 * d, ey - 0.9 * d * asp, ex + 0.35 * d, ey - 0.1 * d * asp)
        if seen[[5, 6]].all():
            ys = f[[5, 6], 1].mean()
            out["neck"] = [(ex - 0.3 * d, ey + 0.4 * (ys - ey), ex + 0.3 * d, ys + 0.3 * (ys - ey))]
    if seen[[0, 1, 2]].all() and seen[[5, 6]].all():  # beside the neck, under each ear (eye when the ear is hidden)
        d = max(abs(f[1, 0] - f[2, 0]), 0.02)
        ys = f[[5, 6], 1].mean()
        for ear, eye in ((3, 1), (4, 2)):
            x, y = (f[ear] if seen[ear] else f[eye] + np.array([0.0, 0.15 * d * asp]))
            out["neck"].append((x - 0.35 * d, y + 0.35 * (ys - y), x + 0.35 * d, ys - 0.05 * (ys - y)))
    if cut_top or hand_up:
        out["hair"] = None if cut_top or not seen[[1, 2]].all() else out["hair"]
    return out


def hair_length(bgr, box, rs, mask, hair, skin, top):
    """'bald' when the hair patch is skin; with seg + pose, 'long' when masked pixels beside the neck are hair, else
    'short'. None when it cannot be told: no mask / keypoints, or hair and clothes too alike (black hair, black suit)."""
    if skin is not None and float(np.linalg.norm(hair - skin)) < 12.0:
        return "bald"
    if mask is None or not rs or top is None or float(np.linalg.norm(hair - top)) < 15.0:
        return None
    measured = False
    for r in rs:
        px, share = region(bgr, box, r, mask, frac=True)
        if px is None or share < 0.35:
            continue
        measured = True
        lab = median_lab(px)
        dh = float(np.linalg.norm(lab - hair))
        if dh < 20.0 and (skin is None or dh < float(np.linalg.norm(lab - skin))):
            return "long"
    return "short" if measured else None


def sample(p, bgr, t):
    """One look at a person: every region that gave pixels votes; median Labs feed the hair-length checks."""
    mask = seg.decode(t["mask"]) if isinstance(t.get("mask"), str) else None
    rs, box = regions(t, bgr.shape[1], bgr.shape[0]), t["box"]
    labs = {}
    for name in ("top", "bottom"):
        px = region(bgr, box, rs[name], mask) if rs[name] else None
        getattr(p, name).push_px(px)
        labs[name] = median_lab(px)
    if labs["top"] is None and p.top.locked:
        labs["top"] = p.top.lab[p.top.idx]
    spx = skin_px(region(bgr, box, rs["face"], mask)) if rs["face"] else None
    p.skin.push_px(spx)
    skin = median_lab(spx) if spx is not None else (p.skin.lab[p.skin.idx] if p.skin.locked else None)
    hpx = region(bgr, box, rs["hair"], mask) if rs["hair"] else None
    if hpx is not None:
        p.hair.push_px(hpx)
        kind = hair_length(bgr, box, rs["neck"], mask, median_lab(hpx), skin, labs["top"])
        if kind is not None:
            p.hair_len.push(HAIR_LEN.index(kind))


def overlapped(box, others, frac=0.3):
    a = max(1e-6, (box[2] - box[0]) * (box[3] - box[1]))
    for o in others:
        iw, ih = min(box[2], o[2]) - max(box[0], o[0]), min(box[3], o[3]) - max(box[1], o[1])
        if iw > 0 and ih > 0 and iw * ih / a > frac:
            return True
    return False


class CameraTraits:
    """One camera's people, by track id; kept `keep_s` after last seen (the tracker's memory) so a revived id keeps
    its look."""

    def __init__(self):
        self.people = {}

    def attach(self, tracks, bgr, now, keep_s=30.0):
        h = bgr.shape[0]
        live = [t for t in tracks if t.get("age_s", 0) == 0]
        done = 0
        for t in tracks:
            p = self.people.get(t["tid"])
            box = t["box"]
            if (t.get("age_s", 0) == 0 and done < SAMPLES_PER_STEP and (p is None or now - p.at >= SAMPLE_EVERY_S)
                    and (box[3] - box[1]) * h >= MIN_BOX_PX and not overlapped(box, [o["box"] for o in live if o is not t])):
                p = p or self.people.setdefault(t["tid"], Person())
                p.at = now
                done += 1
                sample(p, bgr, t)
            if p is not None:
                p.seen = now
                w = p.wire()
                if w:
                    t["traits"] = w
        for tid in [k for k, v in self.people.items() if now - v.seen > keep_s + 5.0]:
            del self.people[tid]

"""WO-616 T9 — ByteTrack multi-person tracker (pure NumPy) for the detection sidecar.

Port of OpenFollow `openfollow/video/tracking.py` @ 2f8aa257 (AGPL-3.0-or-later, (C) 2026 The OpenFollow Project –
Paul Hermann, Michel Honold, Vinzenz Schultz). A constant-velocity Kalman filter on [cx, cy, a=w/h, h] predicts each
track; detections bind in two greedy IoU passes — the high-confidence band first (with a centre-distance rescue for
fast movers), then the low band against every still-unmatched track (holds a performer dimming into shadow). Only
high detections spawn tracks. Everything is in normalised 0–1 frame space.
Changes: boxes are plain (x1, y1, x2, y2, score) tuples instead of DetectionBox; comments condensed. Same constants,
noise model, gates, ranking and lifecycle.
"""

import numpy as np

HIGH_IOU_GATE = 0.2  # first association, against the Kalman-predicted box
LOW_IOU_GATE = 0.5  # second association: strict, low boxes are noisy
LOW_DETECTION_THRESHOLD = 0.1  # score floor of the low (recovery) band
DIST_RESCUE_FACTOR = 1.5  # first pass only: centre within this many predicted-box widths


def _xyah(b):
    w = max(float(b[2]) - float(b[0]), 1e-6)
    h = max(float(b[3]) - float(b[1]), 1e-6)
    return np.array([float(b[0]) + w / 2.0, float(b[1]) + h / 2.0, w / h, h], dtype=np.float64)


def _tlbr(mean):
    cx, cy, a, h = float(mean[0]), float(mean[1]), float(mean[2]), max(float(mean[3]), 1e-6)
    w = max(a * h, 1e-6)
    return (cx - w / 2.0, cy - h / 2.0, cx + w / 2.0, cy + h / 2.0)


def iou_matrix(t, d):
    """Pairwise IoU of (N, 4) and (M, 4) tlbr boxes."""
    tl = np.maximum(t[:, None, :2], d[None, :, :2])
    br = np.minimum(t[:, None, 2:], d[None, :, 2:])
    wh = np.clip(br - tl, 0.0, None)
    inter = wh[..., 0] * wh[..., 1]
    area_t = np.clip(t[:, 2] - t[:, 0], 0.0, None) * np.clip(t[:, 3] - t[:, 1], 0.0, None)
    area_d = np.clip(d[:, 2] - d[:, 0], 0.0, None) * np.clip(d[:, 3] - d[:, 1], 0.0, None)
    union = area_t[:, None] + area_d[None, :] - inter
    return np.where(union > 0.0, inter / np.where(union > 0.0, union, 1.0), 0.0)


class KalmanFilter:
    """8-dim constant-velocity filter; noise scales with box height (SORT / ByteTrack parameterisation)."""

    POS = 1.0 / 20
    VEL = 1.0 / 160

    def __init__(self):
        self._h = np.eye(4, 8)
        self._f = np.eye(8)

    def initiate(self, z):
        h = float(z[3])
        std = [2 * self.POS * h, 2 * self.POS * h, 1e-2, 2 * self.POS * h,
            10 * self.VEL * h, 10 * self.VEL * h, 1e-5, 10 * self.VEL * h]
        return np.concatenate([z, np.zeros(4)]), np.diag(np.square(std))

    def predict(self, mean, cov, dt=1.0):
        """Advance by dt nominal steps: both the extrapolation and the process noise scale with dt."""
        h = float(mean[3])
        p, v = self.POS * h * dt, self.VEL * h * dt
        q = np.diag(np.square([p, p, 1e-2, p, v, v, 1e-5, v]))
        f = self._f
        for i in range(4):
            f[i, 4 + i] = dt
        return f @ mean, f @ cov @ f.T + q

    def update(self, mean, cov, z):
        h = float(mean[3])
        r = np.diag(np.square([self.POS * h, self.POS * h, 1e-1, self.POS * h]))
        pm = self._h @ mean
        s = self._h @ cov @ self._h.T + r
        k = np.linalg.solve(s, (cov @ self._h.T).T).T  # K = P Hᵀ S⁻¹ without an inverse
        return mean + (z - pm) @ k.T, cov - k @ s @ k.T


class Track:
    """One person: Kalman state, 'tracked' | 'lost', a stable id. The reported box is the measurement while
    tracked and the prediction while lost (a pinned marker glides through a short occlusion)."""

    def __init__(self, box, kf, track_id, now):
        self._kf = kf
        self.track_id = track_id
        self.score = float(box[4])
        self.state = "tracked"
        self.last_seen = now
        self.mean, self.cov = kf.initiate(_xyah(box))
        self.box = tuple(float(v) for v in box[:4])

    def predict(self, dt=1.0):
        if self.state == "lost":
            self.mean[6] = 0.0  # unobserved: keep the shape, extrapolate the centre only
            self.mean[7] = 0.0
        self.mean, self.cov = self._kf.predict(self.mean, self.cov, dt)
        if self.state == "lost":
            self.box = _tlbr(self.mean)

    def update(self, box, now):
        self.mean, self.cov = self._kf.update(self.mean, self.cov, _xyah(box))
        self.score = float(box[4])
        self.state = "tracked"
        self.last_seen = now
        self.box = tuple(float(v) for v in box[:4])

    def mark_lost(self):
        self.state = "lost"
        self.box = _tlbr(self.mean)

    @property
    def predicted(self):
        return _tlbr(self.mean)


class ByteTracker:
    def __init__(self):
        self._kf = KalmanFilter()
        self.tracks = []
        self._next_id = 0

    def update(self, high, low, now, max_lost_s, dt=1.0):
        """high: boxes ≥ confidence; low: [LOW_DETECTION_THRESHOLD, confidence). → the live tracks."""
        for t in self.tracks:
            t.predict(dt)
        unmatched, new_high = _associate(self.tracks, high, HIGH_IOU_GATE, now, DIST_RESCUE_FACTOR)
        still, _ = _associate(unmatched, low, LOW_IOU_GATE, now, 0.0)
        for t in still:
            if t.state == "tracked":
                t.mark_lost()
        for b in new_high:
            self.tracks.append(Track(b, self._kf, self._next_id, now))
            self._next_id += 1
        self.tracks = [t for t in self.tracks if t.state != "lost" or now - t.last_seen <= max_lost_s]
        return self.tracks


def _associate(tracks, dets, gate, now, dist_factor):
    """Greedy best-first matching ranked by (IoU, −centre distance); matched tracks update in place.
    → (unmatched tracks, unmatched detections)."""
    if not tracks or not dets:
        return list(tracks), list(dets)
    tb = np.array([t.predicted for t in tracks], dtype=np.float64)
    db = np.array([d[:4] for d in dets], dtype=np.float64)
    iou = iou_matrix(tb, db)
    if dist_factor > 0.0:
        dist = np.hypot((tb[:, 0] + tb[:, 2])[:, None] / 2.0 - (db[:, 0] + db[:, 2])[None, :] / 2.0,
            (tb[:, 1] + tb[:, 3])[:, None] / 2.0 - (db[:, 1] + db[:, 3])[None, :] / 2.0)
        reach = dist <= (dist_factor * (tb[:, 2] - tb[:, 0]))[:, None]
    pairs = []
    for ti in range(len(tracks)):
        for di in range(len(dets)):
            s = float(iou[ti, di])
            admit = s >= gate
            nd = 0.0
            if dist_factor > 0.0:
                admit = admit or bool(reach[ti, di])
                nd = -float(dist[ti, di])
            if admit:
                pairs.append((s, nd, ti, di))
    pairs.sort(reverse=True)
    mt, md = set(), set()
    for _s, _nd, ti, di in pairs:
        if ti in mt or di in md:
            continue
        tracks[ti].update(dets[di], now)
        mt.add(ti)
        md.add(di)
    return [t for i, t in enumerate(tracks) if i not in mt], [d for i, d in enumerate(dets) if i not in md]

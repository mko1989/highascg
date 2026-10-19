"""WO-616 T9 — person detector for the tracking sidecar: ONNX YOLO person boxes + ByteTrack, per camera.

Ports the inference / tracking path of OpenFollow `openfollow/video/detection.py` @ 2f8aa257 (AGPL-3.0-or-later,
(C) 2026 The OpenFollow Project – Paul Hermann, Michel Honold, Vinzenz Schultz): CLAHE on L (clip 2.0, 8×8 tiles),
letterbox to the model's square input (pad 114), /255 NCHW RGB; both YOLO heads (6-column end-to-end
[x1,y1,x2,y2,conf,cls] → person class, no NMS; [cx,cy,w,h,class scores…] → person score column 4 + greedy NMS IoU
0.45); boxes normalised 0–1; feet-point (bottom-centre) ROI masks before tracking; raw boxes pulled down to the
ByteTrack low floor and split high / low at `confidence`; the step allowance (interval floor, longest of the last
8 step gaps) and coast window (max(grace, allowance)) that set how long a lost track is kept and its age_s.
Changes: frames come from a HighAsCG shm surface (BGRA) instead of a GStreamer appsink, and are downscaled to the
model size BEFORE CLAHE (OpenFollow's appsink delivers a pre-scaled frame; this keeps CLAHE off a 1080p frame);
execution providers prefer CUDA when the onnxruntime build has it (OpenFollow: CoreML), then CPU; no pinning here
(the server owns markers).
"""

from collections import deque

import cv2
import numpy as np

import bytetrack

PAD = 114
NMS_IOU = 0.45
RAW_CAP = 60
STEP_HISTORY = 8
MIN_DT, MAX_DT = 0.1, 8.0


def select_providers(available):
    return [p for p in ("CUDAExecutionProvider",) if p in available] + ["CPUExecutionProvider"]


class Backend:
    def __init__(self, model_path, threads=4):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        self.session = ort.InferenceSession(model_path, sess_options=opts,
            providers=select_providers(ort.get_available_providers()))
        inp = self.session.get_inputs()[0]
        self.input_name = inp.name
        self.output_name = self.session.get_outputs()[0].name
        shape = inp.shape
        ok = len(shape) >= 4 and all(isinstance(v, int) and v > 0 for v in shape[2:4])
        self.size = max(shape[2], shape[3]) if ok else 640
        self.providers = self.session.get_providers()

    def predict(self, rgb, floor, cap):
        """rgb: preprocessed HxWx3 uint8 → [(x1, y1, x2, y2, score)] normalised, score ≥ floor."""
        tensor, scale, pad = letterbox(rgb, self.size)
        x = np.expand_dims(np.transpose(tensor.astype(np.float32) / 255.0, (2, 0, 1)), 0)
        pred = prepare(self.session.run([self.output_name], {self.input_name: x})[0])
        return decode(pred, floor, cap, scale, pad, rgb.shape[1], rgb.shape[0])


def letterbox(img, size):
    h, w = img.shape[:2]
    scale = min(size / w, size / h)
    rw, rh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    out = np.full((size, size, 3), PAD, dtype=np.uint8)
    px, py = (size - rw) // 2, (size - rh) // 2
    out[py:py + rh, px:px + rw] = cv2.resize(img, (rw, rh), interpolation=cv2.INTER_LINEAR) if (rw, rh) != (w, h) else img
    return out, scale, (px, py)


def prepare(raw):
    """Drop the batch axis; [84, N] / [6, N] → rows."""
    p = np.asarray(raw)
    if p.ndim == 3:
        p = p[0]
    if p.ndim != 2:
        return np.empty((0, 0), np.float32)
    if (p.shape[0] < p.shape[1] and p.shape[0] >= 6) or (p.shape[1] < 6 and p.shape[0] >= 6):
        p = p.T
    return p.astype(np.float32, copy=False)


def nms(boxes, scores, iou):
    order = np.argsort(-scores)
    keep = []
    while order.size:
        i = int(order[0])
        keep.append(i)
        if order.size == 1:
            break
        ov = bytetrack.iou_matrix(boxes[i:i + 1].astype(np.float64), boxes[order[1:]].astype(np.float64))[0]
        order = order[1:][ov <= iou]
    return keep


def decode(pred, floor, cap, scale, pad, fw, fh):
    if pred.size == 0 or pred.shape[1] <= 4:
        return []
    scores = pred[:, 4]
    if pred.shape[1] == 6:  # end-to-end head: already de-duplicated — person class only, no second NMS
        m = (scores >= floor) & (np.rint(pred[:, 5]) == 0)
        boxes, scores = pred[m, :4].astype(np.float32), scores[m]
        order = list(np.argsort(-scores))
    else:  # [cx, cy, w, h, class scores…]: column 4 is "person"
        m = scores >= floor
        b, scores = pred[m, :4], scores[m]
        boxes = np.stack([b[:, 0] - b[:, 2] / 2, b[:, 1] - b[:, 3] / 2, b[:, 0] + b[:, 2] / 2, b[:, 1] + b[:, 3] / 2], 1)
        order = nms(boxes, scores, NMS_IOU) if len(scores) else []
    s = max(scale, 1e-6)
    out = []
    for i in order:
        x1, y1, x2, y2 = boxes[i]
        x1 = float(np.clip((x1 - pad[0]) / s, 0, fw))
        x2 = float(np.clip((x2 - pad[0]) / s, 0, fw))
        y1 = float(np.clip((y1 - pad[1]) / s, 0, fh))
        y2 = float(np.clip((y2 - pad[1]) / s, 0, fh))
        if x2 > x1 and y2 > y1:
            out.append((x1 / fw, y1 / fh, x2 / fw, y2 / fh, float(scores[i])))
            if len(out) >= cap:
                break
    return out


def point_in_polygon(px, py, poly):
    inside = False
    x1, y1 = poly[-1]
    for x2, y2 in poly:
        if (y1 > py) != (y2 > py) and px < x1 + (py - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
        x1, y1 = x2, y2
    return inside


def filter_masks(boxes, masks):
    """Keep boxes whose feet (bottom-centre) lie in an enabled mask; no usable mask = everything passes."""
    polys = [m["vertices"] for m in masks or [] if m.get("enabled", True) and len(m.get("vertices", [])) >= 3]
    if not polys:
        return boxes
    return [b for b in boxes if any(point_in_polygon((b[0] + b[2]) / 2, b[3], p) for p in polys)]


def to_rgb(pixels, width, height, stride, size):
    """shm BGRA (premultiplied; channel output is opaque) → RGB scaled to fit `size` (INTER_AREA)."""
    a = np.frombuffer(pixels, np.uint8).reshape(height, stride)[:, :width * 4].reshape(height, width, 4)
    s = min(1.0, size / max(width, height))
    if s < 1.0:
        a = cv2.resize(a, (max(1, round(width * s)), max(1, round(height * s))), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(a, cv2.COLOR_BGRA2RGB)


class CameraDetector:
    """One camera's detection state: CLAHE, tracker, step timing."""

    def __init__(self):
        self.clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        self.tracker = bytetrack.ByteTracker()
        self.gaps = deque(maxlen=STEP_HISTORY)
        self.last_t = None

    def preprocess(self, rgb):
        lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
        lab[:, :, 0] = self.clahe.apply(lab[:, :, 0])
        return cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)

    def step(self, raw, now, cfg):
        """raw boxes (≥ the low floor) → [{tid, box, score, age_s}] for every live track (lost ones coasting)."""
        conf = cfg["confidence"]
        nominal = max(cfg["interval_ms"] / 1000.0, 1e-3)
        gap = None if self.last_t is None else now - self.last_t
        dt = 1.0 if gap is None else min(max(gap / nominal, MIN_DT), MAX_DT)
        self.last_t = now
        if gap is not None:
            self.gaps.append(min(gap, MAX_DT * nominal))  # an outage is not a step
        allowance = max(nominal, max(self.gaps, default=0.0))
        coast = max(cfg["grace_ms"] / 1000.0, allowance)
        tracks = self.tracker.update([b for b in raw if b[4] >= conf], [b for b in raw if b[4] < conf], now,
            allowance + coast, dt)
        out = []
        for t in tracks:
            live = t.state == "tracked"
            out.append({"tid": t.track_id, "box": [round(v, 5) for v in t.box], "score": round(t.score, 3),
                "age_s": 0.0 if live else round(max(0.0, now - t.last_seen - allowance), 3)})
        out.sort(key=lambda d: (d["age_s"] > 0, -d["score"]))
        return out[:cfg["max_persons"]]

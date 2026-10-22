"""WO-667 T1 — body keypoints from a YOLO pose model (yolo26n-pose), for the posed previs dummies (research step 3).

A pose model's rows are [cx, cy, w, h, person score, 17 × (x, y, visibility)] in letterbox pixels ([1, 56, N]); an
end-to-end export gives [x1, y1, x2, y2, score, class, 17 × 3]. It runs as a SECOND session on the same preprocessed
frame as the person detector (whose model the operator picked, e.g. yolo26n-seg for the cut-out masks). Each LIVE
track takes the keypoints of the pose detection that overlaps its box most (IoU ≥ MIN_IOU, each pose used once): the
two models see the same person but never produce identical boxes. Coasting tracks get none (the previs holds the last).

Wire format (on a live track): "kps": 51 numbers, 17 × [x, y, v] — x, y normalised to the frame (0–1, 4 decimals),
v the model's visibility 0–1 (2 decimals). COCO order: nose, eye L/R, ear L/R, shoulder L/R, elbow L/R, wrist L/R,
hip L/R, knee L/R, ankle L/R.
"""

import numpy as np

import detector

NK = 17
MIN_IOU = 0.4


class PoseBackend:
    def __init__(self, model_path, threads=2):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        self.session = ort.InferenceSession(model_path, sess_options=opts,
            providers=detector.select_providers(ort.get_available_providers()))
        inp = self.session.get_inputs()[0]
        self.input_name = inp.name
        self.output_name = self.session.get_outputs()[0].name
        shape = inp.shape
        ok = len(shape) >= 4 and all(isinstance(v, int) and v > 0 for v in shape[2:4])
        self.size = max(shape[2], shape[3]) if ok else 640

    def predict(self, rgb, floor):
        """rgb: the detector's preprocessed frame → [(x1, y1, x2, y2, score, kps [17, 3])], normalised to the frame."""
        tensor, scale, pad = detector.letterbox(rgb, self.size)
        x = np.expand_dims(np.transpose(tensor.astype(np.float32) / 255.0, (2, 0, 1)), 0)
        pred = detector.prepare(self.session.run([self.output_name], {self.input_name: x})[0])
        return decode(pred, floor, scale, pad, rgb.shape[1], rgb.shape[0])


def decode(pred, floor, scale, pad, fw, fh):
    """Pose rows (either head) → detector.decode boxes with each row's keypoints mapped out of the letterbox."""
    if pred.ndim != 2:
        return []
    if pred.shape[1] == 5 + 3 * NK:
        head, kp = pred[:, :5], pred[:, 5:]
    elif pred.shape[1] == 6 + 3 * NK:
        head, kp = pred[:, :6], pred[:, 6:]
    else:
        return []
    s = max(scale, 1e-6)
    out = []
    for r in detector.decode(head, floor, detector.RAW_CAP, scale, pad, fw, fh, kp):
        k = np.asarray(r[5], np.float32).reshape(NK, 3).copy()
        k[:, 0] = np.clip((k[:, 0] - pad[0]) / s / fw, 0.0, 1.0)
        k[:, 1] = np.clip((k[:, 1] - pad[1]) / s / fh, 0.0, 1.0)
        k[:, 2] = np.clip(k[:, 2], 0.0, 1.0)
        out.append(r[:5] + (k,))
    return out


def encode(k):
    return [round(float(v), 4 if i % 3 < 2 else 2) for i, v in enumerate(np.asarray(k).reshape(-1))]


def attach(tracks, poses):
    """Give each LIVE track the keypoints of its best-overlapping pose detection (greedy by IoU, each pose once)."""
    live = [t for t in tracks if t["age_s"] <= 0]
    if not live or not poses:
        return
    tb = np.array([t["box"] for t in live], np.float64)
    pb = np.array([p[:4] for p in poses], np.float64)
    iou = detector.bytetrack.iou_matrix(tb, pb)
    used = set()
    for flat in np.argsort(-iou, axis=None):
        ti, pi = np.unravel_index(flat, iou.shape)
        if iou[ti, pi] < MIN_IOU:
            break
        if "kps" in live[ti] or pi in used:
            continue
        live[ti]["kps"] = encode(poses[pi][5])
        used.add(pi)

"""WO-675 P2 — whole-body features for presenter recognition in wide stage shots, where faces are a few pixels:
OpenCV Zoo person_reid_youtureid (person_reid_youtu_2021nov.onnx, Apache-2.0 files; trained on research re-ID sets —
see the WO-675 doc) through cv2.dnn. Fetched per machine by fetch-face-models.sh, next to the YOLO weights.

Two uses:
  embed_image(bgr, box)   the intake photo (face_embed.py): the person box found there (YOLO, else from the face)
  embed_person(bgr, box)  a person on stage (sidecar.py): that track's box

Every crop is grey-world white-balanced first: the phone and the stage camera never share a tint, and without it the
feature follows the light more than the clothes. 768-d, L2-normalised (cosine = dot product). Same person measured
0.59+ and different people 0.47- on a re-ID gallery; the server's thresholds sit between (presenters-match.js).
"""

import os

import cv2
import numpy as np

MODEL = "person_reid_youtu_2021nov.onnx"
IN_W, IN_H = 128, 256
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
MIN_BODY_PX = 48  # box height in source pixels; shorter is noise


def models_present(models_dir):
    return os.path.exists(os.path.join(models_dir, MODEL))


def grey_world(bgr):
    f = bgr.astype(np.float32)
    m = f.reshape(-1, 3).mean(0)
    return np.clip(f * (m.mean() / np.maximum(m, 1.0)), 0, 255).astype(np.uint8)


def crop(bgr, box):
    """box [x1, y1, x2, y2] normalised → the source pixels, or None when too small."""
    h, w = bgr.shape[:2]
    x1, y1 = int(max(0, box[0] * w)), int(max(0, box[1] * h))
    x2, y2 = int(min(w, box[2] * w)), int(min(h, box[3] * h))
    if y2 - y1 < MIN_BODY_PX or x2 - x1 < MIN_BODY_PX // 4:
        return None
    return bgr[y1:y2, x1:x2]


class Bodies:
    def __init__(self, models_dir):
        self.net = cv2.dnn.readNet(os.path.join(models_dir, MODEL))

    def embed_crops(self, crops):
        """BGR crops → [unit 768-d feature | None], one forward pass for all."""
        if not crops:
            return []
        x = np.stack([(cv2.resize(grey_world(c), (IN_W, IN_H), interpolation=cv2.INTER_AREA)[:, :, ::-1]
            .astype(np.float32) / 255.0 - MEAN) / STD for c in crops]).transpose(0, 3, 1, 2)
        self.net.setInput(np.ascontiguousarray(x))
        out = self.net.forward().reshape(len(crops), -1)
        n = np.linalg.norm(out, axis=1, keepdims=True)
        return [None if k <= 0 else (v / k).astype(np.float32) for v, k in zip(out, n[:, 0])]

    def embed_person(self, bgr, box):
        c = crop(bgr, box)
        return None if c is None else self.embed_crops([np.ascontiguousarray(c)])[0]

    embed_image = embed_person


def overlapped(box, others, frac=0.3):
    """True when another box covers more than `frac` of this one: the crop would mix two people."""
    a = max(1e-6, (box[2] - box[0]) * (box[3] - box[1]))
    for o in others:
        iw = min(box[2], o[2]) - max(box[0], o[0])
        ih = min(box[3], o[3]) - max(box[1], o[1])
        if iw > 0 and ih > 0 and iw * ih / a > frac:
            return True
    return False


def box_from_face(face_box, w, h):
    """Intake fallback without a detector: the body under a face [x, y, fw, fh] (px) — 3.4 face widths wide, down
    to the bottom of the photo. → normalised [x1, y1, x2, y2]."""
    fx, fy, fw, _ = face_box
    cx = fx + fw / 2
    return [max(0.0, (cx - 1.7 * fw) / w), max(0.0, (fy - 0.3 * fw) / h), min(1.0, (cx + 1.7 * fw) / w), 1.0]

"""WO-675 — face features for presenter recognition: OpenCV Zoo YuNet (face detection, MIT) + SFace (128-d face
feature, Apache-2.0) through OpenCV's FaceDetectorYN / FaceRecognizerSF. The models are not committed; each machine
fetches them (fetch-face-models.sh) into the models dir next to the YOLO weights.

Two uses:
  embed_image(bgr)        the intake photo (face_embed.py): the largest face of the whole picture
  embed_person(bgr, box)  a person on stage (sidecar.py): the largest face in the top of the person's box

Features are L2-normalised, so the server compares them with a dot product (cosine; SFace's same-person threshold
is 0.363). Faces smaller than MIN_FACE_PX in the source picture give no feature: at that size it is noise.
"""

import os

import cv2
import numpy as np

DETECTOR = "face_detection_yunet_2023mar.onnx"
RECOGNIZER = "face_recognition_sface_2021dec.onnx"
MIN_FACE_PX = 20  # face width in source pixels
HEAD_FRAC = 0.45  # the top of a person box searched for the face
UPSCALE_TO = 240  # px: a head crop narrower than this is upscaled before detection (YuNet misses tiny faces)
MAX_SIDE = 1280  # px: a large photo is searched at this size


def models_present(models_dir):
    return all(os.path.exists(os.path.join(models_dir, f)) for f in (DETECTOR, RECOGNIZER))


class Faces:
    def __init__(self, models_dir, score=0.6):
        self.det = cv2.FaceDetectorYN.create(os.path.join(models_dir, DETECTOR), "", (320, 320), score, 0.3, 5)
        self.rec = cv2.FaceRecognizerSF.create(os.path.join(models_dir, RECOGNIZER), "")

    def _largest(self, bgr):
        h, w = bgr.shape[:2]
        self.det.setInputSize((w, h))
        _, faces = self.det.detect(bgr)
        if faces is None or len(faces) == 0:
            return None
        return max(faces, key=lambda f: f[2] * f[3])

    def _feature(self, bgr, face):
        v = self.rec.feature(self.rec.alignCrop(bgr, face)).reshape(-1).astype(np.float32)
        n = float(np.linalg.norm(v))
        return v / n if n > 0 else None

    def embed_image(self, bgr):
        """→ (feature, [x, y, w, h] in source px, score) or None."""
        k = min(1.0, MAX_SIDE / max(bgr.shape[:2]))
        img = cv2.resize(bgr, None, fx=k, fy=k, interpolation=cv2.INTER_AREA) if k < 1.0 else bgr
        f = self._largest(img)
        if f is None or f[2] / k < MIN_FACE_PX:
            return None
        v = self._feature(img, f)
        return None if v is None else (v, [round(float(x) / k) for x in f[:4]], float(f[-1]))

    def embed_person(self, bgr, box):
        """bgr: the full camera frame; box: [x1, y1, x2, y2] normalised → feature or None."""
        h, w = bgr.shape[:2]
        x1, y1, x2, y2 = box
        bw, bh = (x2 - x1) * w, (y2 - y1) * h
        pad = 0.15 * bw
        cx1, cx2 = int(max(0, x1 * w - pad)), int(min(w, x2 * w + pad))
        cy1, cy2 = int(max(0, y1 * h - 0.05 * bh)), int(min(h, y1 * h + HEAD_FRAC * bh))
        if cx2 - cx1 < MIN_FACE_PX or cy2 - cy1 < MIN_FACE_PX:
            return None
        crop = np.ascontiguousarray(bgr[cy1:cy2, cx1:cx2])
        k = max(1.0, UPSCALE_TO / crop.shape[1])
        if k > 1.0:
            crop = cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
        f = self._largest(crop)
        if f is None or f[2] / k < MIN_FACE_PX:
            return None
        return self._feature(crop, f)


def bgr_from_bgra(pixels, width, height, stride):
    """shm BGRA (HASCGSHM) → a full-resolution BGR view for face crops (no copy until a crop is taken)."""
    a = np.frombuffer(pixels, dtype=np.uint8).reshape(height, stride // 4, 4)
    return a[:, :width, :3]

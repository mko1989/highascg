#!/usr/bin/env python3
"""WO-675 — one intake photo → its face feature and body feature, for the server's presenter roster
(src/tracking/presenters.js).

Usage: face_embed.py <photo.jpg> <models_dir> [<detector.onnx>]
stdout (one JSON line): {"ok": true, "feature": [128 floats], "box": [x, y, w, h], "score": s, "body": BODY}
                      | {"ok": false, "detail": "no face" | "...", "body": BODY}
  BODY = {"ok": true, "feature": [768 floats], "box": [x1, y1, x2, y2] (0–1), "via": "detector" | "face"}
       | {"ok": false, "detail": "no person" | "..."}
The body box (WO-675 P2) is the largest person the YOLO detector finds in the photo, else the body under the face.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cv2  # noqa: E402

import body  # noqa: E402
import face  # noqa: E402

PERSON_MIN_SCORE = 0.4


def detector_box(img, model):
    """The largest person box of the photo (normalised) via the tracking YOLO, or None."""
    import detector

    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    boxes = detector.Backend(model, 2).predict(rgb, PERSON_MIN_SCORE, 20)
    if not boxes:
        return None
    b = max(boxes, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))
    return [float(v) for v in b[:4]]


def body_of(img, models, model, face_box):
    if not body.models_present(models):
        return {"ok": False, "detail": "body model missing in %s (tools/tracking-detect/fetch-face-models.sh)" % models}
    box, via = None, ""
    if model and os.path.exists(model):
        try:
            box, via = detector_box(img, model), "detector"
        except Exception:  # noqa: BLE001 — fall back to the face below
            box = None
    if box is None and face_box is not None:
        box, via = body.box_from_face(face_box, img.shape[1], img.shape[0]), "face"
    if box is None:
        return {"ok": False, "detail": "no person"}
    v = body.Bodies(models).embed_image(img, box)
    if v is None:
        return {"ok": False, "detail": "person too small"}
    return {"ok": True, "feature": [round(float(x), 5) for x in v], "box": [round(x, 4) for x in box], "via": via}


def main():
    if len(sys.argv) not in (3, 4):
        return {"ok": False, "detail": "usage: face_embed.py <photo.jpg> <models_dir> [<detector.onnx>]"}
    photo, models = sys.argv[1], sys.argv[2]
    model = sys.argv[3] if len(sys.argv) == 4 else ""
    img = cv2.imread(photo, cv2.IMREAD_COLOR)
    if img is None:
        return {"ok": False, "detail": "unreadable photo"}
    if not face.models_present(models):
        out = {"ok": False, "detail": "face models missing in %s (tools/tracking-detect/fetch-face-models.sh)" % models}
        r = None
    else:
        r = face.Faces(models).embed_image(img)
        out = {"ok": False, "detail": "no face"} if r is None else {"ok": True,
            "feature": [round(float(x), 5) for x in r[0]], "box": r[1], "score": round(r[2], 3)}
    try:
        out["body"] = body_of(img, models, model, r[1] if r else None)
    except Exception as e:  # noqa: BLE001 — the face result still counts
        out["body"] = {"ok": False, "detail": str(e)}
    return out


if __name__ == "__main__":
    try:
        out = main()
    except Exception as e:  # noqa: BLE001 — the server reads one JSON line whatever happens
        out = {"ok": False, "detail": str(e)}
    print(json.dumps(out, separators=(",", ":")))

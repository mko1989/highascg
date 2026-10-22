#!/usr/bin/env python3
"""WO-675 — one intake photo → its face feature, for the server's presenter roster (src/tracking/presenters.js).

Usage: face_embed.py <photo.jpg> <models_dir>
stdout (one JSON line): {"ok": true, "feature": [128 floats], "box": [x, y, w, h], "score": s}
                      | {"ok": false, "detail": "no face" | "..."}
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cv2  # noqa: E402

import face  # noqa: E402


def main():
    if len(sys.argv) != 3:
        return {"ok": False, "detail": "usage: face_embed.py <photo.jpg> <models_dir>"}
    photo, models = sys.argv[1], sys.argv[2]
    if not face.models_present(models):
        return {"ok": False, "detail": "face models missing in %s (tools/tracking-detect/fetch-face-models.sh)" % models}
    img = cv2.imread(photo, cv2.IMREAD_COLOR)
    if img is None:
        return {"ok": False, "detail": "unreadable photo"}
    r = face.Faces(models).embed_image(img)
    if r is None:
        return {"ok": False, "detail": "no face"}
    v, box, score = r
    return {"ok": True, "feature": [round(float(x), 5) for x in v], "box": box, "score": round(score, 3)}


if __name__ == "__main__":
    try:
        out = main()
    except Exception as e:  # noqa: BLE001 — the server reads one JSON line whatever happens
        out = {"ok": False, "detail": str(e)}
    print(json.dumps(out, separators=(",", ":")))

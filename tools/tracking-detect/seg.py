"""WO-665 T1 — person cut-out masks from a YOLO segmentation model (yolo26n-seg), for the previs cut-out cards.

A seg model has two outputs: the detection rows (the usual head with 32 mask coefficients appended per row) and the
mask prototypes [1, 32, mh, mw] over the letterboxed input. A person's mask is sigmoid(coefficients · prototypes);
we sample it inside the TRACK box (the box the server and the previs crop the video with), so mask and crop line up
whatever the box's size, at a fixed MASK_W × MASK_H, threshold it and bit-pack it: 576 bytes per person per step.

Wire format (on each live track of a "tracks" message): "mask": base64 of np.packbits(row-major, MSB first) of a
MASK_H × MASK_W 0/1 grid, row 0 at the box top; the message carries "mask_size": [MASK_W, MASK_H].
"""

import base64

import cv2
import numpy as np

MASK_W, MASK_H = 48, 96  # a person box is tall; the 160×160 prototypes give 25–80 px over a 300–1000 px-tall 1080p person
THRESHOLD = 0.5


def seg_outputs(session):
    """→ number of mask coefficients when the model is a seg model (a second, 4-D prototype output), else 0."""
    outs = session.get_outputs()
    if len(outs) < 2:
        return 0
    shape = outs[1].shape
    if len(shape) != 4 or not isinstance(shape[1], int):
        return 0
    return int(shape[1])


def mask_for(box, coef, protos, size, scale, pad, fw, fh):
    """box: [x1, y1, x2, y2] normalised to the frame the model saw (fw × fh); coef: [nm]; protos: [nm, mh, mw] over
    the `size` letterbox → MASK_H × MASK_W uint8 0/1."""
    nm, mh, mw = protos.shape
    m = coef.astype(np.float32) @ protos.reshape(nm, -1)
    m = (1.0 / (1.0 + np.exp(-m))).reshape(mh, mw).astype(np.float32)
    k = (mw / size) * scale  # frame px → prototype px (square prototypes over a square letterbox)
    x1 = (box[0] * fw) * k + pad[0] * mw / size
    y1 = (box[1] * fh) * k + pad[1] * mh / size
    x2 = (box[2] * fw) * k + pad[0] * mw / size
    y2 = (box[3] * fh) * k + pad[1] * mh / size
    # output pixel (u, v) centre ↔ prototype point x1 + (u + 0.5)·sx − 0.5 (pixel-centre convention both sides)
    sx, sy = (x2 - x1) / MASK_W, (y2 - y1) / MASK_H
    affine = np.array([[sx, 0.0, x1 + 0.5 * sx - 0.5], [0.0, sy, y1 + 0.5 * sy - 0.5]], np.float32)
    out = cv2.warpAffine(m, affine, (MASK_W, MASK_H), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
        borderMode=cv2.BORDER_CONSTANT, borderValue=0.0)
    return (out > THRESHOLD).astype(np.uint8)


def encode(mask):
    return base64.b64encode(np.packbits(mask.reshape(-1)).tobytes()).decode("ascii")


def decode(text):
    bits = np.unpackbits(np.frombuffer(base64.b64decode(text), np.uint8))[:MASK_W * MASK_H]
    return bits.reshape(MASK_H, MASK_W)


def attach(tracks, raw, seg):
    """Give each LIVE track the mask of the detection it was updated with (ByteTrack copies that detection's box, so
    the match is exact); coasting tracks get none — the previs keeps their last one. seg = (protos, size, scale,
    pad, fw, fh) from the backend's last predict; raw rows carry their coefficients as element 5."""
    if seg is None:
        return
    by_box = {tuple(round(float(v), 5) for v in r[:4]): r for r in raw if len(r) > 5}
    for t in tracks:
        if t["age_s"] > 0:
            continue
        r = by_box.get(tuple(t["box"]))
        if r is not None:
            t["mask"] = encode(mask_for(t["box"], r[5], *seg))

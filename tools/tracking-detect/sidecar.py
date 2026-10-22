#!/usr/bin/env python3
"""WO-616 T9 — person-detection sidecar, spawned and owned by the HighAsCG server (src/tracking/detect-service.js).

Reads each tracking camera's shm video surface (HASCGSHM v1, tools/hshm-bridge/hshm_abi.Reader), runs YOLO person
detection + ByteTrack per camera (detector.py, OpenFollow port) at most every `interval_ms`, and reports pixel-space
tracks. It knows nothing about stage geometry: the server unprojects feet points with the solved camera.

Protocol (JSON lines):
  stdin  {"type": "config", "model": "/abs/x.onnx", "pose_model": "" | "/abs/y-pose.onnx", "confidence": 0.2, "interval_ms": 67, "max_persons": 10,
          "grace_ms": 500, "threads": 4, "faces": false, "bodies": false, "cameras": [{"id": "cam_1", "path": "/dev/shm/highascg-ch1", "masks": []}]}
  stdout {"type": "ready", "model", "providers", "input"}
         {"type": "tracks", "camera", "frame", "w", "h", "ms", "tracks": [{"tid", "box": [x1, y1, x2, y2] (0–1),
          "score", "age_s", "mask"?, "kps"?}], "mask_size"?}  — once per detection step per camera (an empty list is
          a real "nobody"); a seg model adds WO-665 cut-out masks (seg.py) to live tracks; a pose_model adds WO-667
          body keypoints (pose.py, a second session on the same frame); with "faces" (WO-675) a live track gets
          "face": [128 floats] (face.py, YuNet + SFace) at most every FACE_EVERY_S and only while a face is visible;
          with "bodies" (WO-675 P2) "body": [768 floats] (body.py, youtureid) at most every BODY_EVERY_S, never for a
          box another person covers
         {"type": "status", "cameras": {id: {"state": "ok" | "waiting" | "stale", "detail", "fps", "ms"}}}  — 1 Hz
         {"type": "error", "detail"}
Exits when stdin closes (the server went away), so it never outlives its owner.
"""

import json
import os
import queue
import sys
import threading
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hshm-bridge"))

import detector  # noqa: E402
import hshm_abi  # noqa: E402
import pose  # noqa: E402
import face  # noqa: E402
import body  # noqa: E402

DEFAULTS = {"model": "", "pose_model": "", "confidence": 0.2, "interval_ms": 67, "max_persons": 10, "grace_ms": 500, "threads": 4,
    "faces": False, "bodies": False, "cameras": []}
STALE_S = 1.0
IDLE_S = 0.004
FACE_EVERY_S = 1.0  # WO-675: per track; a face feature costs ~10 ms
FACES_PER_STEP = 3
BODY_EVERY_S = 1.0  # WO-675 P2: per track; ~8 ms each, one batched forward pass per frame
BODIES_PER_STEP = 4


def emit(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def read_stdin(q, done):
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            emit({"type": "error", "detail": "bad config line"})
            continue
        if isinstance(msg, dict) and msg.get("type") == "config":
            q.put(msg)
    done.set()


class Camera:
    def __init__(self, cid):
        self.id = cid
        self.path = ""
        self.masks = []
        self.reader = None
        self.ino = None
        self.opened = 0.0
        self.det = detector.CameraDetector()
        self.face_at = {}  # WO-675: tid → when its face was last looked for
        self.body_at = {}  # WO-675 P2: tid → when its body feature was last taken
        self.last_step = 0.0
        self.last_frame = 0.0
        self.steps = 0
        self.ms = 0.0
        self.detail = ""

    def configure(self, c):
        if c.get("path") != self.path:
            self.close()
            self.path = str(c.get("path", ""))
        self.masks = c.get("masks") or []

    def close(self):
        if self.reader is not None:
            self.reader.close()
        self.reader = None

    def replaced(self):
        """Stale and the name now points at another segment (Caspar recreated the consumer: a server restart's
        REMOVE + ADD) or at none — the mapping we hold is an unlinked segment nobody writes any more."""
        if time.monotonic() - max(self.last_frame, self.opened) <= STALE_S:
            return False
        try:
            return os.stat(self.path).st_ino != self.ino
        except OSError:
            return True

    def poll(self):
        """→ (info, pixels) of a new frame, or None. (Re)opens the segment as needed."""
        if self.reader is None:
            if not os.path.exists(self.path):
                self.detail = "no surface at " + self.path
                return None
            try:
                self.ino = os.stat(self.path).st_ino
                self.reader = hshm_abi.Reader(self.path)
                self.opened = time.monotonic()
            except (OSError, ValueError) as e:
                self.detail = str(e)
                return None
        kind, info, pixels = self.reader.poll()
        if kind != "frame" and self.replaced():
            self.close()
            return None
        if kind == "geometry":
            self.close()
            return None
        if kind != "frame":
            return None
        self.last_frame = time.monotonic()
        self.detail = ""
        return info, pixels


def load_faces(models_dir):
    if not face.models_present(models_dir):
        emit({"type": "error", "detail": "faces: models missing in %s (fetch-face-models.sh)" % models_dir})
        return False
    try:
        return face.Faces(models_dir)
    except Exception as e:  # noqa: BLE001 — detection carries on without faces
        emit({"type": "error", "detail": "faces: %s" % e})
        return False


def load_bodies(models_dir):
    if not body.models_present(models_dir):
        emit({"type": "error", "detail": "bodies: model missing in %s (fetch-face-models.sh)" % models_dir})
        return False
    try:
        return body.Bodies(models_dir)
    except Exception as e:  # noqa: BLE001 — detection carries on without body features
        emit({"type": "error", "detail": "bodies: %s" % e})
        return False


def attach_bodies(bodies, cam, tracks, bgr, now):
    """A live track's body feature, at most every BODY_EVERY_S per track and BODIES_PER_STEP per frame; a box that
    another live box covers is skipped (its crop is two people)."""
    live = [t for t in tracks if t["age_s"] == 0]
    picked, crops = [], []
    for t in live:
        if len(picked) >= BODIES_PER_STEP:
            break
        if now - cam.body_at.get(t["tid"], 0.0) < BODY_EVERY_S:
            continue
        if body.overlapped(t["box"], [o["box"] for o in live if o is not t]):
            continue
        c = body.crop(bgr, t["box"])
        if c is None:
            continue
        cam.body_at[t["tid"]] = now
        picked.append(t)
        crops.append(np.ascontiguousarray(c))
    for t, v in zip(picked, bodies.embed_crops(crops) if crops else []):
        if v is not None:
            t["body"] = [round(float(x), 4) for x in v]
    ids = {t["tid"] for t in tracks}
    for tid in [k for k in cam.body_at if k not in ids]:
        del cam.body_at[tid]


def attach_faces(faces, cam, tracks, bgr, now):
    """A live track's face feature, at most every FACE_EVERY_S per track and FACES_PER_STEP per frame."""
    done = 0
    for t in tracks:
        if done >= FACES_PER_STEP:
            break
        if t["age_s"] > 0 or now - cam.face_at.get(t["tid"], 0.0) < FACE_EVERY_S:
            continue
        cam.face_at[t["tid"]] = now
        done += 1
        v = faces.embed_person(bgr, t["box"])
        if v is not None:
            t["face"] = [round(float(x), 4) for x in v]
    live = {t["tid"] for t in tracks}
    for tid in [k for k in cam.face_at if k not in live]:
        del cam.face_at[tid]


def main():
    q, done = queue.Queue(), threading.Event()
    threading.Thread(target=read_stdin, args=(q, done), daemon=True).start()
    cfg, cams, backend, model = dict(DEFAULTS), {}, None, None
    poser, pose_model = None, ""
    faces = None  # WO-675: face.Faces once a config asks for faces and the models are there
    bodies = None  # WO-675 P2: body.Bodies, likewise
    last_status = 0.0
    while not done.is_set():
        while not q.empty():
            cfg = {**DEFAULTS, **q.get()}
            want = {str(c.get("id")): c for c in cfg["cameras"] if isinstance(c, dict)}
            for cid in list(cams):
                if cid not in want:
                    cams.pop(cid).close()
            for cid, c in want.items():
                cams.setdefault(cid, Camera(cid)).configure(c)
            if cfg["model"] != model:
                model = cfg["model"]
                try:
                    backend = detector.Backend(model, int(cfg["threads"]))
                    emit({"type": "ready", "model": model, "providers": backend.providers, "input": backend.size})
                except Exception as e:  # noqa: BLE001 — a bad model must not kill the loop; the server shows it
                    backend = None
                    emit({"type": "error", "detail": "model %s: %s" % (model, e)})
            if cfg["pose_model"] != pose_model:
                pose_model, poser = cfg["pose_model"], None
                if pose_model:
                    try:
                        poser = pose.PoseBackend(pose_model, max(1, int(cfg["threads"]) // 2))
                    except Exception as e:  # noqa: BLE001 — detection carries on without keypoints
                        emit({"type": "error", "detail": "pose model %s: %s" % (pose_model, e)})
            if cfg["faces"] and faces is None and model:
                faces = load_faces(os.path.dirname(model))
            elif not cfg["faces"]:
                faces = None
            if cfg["bodies"] and bodies is None and model:
                bodies = load_bodies(os.path.dirname(model))
            elif not cfg["bodies"]:
                bodies = None
        now = time.monotonic()
        worked = False
        for cam in cams.values():
            if backend is None or now - cam.last_step < cfg["interval_ms"] / 1000.0:
                continue
            got = cam.poll()
            if got is None:
                continue
            info, pixels = got
            r = cam.reader
            t0 = time.perf_counter()
            try:
                rgb = cam.det.preprocess(detector.to_rgb(pixels, r.width, r.height, r.stride, backend.size))
                raw = backend.predict(rgb, min(detector.bytetrack.LOW_DETECTION_THRESHOLD, cfg["confidence"]),
                    max(cfg["max_persons"] * 3, detector.RAW_CAP))
                tracks = cam.det.step(detector.filter_masks(raw, cam.masks), now, cfg)
                detector.seg.attach(tracks, raw, backend.last_seg)  # WO-665: cut-out masks (seg models only)
                if poser is not None:  # WO-667: body keypoints for the posed dummies
                    pose.attach(tracks, poser.predict(rgb, cfg["confidence"]))
                if faces or bodies:  # WO-675: presenter recognition
                    bgr = face.bgr_from_bgra(pixels, r.width, r.height, r.stride)
                    if faces:
                        attach_faces(faces, cam, tracks, bgr, now)
                    if bodies:
                        attach_bodies(bodies, cam, tracks, bgr, now)
            except Exception as e:  # noqa: BLE001 — one bad frame (e.g. a singular Kalman matrix) drops, not the camera
                emit({"type": "error", "detail": "%s: %s" % (cam.id, e)})
                continue
            cam.ms = (time.perf_counter() - t0) * 1000.0
            cam.last_step = now
            cam.steps += 1
            worked = True
            msg = {"type": "tracks", "camera": cam.id, "frame": info["frame_number"], "w": r.width, "h": r.height,
                "ms": round(cam.ms, 1), "tracks": tracks}
            if backend.last_seg is not None:
                msg["mask_size"] = [detector.seg.MASK_W, detector.seg.MASK_H]
            emit(msg)
        if now - last_status >= 1.0:
            st = {}
            for cam in cams.values():
                stale = cam.last_frame == 0.0 or now - cam.last_frame > STALE_S
                st[cam.id] = {"state": "waiting" if cam.reader is None else "stale" if stale else "ok",
                    "detail": cam.detail, "fps": round(cam.steps / max(now - last_status, 1e-3), 1) if last_status else 0.0,
                    "ms": round(cam.ms, 1)}
                cam.steps = 0
            emit({"type": "status", "cameras": st, "model": model, "ready": backend is not None})
            last_status = now
        if not worked:
            time.sleep(IDLE_S)
    for cam in cams.values():
        cam.close()


if __name__ == "__main__":
    main()

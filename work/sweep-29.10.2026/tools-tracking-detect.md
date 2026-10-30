# tools/tracking-detect — sweep 29.10.2026 (batch 138)

Files: 15 · lines: 1477 · findings: 0 BUG-HIGH, 1 BUG, 2 DEAD, 7 RISK, 6 QUALITY

## tools/tracking-detect/body.py
- `OK`
## tools/tracking-detect/bytetrack.py
- `OK`
## tools/tracking-detect/detector.py
- `BUG` tools/tracking-detect/detector.py:194 — a track that missed ONE detection step is `lost` but reported with `age_s` 0.0 (`max(0.0, now - last_seen - allowance)`; allowance ≥ one step), and every consumer uses `age_s == 0` / `<= 0` as "live": sidecar.py:162 (body), :191 (face), seg.py:68 (mask), pose.py:72 (keypoints). The documented contract (sidecar docstring, test_face/test_body "a coasting (lost) track gets no face/body") is therefore broken for the first miss. Failing input (pure repro in the venv): `CameraDetector.step([box],0.0/0.067/0.134)` then `step([],0.201)` → `[{'tid':0,…,'age_s':0.0}]` with `tracker.tracks[0].state == 'lost'`; `attach_bodies` then writes a 768-float body feature taken from the Kalman-extrapolated box (`'body' in track` → True). Impact is small (one step, ≈67 ms of extrapolation) but it can store a feature of an empty crop or of the next person. The tests miss it because they use `age_s` 0.5. Fix: report `lost` explicitly (e.g. `"live": t.state == "tracked"`) and test that, or return `age_s` > 0 for any lost track.
- `DEAD` tools/tracking-detect/detector.py:45 `self.output_name` — never read (`Backend.predict` uses `self.outputs`). grep: `rg -n "output_name" tools/tracking-detect` → detector.py:45 (assignment only); pose.py:32/41 use their own `PoseBackend.output_name`.
- `RISK` tools/tracking-detect/detector.py:87 — `prepare` decides the orientation with `shape[0] < shape[1] and shape[0] >= 6`; an end-to-end seg/pose head with fewer rows than columns (e.g. `max_det=30` → [30, 38]) is transposed wrongly and decodes to nothing. Today's exports have 300 rows / 8400 columns so no failing case.
- `QUALITY` tools/tracking-detect/detector.py:177 — `CameraDetector.step` takes `now` from the caller's single `time.monotonic()` per loop (sidecar.py:243); with several cameras the later ones step with a timestamp that is the earlier cameras' inference time old, so gap/`dt`/allowance jitter between cameras.
## tools/tracking-detect/export-models.sh
- `RISK` tools/tracking-detect/export-models.sh:40 — the `.pt` weights are downloaded from GitHub without a checksum and then unpickled by `ultralytics` (`YOLO('${m}.pt')`), while fetch-face-models.sh pins every file by sha256; `onnx onnxslim` (:32) are unpinned. A tampered or moved release asset runs code on the box.
- `QUALITY` tools/tracking-detect/export-models.sh:19 — `bootstrap_pip` and the venv-with-or-without-pip block (:24-30) duplicate setup-venv.sh:90-105; the default model list (:35, `yolo26n yolo26s`) does not include the `-seg`/`-pose` weights the sidecar can use (they exist in ~/.local/share/highascg/models, so someone exported them by hand), and the usage text does not say the names can be passed.
## tools/tracking-detect/face.py
- `OK`
## tools/tracking-detect/face_embed.py
- `QUALITY` tools/tracking-detect/face_embed.py:32 — the intake body box comes from `detector.Backend(model, 2).predict(rgb, …)` on the raw full-size photo without the CLAHE and pre-downscale the live path applies (detector.CameraDetector.preprocess / to_rgb), so the intake and stage features/boxes see differently conditioned pixels; a new ONNX session per call (one process per photo, so only start-up cost).
## tools/tracking-detect/fetch-face-models.sh
- `QUALITY` tools/tracking-detect/fetch-face-models.sh:19 — a failed `curl` under `set -e` leaves `<name>.part` behind (the checksum-failure path removes it, the curl-failure path does not); a later run overwrites it, so harmless.
## tools/tracking-detect/pose.py
- `OK`
## tools/tracking-detect/seg.py
- `DEAD` tools/tracking-detect/seg.py:55 `decode()` — only used by tests. grep: `rg -n "seg\.decode|seg\.MASK" tools src` → tools/tracking-detect/test_seg.py only; the Godot client decodes the base64 itself (godot/client/features/previs/tracking/person_cards_model.gd:172). Test-support helper in production module; keep or move to test_seg.py.
## tools/tracking-detect/setup-venv.sh
- `RISK` tools/tracking-detect/setup-venv.sh:26 — "Safe to re-run" (:5) is only true for pins: the venv is rebuilt only when `bin/python` is not executable. After a system Python upgrade (memory: 26.04.1 moved python3 to 3.14 while the venv kept lib/python3.12) `bin/python` still runs, so the script skips recreation and relies on the later pip bootstrap to repopulate; the working fix was `python3 -m venv --clear`. Compare `pyvenv.cfg` `version` with `python3 --version` and pass `--clear` on mismatch (the current venv is 3.14.4 = system, fine).
## tools/tracking-detect/sidecar.py
- `RISK` tools/tracking-detect/sidecar.py:221 — `model = cfg["model"]` is assigned before `detector.Backend(...)` is tried (:223); when the load fails (transient CUDA out-of-memory, file half-written) every later config with the same path skips the reload (`cfg["model"] != model` is false) and the sidecar stays at `backend is None` until restart. Same for `faces`/`bodies`: the `False` sentinel (:235-242) is never retried while the flag stays on.
- `RISK` tools/tracking-detect/sidecar.py:262 — `attach_faces` / `attach_bodies` run inside the same `try` as detection (except at :268), so an exception in an optional extra (cv2 error on an odd crop, DNN failure) drops the whole frame's `tracks` message after the tracker already advanced; `cam.last_step` is not updated (:272) so the failing frame is retried at frame rate with one `error` line each. Wrap the extras separately.
- `RISK` tools/tracking-detect/sidecar.py:214 — `cfg["cameras"]` of `null` (JSON null in a config line) makes the comprehension raise `TypeError` outside any try: the main loop dies and the server only sees the process exit.
- `RISK` tools/tracking-detect/sidecar.py:52 — `json.dumps` default `allow_nan=True` emits a bare `NaN` for a NaN score/box, which is invalid JSON; detect-service.js:127-130 swallows the parse error, so that frame is lost silently. Use `allow_nan=False` plus a sanitising fallback.
- `QUALITY` tools/tracking-detect/sidecar.py:219 — `cams.setdefault(cid, Camera(cid))` builds a Camera (CLAHE object + ByteTracker) on every config line even when the camera exists.
- `QUALITY` tools/tracking-detect/sidecar.py:288 — the `status` message carries `model` and `ready`, which the protocol docstring (:19) does not list.
## tools/tracking-detect/test_body.py
- `OK`
## tools/tracking-detect/test_face.py
- `OK`
## tools/tracking-detect/test_pose.py
- `OK`
## tools/tracking-detect/test_seg.py
- `OK`

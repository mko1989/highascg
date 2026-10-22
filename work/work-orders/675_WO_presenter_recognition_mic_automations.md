# WO-675 — Presenter recognition: backstage photo + name + mic → recognised on stage → automations

**Status: IN PROGRESS — P1 + P3 (face) DONE 22.10 (smoke 8/0, test_face.py, Godot 20887/0, box: intake POST → face ok, sidecar end-to-end on a synthetic camera, Inspector screenshots). Open: P2 body re-ID, live test with real cameras, lower-third action.**

Owner, `next.md` 22.10: *"how possible is it to do this: an audio tech is giving a mic to a presenter backstage he
takes a photo of him/her full person, sends it to the system, with a note, name and mic number. when that presenter
goes on stage is recognized as that presenter and automations happen."*

## Owner decisions (22.10)

- **D1 — an operator approves every recognition.** The system only suggests ("this is Anna, 87 %"); nothing fires
  for a presenter until the operator confirms the match. No auto-assign phase.
- **D2 — photos live in `/tmp`**, so a reboot removes them. The roster (name, mic, note) and any embeddings go there
  too; never into the project, config/, a stick or Syncthing.
- **D3 — consent is asked by the tech** when taking the photo ("for automation during the show"). The intake page
  shows a consent tick that must be set before it sends.
- **D4 — mics go through Companion.** A presenter's actions are Companion buttons (the existing
  `companion:<page>/<row>/<col>` action); no desk protocol on the box.

## Investigation (desk, 22.10)

**Already on the box (WO-616 / 665):**

- Calibrated stage cameras (DeckLink) + the `tools/tracking-detect/sidecar.py` YOLO26 detector (~17 ms CPU; the GPU is
  an RTX PRO 4000, 24 GB, ~2 GB used).
- `src/tracking/fusion.js`: one Kalman track per **world person**, with a stable person id (the Godot P-tags).
- `src/tracking/zone-engine.js` + `zone-actions.js`: floor zones fire `look:<id>[@preview]` or
  `companion:<p>/<r>/<c>` on enter / leave.
- WO-663 lower thirds take operator text. WO-665 cut-out crops give a clean per-person image.

**Missing — the identity of a person:**

1. **Intake:** a phone page (photo + name + mic number + note) → a show roster on the server.
2. **Recognition:** compare each world person with the roster.
   - **Body re-ID (clothes / build)** is the strong signal here. The photo is full-length and taken the same day,
     so the outfit matches. Candidates: OSNet (torchreid, MIT), ONNX, a few ms per crop.
   - **Face** is a second signal. It only helps when faces are big enough: near cameras, a downstage presenter. It
     fails when backlit or turned away. License trap: InsightFace's pretrained models are **non-commercial only**.
     OpenCV Zoo YuNet (MIT) + SFace (Apache-2.0) are usable.
   - **Matching:** a small known roster (5–30), per-track evidence over time, hysteresis, and "unknown" below a
     margin. A wrong name on air is worse than no name.
3. **Identity actions:** per presenter: take the lower third with their name, a look, a Companion button (D4: the
   mic is a Companion button).

**Risks:**

- Look-alike outfits (all-black suits, a choir), and stage light shifting colours. Mitigation: face as a tie-breaker,
  and the operator confirms.
- Privacy: photos + embeddings are biometric data (GDPR art. 9) → D2 + D3.
- A cue firing on a wrong ID → D1.

## Face recognition candidates (web, 22.10)

The weights' license is what matters, not the code's.

| Project | Model | License (as stated) | Note |
|---|---|---|---|
| [OpenCV Zoo](https://github.com/opencv/opencv_zoo) YuNet + SFace | detect + recognise (MobileFaceNet), ONNX | YuNet dir: MIT; SFace dir: "All files … Apache 2.0" | tiny, CPU-fast, 99.40 % (zoo eval); the cleanest license; first choice |
| [EdgeFace](https://github.com/otroshi/edgeface) (Idiap) | 1.2–18 M params | repo BSD-3-Clause; weights not separately licensed | LFW 99.57–99.83 %; small and accurate; check the weights' terms |
| [AdaFace](https://github.com/mk-minchul/AdaFace) (CVPR 2022) | ResNet-100 | code MIT; weights unlicensed, trained on MS1MV2 / WebFace | best on low-quality faces (TinyFace 72 % rank-1) = stage distance; dataset terms are research-only |
| [DeepFace](https://github.com/serengil/deepface) | wrapper (SFace, ArcFace, FaceNet …) | MIT; "license types will be inherited" from each model | 23.6 k stars; good for comparing models on our own footage, not for shipping |
| [facenet-pytorch](https://github.com/timesler/facenet-pytorch) | InceptionResnet (VGGFace2) | code MIT; weights unstated | LFW 99.65 %; older |

Avoid: InsightFace `buffalo_*` / glintr100 (non-commercial; a license costs money).

The sidecar already runs ONNX Runtime (CUDA when present) and numpy; it has no OpenCV. YuNet + SFace run as plain ONNX.

## Proposed phases

| Phase | What | Estimate |
|---|---|---|
| P1 | Intake page (photo, name, mic, note, consent tick) → `/tmp` roster; Godot: roster in the Inspector; the operator taps a P-tag → assigns a presenter; zones fire that presenter's actions (lower third with the name, look, Companion button for the mic) | ~1 day |
| P2 | Suggest: OSNet body re-ID in the sidecar, the best roster match shown on the P-tag with a confidence; the operator confirms with one tap (D1) | ~2–3 days |
| P3 | Face (YuNet + SFace) added to the suggestion, as a tie-breaker between look-alike outfits | ~1–2 days |

## What was done (22.10 — owner: "lets do zoo")

P1 and P3 together, face first (OpenCV Zoo); P2 (OSNet body re-ID) is not started.

**Server (`src/tracking/`)**
- `presenters.js` (new): the roster in `/tmp/highascg-presenters` (env `HIGHASCG_PRESENTERS_DIR`), dir 0700, files 0600
  (`roster.json`, `pN.jpg`). Create needs `consent: true`, a name and a JPEG (≤ 6 MB). The photo is embedded in the
  background (`face_embed.py` in the sidecar venv) → `face: pending | ok | none | unavailable`. Reloaded after a server
  restart; bindings are dropped (track ids do not survive it). Features never leave the server.
- Suggestions: SFace cosine ≥ 0.363 (the model's own threshold), ≥ 0.05 clear of the runner-up, ≥ 2 sightings,
  smoothed 0.35, evidence kept 10 s. Never auto-bound (D1): only `assign` (the operator) binds.
- A bound presenter drives hub marker `65000 + slot` named "Name (mic N)", source `presenter`.
- `zone-actions.js` / `zone-service.js`: zone action `presenter` runs the presenter's own `on_enter`
  (first / additional entry) or `on_exit` (exits) actions; only `look:` and `companion:` are allowed (D4: the mic is a
  Companion button).
- `presenter-routes.js` (new): the routes listed in its header; GET adds `intake_urls` (the box's LAN IPv4 addresses).
  `presenter-intake.html` (new): the phone page (photo, name, mic, note, consent tick; the image is resized to 1280 px).
- `detect-service.js` / `register.js`: the sidecar config gets `faces` only while some presenter has a face; per-camera
  face features → `presenters.observe` (keys `w:<id>` when fused, else `camera:tid`); WS `tracking:presenters` ≤ 2 Hz
  on change.

**Sidecar (`tools/tracking-detect/`)**
- `face.py` (new): YuNet detect + SFace align/feature (cv2 `FaceDetectorYN` / `FaceRecognizerSF`, both in the venv's
  opencv 5.0). Person crop = top 45 % of the box, upscaled to 240 px wide; faces under 20 source px are skipped.
- `sidecar.py`: live tracks get `"face"` (128 floats) at most once a second per track and 3 per frame.
- `face_embed.py` (new CLI for the intake photo), `fetch-face-models.sh` (new, sha256-pinned; models not committed),
  `test_face.py` (new).

**Godot (`features/previs/tracking/`)**
- `presenters_section.gd` (new): Inspector → Camera → **Presenters** mode. Intake URLs to read out, then one row per
  presenter: photo, "Name · mic N", note, status ("On stage as P3", "Looks like P3 (81 %) — confirm?"), Confirm /
  Person… picker / Release / Delete, On enter / On exit action fields; Clear all (with a confirm).
- `presenters_model.gd` (new): the pure helpers (persons to bind, status line), so the headless tests can load them.
- `tracking_page.gd`: the sixth mode. `previs_tab.gd`: Presenters mode draws the markers on the picture.

## What was VERIFIED

- `tools/smoke/smoke-wo675-presenters.test.js` 8/0 (consent, file modes, restart reload, suggestion rules, marker,
  zone `presenter` → Companion presses, routes, LAN-only URLs, wiring); added to the curated CI list. test:ci: the only
  failure was the stale WS contract doc (new `tracking:presenters`), regenerated.
- `test_face.py`: throttle + per-frame budget, BGRA view, small box skipped.
- Face models on the box: lena vs lena small-in-frame 0.790, lena vs messi 0.127, flipped 0.912; person crop ~10 ms.
- Sidecar end to end (synthetic HASCGSHM camera, messi ×2.5, yolo26n, faces on): 21 track messages, 3 with faces;
  similarity to a messi intake 0.930, to lena 0.142.
- Box server: intake page 200; POST a JPEG → `face: ok`; dir 0700, files 0600; after a restart `intake_urls` =
  192.168.0.23 + tailscale.
- Godot 20887/0 (+7 `test_tracking_presenters.gd`), `--check` boot OK. Second client window: the Presenters mode shows
  the URLs, the photo row and the fields; typing `companion:1/2/3, nope` in On enter saved `["companion:1/2/3"]`.
- NOT verified: real cameras (the project has none and detection is off), so a live suggestion → Confirm → zone fire
  is owner QA.

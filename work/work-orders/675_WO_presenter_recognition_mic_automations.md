# WO-675 — Presenter recognition: backstage photo + name + mic → recognised on stage → automations

**Status: IN PROGRESS — P1 + P3 (face) DONE 22.10 (smoke 8/0, test_face.py, Godot 20887/0, box: intake POST → face ok, sidecar end-to-end on a synthetic camera, Inspector screenshots); round 2 DONE 22.10: short `/intake` address + presenter picks in the lower-third inspector (box screenshots). P2 body re-ID DONE 22.10 (youtureid + grey-world, fused with faces; smoke 9/0, test_body.py, Godot 20946/0, box: intake body feature + sidecar on a synthetic camera 0.784 vs 0.152). Open: live test with real cameras; owner decision on the research-trained weights (P2 section).**

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

## Round 2 — owner answers (22.10)

Owner: *"phone intake how is done? should be a simple page on the network. lower third action should be look up of
the presenters list if avaible. recognizing by body too is what i want because the camera shots that overview stage
are gonna be wide shots, thats why the backstage tech is taking a whole body shot."*

### Investigation

- The intake already was a plain page served by the box, but at a long address:
  `http://<box>:4200/api/tracking/presenters/intake`. That is hard to type on a phone.
- The page posts to `./`, so it must stay under `/api/tracking/presenters/`. A rewrite at a short path would break the
  POST; a redirect keeps it working.
- The lower-third inspector (`lower_third_section.gd`) already has a spreadsheet "Data sheet" whose rows fill Title /
  Subtitle (`row_picked`). The backstage roster is a second source for the same two fields.
- `Ws` (core/ws.gd) has `on()` but no `off()`. The lower-third section is rebuilt on every layer selection, so a WS
  subscription there would leave handlers on freed nodes (the WO-676 kind of crash). The section reads the roster
  when it builds instead.
- Body re-ID licenses (web research, 22.10, by a subagent; the dataset terms are from its memory and unverified): no
  re-ID checkpoint has a clean commercial chain. OSNet, FastReID, SOLIDER, CLIP-ReID and TransReID have MIT / Apache
  code, but their weights are trained on Market-1501 / MSMT17 / Duke / CUHK03 (research-only or withdrawn). The one
  exception is the **OpenCV Zoo `person_reid_youtureid`**: its directory says "All files in this directory are
  licensed under Apache 2.0", it ships as ONNX, and it runs in the sidecar's opencv. Its training data is undisclosed.
  First choice for P2, from the same zoo as the face models.

### What was done

- `src/server/http-server.js`: `GET /intake` (and `/intake/`) → 302 to the intake page. It sits before the API and
  headless checks, so it works on a headless server too. `presenter-routes.js` `intake_urls` now list the short
  `http://<lan-ip>:4200/intake` (the Inspector → Camera → Presenters URLs).
- Godot `features/live/lt_presenters_model.gd` (new): roster → picks `{label "Name · mic N · on stage", title = name,
  subtitle = the tech's note}`. Presenters on stage come first, then intake order; blank names are skipped.
- `lower_third_section.gd`: when the roster has names, "Presenters (backstage list)" shows one button per presenter
  under Title / Subtitle. A click fills both fields and queues the CG update, exactly like a Data sheet row (the same
  `pick` callable now serves both). With no roster, nothing shows.
- `app/main.gd`: dev flag `--probe-lt` opens the section on a fake layer in a dialog (no look in the test project has
  a lower third).

### What was VERIFIED

- Offline: `smoke-wo675-presenters` 8/0 (now asserts the short URL and the redirect); test:ci 2798 / 0 fail; Godot
  20939/0 (+7 `test_lt_presenters_model.gd`), `--check` OK. Lint is 214 warnings; no file over 500 lines.
- Box:
  - `curl http://192.168.0.23:4200/intake` → `302 → /api/tracking/presenters/intake`, then `200 text/html`. `GET
    /api/tracking/presenters` → `intake_urls: ["http://192.168.0.23:4200/intake", "http://100.101.245.97:4200/intake"]`.
  - With two test presenters posted (Anna Nowak · mic 3 · "CEO, Acme"; Bob Smith · mic 5 · "Host"), `--probe-lt`
    showed both buttons (screenshot). Clicking Anna filled Title "Anna Nowak" and Subtitle "CEO, Acme" (screenshot).
    The test roster was then cleared.
- Owner QA: open the intake on a phone at `http://<box>:4200/intake`, send one person; then a look with a lower third
  → Inspector → tap the name.

## P2 — body recognition for wide shots (22.10)

Owner: "recognizing by body too is what i want because the camera shots that overview stage are gonna be wide
shots, thats why the backstage tech is taking a whole body shot."

### Investigation

- Model: OpenCV Zoo `person_reid_youtu_2021nov.onnx` (`models/person_reid_youtureid`). Input 1×3×256×128,
  BGR→RGB, /255, ImageNet mean/std; output 768 floats (`[N, 768, 1, 1]`, batches work). It runs in the sidecar's
  existing cv2.dnn: 9.5 ms for one crop, 158 ms for 21 (~7.5 ms each) on the box CPU.
- **License caveat for the owner.** The zoo folder says "All files in this directory are licensed under Apache 2.0".
  But the model's upstream (ReID-Team/ReID_extra_testdata, linked from the zoo README) says it was trained on
  Market-1501, DukeMTMC-reID and MSMT17. Those datasets are research-only, and Duke was withdrawn. This is the same
  category as SFace, which was trained on research face data. It is not a blocker for the code, but it is a decision
  for the owner before HighAsCG ships for sale.
- Accuracy, measured on 21 Duke gallery crops (8 people):
  - same person: min 0.661, different people: max 0.494;
  - with grey-world white balance on every crop: 0.590 and 0.458.
  - The balance costs a little separation, but it makes the feature follow the clothes, not the light.
  - It is needed because the phone photo and the stage camera never share a tint.
  - The feature held at 16 px crop width.
  - The test data is not clean: the model may have been trained on Duke, so these numbers are optimistic.
- Intake photo: the tech takes a whole-body shot. The person box comes from the tracking YOLO run on the photo. If
  no YOLO model is present, it is estimated from the face (3.4 face widths wide, down to the bottom of the photo).
  The rest of the photo is background and would swamp the feature.

### What was done

- `tools/tracking-detect/body.py` (new): `Bodies` (cv2.dnn), `grey_world`, `crop` (person box; under 48 px tall
  gives nothing), `embed_crops` (one forward pass for a list), `overlapped` (a box another box covers >30 %),
  `box_from_face`.
- `fetch-face-models.sh`: + `person_reid_youtu_2021nov.onnx`, sha256-pinned (`0579…580d`, 107 MB).
- `sidecar.py`: a `bodies` config flag. `attach_bodies` gives a live track a `body` (768 floats) at most every
  `BODY_EVERY_S` (1 s) per track, `BODIES_PER_STEP` (4) per frame, in one batch. A box another person covers is
  skipped, because its crop is two people.
- `face_embed.py`: optional third argument, the YOLO model. The output gains `body: {ok, feature, box, via:
  detector|face}` or `{ok: false, detail: 'no person'|…}`. The face result is unchanged.
- `src/tracking/presenter-match.js` (new): the evidence and suggestion logic, moved out of `presenters.js` and
  extended to two kinds:
  - face: 0.363 / margin 0.05 / 2 sightings, as before;
  - body: 0.5 / margin 0.08 / 3 sightings;
  - fusion rules:
    - face and body agree → `via: 'face+body'`;
    - they disagree → no suggestion;
    - body only → `'body'`, unless a clearly seen face (2+ sightings) scores that presenter under 0.15;
  - one suggestion per presenter, the best one; a face-backed suggestion outranks body only.
- `presenters.js`:
  - `body` / `body_status` per presenter (persisted in the /tmp roster, owner D2);
  - `observe(list, kind)` and `wantsBodies()`;
  - `defaultEmbed` passes `yolo26n.onnx` (else the first non-pose YOLO in the models dir).
- `detect-service.js`: `bodies` in the sidecar config; `body` features go to the same sink with kind `'body'`, never
  into frames, status or WS. `setFaces(on, sink, bodiesOn)`.
- `register.js`: `observeFaces(camera, list, kind)`. The sidecar runs bodies while any presenter has a body feature.
- Godot `presenters_model.gd` `status_of`:
  - "Looks like P4 by body (60 %) — confirm?" / "by face + body";
  - "Not on stage · body only" / "· face only";
  - "Reading the photo…";
  - "No face or person found in the photo".
  - The section note now says face and body recognition only suggest (D1 unchanged).

### What was VERIFIED

- Offline:
  - `smoke-wo675-bodies` 9/0 (new, curated list): the fusion rules, TTL, body status/persistence, detect-service
    forwarding (both kinds to the sink, none in status) and the source wiring;
  - `smoke-wo675-presenters` 8/0;
  - `test_body.py` 3/0 and `test_face.py` 3/0 in the venv;
  - Godot 20946/0 (+8 `status_of` cases).
- Box:
  - Intake: a synthetic portrait photo (a Duke crop scaled to 600×1200 on a plain background, no face) was posted
    to the live server → `face: none, body: ok` 0.4 s later. The YOLO box found was [0.23, 0.30, 0.78, 0.80].
    Without a detector and without a face → `no person`. The probe presenter was then deleted.
  - Sidecar, standalone: a synthetic 1920×1080 shm camera (hshm_abi.Writer) with two people 200×480 px. One was
    another shot of the intake person, the other a stranger. Run with `bodies: true`:
    - both tracks got a body once per second;
    - similarity to the intake feature: 0.784 for the intake person, 0.152 for the stranger (threshold 0.5);
    - detection + bodies step: median 18.5 ms.
  - Detection is off on this box, so the live sidecar → server path was not run here. It is covered offline.
- Owner QA (real cameras): take a whole-body photo at intake. A presenter seen small in a wide shot should get
  "Looks like P… by body" within ~3 s. Two people in similar clothes should give no suggestion (the margin).

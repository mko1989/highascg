# WO-665 — Previs: tracked people as live cut-out cards (person texturing, step 1)

**Area:** tracking-vr, godot-client
**Status: DONE (22.10, offline suites + live sidecar run on a fed surface + real-client render probe; owner QA on the rig pending)**

Owner, 22.10: "start" — step 1 of `docs/research/multi-camera-person-texturing.md` (the cut-out card / billboard).

## Investigation

- **The 3D view drew no persons.** The research doc (line 28) said the P-tags show "in the 3D view". They do not: P-tags
  are drawn only in the 2D Camera view (`godot/client/features/previs/tracking/tracking_view.gd`). Corrected in the doc.
  The card layer is the first person drawing in the 3D stage.
- **No segmentation existed.** The sidecar (`tools/tracking-detect/detector.py`) loads a detect-only `yolo26n.onnx`.
  `tools/tracking-detect/export-models.sh` already supports any ultralytics name, so `yolo26n-seg` was exported:
  `~/.local/share/highascg/models/yolo26n-seg.onnx`, 11,204,169 B, sha256 `81b3772e…f118708`.
  - Outputs: `output0 [1,116,8400]` = 4 box + 80 classes + 32 mask coefficients; `output1 [1,32,160,160]` = prototypes
    over the 640 letterbox.
  - A mask = sigmoid(coefficients · prototypes).
- **onnxruntime in the venv is CPU only (1.31).** Measured on real frames:
  - detect-only: 17 ms per inference;
  - seg: 29–38 ms per inference, plus about 4 ms for the masks.
  - A seg run costs about 2–3× a detection, which is acceptable at the sidecar's 10–15 Hz.
- **Mask ↔ track matching.** ByteTrack copies the detection box onto the live track unchanged, so a track finds its
  detection (and that detection's coefficients) by rounded box equality. Coasting tracks have no detection this step:
  they get no mask, and the client keeps the last one.
- **Wire budget.** The mask is sampled inside the TRACK box at a fixed 48×96, so mask and video crop line up whatever the
  box size. It is bit-packed and base64-encoded: 576 B → 768 chars per person per step.
  - The first try at 32×64 looked blocky on real frames.
  - 48×96, upsampled bilinearly in the shader and cut at 0.5, gives a smooth contour.
- **Video on the GPU.** `VideoSurfaces.acquire/texture(role)` already hands out the camera's surface as a `Texture2DRD`.
  The card samples it with a UV crop, so there is no CPU copy and no extra encode.

## What was done

**T1 — sidecar seg masks (`tools/tracking-detect/`)**
- `seg.py` (new):
  - `seg_outputs()` detects a seg model;
  - `mask_for()` samples sigmoid(coef·protos) inside the track box (inverse `cv2.warpAffine`, letterbox pad and scale
    mapped, pixel-centre convention);
  - `encode`/`decode` (packbits, MSB first, row 0 = box top);
  - `attach()` gives live tracks their mask.
- `detector.py`:
  - the backend runs both outputs when the model is seg (`nm`, `last_seg`);
  - `decode(..., coefs)` keeps each kept row's coefficients as element 5 (both the 84-column and the end-to-end head).
- `sidecar.py`: attaches the masks after `step`, and the tracks message carries `mask_size` for a seg model.
- `test_seg.py`: self-test, 11 checks, no model needed.
- A detect-only model behaves exactly as before.

**T2 — server pass-through (`src/tracking/`)**
- `detect-model.js`:
  - `maskSizeFrom(msg)`: `[w, h]` positive integers ≤ 256, or null;
  - `personsFrom` passes `mask` through only when it matches `MASK_RE` (base64, ≤ 4096 chars).
- `detect-service.js`: `latest` keeps `maskSize`, and the WS snapshot's camera carries `mask_size` only while fresh.

**T3 — Godot card layer (`godot/client/features/previs/tracking/`)**
- `person_cards_model.gd` (pure):
  - `cards(snap, cams)`: one card per world person with a live view;
  - `best_view`: the largest box in raster pixels; a coasting view is weighted ×0.25. The research doc said "closest and
    most frontal"; box area covers "closest", and "frontal" is left for step 2, which needs normals anyway;
  - `estimate_height`: the ray through the undistorted top-centre pixel, taken at its closest approach in plan to the
    feet's vertical line. A fused `height` wins when present; the result is clamped 0.4–2.6 m, default 1.75;
  - `mask_image`: the mask as an L8 image.
- `person_card.gdshader`:
  - unshaded, double-sided;
  - `ALBEDO` = the video cropped to the box, `ALPHA` = the bilinear mask with scissor at 0.5;
  - without a mask, a soft-edged full box.
- `person_cards.gd` (Node3D on `stage`):
  - one QuadMesh per card: width × height at the fused feet, turned toward the viewer about Y only (people stay upright);
  - holds the camera surfaces only while cards draw, and releases all of them when off;
  - owns its "Cut-outs" CheckBox, persisted in `ui.cfg [previs] cutouts`, and reloads tracking cameras on
    `Store.project_changed`;
  - dev probe `--probe-cutouts=<dir>` draws `<dir>/frame.png` + `persons.json` and saves the 3D view to
    `<dir>/render.png`.

**T4 — wiring (`previs_tab.gd`, +5 lines, 487/500)**
- `stage.add_child(cards)`;
- `markers.detected` → `cards.set_detections`;
- `_apply_mode` → `cards.set_shown(is3d and shown)`;
- `bar.add_child(cards.toggle)` next to "Tracking cameras".

## What was VERIFIED

- **Sidecar on real frames:**
  - the fire-dancer and car-driver frames gave clean cut-outs;
  - the real `sidecar.py` process ran on a HASCGSHM surface fed with `firebelly-torches-dv.mov`: 135 tracks messages,
    142 masks, 13.8 fps, 51 ms per step, 0 errors;
  - 3 of 145 live tracks got no mask. This is unexplained and minor: the card keeps the last mask.
- **Real client render** (second Godot instance, `--tab=1 --probe-cutouts=…`, the real `previs_tab` 3D stage):
  - the dancer stands at the stage origin, background removed, upright and not mirrored (stance matches the source crop);
  - the truss in front correctly hides part of the card.
- **Tests:**
  - `test_seg.py` PASS (11 checks);
  - `smoke-wo665-person-cutouts` 5/5, added to the curated list;
  - `test_person_cards_model.gd`: height recovered within 1 cm (front and yawed cameras), best view, cards from a
    snapshot (a stale camera gives no card, box aspect kept, fused height clamped), mask bit order;
  - `npm run test:ci` 2743 / 0 fail; Godot `--test` 20798 / 0; `--check` boot OK;
  - lint 214 (cap 216), format, file lines, and unwired exports (633) all clean.
- **Not proven, owner QA:** the full loop on the rig. Enable detection with the model set to `yolo26n-seg.onnx` and a
  solved camera, open Previs 3D, tick "Cut-outs", walk. The live project currently has no tracking cameras, so this could
  not run on the box without editing the owner's project.

## Not done (next steps)

- Step 2 of the research doc: projective texturing onto a dummy.
- The model choice is per project (`detection.model`). Picking `yolo26n-seg.onnx` turns masks on; it is not the default,
  because it costs about 2× the CPU.

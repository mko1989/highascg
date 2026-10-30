# WO-667 — Previs: posed dummies from body keypoints (person texturing, step 3)

**Area:** tracking-vr, godot-client
**Status: DONE (22.10, offline suites + real sidecar run on a fed surface + real-client render probe; owner QA on the rig pending)**

Owner, 22.10: "continue building. i will test it later." This follows WO-665 (cut-out cards) and WO-666 (textured
dummies). It is step 3 of `docs/research/multi-camera-person-texturing.md`: a pose model, 3D joints, and a posed
mannequin.

## Investigation

- **WO-666's probe showed both step-2 limits.**
  - The dancer's raised hand is the top of her box, so she measured 2.23 m and her painted head landed on the dummy's
    chest.
  - Her limbs smeared across a static torso.
  - Body keypoints fix both.
- **Pose model.** `export-models.sh yolo26n-pose` gives `~/.local/share/highascg/models/yolo26n-pose.onnx` (12,111,781 B,
  sha256 `e4b862c3…ad4005`).
  - Single output `[1,56,8400]`: 4 box + person score + 17 × (x, y, visibility) in letterbox pixels.
  - On the dancer frame the skeleton is right: raised arm, wide stance, lowered torch arm
    (`scratchpad/seg/card/frame_pose.png`).
- **Pose cannot replace seg.** One model can't give both masks and keypoints, so pose runs as a second session on the same
  preprocessed frame.
  - The two models' boxes for one person differ slightly, so tracks take keypoints by best IoU (≥ 0.4), not by box
    equality as seg does.
  - Cost on the box's CPU-only onnxruntime: seg + pose = 74 ms per step and 9.5 fps on one camera, versus about 51 ms
    and 13.8 fps for seg alone.
  - This is why pose is a separate opt-in ("Body pose: Off" by default).
- **Joints belong on the server.** `fusion.js` already owns world persons, their `keys` (camera:tid), the solved cameras
  and a least-squares ray triangulator (`triangulate`, used for head height). 3D joints reuse all of it. They live next to
  `height` on the world person, where any client (or a later PSN-joint output) can read them.
- **Smoothing must follow fusion steps, not snapshot reads.** `withPins` builds snapshots for the WS tick, the
  verification walk and `GET /api/tracking/detections`, so smoothing there would step 1–3 times per frame. Split into
  `update` (once per fusion step, in `pinTick`) and `decorate` (read-only).
- **Shader bug found on the way.** `person_dummy.gdshader` turned normals with `mat3(MODEL_MATRIX)`. That is wrong once
  parts are scaled unevenly (posed ellipsoids), so it now uses `MODEL_NORMAL_MATRIX`.

## What was done

**T1 — sidecar (`tools/tracking-detect/`)**
- `pose.py` (new):
  - `PoseBackend` (its own ONNX session, half the threads);
  - `decode` (both heads, keypoints mapped out of the letterbox, visibility clamped);
  - `encode` (51 numbers);
  - `attach` (greedy IoU, live tracks only, each pose used once).
- `sidecar.py`: config `pose_model` ("" = off) loads or drops the pose backend. After seg's attach,
  `pose.attach(tracks, poser.predict(rgb, confidence))`.
- `test_pose.py`: self-test, 11 checks.

**T2 — server (`src/tracking/`)**
- `detect-model.js`:
  - `pose_model` in the detection slice (a file name or '', checked like `model`);
  - `kpsFrom()`: exactly 51 numbers, all in 0–1, else dropped;
  - `personsFrom` passes `kps`.
- `detect-service.js`: the config line carries `pose_model` as a path in the models directory, or ''.
- `pose3d.js` (new): `personJoints(wp, views)`.
  - Each joint seen (v ≥ 0.5) by 2+ cameras whose rays are ≥ 5° apart is triangulated (fusion's `triangulate`,
    gap ≤ 0.2 m).
  - Otherwise the biggest view's ray is cut with the upright plane through the person's floor point, facing that camera.
  - `Pose3D.update/decorate`: per-person easing (α 0.5, snap above 0.5 m), coasting persons keep joints for 1 s, dropped
    persons are forgotten.
- `register.js`:
  - `pose3d.update(...)` after each fusion step that stepped;
  - `withPins` decorates world persons with `joints`;
  - reset with fusion.

**T3 — Godot (`godot/client/features/previs/tracking/`)**
- `person_pose_model.gd` (new, pure):
  - `usable(joints)`: both shoulders and both hips;
  - `parts(joints, height)`: torso (hips → shoulders, shoulder-wide, 24 cm deep), neck, head (mean of the face points
    seen, else above the shoulders), and 8 limbs. Each part is a unit sphere stretched between two joints, with radii
    scaled by height. A missing joint drops only its part.
- `person_cards.gd` (dummies mode):
  - each person is a body Node3D holding the static mannequin plus a pool of part instances, all sharing one projective
    material;
  - with usable joints the posed parts show and the static mannequin hides, otherwise the reverse.
- `person_cards_model.cards()` carries `joints`.
- The probe takes `joints` from `persons.json`.
- `detect_model.gd`: mirrors `pose_model`.
- `detect_section.gd`: a "Body pose" picker (Off + installed `*pose*` models).
- `person_dummy.gdshader`: `MODEL_NORMAL_MATRIX`.

## What was VERIFIED

- **Real sidecar** (fed `firebelly-torches-dv.mov` surface, seg + pose):
  - 96 tracks messages; of 103 live tracks, 100 got masks and 95 got keypoints;
  - 0 errors; 9.5 fps, 74 ms per step.
- **Real pipeline into a real-client render:**
  1. the pose model's keypoints on the dancer frame (`add_pose.py`);
  2. the real `pose3d.personJoints` with the probe camera (`add_joints.js`): 15 of 17 joints, monocular plane;
  3. `--probe-cutouts=<dir>:dummies` in a second Godot instance.
  - The posed dummy matches the frame: raised arm up and right, lowered arm down and left, wide stance.
  - The front is painted from the camera; the back is the posed body in mean colour.
  - Sheet: `scratchpad/seg/card/sheet_pose.png`.
- **Tests:**
  - `test_pose.py` PASS (11);
  - `smoke-wo667-posed-dummies` 7/7, in the curated list:
    - kps validation;
    - pose_model setting + config path;
    - two-camera triangulation within 5 mm of the joints projected by camera-model;
    - a joint hidden in one camera via the plane within 10 cm;
    - plane edge cases;
    - easing, keep and forget;
    - Godot / register wiring.
  - `smoke-wo616-tracking-detect` default pin updated with `pose_model: ''`.
  - `test_person_pose_model.gd`: usable, 11 parts, a missing wrist drops one part, the thigh spans hip → knee, the head
    from face points or the fallback, the degenerate side axis.
  - `npm run test:ci` 2750 / 0 fail; Godot `--test` 20826 / 0; `--check` boot OK;
  - lint 214 (cap 216), format, file lines, and unwired exports (633) all clean.
- **Box:** node restarted. `GET /api/tracking/detections` returns `config.pose_model: ''` and lists `yolo26n-pose.onnx`.
- **Owner QA on the rig:**
  1. Detection model `yolo26n-seg.onnx`, Body pose `yolo26n-pose.onnx`.
  2. Previs 3D → People: dummies.
  3. Move your arms: the dummy follows, painted from the cameras.

## Not done (next steps)

- The dummy's height still scales part radii from the box-top height. Joints give a better height (ankles → head);
  worth switching once seen on the rig.
- Depth maps (occlusion by other people or by limbs) and per-camera colour match are still deferred from WO-666.
- GPU execution provider for the sidecar: seg + pose on CPU is 74 ms per camera. Two cameras at 15 fps would need it.

# WO-666 — Previs: tracked people as mannequins painted from the cameras (person texturing, step 2)

**Area:** tracking-vr, godot-client
**Status: DONE (22.10, offline suites + real-client render probe; owner QA on the rig pending). Depth maps and colour-match controls deferred (below).**

Owner, 22.10: "Continue" after WO-665 (step 1). This is step 2 of `docs/research/multi-camera-person-texturing.md`:
projective texturing onto a dummy.

## Investigation

- **Camera maths already existed.** It lives in `godot/client/features/previs/tracking/camera_model.gd`:
  - `project()`: PSN → Godot frame (x, z, −y); `v = Rᵀ·t`; `nx = (f/aspect)·vx/−vz`; `ny = f·vy/−vz`;
  - `apply_distortion()`: radial k1/k2 in units of half the raster diagonal.
  - The shader only had to repeat these exactly. To keep the two from drifting, the maths was written once more in
    GDScript (`person_dummy_model.project_uv`) and tested against `camera_model`.
- **WO-665's data is enough.** Every live view of a person (world `keys` → camera `persons`) brings a box and, with the
  seg model, a mask. That is all a camera needs to paint its part of the dummy.
- **No mannequin asset in the repo.** Godot primitives (capsules and a sphere, merged with `SurfaceTool`) avoid any
  licence question and give a 1 m mesh that is easy to scale.
- **Visibility.** The research doc proposed one depth map per camera. The mannequin is close to convex, so N·V > 0 already
  stops the front camera painting the back. Depth maps only matter when another person or a raised arm sits between the
  camera and the surface. Deferred.
- **Height comes from the box top.** The probe shows it: the fire-dancer's raised hand is the top of her box, so she
  measures 2.23 m and her painted head lands on the dummy's chest. Only pose (step 3) can tell a head from a hand.

## What was done

- **`person_dummy_model.gd` (new, pure):**
  - `views_for(wp, views, by_id)`: the person's views from solved cameras, biggest box first, at most 3 (the shader's
    slots);
  - `cam_uniforms(ce)`: rotation Basis, Godot-frame position, lens [f, aspect, k1, k2], raster;
  - `project_uv(u, p)`: the shader's `cam_uv`, line for line;
  - `face_yaw()`: turns the dummy's front toward the best camera.
- **`person_dummy_mesh.gd` (new):** the procedural mannequin, 1 m tall, feet at y = 0, front +Z, arms at the sides.
  Limbs and torso are flattened to 0.62 depth, normals regenerated, and the mesh is built once and shared.
- **`person_dummy.gdshader` (new):** unshaded, back-face culled.
  - Per camera slot: project the world point; it counts where it lands inside the box and the person's mask (smoothstep
    0.35–0.65); weight = coverage × (N·V)².
  - The weighted mean colour of the cameras wins. Surface no camera paints takes the person's mean colour (8 masked
    samples down the best camera's box), lightly shaded by the normal so the shape reads.
- **`person_cards.gd` becomes the "people" layer:**
  - The "Cut-outs" checkbox became an OptionButton: People: off / cut-outs / dummies.
  - The choice is saved in `ui.cfg [previs] people`. An old `cutouts = true` migrates to "cut-outs".
  - Dummies mode places the mesh at the feet, scaled to the height and turned to the best camera, and fills 3 camera
    slots: video, mask, box, uniforms.
  - Mask textures are cached per camera, so a coasting view keeps its last mask.
  - Every slot's video role is held while drawn.
  - The dev probe now uses a real solved camera (8 m downstage): the person stands where the box puts them, at the
    measured height. `--probe-cutouts=<dir>[:dummies]`.
- **`person_cards_model.cards()`:** each card also carries `views`.
- **`previs_tab.gd`:** `cards.toggle` → `cards.picker`. One line changed; still 487 lines.

## What was VERIFIED

- **Real client render** (second instance, `--tab=1 --probe-cutouts=<dir>:dummies`, fire-dancer frame plus her real seg
  mask):
  - front: her picture is painted onto the dummy's torso and legs, inside her mask;
  - back: no camera paints it, so it shows the mean colour (fire-lit red), shaded;
  - cut-out mode, rendered again after the refactor, is unchanged.
  - The first frames after boot can be garbage, and the stage re-fits on model load; the probe frames at 2 s and captures
    at 3 s and 4 s.
- **Tests:**
  - `test_person_dummy_model.gd`:
    - `project_uv` matches `camera_model.project` + `apply_distortion` within 0.01 px for 2 cameras (one yawed, rolled
      and lens-distorted) × 3 points;
    - points behind the camera → null;
    - `views_for`: the 3 biggest, unsolved cameras skipped;
    - `face_yaw` points the front at the camera;
    - mannequin AABB: feet at 0, head top at 1 m, flattened.
  - `smoke-wo665-person-cutouts` (5/5) now also pins the picker, the ui.cfg migration, and the shader's projection lines
    against the tested GDScript twin.
  - `npm run test:ci` 2743 / 0 fail; Godot `--test` 20815 / 0; `--check` boot OK;
  - lint 214 (cap 216), format, file lines, and unwired exports (633) all clean.
- **Owner QA on the rig:**
  1. Detection model `yolo26n-seg.onnx`, two solved cameras.
  2. Previs 3D → People: dummies.
  3. Walk around: the front is painted, the sides blend where both cameras see you, and the back is flat colour.

## Not done (next steps)

- Depth maps per camera, for occlusion by other people or a raised arm. N·V covers the lone, convex case.
- Per-camera gain/tint (colour match) on the camera objects. Seams between cameras will show until then.
- Step 3 (pose): this fixes both the head-vs-raised-hand height and the limbs that smear across the torso.

# WO-896 — Visuals 3D view drives the output: the orbit camera reaches the program

**Area:** godot-client
**Status: DONE (31.10.26, Godot suite + private-Xvfb probe screenshots; owner-QA of the live feel on the real GUI is not done)**

## Owner request

Owner, 31.10: *"the 3d view of the visuals has no effect on the actual output."*

## Investigation

File references are as found on 31.10.26; to re-verify at implementation.

- The Visuals tab's 3D view is an orbit view. It moves only the **editor** camera.
- The output stage, `features/visuals/visuals_stage.gd`, has its own camera. The mixer decks in
  `features/visuals/visuals_mixer.gd` render through that stage, so they never see the editor orbit.
- Result: the operator can orbit the 3D preview, and the program output stays fixed.
- The shader backdrop quad is not known to follow the stage camera (to verify at implementation; the Design below
  requires it to).
- Flow (`features/visuals/visuals_flow.gd`) drives values over time; whether it can reach a camera parameter is to
  verify at implementation.

## Design (approved 31.10.26)

- Add an option to make the orbit camera **drive the output stage camera**. When on, the stage camera copies the
  editor orbit each frame; when off, the output stays where it is.
- Store the choice and the camera pose **per look** and in the visuals params, so a saved look reproduces its framing.
- Optional: audio-driven orbit. Flow parameters (`visuals_flow.gd`) drive yaw, pitch or distance of the stage camera,
  so the output moves with the music.
- The shader backdrop quad follows the stage camera, so the shader fills the frame from any angle the camera reaches.

## Investigation (31.10.26, at implementation)

- The 3D mode's `orbit` (yaw, pitch, distance) only fed `orbit_cam` in its own SubViewport: `visuals_workarea.gd` `step()`
  (was line 71-75) and `_orbit_input()` (78-85). Nothing read `orbit` outside that file.
- The output camera is created per layer stage in `visuals_stage.gd` `_ready()` (position (0, 0, 14), fov 60, far 400).
  Every layer of a deck is its own `Stage` in its own SubViewport/World3D (`visuals_deck.gd` `_slot()`, line ~180), so
  "the output camera" is N cameras, one per layer. To keep a stack aligned they all take ONE pose: the deck's.
- Looks: `visuals_looks.gd` `KEYS` (line 11) is what a look captures (layers, params, graph); `capture` / `apply` /
  `normalize` / `showing` all loop over `KEYS`, so adding a key is the whole per-look change. `visuals_show_ctl.gd`
  `recall()` (122-131) applies a look then `tab._go(true)`, which makes the mixer crossfade (`visuals_mixer.gd` `go`, force).
  The mixer has TWO decks: the incoming one loads the look, the outgoing one keeps what it had. So a per-DECK pose gives
  "no jump on a crossfade" without extra code.
- Backdrop quads are world-space, NOT camera-attached: `scenes/shader.gd` put its quad at `z = CAM_Z - FAR` (−286) with
  the camera hard-wired at z 14 (lines 10, 62, 90), `scenes/game.gd` the same at `CAM_Z - DIST` (14, 125). With a moving
  camera that quad leaves the frame (a 300-unit-away fixed quad covers the frustum only from the one pose). So the
  design item "the backdrop follows the camera" was REAL work, for Shader and Game (the other scenes are 3D content around
  the origin and are meant to be seen from any side).
- Flow: `visuals_model.gd` `evaluate()` (116-139) returns `{param: 0..1}` for the names in `PARAMS` (7); the Flow param node
  menu (`visuals_flow.gd:80`) and the Inspector sliders (`visuals_page.gd:84`) both iterate `M.PARAMS`. So three new
  parameters appear in the Flow menu and the Inspector with no other change. They are clean to add (no scene reads
  unknown params), so the optional audio orbit is done.

## What was done

Design decisions (the WO left them open):
- **Which cameras:** all of them. The deck holds one pose (`cam`) and gives it to every layer's stage, so a multi-layer
  stack is always aligned. The pose is per deck; only the live deck follows the orbit.
- **Pose = orbit.** The camera sits `dist` from the world origin on the sphere the angles pick, looking at the origin.
  Pose (0, 0, 14) is exactly the old fixed camera (verified by a test), so nothing changes for existing projects / looks.
- **Drive off keeps the stored pose** (not "the orbit at that moment" and not a reset): the output stays where it was.
  Drive on copies the orbit at once and follows it. Flow's offsets (below) apply in both states: binding is the opt-in.
- Store: `project.visuals.camera = {drive, yaw, pitch, dist}`; also a look key. A look saved before this has no camera →
  home, not driving, which is the old picture.

Files:
- `features/visuals/visuals_camera.gd` (NEW, pure): HOME, limits, `normalize`, `clamp_pose`, `transform_of`
  (pose → transform, identical maths to the editor camera), `pose_from` (inverse), `offset` (Flow), `attach` (camera-attached
  quad), `frustum_h`. `normalize` works in doubles (a Vector3 would round the stored 0.9 to 0.89999998).
- `features/visuals/visuals_camera_ctl.gd` (NEW): the tab's controller (like ShowCtl): orbit → `slice.camera` → the
  live deck, project write debounced 0.5 s; `from_slice()` after a load / recall puts the switch and the editor orbit
  in line with the look.
- `features/visuals/visuals_probe_orbit.gd` (NEW): `--probe-visuals-orbit=<dir>` dev probe (never saves the project:
  `ProjectSync.project_gone`), screenshots + numeric shot differences.
- `visuals_workarea.gd`: "Drive output" checkbox + "Home" button in a small bar over the 3D view (`orbit_changed` signal);
  orbit maths moved to visuals_camera.gd; the editor camera got fov 60 / far 400 like the output's.
- `visuals_stage.gd`: `pose` (setter re-aims), `_aim()` each frame = pose + Flow offsets, and tells scenes with
  `set_camera()` where the camera is.
- `visuals_deck.gd`: `cam` (pushed to every stage, given to new layers). `visuals_mixer.gd` `go(..., cam)`: an edit sets the
  live deck's, a look (`force`) gives the INCOMING deck its own; the outgoing deck keeps its pose while it fades.
- `scenes/shader.gd`, `scenes/game.gd`: `set_camera()`; the quad is `attach`ed (dead ahead of the camera at its old
  distance, scaled to the frustum), so it covers the frame at any angle. The Game screen keeps its wobble.
- `visuals_model.gd`: `slice.camera`; params `cam_yaw`, `cam_pitch`, `cam_zoom` (default 0.5 = no offset: yaw ±0.8 rad,
  pitch ±0.5 rad, distance ×0.5…×2). `visuals_looks.gd`: `KEYS` += "camera".
- `visuals_tab.gd`: +6 lines (preload, var, create the controller, pass `cam_ctl.pose()` to `mixer.go`, `cam_ctl.from_slice()`,
  the probe flag).
- `tests/test_visuals_camera.gd` (NEW, 9 tests).

Not done on purpose: no smoothing of the output camera towards the orbit (it is a hard copy, as the design says); Home sets
the orbit to (0, 0, 14), it does not toggle Drive.

## What was VERIFIED

- Godot suite: `[tests] 24622 passed, 1 failed`. The one failure is `test_tab_undock::test_move_to_second_and_back` (Previs
  tab visibility flips; `tests/test_tab_undock.gd` was edited by another agent at 12:59 while I worked, and it passed in my
  first run before that); not touched, reported. `run-client.sh --check`: boot OK. `check-max-file-lines.js`: 0 files over 500.
- New tests cover: HOME = old camera; pose ↔ transform round trip (4 poses); clamps / junk normalize; Flow offsets and a bus
  bound to `cam_yaw` through `M.evaluate`; backdrop quad dead ahead and exactly frustum-height at 4 poses × 3 distances;
  Stage follows pose + offsets, Shader quad rides the camera at an extreme pose; Deck puts one pose on all 3 layers and on
  a new layer; Mixer gives a look's pose to the incoming deck only; Looks capture / apply / showing / pre-WO-896 looks;
  the real tab: drive off leaves the output, drive on follows, look saved with and without drive, recall restores
  the switch, pose and orbit, outgoing deck not moved.
- Probe on a private Xvfb :94 (own XDG_DATA_HOME, `--visuals-ring=probe896`, project writes off), static Rings scene,
  output canvas shots in `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/shots896/`
  (mean shot difference, 0 = identical; two shots at the same pose = 0.0000):
  - `00-home.png` reference; `01-drive-off-orbited.png`: orbit (1.0, 0.5, 25) with Drive OFF → output pose stays (0, 0, 14),
    difference 0.0000.
  - `02-drive-on-orbited.png`: Drive ON → output pose (1.0, 0.5, 25), difference 0.0102 (the rings seen from the side);
    `03-drive-on-moved.png`: orbit (−0.8, 0.2, 18) → output pose follows.
  - `04-orbit-home.png`: orbit back to Home while driving → 0.0000 vs the reference.
  - `05-before-recall.png` / `06-look-recalled.png`: look saved at (−0.8, 0.2, 18) with Drive, Drive then switched off and orbited
    elsewhere, look recalled → Drive back on, pose (−0.8, 0.2, 18), 0.0000 vs the saved framing.
  - `07-shader-*.png`: Shader layer at poses (0,0,14), (2.9,1.3,80), (π,0,6), (−1.2,−1.4,3): the shader fills the frame at
    each (edge brightness 0.041–0.052, no black edge); before this change the world-space quad would leave the frame.
- Probe client logged 0 SCRIPT ERRORs.

Unverified: no live Flow binding to `cam_yaw` watched on a real audio feed (the binding maths is unit-tested through
`M.evaluate` and the stage test; the screenshot probe does not play audio); the crossfade between two different poses was
asserted on the decks (incoming = look pose, outgoing unchanged) but not filmed mid-fade; owner feel-QA of the drag.

## Acceptance / verification plan

- Orbit the 3D view with the option on: the program output (the mixer preview of the stage) changes framing to match.
- Option off: orbiting changes only the editor view; the output stays fixed.
- Save a look with a camera pose, switch away, switch back: the output returns to the saved framing.
- Audio-driven orbit: with a Flow parameter bound to yaw, the output moves with the audio and stops when the binding is
  removed.
- The backdrop quad stays covering the frame at extreme orbit angles (no edge showing).
- Godot suite green, `run-client.sh --check` clean, no file over 500 lines.
- Box: probe client on a private Xvfb with `--tab=Visuals`; set the option through the probe, orbit by script, and
  screenshot the output stage before and after.

## Dependencies

- **WO-890** (dynamic visual layers, per-layer shaders): the camera and backdrop act on the layer stack. Implementation
  waits for it.
- **WO-877** (mixer decks in the Visuals stage): the decks render through `visuals_stage.gd`, so the camera change must
  reach them.
- Flow (`features/visuals/visuals_flow.gd`): needed only for the optional audio-driven orbit.

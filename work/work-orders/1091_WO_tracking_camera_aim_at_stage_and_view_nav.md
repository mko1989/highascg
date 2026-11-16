# WO-1091 — Tracking camera: a new camera sees the stage, rough aim in the Camera view, zoom out, legible overlay

**Area:** tracking-vr, godot-client
**Status: DONE (16.11, Godot suite 28788/0 + on glass on the box: Aim at stage, rough aim, zoom-out, no-signal overlay, Show in 3D, Fit, point pick)**

Owner, 16.11: "in the camera calibration view, i cant rotate the view, or zoom out more than the default. ive added a
camera now (no real connected) and the view of the 3d room doesnt even show the stage..."

Related: WO-616 (tracking cameras, T3b Camera view, T10c coverage, T12 3D ghost), WO-1040 (solve mirror), WO-703
(preset stage marks), WO-711 (PTZ cameras), WO-1002 (tracking stage Fit to selection).

## Investigation

Owner's project `projects/90c_pgrp_hilton_wawer.json` (read only, not changed):

- `previs.tracking.grid` = width 3, depth 15, spacing 1, centre (11.05, −3.5), floor 0.639 — the top of a 15 × 3 m stage
  against a long side wall, PSN X 9.55…12.55, Y −11…4.
- `previs.stage.objects[0]` = LED wall "Dioda P3 15 x 3 m" at Godot (12.7, 1.239, 3.5), rotation Y −90°. Stage
  objects face +Z (Godot) = the audience (`camera_model.gd` header); rotated −90° about Y that is −X Godot = −X PSN. So
  the audience is at X < 9.55, looking +X. Nothing in the project says −Y.
- `cam_1` = pos (0, −11, 6), pitch −22, yaw 0, fov 60, no points, rms −1.

### 1. Default pose of a new camera is a constant

`godot/client/features/previs/tracking/tracking_model.gd:107` — `new_camera()` always returns
`C.camera(0.0, -11.0, 6.0, -22.0, 0.0, 0.0, 60.0)` ("OpenFollow's stage_default camera"): 11 m downstage of the PSN
origin, looking +Y (upstage). It ignores the grid and the stage objects. Projecting the owner's grid corners through
it (`src/tracking/camera-model.js` project, 1920×1080): downstage corners at x = 8867 / 11351 px (far off frame), the
upstage ones at x = 1958 / 2271 px — just past the right edge. The camera looks at empty carpet 15 m in front of it
(floor hit at PSN (0, 3.85)); the grid is "just visible at the far right edge", as in the owner's screenshot.

No other code path places a tracking camera: `tracking_page.gd` `_add_cam` (≈ line 300) only calls `T.new_camera`.
The server has no camera normaliser or default (grep `pos_z` / `normalizeCamera` in `src/` — none; the server's
`src/tracking/camera-model.js` only projects), so there is no server twin to keep in step.

### 2. Camera view navigation

`tracking_view.gd` `_gui_input` (lines ≈ 455–495):
- wheel = 2D zoom of the picture, `clampf(_zoom * f, 1.0, 40.0)` (line 478) — **never below 1×**: the frame always
  fills the view, nothing around it can be seen; at exactly 1× the pan resets to zero (line 481).
- right-drag = 2D pan of the zoomed picture; left click = calibration click / ctrl+click picks a point.
- **Nothing rotates or moves the virtual camera.** The only way to change the pose by hand is the nine pose spin boxes
  on the Inspector page (`tracking_page.gd:156-160`, "X m (stage left +)" … "Lens k2"), placed between Raster H and
  the calibration list — easy to miss, and typing yaw / pitch numbers to find a stage you cannot see is blind work.
- Those spin boxes also edit a **solved** camera silently: `_edit` writes `c.cam[key]` and keeps `rms`, so the status
  goes on saying "RMS 0.4 px" for a pose nobody solved.
- The toolbar **Fit** (`previs_tab.gd:404`) only frames the hidden 3D stage (`stage.frame_box`); in the Camera view
  it does nothing visible. The F key (`previs_tab.gd:320-322`) does both.
- Seeing the camera from outside exists (3D mode → "Tracking cameras" toggle, `coverage_3d.gd`: frustum, footprint,
  coverage cells), but nothing on the calibration page leads there.

### 3. The overlay is too dark — the operator's opacity over a missing picture

- The kiosk client's `user://ui.cfg` (`~/.local/share/godot/app_userdata/HighAsCG Operator/ui.cfg`, read only):
  `[previs] ghost_on=true ghost_opacity=0.1`. The opacity slider was set to 10 % — sensible over a real camera picture.
- `camera_overlay.gd:47` multiplies every ghost pixel's alpha by that opacity, and `tracking_view.gd:220` draws the
  "no picture" frame in `BG_ELEVATED` (a dark grey) behind it. With no signal the room is 10 % of the render over dark
  grey: "dim, dark carpet". The render itself is lit like the 3D view (same `World3D`, same sun; the environment is a
  duplicate with `ambient_light_source = COLOR` 0.25, only background / glow changed, `camera_overlay.gd` `attach`), so
  the darkness is the blend, not the lighting.
- On glass (16.11) the owner's view was not even "no picture": `GET /api/video-surfaces` lists `in1` (channel 5, the
  DeckLink input) `active: true` with a lease — the input delivers frames, all **black** (nothing cabled). So the
  view's "has a picture" test (`tex.get_width() > 1`) was true, the overlay stayed at the 10 % operator opacity, and
  the view showed a black picture with a 10 % room over it (screenshot `00_before`: dark carpet, no stage).
- The "no picture from in1" label is drawn on the back layer (`tracking_view.gd:221`), under the ghost — at full
  opacity the ghost would hide it.

### 4. Neighbours

- **Grid point labels** (`tracking_model.gd:137`, `candidate_points`): corners are named DSR / DSL / USL / USR by PSN
  sign (downstage = −Y, stage left = +X). The positions are right (the grid is axis-aligned in PSN and its crossings
  land on it), but for the owner's stage (audience −X) the corner called "DSR" (−x, −y) is really down-stage LEFT.
  "Grid line X4 / Y0" labels name PSN columns / rows — correct for any placement.
- **Preset stage marks** (`follow_model.gd:159-166`, WO-703; used by `fixtures/calibrate_fold.gd:223`): the same
  −Y-is-downstage names (DSR … SR, Centre). The owner has no marks yet; pressing it would name them wrongly.
- **PTZ cameras** (`ptz_model.gd:90-92`, server twin `src/ptz/ptz-model.js:72-77`): a new PTZ sits at (0, −8, 2.5)
  facing upstage — the same origin assumption.
- Fine as they are: marker Home (`marker_driver.gd:97`, grid centre), puppet "Centre on stage"
  (`src/tracking/puppet.js:140`, grid centre), auto-split home points (`src/tracking/auto-split.js` homePoints,
  spread over the rectangle whatever its orientation), coverage (`coverage_3d.gd` / `coverage_model.gd`, from each
  camera's pose and the grid), detect-sim (`src/tracking/detect-sim.js`: boxes in picture fractions; where they land is
  the camera's pose — fixed by fixing the pose), the dev probe camera in `person_cards.gd:294` (its own fixture).

## What was done (commit 56c2e35d)

- **`tracking/aim_model.gd` (new, pure, tested)** — the camera-placement maths, so it is testable without a scene:
  - `audience(grid, objects, room)`: which side the audience is on. Order: (1) the stage objects' facing (+Z local,
    width-weighted sum; used when the sum is clearly one way, > 25 % of the weight) — an LED wall or screen is built to
    be watched, so it is the strongest evidence; (2) a room box that contains the grid: the side with the most free
    floor (> 1 m) — the audience needs floor; (3) the grid: a deep-and-narrow grid off the origin along X faces back
    towards the origin's side, else PSN −Y (the PSN convention). The owner's project → (−1, 0) from the LED wall.
  - `stage_pose(grid, objects, room, raster)`: on the audience side, looking at the grid centre from 25° up (≥ 2.5 m),
    at the shortest distance (binary search) that frames every grid corner at floor AND head height (1.8 m) with an
    8 % margin at the default fov 60. Inside a room the height clamps under the ceiling and, when the room is too
    shallow to back off, the fov widens up to 100°; past that it says `outside_room`.
  - Rough-aim maths (grab-the-picture): `look` (yaw/pitch by the drag × fov/frame width, pitch ±89, yaw wrapped),
    `move` (sideways/up in the camera plane, scaled to the focus distance), `dolly` (along the view, 10 % of the focus
    distance per notch, ≥ 0.25 m), `zoom_fov` (fov ÷ 1.1 per notch, 10…170°), `clamp_zoom` (0.25…40, snaps to 1×),
    `wide` (how much wider than the frame the overlay must render at a zoom below 1×).
  - `can_aim` / `with_pose`: a solved camera (rms ≥ 0) is refused unless explicitly unlocked; an unlocked change drops
    the solve (rms −1, the clicked points stay so Solve brings it back).
  - `stage_name` / `stage_spot`: DSR…Centre for any audience side; `is_black(img)` (12 × 7 samples ≤ 0.05).
- **New camera** (`tracking_model.gd new_camera(existing, role, cam)`, `tracking_page.gd _add_cam`): starts at
  `stage_pose` for the project's grid, stage objects and room (the MVR room box, `mvr.room()`).
- **Pose section** (`tracking/pose_section.gd`, new; the pose spin boxes moved here, now right under the page's
  "Pose" heading): a state line (Not calibrated + the view gestures / Unlocked / Solved – locked), **Aim at stage**,
  **Unlock pose…** (confirmation; only on a solved camera), **Show in 3D**. A locked camera's spin boxes and Aim at
  stage are disabled; nothing ever overwrites a solved pose silently. The note after Aim at stage names where the
  audience side came from and is dropped when another camera is shown.
- **Camera view** (`tracking_view.gd`): while the camera is free (Calibrate mode, not solved or unlocked): drag = look
  around, shift+drag = move, shift+wheel = dolly, ctrl+wheel = lens; a press without a drag still picks / clicks as
  before. The pose is saved on release / per wheel notch (not per motion — `mark_dirty` snapshots undo). Wheel zoom now
  goes down to 0.25×: the real frame is outlined, the area outside it is veiled, and the overlay renders around it
  (`camera_overlay.gd` `wide`: the ghost renders a wider fov, ≤ 85° half-angle, and the shader keeps frame pixels
  where they were and draws the outside at full strength). Draw layers moved to `tracking/view_layers.gd` and the
  grid fields to `tracking/grid_section.gd` (500-line limit).
- **Too dark**: with no picture **or a black picture** (checked every 2 s, `is_black` on the surface image) the
  overlay draws at full strength regardless of the operator opacity, and a "no signal on in1 (black) — the 3D stage
  shown in its place" chip sits on a dark backing on top. With a real picture the operator's opacity applies as before.
- **Show in 3D** (`previs_tab.gd _show_in_3d`): ticks "Tracking cameras", switches to 3D and frames the coverage box
  from the camera's side. **Fit** also resets the Camera view's zoom/pan.
- **Neighbours**: calibration grid-corner labels and the Lighting preset marks (`follow_model.preset_marks(…, aud)`,
  called with `aim_model.project_audience(Store.project)`) are named for the real audience side (ids unchanged, so
  stored points still match). A new PTZ camera starts where a tracking camera would stand, facing the stage centre
  (`aim_model.ptz_pose`; pitch 0 = level mount); `ptz_model.normalize_camera` and its server twin keep their
  defaults (no server change, no node restart). Smoke `smoke-wo700-calibrate-heads-lighting.test.js` repointed to the
  new preset-marks source.
- Fine as they were (section 4): marker Home, puppet Centre on stage, auto-split home points, coverage, detect-sim,
  the person-cards probe camera.

## What was verified

- Godot unit suite: `GODOT=~/.local/opt/godot/godot ./run-client.sh --test` → **28788 passed, 0 failed**
  (`tests/test_tracking_aim_wo1091.gd`: default pose for the origin grid (no objects / a wall facing −Y), the owner's
  stage (yaw 90, X < 9.55, the old default does not frame it), a 45° stage, tiny 1×1 and huge 40×60 grids, inside a
  room / a shallow room (fov widens) / a box that is not a room; rough-aim look / move / dolly / fov / yaw wrap /
  pitch clamp, zoom limits and `wide`; never overwriting a solved camera (refused locked, rms dropped when unlocked);
  stage names for −Y / −X / +Y audiences and the candidate label; preset marks for the owner's stage; PTZ pose).
  `--check` boot OK.
- On glass on this box (owner GUI relaunched under `flock -o /tmp/highascg-gui.lock`, xdotool, screenshots looked at):
  `01`–`03` relaunch → Calibrate: the black-input overlay is now the full-strength room (was dark carpet);
  `04` **Aim at stage** on cam_1 → (−5.62, −3.5, 5.7) pitch −16.9 yaw 90 fov 60 (height clamped under the MVR
  ceiling): the whole 15 m stage, grid and LED wall framed; `05` drag = look (yaw 90 → 83.2, pitch −16.9 → −19.0,
  saved to the project); `06` zoom-out: frame outlined, room rendered and veiled around it; `07` ctrl+wheel fov
  60 → 49.6, shift+wheel dolly (saved); `08` shift+drag move; `09` **Show in 3D**: 3D view, frustum + coverage;
  `10` Fit resets the Camera view; `11` "Grid corner DSL" highlights the near-right corner (audience −X: stage left
  = −Y, on the audience's right) — correct; `12`/`13` Add → Camera 2 sees the stage at once, then deleted;
  `14` zoomed out with the no-signal chip legible.
- Gates (16.11): verify:script-paths 0, max-file-lines 0, unwired-exports 0, `index.js --no-http` 0, lint 0,
  format:check 0, npm-audit 0; offline suite first 1 (the WO-703 preset-marks smoke pinned the old source, the index
  was stale, and two rc-game Narvil-scene tests of another agent's uncommitted work) → after the smoke repoint and the
  index rebuild **0** (6764 pass, 0 fail).
- Not verified: a **solved** camera's locked / Unlock pose… flow on glass (unit-tested only — the box has no solved
  camera and solving one needs a real picture); the PTZ Add on glass (unit-tested); a real camera picture under the
  operator opacity (no input is cabled); the per-2-s black check's frame cost (a GPU read-back of one 1080p frame).

End state: cam_1 aimed at the stage (rms −1, no points), the test camera removed, one fullscreen GUI on the project,
Previs tab.

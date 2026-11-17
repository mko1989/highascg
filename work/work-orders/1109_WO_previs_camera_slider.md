# WO-1109 — Previs: a camera slider (A → B camera moves, played smooth and repeatable) for a "cinematic" view

**Area:** godot-client, tracking-vr
**Status: DONE (17.11.26 — built by an agent, Godot suite 30093 / 0; lead, on the box: three moves stored in `previs.camera` ("Carpet dolly in", "Slider left to right", "Crane down"), the fold shows in the owner's GUI, and a move played on the previs output (two channel prints 6 s apart show the camera travelling). Not driven by hand: Set A / Set B, scrub, play / stop on the operator's own view, undo)**

Owner 17.11 (verbatim): "id also like to add a camera slider option so i can easily create a 'cinematic' view."

Related: [WO-1108](./1108_WO_previs_view_as_live_source.md) (the Previs output plays these moves on its own camera),
[WO-1098](./1098_WO_obj_venue_importer_and_real_hilton_hall.md) (View presets), [WO-1025](./1025_WO_previs_camera_dolly_forward.md)
(dolly), [WO-1008](./1008_WO_previs_full_screen_floating_inspector_and_middle_pan.md) (middle-drag pan).

## Investigation

How the Previs 3D camera worked before this WO:

- **One orbit camera, four numbers.** `features/previs/previs_stage.gd:21-24` holds `_yaw`, `_pitch`, `_dist`, `_target`;
  `_update_camera()` (`:302-307` before this WO) puts the Camera3D at `_target + (sin yaw · cos pitch, sin pitch,
  cos yaw · cos pitch) · _dist` and `look_at(_target, UP)`. No roll; `fov` fixed at 50 (`:63`).
- **Who moves it:** mouse orbit / wheel / middle-drag pan / left+right dolly (`handle_input :207-233`, `pan :239`,
  `dolly :260`), the game pad (`_process :268-293`, WO-1067), `frame_box` (Fit, F, a stage load), and the View presets
  (`fly_to_preset :177-193`: a 500 ms Tween of yaw / pitch / dist / target; the pad kills it, nothing else does).
- **No pose API:** nothing outside the stage could read or set "where the camera is"; the presets pass orbit numbers.
  `view_presets.gd` (WO-1098) already documents the orbit convention the tests rebuild (`test_view_presets_wo1098.gd _cam`).
- **Pitch range:** mouse orbit clamps pitch to −0.2…1.5 rad (`:232`); `look_at` with `Vector3.UP` fails at ±π/2, so any
  pose → orbit conversion must stay short of the pole.
- **Where the controls go:** the 3D mode Inspector page is `previs_tab.gd _build_panel` (Fold sections, WO-640); View holds
  Front / Top / ISO. `previs_tab.gd` was at 498 lines, `previs_stage.gd` at 353 (500-line limit): new code in new files.
- **Persistence path:** previs sections write `Store.project["previs"][<key>]` and call `ProjectSync.mark_dirty()`
  (`mvr_section.gd _save :228-239`); `ProjectSync.edited` feeds the undo history (`core/project_undo.gd:32`); a remote
  sync arrives as `Store.project_changed`. `previs` is a client-owned slice (`src/engine/project-client-slices.js:15`), so a
  web autosave keeps unknown sub-keys.

## What was done

- **Model — `godot/client/features/previs/camera/camera_slider_model.gd` (new, pure):** a pose is `{pos, look, fov}` in the
  stage frame; a move `{id, name, a, b, duration_s (0.5…600, default 12), ease (linear | smooth = smoothstep, default |
  in | out), mode (once | pingpong, default | loop)}`; `project.previs.camera = {moves, active}`.
  `normalize()` drops junk (no usable A; NaN), clamps, makes ids unique, keeps unknown keys; a missing B = A.
  `sample(move, t)` lerps the position AND the looked-at point (the subject stays framed) and the fov. `phase(move,
  elapsed)` → the eased position for once / loop / ping-pong (back with the same ease); `elapsed_at()` inverts it so ▶
  resumes from wherever the slider stands. `orbit_of(pose)` / `pose_of_orbit()` convert to the stage's orbit state —
  never NaN (position = look point keeps a level view; pitch held at ±1.55 rad). `transform_of()` for the output camera.
- **Stage hook — `previs_stage.gd`** (+23 lines): `view_pose()`, `set_view_pose(pos, look, fov)` (sets orbit state, so
  orbit / pan / dolly continue from there; kills a running fly-to), `flying()`. Why orbit state and not a free camera:
  the operator's next mouse move must continue from the framed view, not snap back to an old orbit point.
- **Runtime — `features/previs/camera/camera_slider.gd` (new):** owns the playback clock and drives the stage. "The
  operator took over" is detected, not hooked: each played frame compares the stage's pose with the pose it set last
  (1 mm) and checks `flying()` — so orbit, pan, wheel, dolly, pad, Fit / F, a View preset all stop playback with no
  edits in those paths.
- **UI — `features/previs/camera/camera_slider_section.gd` (new):** Inspector fold "Camera slider" right under View:
  move picker + "+" (new move, A = B = the current view) + "✕" delete, an inline name field, Set A / Go A / Set B / Go B,
  ▶ / ■ and a 0–100 % slider (dragging scrubs and pauses), Duration (a SpinBox: RULES.md maths + select-on-focus through
  `core/numeric_field.gd install`), Ease, Mode. With no move only "+" and a one-line hint show. Saves through
  `ProjectSync.mark_dirty()` (undo-able); `Store.project_changed` reloads it (a playing move keeps playing with its new
  data, a deleted one stops).
- **Wiring — `features/previs/camera/previs_cinema.gd` (new):** builds the runtime, the section and the WO-1108 output;
  `previs_tab.gd` got one line in `_build_panel` (`for f in …previs_cinema.gd.attach(self): v.add_child(f)`).
- **Tests — `godot/client/tests/test_camera_slider_wo1109.gd` (new, 112 asserts):** normalize (defaults, clamps, junk,
  unknown keys, unique ids, active), new_move, sample, the four eases (ends, monotonic, symmetry), phase for the three
  modes (ping-pong's way back has the same ease), elapsed_at inverts every ease, pose ⇄ orbit round trip at three poses
  incl. the transform, degenerate poses (position = look, straight down, A = B, zero duration) without NaN.

## What was verified

- Godot suite `run-client.sh --test`: **30077 passed, 0 failed** (baseline before both WOs 29901; +112 this WO, +64 WO-1108).
- `run-client.sh --check`: boot OK (no script errors). `node tools/ci/check-max-file-lines.js`: 0 files over 500
  (`previs_tab.gd` 500, `previs_stage.gd` 377).
- A mid-work slip, recorded honestly: for a few minutes `previs_stage.gd` named its preload `Slider`, which shadows
  Godot's native `Slider` class — a parse error in the stage script (caught by the first unit run, renamed `CamPose`).
  A GUI relaunch in that window would have had no Previs stage; a relaunch now is clean.

## What is NOT verified (the lead's on-glass list)

Nothing was run on glass (no GUI / Xvfb from this session). On the owner's GUI after a relaunch, Previs ▸ 3D, Inspector:

1. "Camera slider" fold under View: only "+" and the hint. Frame a wide view, press "+": picker shows "Move 1", the rows
   appear. Orbit / zoom to a close view, "Set B".
2. ▶: the view travels from A to B and back (ping-pong, 12 s each way, eased at both ends); the slider follows. ■ stops.
3. Drag the slider: the view scrubs, playback pauses; ▶ continues from the slider's point.
4. While playing, orbit with the mouse (or the wheel, middle-drag, a View preset, F): playback stops at once and the
   camera stays where the operator took it (no jump back).
5. Go A / Go B fly there (500 ms); Duration 4 → faster; Ease Linear → constant speed; Mode Once → stops at B; Loop →
   jumps back to A.
6. Rename in the name field (Enter) → the picker shows the new name; "✕" deletes; Ctrl+Z restores (undo history).
7. Reload the project / a second client edits the move → the fold follows.

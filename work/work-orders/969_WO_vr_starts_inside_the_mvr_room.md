# WO-969 — VR starts inside the loaded MVR room, facing its rig, not 8 m +Z of the origin (backstage in this venue)

**Area:** tracking-vr, godot-client
**Status: IN PROGRESS (05.11.26 — Godot suite 26006/0, boot check OK, XR client restarted on the code; the start pose in the headset waits for the owner to put it on)**

Owner 05.11: *"the vr session doesnt show most of the scene."*

Related: [WO-741](./741_WO_vr_walk_mvr_scene_program_lights.md) (the walk, `start_pose`),
[WO-770](./770_WO_vr_session_gui_pin_modal_mirror.md) (session + desktop mirror),
[WO-957](./957_WO_vr_headset_black_smaa_multiview.md) (the last VR render fix).

## 1. Investigation

- Session state: WiVRn up, Quest 3 connected, `XR_SESSION_STATE_FOCUSED` while worn. The XR client log (run of 20:39)
  had no render errors: no WO-957 framebuffer lines, only the old `ssr_roughness_quality` deprecation warning.
  `--xr-mode on` also turns on Godot's XR shaders, so the missing `[xr]` section in `project.godot` is not the cause.
- The XR client's own window (the WO-770 mirror, which follows the head) showed a floor corner, one wall panel and
  black. Nothing else of the MVR was in view, although the client had loaded it ("1196 objects, 1350 parts from
  109 meshes").
- The loaded MVR is "Narvill Pozytywni Serock" (`/api/stage/mvr/a6348e82b04e`). Its part positions, per layer:
  - Tables "Stoły": z −20.9 … −6.8 (the audience).
  - LED walls "Dioda środek" / "Dioda R": z ≈ −1.5, y 1–4.
  - Stage "Scena": z −3.6 … −1.5.
  - "Layer 22" (back structures): z 0 … 3.3 across x −31 … 28.
  - Room: x −33 … 29.5, z −24.2 … 3.3, y 0 … 6.
  - So this venue's audience is at **−Z** and the stage faces it from z ≈ −1.5.
- `xr_walk.gd _ready` always started at `Walk.start_pose(Vector3.ZERO)`, i.e. (0, 1.7, **+8**) looking −Z. That
  assumes HighAsCG's own stage convention (audience +Z). In this venue that start is backstage, outside the building
  (the room ends at z 3.3), behind the back structures and the back of the LED walls, which block most of the scene.
  The two side walls the owner hides (`previs.mvr.hidden_layers`) leave the view out of the corner open to the black
  outside, which is the mirror frame above.
- The MVR has no `screen` objects (0), so the screens can't say where the audience is. Its 107 fixtures hang over
  the stage and the front of the hall.

## 2. What was done

- `xr_walk_model.gd room_pose(box, focus)`: the start in a room is its middle at eye height. It faces `focus` (the
  rig centre) when that is more than 0.5 m away horizontally, else yaw 0 as before.
- `mvr_scene.gd room()`: the loaded scene in world space. It returns `box` (every object's meshes, shown or not) and
  `rig` (the centre of the MVR fixtures' boxes, or null), or `{}` when nothing is loaded.
- `xr_walk.gd`:
  - `_ready` places the walk with `_to_room(tab.mvr)`, and again on every `loaded` signal: the MVR loads
    asynchronously after the session starts. A cleared scene or a load error doesn't move the player.
  - In the headset it sets the XR origin's x/z and its `rotation.y`, the same yaw snap turn uses. On the desktop walk
    it sets the camera and `_yaw`.
  - It logs `[xr] room start <pos> yaw <deg>`.
  - Without an MVR the old `start_pose` stays: HighAsCG's own stage keeps its audience at +Z.

For this venue that is about (−2, 1.7, −10.5) among the tables, turned to face the stage and LED walls.

## 3. Verified

- `tests/test_xr_walk.gd test_room_pose_faces_the_rig`, with the venue's box: the start is at the middle, forward
  points at the rig, and with no rig or a rig overhead the yaw stays 0. Godot suite 26006 passed, 0 failed;
  `run-client.sh --check` boot OK.
- The XR client was restarted on the new code (`POST /api/vr/start`). The Quest had gone to sleep, so the client is
  waiting for it (WO-776).

**Pending:** the owner puts the headset on. Then check the `[xr] room start` line in `~/.highascg/log/godot-xr.log`
and the mirror frame (stage and tables in view).

# WO-682 — move objects in the 3D previs (drag) and from an Inspector Position card

**Area:** godot-client
**Status: DONE (22.10, Godot 21034/0 + boot check; box: head drag + card, MVR truss tower drag / keys / card + relaunch
persistence, LED wall keys + shift-drag + card; owner's layout restored afterwards; owner QA open)**

Owner, 22.10: *"also why cant i move the objects around in 3d and with parameters. in inspector"*. Proposal (4 parts:
Position card, 3D drag with shift for height, heads keep their Programmer values, beam / aim follow) → owner: *"go"*.

## Investigation

What could already be moved, and how, before this WO:

- **Stage objects** (LED walls, TVs, projection — `stage_panel.gd`): only by typing X / Y / Z / Yaw in the Stage
  inspector, or arrows / Q / E (`previs_tab.gd` key handler → `stage_panel.nudge` / `turn`). No 3D drag.
- **MVR objects** (truss, deck, set pieces): not at all, one by one. The whole scene moves with the MVR section's
  Place X / Y / Z / ↻ (`mvr_section.gd` `_place`); objects stand where the file put them (`mvr_scene.show_scene`).
- **Heads** (`project.fixtures.patch[*].pose`): only where the MVR / patch put them; no editor in the previs.
- A left press in the 3D view always went to the orbit camera (`previs_stage.handle_input`), and the click logic ran on
  release, so a drag was never available for objects.
- Frames to respect: stage frame = Godot (X across, Y up, Z downstage); a head's pose is PSN-like (x stage left,
  y upstage, z up; `psn_to_stage = (x, z, -y)`), with yaw negated in `fixtures_3d_model.pose_xform`. MVR object
  nodes sit under the scene root, whose transform is the Place (`mvr_scene.set_place`).
- The server follow engine reloads `project.fixtures` on every project write (`routes-data-project-sync.js:36`
  `emitProjectChanged` → `follow-service.js:142` `onProjectChanged(apply)`), so a saved pose reaches the IK
  with no extra wiring.

## What was done

New `godot/client/features/previs/move/`:

- `move_model.gd` (pure) — frame maths: `head_pose` (stage delta + turn → pose, yaw wrapped ±180), `group_delta`
  (turn about the selection's pivot + shift), `moved_local` (a stage-frame delta → the object's local transform under
  the Place), `xf_to_array` / `array_to_xf` (12 floats; identity stores nothing; junk / short / flat basis → identity),
  `yaw_of`, `base_of` (bottom centre = the pivot), `floor_at` / `wall_at` (drag planes).
- `move_targets.gd` — what is moved: the last kind picked that still has a selection — **heads** (Programmer selection
  → `patch[*].pose`), **mvr** (3D-clicked MVR objects → new `project.previs.mvr.moved[uuid]`), **stage** (Stage panel
  object → `stage_panel.place`). `begin` / `preview` (live, unsaved) / `commit` (saved), `set_from_card`, `nudge`.
- `move_drag.gd` — a left press **on the selection** arms a drag (anywhere else still orbits / picks); past 4 px it
  slides on the floor plane at the pivot's height, shift at the press = up / down on an upright plane facing the
  camera; one save on release. A click without a drag still falls through to the normal pick. Keys: arrows 5 cm
  (shift 50 cm), Page Up / Down height, Q / E turn 5° (shift 15°) — for every kind, not just stage objects.
- `position_card.gd` — the Inspector's **Position** fold (first in the panel): X / Y (height) / Z / Yaw of the
  selection; hidden when nothing is selected; an edit moves it (a group moves together).

Wiring:

- `mvr_scene.gd` — `set_moved` (from `configure`) applies `previs.mvr.moved` to each object node; nodes built by
  `show_scene` start from it, so a moved object survives a relaunch and a re-show.
- `mvr_section.gd` — `objects_picked` signal on a 3D hit; `selected_uuids()`.
- `mvr_screens.gd` — `refresh()` recomputes the selection frames from the live boxes (each wall keeps the `toward`
  it was clicked from), so the yellow frame follows a moved object.
- `fixtures_3d.gd` — `preview_pose(id, pose)` for the live drag.
- `stage_panel.gd` — `place(pos, yaw)`; the old `nudge` / `turn` are gone (the keys go through `move_drag.key`).
- `previs_tab.gd` — `move_drag.input` runs before the orbit camera; the pick now runs on release only; arrow / Page /
  Q / E keys → `move_drag.key`.
- `move_targets` listens to `stage_panel.stage_changed` as well as `Store.project_changed`: the Stage panel's own saves
  do not echo a `project_changed`, so the card stayed on the old value until this was added (found on the box).

Why an MVR `moved` map rather than rewriting the .mvr: the scene id is the file's content hash and other projects can
share it; per-project offsets keep the file untouched and are erased again when an object goes back (identity).

Known limit: a head standing on a moved truss does not follow it — move both (select the heads, same delta).

## What was VERIFIED

- Godot suite **21034 passed, 0 failed** — new `test_move_model.gd` (frames / head pose, group turn about the pivot,
  `moved_local`, stored transform round trip + junk, yaw / base, planes) and `test_move_drag.gd` (press off the
  selection left alone, click on it still picks, floor drag commits (2, 0, 3) once, shift = height only (0, 1.5, 0),
  keys nudge, nothing selected → keys left to others). `run-client.sh --check`: boot OK. No file over 500 lines.
- Box, project `godot_test`, Godot GUI on :0:
  - Head: click → card "Focus Profile 1 1, X −2.5, Y 2.0, Z 6.0, Yaw −180"; drag moved it live and saved the pose;
    typing X / Z put it back.
  - MVR truss tower: click → card "Tower L — MVR, X −2.5, Y 0, Z 6"; drag → X −0.66 / Z 6.67, saved as
    `previs.mvr.moved[f4c5dca0…]` (rev 121); **GUI relaunch → still there**, card read it back; shift+→ and Q →
    X −0.16, yaw 5°, frame followed; card X −2.5 / Z 6 / yaw 0 → `moved` = `{}` (rev 125).
  - LED wall: shift+↑ → Z −3.5 saved (rev 126); shift+↓ → −3.0 and the card refreshed at once (after the
    `stage_changed` fix); shift-drag up → position [0, 0.981, −3] (X / Z untouched); card Y 0 → [0, 0, −3].
  - End state = the owner's layout: wall [0, 0, −3], `moved` {}, heads ±2.5 / −6 / 2 m yaw −180. `gui.log`: 0 errors.
- Not proven on the box: the server IK using a dragged pose — code path only (see Investigation; `/api/tracking/fixtures`
  listed none with follow idle).
- Owner QA: drag heads / truss / wall in 3D, edit the Position card, keys.

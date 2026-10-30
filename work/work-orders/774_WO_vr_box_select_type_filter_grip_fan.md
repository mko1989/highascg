# WO-774 — VR: box select over fixtures, a fixture-type filter, and the right grip fans pan / tilt

**Area:** tracking-vr, lighting
**Status: IN PROGRESS (25.10) — offline-verified (Godot 21865 / 0, boot check OK, sandbox GUI e2e of the panel / box
drawing / type row); headset QA = owner (no OpenXR path can run off the headset).**

Owner, 25.10 (in the headset):
> In vr add ability to select via dragging a selection box over fixtures. Then give a drop down to select only by
> fixture type. There are two buttons under fingers the one that is pointing fixtures is good the second one should
> change their fan.

Parents: [WO-741](./741_WO_vr_walk_mvr_scene_program_lights.md) (the walk), [WO-757](./757_WO_vr_programmer_panel.md)
(the wrist panel), [WO-771](./771_WO_vr_panel_selection_highlight_groups_view.md) (panel selection / groups view).

Reading of "two buttons under fingers": the right controller's **trigger** (index finger — picks and aims, "is good",
unchanged) and **grip** (middle finger — until now the add-to-selection modifier). The grip gets the fan; the add
modifier moves to the **left** grip.

## Investigation

1. **The trigger today** (`features/previs/xr/xr_walk.gd` at HEAD): `_right.button_pressed` → `trigger(true,
   _right.is_button_pressed(&"grip_click"))` (line 85): the right grip was the add modifier. `_trigger` (223–231) runs
   on the **press**: `Walk.trigger` (xr_walk_model.gd) → a head hit / near → `sel.pick`, else with a selection the
   floor under the ray → `tab.aim_drag.aim(psn)`. A release only reaches the panel. So a box drag needs the floor aim
   moved from the press to the release (a press that turns into a drag must not have aimed already); a press on a
   head can stay instant.
2. **Picking.** `fixtures_3d.gd` `hit()` (ray vs each head's body AABB, visible heads only) and `near()` (screen
   distance of the body centre to the pointer) through the right controller's non-current `_pointer` camera. Each
   head's parts carry its GDTF type id (`parts.type = str(f.typeId)`, fixtures_3d.gd:161). Nothing listed every
   head's centre for a box test. `aim_drag.gd` and `move_targets.gd` call `hit(cam, pos)` / `near(cam, pos, px)` —
   an optional trailing parameter keeps them unchanged.
3. **Fixture types.** The Programmer lists the "typed patch entries" (`programmer_section.gd:21`, `_fill_list` 108:
   `F.normalize(project.fixtures).patch` with `typeId != ""`). Names come from `GET /api/fixtures/types`
   (`[{id, manufacturer, name, …}]`, used by `fixtures_section.gd` `refresh_types`). `auto_groups_model.gd` already
   groups by type for "By position" (name guessed from fixture names) — not a filter. `programmer_section.gd` is 445
   lines: the filter goes in its own file, like `xr_looks_row.gd`.
4. **Pan / tilt and "aim" on the server.**
   - Programmer values are per fixture, physical units: `POST /api/fixtures/program {ids, values}`
     (`src/api/routes-fixture-dmx.js:66-77`) writes **the same** `values` to every id (`follow-engine.js:125`
     `program`). Pan / Tilt keys are `"Pan"` / `"Tilt"` in degrees.
   - Ranges: `GET /api/fixtures/program/features` → `pan` / `tilt` = `{from, to, at}` (`src/fixtures/gdtf-features.js`
     `range()`, `at` = the GDTF default the slider shows unprogrammed).
   - **Point at is one-shot.** `POST /api/fixtures/program/aim` → `follow-service.js:243-253` `aim()` → `aimValues`
     (`gdtf-features.js:66-77`) solves the IK once and **programs Pan / Tilt**; no aim point is stored anywhere (the
     client's `sel` has none either). The only persistent "follow" is the patch's `follow` marker (`follow_model.gd`,
     follow-engine.js:7 — tracking markers, a different feature; while a head follows a marker the engine's aim wins
     over the programmer's pan / tilt, follow-engine.js:20-21).
   - The Programmer refreshes its sliders on `sel.aimed` (`programmer_section.gd:93`).
5. **Grip input.** The OpenXR action map Godot uses binds `grip_click` to the Touch controller's
   `/user/hand/{left,right}/input/squeeze/value` (`godot/client/openxr_action_map.tres` 509–513, Godot's default map),
   so `is_button_pressed(&"grip_click")` / `button_pressed("grip_click")` work on both hands; the left grip was unused.
6. Test-runner constraint (WO-757): `tests/run_tests.gd` compiles without autoloads, so `xr_walk.gd` (preloaded by
   tests) must not name `Api` / `Store`; anything using them is `load()`ed at headset start or gets callables injected.

## Decision: what the fan spreads

Fan = the console fan: each selected head's **programmed Pan / Tilt**, offset by `k × spread` with `k` = −1 for the
first, 0 for the middle, +1 for the last (selection order), each from its own current value and clamped to its own
range. Not aim points, because the codebase keeps none (investigation 4): Point at converts a floor point into Pan /
Tilt at once, so after an aim the heads simply sit on pan / tilt values that point there, and fanning those spreads the
beams around the aimed spot — "aim at a spot, then fan out from it". Spreading floor aim points instead would need
the client to remember an aim the server forgot, a different IK call per head per frame, and would make the fan
meaningless after a manual pan / tilt slider move; a degree fan works in every case. A box selects left → right as the
controller sees it, so a box-selected row fans in stage order.

No new endpoint: per-fixture values go as one ordinary `POST /api/fixtures/program` per head (one round in flight,
the newest spread winning, as `aim_drag.gd`). With a few dozen heads a round is a few dozen local requests; a batch
endpoint (`{values_by_id}`) is the follow-up if a big rig feels slow in the headset. It needs no node restart.

## What was done

- **`features/previs/xr/xr_walk_model.gd`** (pure, tested) — box: `view_frame` (the press ray's view, level with the
  floor whatever the controller's roll; straight down → upstage is up), `view_angles` (right / up angles, null
  behind), `dragged` (past `BOX_MIN_DEG` = 3°), `in_box`, `box_pick` (heads `{id: {at, type}}` inside, left → right,
  optional type), `box_outline` (the drawn box, curved edges at `BOX_DIST` 3 m), `box_select` (replace; add with the
  left grip; **an empty box changes nothing** — a stray drag in the headset never wipes the selection, None does).
  Types: `patch_types` (`[{id, name, count}]` by name), `of_type`. Fan: `fan_k`, `fan_spread` (2 cm dead zone, then
  `FAN_DEG_PER_M` 150°/m — first guess, tune in the headset), `fan_move` (sideways = the head's level right, up = up,
  room metres), `fan_bases` (programmed value, else the GDTF default, with lo / hi), `fan_values` (only the axes the
  hand moved — a sideways fan never writes Tilt).
- **`features/previs/xr/xr_fan.gd`** (new, injectable `get_json` / `post_json`): grip down → features + program
  values → bases; each frame's spread → one write per head; grip up → `sel.aimed` (the sliders follow).
- **`features/previs/xr/xr_walk.gd`** (headset path):
  - right grip → `_fan_p0 = _right.position` (room space: walking with the stick does not fan) + `_fan.start()`;
    every frame `_fan.move(Walk.fan_move(...))`; release → `_fan.end()`. The Api callables come from
    `get_node("/root/Api")` at headset start (the file still names no autoload);
  - the add modifier is `_add_held()` = the **left** grip (head picks, box, and ctrl in the panel's list);
  - `trigger()`: on the panel as before; in the stage a press on a head picks at once (type-filtered `hit` / `near`);
    else the press is kept (`_press`), `_drag()` turns it into a box past 3° and draws it (an `ImmediateMesh`: faint
    fill + outline, no depth test, top level), the release selects the box (`fixtures3d.heads()`) or, not dragged,
    aims at the **press** ray's floor spot — the same target as before, sent on release.
- **`features/previs/fixtures/fixtures_3d.gd`**: `hit()` / `near()` take an optional `only_type`; `heads()` lists the
  shown heads' world centres and types. 470 → 483 lines.
- **`features/previs/xr/xr_type_row.gd`** (new): "Type [All types | <Manufacturer Name> (n) …] [Select]" — rebuilt only
  when the patch's types change (an autosave never closes the open menu), names fetched once per new type id;
  Select = every fixture of that type. **`xr_panel.gd`**: the row above the Programmer, `type_filter()`; doc: the left
  grip is ctrl.
- **`e2e/scenarios/06_xr_walk.gd`**: the looks row is found next to the Programmer (`get_index() + 1`), not as child 1
  (the type row is now child 0).
- **`help/vr-walk.md`**: the controls table (left grip adds, release aims, drag = box, right grip = fan), Type and Fan
  paragraphs.

## What was VERIFIED

- `tests/test_xr_box_fan_wo774.gd` (new; 64 assertions): view angles / level frame / straight down, drag threshold,
  in_box, box_pick (inside, order, type, reversed drag, behind), outline (closed, starts on the press ray, far corner on
  the sphere), box_select (replace / add / empty keeps), patch_types / of_type, fan_k / dead zone / gain / hand move
  in the head's frame, fan_bases (programmed, default, reversed range, no pan / tilt skipped), fan_values (symmetric,
  middle stays, clamped, only moved axes), the xr_fan session with fakes (no selection, one write per head pan only,
  same spread not resent, release announces aimed once, no writes after), the release-time floor aim, source hooks.
- Godot suite **21865 passed / 0 failed** (baseline 21801 / 0); `run-client.sh --check` boot OK; 500-line check 0 over.
- Sandbox GUI e2e (`node tools/e2e/run-gui-e2e.js --e2e=06_xr_walk --xr`, Xvfb + sandbox server, live box untouched):
  on the live tree step 3 "Left-drag looks around" fails (`yaw 3.027…`) and skips the rest — **pre-existing**: a
  `git archive HEAD` copy of the client fails identically. On a scratch copy with this WO's files and that one step
  removed: **4 / 4** — floor aim, panel by ray (Groups opens, Store answers), and added probes printed: the type row
  with a 3-head / 2-type patch → 3 items, a chosen type is `type_filter()`, Select → `["x1", "x2"]`; a box press driven
  through `_drag()` stays a click until turned, then a box (2 surfaces drawn), hidden on release, an empty box kept the
  selection.
- Not touched: `src/` (no server change, no node restart needed). Not run: `npm run test:ci` / lint (no JS changed).
- **Owner QA (headset):** relaunch the VR client. Trigger on a head picks (instant); trigger on the floor and let go
  aims; hold the trigger off the heads and sweep → a blue box, release selects what is inside (left grip held adds);
  Type → a type: box and head picks only take that type, Select takes them all; select a row, aim it, hold the right
  grip and move sideways → pan fans out from the middle, up / down → tilt; release keeps it, the panel sliders follow.
  Tune `FAN_DEG_PER_M` / `BOX_MIN_DEG` if the feel is off.

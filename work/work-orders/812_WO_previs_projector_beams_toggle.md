# WO-812 — Previs: hide the projector beam lines

**Area:** lighting, godot-client
**Status: DONE (29.10, live e2e on the box) (29.10 — Godot suite 22256/0, boot check OK; owner QA = the "Projector beams" checkbox on the Previs toolbar, look on the glass unverified) · live e2e 29.10: checkbox PASS on the glass**

Owner, 29.10:
> there is no way to hide the projector trapezoid (or whatever it's called) in previz. the lines coming from a projector to a projected image.

## Investigation

- `godot/client/features/previs/stage_builder.gd` "projection" case: the projector body box and `_frustum(p, size)`,
  one `MeshInstance3D` of `PRIMITIVE_LINES` from the projector to the four screen corners. Nothing controlled it.
- Previs toolbar (`previs_tab.gd` `_build_toolbar`) is built in `_ready` before the `StageBuilder` exists
  (builder created later in the same `_ready`), so the checkbox cannot take a builder reference at build time.
- Live 3D (`features/live/live_stage_3d.gd`) also uses `StageBuilder`.

## What was done

- `features/previs/projector_beams.gd` (new, 40 lines): one shared switch like `haze.gd` (`ui.cfg [previs] projector_beams`,
  default on). `shared()` loads it, `set_on()` saves it and emits `changed`, `checkbox()` returns the "Projector beams" CheckBox.
- `features/previs/stage_builder.gd`: `show_beams` + `_beams` (id → frustum). The frustum is created visible per
  `show_beams`; `set_beams(on)` flips visibility in place (no rebuild). Every builder connects to the shared
  `changed` signal in `_init`. Entries are cleared on `set_objects`, `remove`, and on each `_build` (so a replaced
  object never leaves a freed node in the map).
- `features/previs/previs_tab.gd`: the checkbox is added to the existing toolbar list between the haze picker and VR (one line changed, no new lines; file stays at 500).
- `tests/test_stage_builder.gd`: beams hide in place (3 → 2 visible meshes), stay hidden across a rebuild, come back on.
- Side effect, by design of the shared switch: Live 3D's builder also follows the same toggle (it has no checkbox of its own).

## What was VERIFIED

- Godot headless suite `godot --headless --script res://tests/run_tests.gd`: 22256 passed, 0 failed (was 22252; +4 assertions).
- `GODOT=~/.local/opt/godot/godot ./run-client.sh --check`: boot OK.
- `tools/ci/check-max-file-lines.js`: 0 files over 500.
- NOT verified: how the lines look on the glass / in the live Previs view. Owner QA pending.

## Live e2e (29.10, on the glass — real Godot client on :0, real PGM/PRV)

**PASS.** Previs toolbar "Projector beams": OFF hides the beam trapezoids and ON brings them back
(q812_beams_on_off.png).

Evidence: session scratchpad `live-e2e/` (screenshots were read before they went in here; `onair.log` has every click with its epoch).

# WO-649 — Live preview: one 2D / 3D toggle; the 3D view shows the MVR model, with or without lights

**Area:** godot-client
**Status: DONE (2026-10-21; Godot 20696/0, box: the toggle switches 2D ↔ 3D, the Live 3D view shows the Pabianice MVR model with the rig, Lights off keeps the heads, both remembered). Owner QA: beams with a live console, the framing.**

Owner, 21.10: *"the standard 3d should be a toggle 2d/3d in live preview. when the mvr is loaded it should display the
model, with or without lights."*

Builds on [WO-621](./621_WO_godot_owner_notes_live_looks_previs.md) N6 (the Live Standard ↔ 3D switch),
[WO-612](./612_WO_previs_mvr_import.md) (MVR scene), [WO-615](./615_WO_previs_fixtures_gdtf_patch_dmx_out.md) T5 (the fixture
rig), [WO-648](./648_WO_live_preview_fills_width.md) (the 2D view fills the width).

## Investigation

- `features/live/live_tab.gd` `_view_switch()`: two buttons in a ButtonGroup ("Standard", "3D") plus "Fit" (3D
  only). The view is remembered in `user://ui.cfg` `[live] view`.
- `features/live/live_stage_3d.gd` (the Live 3D view) builds only `project.previs.stage.objects` through a
  StageBuilder. No MvrScene and no fixture rig, so with an MVR scene loaded the Live 3D view shows only the HighAsCG
  walls. The Previs tab (`previs_tab.gd:81-85`) adds three things to its stage: an `MvrScene`, the coverage, and
  `fixtures_3d.gd`.
- `mvr_section.gd:150` `_maybe_reload` is the only code that applies `project.previs.mvr` to a scene: place, hidden
  layers / objects, layer colours, `show_scene(id)`. The Live view needs the same steps, so they move into the scene
  (`MvrScene.configure`), rather than being copied.
- `fixtures_3d.gd` is self-contained: it follows `project.fixtures` and the WS `tracking:fixtures` itself, so a
  second instance in the Live world works without the Previs tab. When the rig is shown, the static models of patched
  fixtures hide (`MvrScene.set_patched`, WO-615 T10). With the lights off they have to come back.
- Loading a second copy of the scene at start-up would double the mesh fetches (418 objects here) for a view that is
  off by default. So the Live copy loads on the first show.

## What was done

- `features/previs/mvr_scene.gd` `configure(c)`: place, hidden layers / objects, layer colours, `show_scene`.
  `mvr_section.gd` `_maybe_reload` calls it instead of its own five lines.
- `features/live/live_stage_3d.gd`:
  - an `MvrScene` beside the StageBuilder;
  - on the first show it creates a `fixtures_3d.gd` rig and starts following `project.previs.mvr` (`_reload_mvr`);
  - `set_lights(on)` → `fixtures_3d.gd set_beams(on)`. Owner correction, 21.10: *"for the lights on of it should be
    to render the actual lights or not, the heads should stay either way."* So the rig (heads, pan / tilt) always
    stays. Off draws every beam dark: cone, SpotLight and lens glow all follow the tint's alpha
    (`fixtures_3d_model.gd shown_tint`). The first cut hid the whole rig, and the heads went with it;
  - Fit merges the stage, MVR and (shown) rig bounds, like the Previs tab's `_fit_box`; a loaded scene is framed
    once.
- `features/live/live_tab.gd`:
  - one toggle button instead of the Standard / 3D pair. It names the view shown ("2D" / "3D") and is lit in 3D.
  - In 3D, **Fit** and **Lights** next to it.
  - `[live] view` and `[live] lights` in ui.cfg (`_save_ui`).

## What was VERIFIED
- Godot `--test` 20696 passed, 0 failed; `--check` boot OK. No test pins the Live tab; this is UI wiring over the
  pieces the Previs tests already cover.
- Box (21.10, 20:49, DP-0, project godot_test, MVR "Pabianice Final Patch", 418 objects):
  - The Live tab shows one **2D** button. Clicked, it reads **3D** (lit), Fit and Lights appear, and the view shows the
    MVR model (trusses, stage, walls, the patched heads) on the floor.
  - **Lights** off, first cut: the rig went with it, and only small static bits stayed (this file has no fixture
    bodies of its own). Hence the correction.
  - After it (20:54): Lights off keeps every head on the trusses. ui.cfg `lights=false`; on again `lights=true`.
  - `test_fixtures_3d_model.gd::test_lights_off_renders_no_light` covers the beam on / off rule (Godot 20698/0).
  - Back to 2D: `view="standard"`; the owner's 2D state is left as it was.
  - Fit frames the same box as the Previs tab (`frame_box`, longest axis × 1.4). In the wide, short Live area that
    leaves the model small.
- Not seen: beams. No console was sending DMX, so the rig drew bodies only.

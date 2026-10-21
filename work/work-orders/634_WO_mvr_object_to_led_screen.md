**Status: DONE (2026-10-21, Godot unit tests + box test: Pabianice centre wall + 2 totems → 3 LED walls on PGM 1). Parent: [WO-612](./612_WO_previs_mvr_import.md). Related: [WO-614](./614_WO_previs_stage_builder.md) (the LED wall it creates).**

# WO-634 — Make an LED screen from an MVR object (map a destination onto the MVR's wall)

Owner 21.10: "how can i map the destination on to the mvr led wall?" → "make work orders for those additions and start
working on them". Then: "what i need for the led walls is also a way to map one screen destination to multiple led
walls. like in this import i have one big central led wall and two totems on each side. they are fed from one output
from a media server and mapped accordingly in the sending card. the source is just a full canvas that covers the 3
walls."

## Investigation

- WO-612 T5 binds only MVR `VideoScreen` objects whose `Source` is `highascg:<role>` (`src/stage/mvr-scene.js:44-52`,
  `screenBinding`) — i.e. MVRs we exported. None of the 7 real Capture exports has a VideoScreen, Mapping or Source
  (profiled 2026-10-21; WO-612 "Placement + real Capture exports").
- In Pabianice every geometry object is an unnamed `SceneObject` (217 in "Default Layer", 136 in "Layer 34"); the LED
  wall is one of them. Nothing in the file says "screen", so the operator has to point at it.
- Texturing the MVR mesh itself is a dead end: `mvr-3ds.js parse3ds` reads vertices and faces only (no 0x4140 mapping
  chunk), Capture walls are plain boxes, and the stage builder's panel grid / crop / MVR export would not apply.
- What works today, by hand: Stage → Add ▾ → LED wall from a destination, then size / move / turn it onto the MVR wall
  by eye (WO-614 objects: `position` Godot frame m, bottom-centre of the picture; `rotation` degrees, Godot YXZ;
  picture faces +Z; `stage_objects.gd`). The MVR wall stays visible behind it (same layer as everything else).
- One destination → several walls already exists in the model: every WO-614 object has `source {role, rect}` and the
  stage panel edits the rect (X / Y / W / H spin boxes, `stage_panel.gd:269-271`); `uv_rect` crops the role's raster
  (`stage_objects.gd:149`). WO-614's design names it ("Several objects can share one raster … each gets its own rect;
  default placement packs rects left→right"). Missing: creating the walls and their canvas layout in one step.
- **A Capture LED wall is not one object** (measured 2026-10-21, scratch script: GLB POSITION min/max per part × the
  part xform, unioned per object): Pabianice's walls are **192 SceneObjects of 0.5 × 0.5 × 0.08 m, one per panel**
  (2 parts each, same meshes). Touching panels cluster into exactly the owner's three walls: 160 panels x 7.00→17.00,
  y −1.60→2.40 (10 × 4 m, 20 × 8) and two totems of 16 (1 × 4 m, 2 × 8) at x 5.25→6.25 and 17.90→18.90, 0.75 / 0.90 m
  apart, all at z ≈ −9.2. A click therefore has to select the panel's wall, not the panel — and the panel size and count
  come from the file. The part xform is `[1,0,0, 0,−1,0, 0,0,−1, …]` (Y and Z flipped), so axes must be taken from the
  geometry, not assumed.
- 3D clicks: `previs_tab.gd _on_3d_input` → `fixtures3d.click`, then `builder.pick` (ray vs mesh AABBs). MVR objects are
  not pickable. `previs_tab.gd` is at 497 lines (500 limit) — the MVR pick must live in the MVR section / scene.

## Design

- **Wall = cluster** (added after the measurement above): the clicked object plus every object of the same model (same
  part meshes) whose box touches the selection (5 cm), transitively. A one-object wall (other exporters) is a cluster
  of one.
- **Pick:** a click that hits no fixture and no stage object tests the MVR scene (`mvr_scene.pick`, ray vs each visible
  object's mesh boxes, nearest) → the MVR section shows "Selected: <name> — W × H m" with **Make LED screen…**; a yellow
  box marks it.
- **Frame:** the object's oriented box from its largest mesh's own frame: thinnest axis = the picture normal, facing the
  camera that clicked; of the other two, the one closest to world up = height, the other = width. → basis (X width,
  Y up, Z normal), size W × H, front-face bottom-centre.
- **Dialog:** destination (screen destinations → role + raster) and panel type (WO-614 presets); shows the panel count
  (W / panel, H / panel, rounded) and pixels. OK → a WO-614 `led_wall` at that frame (position = front-face bottom-centre,
  rotation = the basis' YXZ Euler), source = the role, full raster rect; the MVR object is hidden
  (`project.previs.mvr.hidden_objects`, uuids). "Show N replaced objects" brings them back.
- **Several walls, one canvas** (the owner's centre wall + two totems): shift-click adds objects to the selection;
  **Make LED screens…** makes one LED wall per object, all on the one destination. Each wall's pixels come from its
  panel count; the crops are packed left→right in stage order (as the audience sees them, i.e. by position along the
  stage's x), top-aligned from 0,0 — how a sending-card map usually starts. The dialog shows the resulting canvas
  (W × H px) against the destination raster and warns when it does not fit. The crops stay editable per wall in the
  Stage panel (X / Y / W / H) to match the real sending-card map.
- From then on they are normal stage LED walls: live picture, crop, nudge / turn keys, MVR export.

## Tasks

- [x] T1 Pure model (`mvr_screen_model.gd`): cluster, frame from oriented boxes, LED wall object, canvas packing (+ tests). 1070d0db
- [x] T2 Pick (shift = add) + selection marks in `mvr_scene.gd`; hidden objects; section row + dialog. (No stage panel
  `add_objects`: the walls are written to `project.previs.stage.objects` and the Stage panel reloads on
  `project_changed` like any other change — one less hook through `previs_tab.gd`, which is at 499 / 500 lines.)
- [x] T3 Box: Pabianice's centre wall + side walls → one PGM destination, packed crops, the picture spans them.

## What was done

- `features/previs/mvr_screen_model.gd` (new, pure): `cluster(items, seed, gap)`; `wall_frame(objects, toward)` — the
  clicked object's main box (largest extents) gives the axes: thinnest = picture normal, flipped to face the viewer
  (camera position), the other axis nearest world up = height (sign up), width = up × normal; every corner of every
  object projected onto those axes → size, front face, bottom centre; the clicked object alone → `cell` (panel size);
  `wall_object` (WO-614 `led_wall`: rotation = the basis' YXZ Euler, panels = size / panel mm); `panel_mm_for` (a
  multi-object wall uses its own panel size, a single object the preset's); `pack(walls, raster)` — crops left → right
  by stage X (= audience left → right; the WO-614 three-walls template has the same order), top-aligned, native pixels;
  **a canvas bigger than the destination is scaled into it, proportions kept** (the three-walls template does the
  same) — on this box the only PGM is 1920 × 1080 and even P4.8 panels need 2496 × 832, so warn-only would have made
  nothing usable; the owner's "one output … a full canvas that covers the 3 walls" is exactly the scaled case.
  `fit_note` says the scale.
- `mvr_scene.gd`: per-object `model` meta (sorted part mesh keys); `set_hidden_objects`; `pick` (ray vs visible mesh
  boxes, nearest); `cluster_items`; `wall_boxes` (stage frame = the scene's parent, where WO-614 objects live — the
  MVR placement is folded in); `to_stage`; `mark` (translucent yellow box per selected wall, top level; excluded from
  `bounds()` so Fit ignores it).
- `mvr_screens.gd` (new, in the MVR section): "Selected: 10.00 × 4.00 m (160 objects), …", **Make LED screen(s)…**
  (destination without the operator GUI, panel preset defaulting to the finest that fits unscaled, per-wall panels /
  pixels / crop, canvas or scale note), Make → walls appended to the stage, their MVR objects into
  `project.previs.mvr.hidden_objects`; **Show N replaced** clears it (key removed).
- `mvr_section.gd`: hosts it, `click()`, applies `hidden_objects` on reload, clears the selection on scene load.
- `previs_tab.gd`: a click that picks no fixture and no stage object goes to `mvr_section.click` (+2 lines → 499).

## What was VERIFIED

- Godot `--test` 20598 pass / 0 fail (`test_mvr_screen_model.gd`: cluster stops at the 0.75 m gap and at another model;
  frame of a Y/Z-flipped panel grid = identity, 2 × 1 m, cell 0.5, origin front-bottom-centre; seen from behind → −Z;
  turned 90° → rotation [0, 90, 0] and the rotated position; 20 × 8 panels / 3840 × 1536 at 192 px; L | C | R packing,
  scaled ×5/6 into UHD without gaps, native when it fits); `--check` boot OK. Offline suite 3073 pass / 0 fail; line
  limit 0 over.
- Box (2026-10-21, `godot_test`, Pabianice placed at −12.87 / 0.68 / 2.37): click on the centre wall → "Selected:
  10.00 × 4.00 m (160 objects)", yellow mark over the wall; shift-click both totems → "+ 1.00 × 4.00 m (16 objects)"
  × 2. Dialog on "PGM/PRV 1 1920×1080 → pgm1", P4.8 picked (coarsest; none fits unscaled): 20 × 8 / 2 × 8 / 2 × 8
  panels of 500 mm, crops L 0,0 160 × 640 · C 160,0 1600 × 640 · R 1760,0 160 × 640, "scaled ×0.77 into it
  (1920 × 640)". Make → `previs.stage.objects` = 3 LED walls, rotation 0, positions centre (−0.865, 0.769, −9.812),
  L (−7.12, 0.073, −9.812), R (5.534, 0.019, −9.795) — matching the raw file by hand (centre x 12 − 12.87, bottom
  −1.60 + 2.37, front −9.13 − 0.68); `hidden_objects` 192; the 3D view shows the live PGM test card across the centre
  wall and its outer edges (corner diagonals near the top) on the totems; `GET /api/stage/mvr-export` →
  `X-MVR-Screens: 3`. Show 192 replaced → panels back, saved list 0.
- Restored: the 3 walls deleted in the Stage panel (stage objects `[]`), hidden list empty, `project.fixtures`
  unchanged.
- Owner QA: the real sending-card map (edit crops per wall), a destination at the show's real raster.

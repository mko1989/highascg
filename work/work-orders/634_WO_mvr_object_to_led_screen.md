**Status: IN PROGRESS (2026-10-21) — investigation written; implementation started. Parent: [WO-612](./612_WO_previs_mvr_import.md). Related: [WO-614](./614_WO_previs_stage_builder.md) (the LED wall it creates).**

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
- 3D clicks: `previs_tab.gd _on_3d_input` → `fixtures3d.click`, then `builder.pick` (ray vs mesh AABBs). MVR objects are
  not pickable. `previs_tab.gd` is at 497 lines (500 limit) — the MVR pick must live in the MVR section / scene.

## Design

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

- [ ] T1 Pure model (`mvr_screen_model.gd`): frame from an oriented box, LED wall object from frame + panel + role,
  canvas packing of several walls (+ tests).
- [ ] T2 Pick (shift = add) + selection marks in `mvr_scene.gd`; hidden objects; section row + dialog; stage panel
  `add_objects`.
- [ ] T3 Box: Pabianice's centre wall + side walls → one PGM destination, packed crops, the picture spans them.

## What was done

## What was VERIFIED

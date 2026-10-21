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

## Follow-up (2026-10-21) — the owner's other six MVRs

### Investigation

Every file from `~/Downloads` imported into a scratch store (`HIGHASCG_PROJECTS_DIR`, live store untouched), then
clustered the way `mvr_screen_model.cluster` does (same mesh signature, boxes grown 5 cm):

| file | LED walls found | panel | notes |
|---|---|---|---|
| Pabianice | 20 × 8 + 2 × (2 × 8) | 0.5 × 0.5 | the WO's own case |
| Narvill Pozytywni Serock | 10 × 4 m (80) + two 5 × 3 m side walls (30 each) | 0.5 × 1.0 | side walls flat, turned 8.6° / 11.5° (one rotation per wall) → the clicked object's axes are right |
| guttmany25 | 12 × 4 m centre + 6 stepped columns 1 × 4 / 3.5 / 3 m | 0.5 × 0.5 | **1374 objects on 276 positions** — every panel stacked ~5× (named vp25…); columns 0.5 m from the centre → separate walls |
| WEKTORY 2025 | 24 × 3.5 m (336) | 0.5 × 0.5 | one wall |
| ATM Final Patch | 15 × 4.5 m (270) | 0.5 × 0.5 | far from the origin (−50, −64, −93) |
| SLUZEW, TAMOOS | — | — | fixtures only, no geometry |

Box test on guttmany (Godot client, timing prints added to `click()` for the test only, not committed): the centre
click selects "12.00 × 4.00 m (1248 objects)", shift-click adds the columns (24 / 21 / 18 objects), marks correct. But:

1. **`cluster()` takes 536 ms** on the 1248-object wall (pick 30 ms, `cluster_items` 44 ms over 15 479 visible objects,
   frame 18 ms) — every grown member rescans the whole same-model pool (1374) twice: O(cluster × pool), a 0.6 s UI
   freeze per click on this rig. Columns: 15–19 ms.
2. **Facing.** The default view of guttmany (Fit) looks at the wall from backstage, so the walls made from that click
   would face backstage (WO design: the picture faces the clicking camera). The panel's own geometry is no better
   default: every Capture panel is body + a flat face plate 3.3–4 cm off-centre along the normal, and the face points
   at the audience in Pabianice (+Z), guttmany (−Z, tables at z < 30, wall at 32.5), Narvill (−Z, tables −14.4,
   wall −1.5) and WEKTORY (+Z, rig at +3.3) — but **ATM's panels are the same mesh turned 180°** (face −Z while its rig
   −86, chairs −24 and trusses −83 are all on the +Z side of the −93.4 screen). The designer's panel orientation is not
   reliable; what the operator sees is, plus a way to turn it.
3. **Crop order bug.** `pack()` orders walls by stage X ascending = the audience's left → right only for walls facing
   +Z. guttmany and Narvill face −Z: the audience's left is +X, so the crops would come out mirrored against the
   sending card (centre/totem L/R swapped).

### Fix plan

- `cluster`: uuid → box map + a uniform grid (cell = largest box extent + gap) so each member only tests its 27
  neighbouring cells.
- `wall_frame` returns `depth`; new `turned(frame)` = same wall seen from the other side (X and normal negated, origin
  on the other face).
- `pack` orders along the walls' own width axis (the first wall's rotation), not stage X.
- Dialog: a **Turn around** check (the picture faces the other side) — frames turned before building.

### What was done

- `mvr_screen_model.gd`: `cluster` keeps a uuid → box map and buckets the same-model pool into a grid (cell = the
  largest box extent + gap ⇒ touching boxes are at most one cell apart, so each member tests 27 cells, not the pool).
  `wall_frame` also returns `depth`; `turned(frame)` = basis (−X, Y, −N), origin moved by `depth` to the other face.
  `pack` sorts along the first wall's own width axis (from its YXZ rotation) instead of stage X.
- `mvr_screens.gd`: **Turn around (the picture faces the other side)** check in the Make dialog (reset on open);
  `_build` turns every selected frame when ticked, so the summary/crops update live.
- Tests: stacked ×3 copies of a 24 × 8 wall at (−56, 0, −93.4) with a column 0.5 m away (negative grid cells, all
  copies in, column out); `turned` = the frame seen from behind, twice = as clicked; walls facing −Z pack +X first.

### What was VERIFIED

- Godot `--test` 20604 pass / 0 fail (+6), `--check` boot OK; offline suite 3073 pass / 0 fail; line limit 0 over.
- Box (guttmany25 uploaded to the live store for the test, room layers hidden, timing prints only during the test):
  centre wall `cluster` **536 → 24.5 ms**, columns 15–19 → 8 ms. Centre + three left columns from the backstage view:
  crops column 3 m at 0, 3.5 m at 128, 4 m at 256, centre at 384 (the viewer's left → right); ticking Turn around →
  centre 0, 4 m 1536, 3.5 m 1664, 3 m 1792 (×0.62 into PGM 1 1920 × 1080). Make → 4 LED walls, rotation [0, 180, 0],
  front face z 32.43 (wall centre 32.47 − half depth), x 0.024 / −6.976 / −8.476 / −9.976 = the scratch survey's
  positions; 1311 objects hidden (1248 + 24 + 21 + 18); the live PGM test card reads unmirrored from the room side.
- Restored: walls deleted, Show 1311 replaced, scene back to Pabianice at −12.87 / 0.68 / 2.37, guttmany removed
  from the store (`DELETE /api/stage/mvr/86cc4dc91e3e`; store = Pabianice only).
- Not changed: the default facing (the clicked side) and top-aligned crops for stepped columns (guttmany's columns
  share a bottom line, so their crops' real map is the sending card's — editable per wall).

## Follow-up 2 (2026-10-21) — owner: "let user click with control to select multiple walls and map directly"

- `previs_tab.gd`: the MVR click passes `shift or ctrl` as "add" (shift kept — it is the fixtures' multi-select key).
- `mvr_screens.gd`: the modal Make dialog is gone. Under the selection: **[destination ▾] [Map] [Turn around]**
  (row hidden while nothing is selected; the destination choice is kept across selections). Map builds at once: the
  MVR's own panel size, the finest pitch whose packed canvas fits the destination unscaled (else the coarsest), crops
  left → right as the audience sees them; the info line then says what was mapped (canvas, scale).
- `mvr_screen_model.gd`: `panel_px_for(panel_mm, pitch)` — pixels from the preset's pitch, not its panel; the old path
  gave Narvill's 500 × 1000 mm panels the preset's square 192 × 192 px.
- VERIFIED: Godot `--test` 20606 pass / 0 fail (+2: P3.9 0.5 × 1 m → 128 × 256, P4.8 → 104), `--check` boot OK.
  **Not box-tested**: when relaunched, the owner's `godot_test` project already held their own 3 Pabianice walls
  (192 objects replaced) — a live Map test would have meant un-hiding and re-mapping their work. Owner QA: ctrl-click
  the walls, pick the destination, Map.

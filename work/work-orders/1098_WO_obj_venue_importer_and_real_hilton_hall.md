# WO-1098 — OBJ venue importer (SketchUp export → venue .glb) and the real Hilton ballroom

**Area:** tracking-vr, godot-client, media
**Status: DONE (16.11.26 — importer tested offline (11 node + Godot tests) and live over the API on the real 77 MB OBJ; the real Hilton hall applied to the show and checked on glass (previs presets, cam_1 Camera view) and in RC / Skirmish / Stage Salad; Files window not driven on glass)**

Owner 16.11: "can we add a skp importer?" → SketchUp's .skp model is a closed format, so the geometry comes as OBJ
(SketchUp: File → Export → 3D Model → OBJ); the .skp is a ZIP whose `materials/` folders hold the pictures. Owner:
"ive added obj to the downloads" — `~/Downloads/Hilton DT Marcin1.obj` (77 MB), `Hilton DT Marcin1.mtl`, `Marcin2.mtl`,
`Hilton_DT_Capture.skp`.

## Investigation

### The real file
- Parse (own parser, src/stage/obj-parse.js): 1.4 s, 434 MB RSS; 902 388 v, 2 697 vt, 26 147 vn, 465 319 faces of which
  464 569 have more than 3 corners and 24 689 are concave → 1 781 340 triangles; `# File units = meters`; Y up (floor
  y = 0); 4 658 groups, 22 materials; 0 faces skipped.
- Structure: Group46 = the floor (2 triangles, 1 884 m², material FrontColor, facing DOWN — outward); Group57 = coffered
  ceiling (867 triangles, y 5.75…6.75); Group53 = −x long wall with door photos (`M_20150401_121811` + `_1_`…`_5_`
  variants); Group47 = +x window wall (glass `Translucent_Glass_Gray` d 0.5, black drape `Wys_ona_pod_diod_`, photos);
  Group59 = curtains `Zas_ona3` (13 560 triangles); Group2 / Group23 = end walls (kitchen-door picture, lattice `krata`);
  16 chandeliers `Komponent_21_N`, each ~280 strands × 390 triangles: 1 765 760 triangles = 99 % of the file
  (Gold 938 496, White 807 712, Lustro 1 504, FrontColor 18 048), y 5.2…6.65. `krata` is a wall lattice, not a rigging
  grid. No stage in the OBJ.
- Facing is mixed (floor out, photos in, coffers both) → sidedness must be decided by rules, not by the file.
- UVs: untextured FrontColor faces carry inch-scale UVs (±2425); textured photos 0…1 crops; the `_N_` variants span
  whole panels 0…1 (a 7.8 × 5.75 m panel, photo aspect 1.33 vs 1.36 — the base picture stretched is close).
- MTL ↔ SketchUp: `Marcin1.mtl` names `Hilton DT Marcin1/<name>.jpg` (folder not delivered). In the .skp (a ZIP after a
  69-byte header; JSZip reads it): `materials/20150401_121811/20150401_121811.jpg` (3264 × 2448) etc.;
  `Zas_ona3` = SketchUp material "Zasłona3" whose material.xml points at `materials/Zasłona2/Zasłona1.png`;
  `Lustro__2` = "Lustro #2" → `V-Ray Texture Helper.png` (a renderer placeholder, ignored → Kd 0.149);
  `Balowa_drzwi_do_kuchni` → `materials/Obraz/Balowa drzwi do kuchni.PNG`. Marcin1.mtl has NO carpet and NO hang-point
  picture; the .skp holds them: carpet `_50/Hilton dywan 05.jpg` (1823 × 967, xScale/yScale 78.74 × 41.77 in = 2.000 ×
  1.061 m) and `Hilton - haki do podwieszania2/…jpg` (3300 × 2550, 2686 × 2055 in = 68.2 × 52.2 m).

### The current project frame
- "90C PGRP Hilton Wawer", MVR 1a25c72c40b8 (generated from the Guttmany-derived MVR 2e2b02a736fd), place 0, so MVR
  frame = Godot frame. Generated room: walls x −15.25 / 15.02, end walls z −27.74 / 34.485, carpet y 0.24, ceiling 5.99;
  Scena x 9.55…12.55 y 0.24…0.64 z −4…11; LED legs x 12.6…13.2; Krata front x 4.76…5.05 y 5.05…5.34 z −4.51…11.51
  (16 m), fronts at x 4.9 y 5.055 z −3.5…10.5; led_wall_1 at (12.7, 1.239, 3.5) yaw −90 15 × 3 m; tracking grid
  3 × 15 m x_offset 11.05; cam_1 (−5.62, −3.5, 5.7) in the tracking frame.
- The old MVR's layer "Podłoga 3 z zawiesiami" (same name as a SketchUp layer of the .skp) holds 63 hang-point circles
  (mesh 0x638B4A06.3ds, 400 mm, centre (−0.120, +0.119) m from the origin in Godot axes, mvr-3ds.js:120 maps 3DS y → −z).

### Readers of a venue .glb
- WO-1003 (godot/client/features/previs/mvr_venue.gd): nodes keyed by `extensions.CAPTURE_model.identifier`, layers by
  `asset.extensions.CAPTURE_model.layers` + node `layer_identifier` (walks parents), unmatched meshes become objects of
  their layer (eye, hidden_layers by name); `is_capture()` looks for `"CAPTURE_model"` in the JSON chunk.
- Game bake (modules/rc-game/server/rc-scene-venue.js `ext`): same extension. So the importer writes the same shape under
  its own name `HIGHASCG_venue` and both readers take either (one-line aliases).

## What was done

### Importer (product) — commit 9bdaa50f
- `src/stage/obj-parse.js` — streaming OBJ parser: v/vt/vn/f (all index forms, negative indices), triangles, quads,
  n-gons (convex → fan, concave → ear clipping on the Newell-normal plane), g/o/usemtl/mtllib/s, `# File units`,
  `# Exported from <app>`; a face with a bad index is skipped and counted.
- `src/stage/obj-mtl.js` — MTL (Kd, Ks, Ns, d, Tr → opacity, map_Kd/map_d with options and spaces), Phong → roughness,
  texture lookup in order: path as written (\\ or /, any case) → file name anywhere → SketchUp `<name>_N_` variant →
  normalised name / SketchUp material folder (.skp material.xml: name, picture, xScale/yScale → tile metres).
- `src/stage/venue-sources.js` — what was handed over as one list: loose files, folders, files inside a .zip, the
  pictures of a .skp (only `materials/`; model.dat is never read).
- `src/stage/venue-build.js` — units (option > file comment > SketchUp → inches > metres), up axis (level-face area along
  Y vs Z; Z-up → (x, z, −y)), floor (lowest level ≥ 25 % of the footprint), ceiling (lowest level ≥ 10 % in the upper
  half), layers Floor / Walls / Ceiling / Chandeliers / Objects: floor and level ceiling faces single-sided facing into
  the room, wall faces on the room's side planes single-sided facing in (seen from inside, not invisible; from outside
  you look in), everything else double-sided; repeated hanging component instances (≥ 2, ≥ 200 triangles, upper half)
  → one node per instance ("Chandelier N", numbered by position).
- `src/stage/venue-optimize.js` — weld (0.5 mm, normal, UV), drop degenerate and repeated faces, then a triangle budget
  (default 250 000): groups water-filled smallest first (the room shell is never touched), each group over its share
  simplified by vertex clustering at the finest cell that fits (bisection), one cell per repeated part so all copies
  stay alike.
- `src/stage/venue-convert.js` — the pipeline; materials as glTF PBR (sRGB Kd → linear, d < 1 or a PNG with
  see-through pixels → BLEND), pictures re-encoded by rc-scene-tex.js (≤ 1024 px, 6 MB budget, mean colour when left
  out — the WO-1082/1090 rules), REPEAT sampler (SketchUp's big UVs tile), V-Ray placeholder pictures ignored; one node
  per layer / chandelier under a root "venue" node whose matrix is the optional registration; layers in
  `HIGHASCG_venue`; the import report in `asset.extras.highascg_import`. Options for scripts: per-material / per-layer
  picture override with a tile size (planar UVs), a flat picture layer (rigging plan) and marker discs (hang points).
- `src/stage/glb-write.js` — rich path (materials Map, UVs only where textured, root node, asset extensions); without
  options the output is unchanged (WO-612 / 1082 smokes green).
- `src/stage/venue-import-worker.js` + `src/media/venue-import-job.js` + `src/api/routes-venue-import.js` — uploads
  staged per session in the OS temp folder (paths kept, sanitised; .obj .mtl .zip .skp .jpg .jpeg .png), one job at a
  time in a worker thread, progress as WS `change` `venueImport`, cancel = worker terminated (nothing written, staging
  removed), result `<obj stem>.glb` into the project folder (never overwrites). Routes: POST /api/venue-import/files,
  /start, /cancel, GET /api/venue-import (registered in router.js; API contract regenerated).
- Godot: `core/venue_import.gd` (an .obj brings its .mtl files and the `<name>/` picture folder SketchUp writes beside
  it; a dropped folder keeps its name; report text), Files window (`app/project_files_dialog.gd`) accepts the new
  kinds (own filter row), shows the help line "From SketchUp: File → Export → 3D Model → OBJ (with 'Export texture
  maps'); upload the .obj, .mtl and texture folder, or a zip of them. SketchUp files are used for their textures only;
  export OBJ for the geometry.", progress / report on the status line and "Cancel import" while it runs.
  `mvr_venue.gd` and `rc-scene-venue.js` accept `HIGHASCG_venue`.
- Venue files live in the project media folder: `home/casparcg/highascg/media/*` is excluded from the ISO
  (tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list:65); staging is under /tmp (excluded too).

### Real file → "Hilton sala balowa.glb" (scratchpad build-hilton.js)
- Default conversion: 1 781 340 → 1 771 705 welded (9 635 degenerate) → 249 365 triangles; 4 657 groups → 20 nodes;
  22 → 30 materials (× sidedness); chandeliers White 803 175 → 104 786 and Gold 933 466 → 109 515 (cell 6 cm); 16
  pictures matched, 0 missing, 1 placeholder ignored; 8.5 MB .glb; 6.1 s (live through the API: 6.3 s).
- Floor: Group46 (FrontColor, Floor layer) gets the carpet `Hilton dywan 05.jpg` from the .skp at 4.0 × 2.122 m — twice
  the SketchUp material's own 2.0 × 1.06 m; chosen against the photo, where the swirl bands are about a third of a
  1.8 m table wide (at 2 m they were half that).
- Registration onto the project frame: pure translation (x −16.62, y +0.24, z +34.4325), yaw 0 (area-weighted wall
  normals 0.0000° in both rooms). Residuals: side walls 0.00 / 0.00 m, end walls ±0.003 m, floor 0.00, ceiling
  underside 0.00 (real 5.75 above the floor = generated 5.99 − 0.24). The generated pilasters differ by −0.21…+0.24 m
  (their bay pitch is 7.82 m from the drawing, the SketchUp model's is 7.88 m) — the generated geometry being replaced.
  Baked into the root node, so previs.mvr.place stays 0.
- What would have to move: nothing. Stage, LED wall, truss, fixtures, tracking grid and cameras are within 1 cm of the
  real room. Clearances: LED legs x 13.2 → pilaster faces x 13.69 (0.49 m); +x chandelier column x 6.84…9.14,
  y 5.44…6.89 (bottom 0.10 m above the truss top 5.34, 1.8 m beside it); ceiling underside 5.99.
- Hang points ("Haki"): the plan picture's 63 red dots (auto-detected) fit the 63 circles of the old MVR's
  "Podłoga 3 z zawiesiami" layer as a similarity: 0.020542 m/px, rotation −0.15°, RMS 0.155 m, max 0.30 m (a dot is
  ~0.5 m across), all 63 matched one to one. The circles (the SketchUp author's digitisation of the same picture)
  are used as the hang points: layer "Haki", 0.2 m red discs 5 cm under the ceiling; the picture itself is layer
  "Haki plan" at 6 cm, hidden by default. Cross-checks: the plan's structural columns land in the real walls (−x
  inner face −15.27 vs −15.25); its chandeliers at x −7.7 / 7.85 vs the SketchUp model's −8.88 / 7.99 — the model's
  −x chandelier row is 1.2 m off the drawing.
- Relative to the front truss (x 4.9, z −4.51…11.51, 16 m along the long wall): the hang-point line x ≈ 4.79 runs
  0.11 m from the truss line (points at z −26.88, −19.14, −12.03, 4.27, 11.39, 27.69); under the truss: (4.835, 4.272)
  and (4.785, 11.392) — 0.065 and 0.115 m off its axis, the second 0.12 m inside its +z end; at the −z end the row
  z −3.878 has a pair straddling the truss at x 3.315 and 6.335 (1.59 / 1.44 m off the axis, 0.63 m inside the end).
  Hanging plumb from the x 4.79 line would move the truss 0.11 m (x 4.9 → 4.79); not part of the prepared change.
- Applied 16.11 (lead's go-ahead, after WO-1097 / 764 / 765 finished): scratchpad `apply-hilton.js --apply` took a
  snapshot of the stored project (rev 68; copy kept as `~/.highascg/wo1098-hilton-before-venue-rev68.json`) and autosaved
  previs.mvr.venue_glb = "Hilton sala balowa.glb" with Dywan, Ściany, Boazeria, Zasłony, Sufit, Żyrandole and Haki plan
  hidden (rev 69). `--revert` puts venue_glb + hidden_layers back from the snapshot. Scena, Wykładzina (the stage's
  carpet, y 0.64), Dioda, Krata front, Fronty stay. Nothing was re-seated: every wall plane, floor and ceiling of the
  real room is within 1 cm of the generated one the stage was built in. The truss was NOT moved onto the x 4.79 hang
  line: its 0.07–0.11 m offset is below the hang points' own uncertainty (fit RMS 0.155 m, max 0.30 m, 0.5 m dots).
- Core / module boundary (d45c612a): the texture shrinker moved from modules/rc-game/server/rc-scene-tex.js into
  `src/stage/scene-tex.js` (the importer is core and must not require an opt-in module — WO-1076 "the core names
  nothing of the game", WO-749 release sweep); the game's rc-scene-tex.js hands the core file on through `core()`, the
  WO-1074 import guard lists that instead of child_process. IMAGE_EXT no longer exported.
- View presets (owner 16.11 via the lead: "at least for that scene the front camera preset is 'showing' wrong
  perspective"; b35289fd). Cause: previs_stage.gd PRESETS were fixed orbit poses (yaw 0 = camera on +Z) around the
  current orbit point; the Hilton wall faces −X (rotation −90°), so Front looked down the room's length past the stage's
  end. New `godot/client/features/previs/view_presets.gd`: the audience side from the WO-1091 model
  (tracking/aim_model.gd `audience`: stage objects' facing weighted by width → room side → grid shape); framed box =
  visible stage objects + tracking grid with 1.8 m heads; Front from the audience at the old pitch (0.12, horizon level),
  distance so the box fits the view's aspect with 15 % air; Top pitch 1.45 from the audience side (upstage = up); ISO the
  old −0.75 rad turn, inside a venue kept under 80 % of the room height (from above the coffers and chandeliers stood in
  front of the stage). No stage objects and no grid → the old fixed poses (around the venue centre when there is one).
  previs_stage.gd `fly_to_preset(name, pose)` tweens the orbit point too and turns the short way. Fit already followed
  the stage facing (builder.front_yaw) and frames everything (now the whole venue from the audience side, from outside
  the room) — left as is. Game spectator cameras checked, nothing wrong.

## What was VERIFIED

- Node: tools/smoke/smoke-wo1098-obj-parse.test.js (7) + smoke-wo1098-venue-import.test.js (4: synthetic Z-up inch
  hall → layered textured placed GLB; zip + .skp pictures, .skp alone refused; job with a fake worker — progress,
  one-at-a-time, cancel terminates, late result ignored, "<stem>.glb" saved; real worker thread + routes with a zip
  upload and a loose picture with its folder path). WO-612 / 1082 / 1090 / 1009 / 598 smokes green (36 + 7).
- Godot: tests/test_wo1098_venue_import.gd (4); full suite 29 004 passed, 0 failed; `run-client.sh --check` boot OK.
- Live on the box (node restarted): the real OBJ + MTL + SKP uploaded with curl, converted in 6.3 s with GET
  /api/venue-import answering in ≤ 25 ms throughout (63 polls) — the event loop is not blocked; node peak RSS 1.06 GB;
  a second run cancelled at 77 % reading → state cancelled, no file written, staging removed. Test .glb deleted.
- Headless three.js renders (Firefox on a private Xvfb :87) of the converted hall from inside (the photo's viewpoint),
  above and outside, and with the stage / truss / legs of the current MVR: clearly closer to the photo than the
  generated room (real pilasters, doors, coffers, chandeliers, curtains, end walls; carpet scale).
- Offline game bake with the new venue (in-memory project change, scratch cache): venue used, 20 extra objects
  (Walls, Floor, Ceiling, 16 Chandeliers, Haki), 7 textures (1.44 MB), hall floor y 0.24 rect matching, RC tracks 11
  (same 11 as without), 261 497 triangles, 6.5 MB scene .glb (0.49 MB without the venue).
- Glass (the running client relaunched under the GUI lock with this code, Hilton project, rev 69+), screenshots in
  `/tmp/claude-1000/-home-casparcg/b8ff075d-eabe-4bed-9570-f2b4603d84a3/scratchpad/wo1098/glass/`: before the preset fix `v_Front.png` (looking down the room past the stage's end), `v_Top.png`,
  `v_ISO.png`; after: `new_Front.png` (from the audience: stage centred, LED wall, truss + 8 heads, chandeliers, real
  pilasters / curtains; horizon level, nothing cut off), `new_Top.png` (stage plan with upstage up; coffer rims and two
  chandelier discs lie over the picture — the Ceiling / Chandeliers layers can be hidden by the eye), `new_ISO.png`
  (three-quarter inside the room under the ceiling), `new_Fit.png` (whole venue from the audience side); `cam1.png`
  (Camera view of cam_1: stage, grid, LED wall in front of the real wall, truss and heads, chandeliers), `iso_out.png`
  (from above, the ceiling culled). The presets follow stage data the room swap did not change, so their pose before the
  swap is the same; "before the swap" shots were not taken (the swap was already applied when the item arrived).
- Games (enabled for the check, disabled again; test puppet on for it, off again), `/tmp/claude-1000/-home-casparcg/b8ff075d-eabe-4bed-9570-f2b4603d84a3/scratchpad/wo1098/games/`: RC bake with the venue
  in 5.3 s — 11 tracks (the same 11 as without the venue), floors hall y 0.24 + stage y 0.639, 261 497 triangles, 6.5 MB,
  7 textures; `rc-spec.png` (spectator: a track on the carpet beside the stage), `rc-player.png` (a joined car on the
  Stage loop, the real end wall with doors behind); Skirmish 8 arenas (stage, tables, foh, aisle, backrow, banquet,
  sidehall, crossroads), `sk-spec.png`; Stage Salad `salad-spec.png` (the puppet avatar on the stage before the LED wall,
  front heads with beams, real room).
- Node smokes after the core move: WO-1074 rc-server (all), WO-1076, WO-1090, WO-749, WO-1082, WO-1098 — 74 + 27 pass.
  Godot: test_view_presets_wo1098.gd (26) pass.
- Gates 16.11 (after d45c612a + b35289fd): verify:script-paths 0, max-file-lines 0, unwired exports 0, index.js --no-http 0,
  lint 0, format:check 0, npm audit 0, licenses 0; offline suite 1 — only the RC / Skirmish / Salad client source-text
  checks (WO-1074 / 1081 / 1089 "only the contract host actions"), tripped by WO-1099's uncommitted `house` host action
  in the worktree, not this WO. Godot full suite 29 073 passed, 2 failed — test_pixelhue_programming_panel
  live-geometry timing, 34 / 34 when run alone.
- NOT verified: the Files window upload on glass (it needs the native file dialog); a race actually driven (lobby only).

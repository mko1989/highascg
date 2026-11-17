# WO-1107 — "gutmanny 26": the Capture MVR + .glb into the project (room textures from PGRP, glossy stage, red carpet, LED canvas, looks)

**Area:** tracking-vr, lighting, godot-client
**Status: DONE (17.11.26 — scene, patch, LED map and looks stored in the project and seen in the owner's GUI; unpatched-MVR auto-addressing in the product with a smoke; reflections only checked at Quality Ultra by eye)**

Owner 17.11: "there is gutmanny26 glb and mvr file. add it to the current gutmanny26 project. you can use sketchup
textures from the pgrp project as this is the same room. the stage should be black reflective (hips in polish). there
should be a red carpet 2m wide extanding from the stage to 3/4 of the room. calculate the full led size with the hanging
stripes and change the pgm/prv1 to that custom size. its 2.6p panels 500x500mm 192x192px. try creating a couple of
lighting scenes using the rig. the colors of the event are dark blue and gold." (Previs as a source: WO-1108; camera
slider: WO-1109.)

## Investigation

- **Files:** `~/Downloads/Guttmanny2026.mvr` (Capture, MVR 1.4, 10.6 MB: 16 702 objects, 252 fixtures of 8 types, 1 553
  3DS meshes, every `<Address>` 0 — the rig is unpatched in the file) and `Guttmanny 2026.glb` (Capture 2025.1.16, 78.5 MB,
  22 064 nodes / 16 721 meshes, 13 pictures; 13 584 of the mesh nodes are the 16 chandeliers, 1.77 M triangles).
- **Patch:** `POST /api/stage/mvr/<id>/patch` skipped all 252 ("no DMX address (unpatched in the MVR file)",
  src/stage/mvr-patch.js) — a Capture export of an unpatched rig could not be patched at all. All 8 GDTFs are Capture
  placeholders already replaced by real types on this box (WO-633 aliases).
- **Room = the PGRP room, turned.** The PGRP venue `Hilton sala balowa.glb` (WO-1098, from the SketchUp OBJ) carries its
  registration in the root node (−16.62, +0.24, +34.4325). With that undone its chandeliers sit exactly on the Capture
  file's (x 6.60…25.76, z −59.60…−2.67 in both) — but the Capture file's room SHELL is the same shell turned 180° about
  the vertical: glass wall x 0.95 vs 31.64, curtains x 1.17…1.31 vs 31.28…31.43, kitchen-door photo on the z −62.16 end
  wall vs z +0.05. Floors: Capture `*50` x 0.954…31.224 z −62.168…0.057, PGRP x 1.363…31.647 z −62.165…0.061 →
  x′ = 32.594 − x, z′ = −62.1075 − z. The 63 hang points: PGRP's discs turned the same way and shifted (0.132, 0.361) m
  land on the Capture file's 63 circles with RMS 0.000 m (as-is: 1.76 m).
- **LED** (faces with material "LED Grid", 420 panels of 0.5 × 0.5 m, every arc 2.50° per panel = R 11.46 m): centre
  26 × 8 (13 × 4 m, y 0.6…4.6); each side three hanging stripes 2 panels high (rows y 3.6…4.6, 2.1…3.1, 0.62…1.62) of
  13 / 11 / 13 columns (the middle one misses the first and last column); two 4 × 8 side wings at the stage front
  (convex, 2 × 4 m). In the Capture file the wings face UPSTAGE (frames 3–4 cm on the audience side of the face; the
  centre and stripes have them behind) — the owner saw their grey backs ("speakers… light gray", then "sorry thats led
  panels not speakers. map them too").
- **Canvas:** panels side by side at native pitch, audience left → right: wing 4 + stripes 13 + centre 26 + stripes 13 +
  wing 4 = 60 columns × 8 rows × 192 px = **11520 × 1536 px** (30 × 4 m; 420 of the 480 cells lit — stripe gaps are
  rows 3 and 6 of the stripe columns, plus 2 cells per middle stripe).
- **Stage:** 6 objects with Capture material "Black, Gloss" (0.196 grey, roughness 0.1): main deck 24 × 11 m (x 4.05…28.05,
  z −58.97…−47.97, 0.6 high), catwalk 3 × 10 m (x 14.81…17.81 to z −37.97), steps. The catwalk axis is x 16.31 (the deck's
  is 16.05).

## What was done

- **Product (commit b7dd0bd6):** `buildMvrPatch(…, { autoAddress })` — fixtures without an address get one: after the
  file's own universes, one type + mode after another, a fixture that does not fit starts the next universe; without a
  FixtureID they are named "Name 1…N". `POST /api/stage/mvr/<id>/patch {autoAddress: true}`; the Godot Patch button
  sends it; the result note says what was addressed. Smoke case in `tools/smoke/smoke-wo615-mvr-patch.test.js`.
- **Project data** (scripts kept in `work/notes/gutmanny26-build/`, run against the live server; the project was edited
  through `POST /api/project/autosave` only):
  - both owner files uploaded into the project folder; MVR imported (id 09b5a4f91899); 252 fixtures patched on Art-Net
    0…11 (Quantum 1–36, LEDWash 1–54, Pixel Strobe 1–36, Focus Profile 1–24, X-Dot Max 1–12, Vizi Beam 1–28, X-Dot 1–28,
    Pixel Line 1–34); DMX output left off.
  - `build_venue.py` → `Guttmanny 2026 venue.glb` (24 MB, 2 113 nodes): from the Capture .glb the stage, trusses, LED
    frames and ground support by uuid (fixtures dropped — the MVR draws them); from PGRP the textured walls, carpet,
    ceiling (turned as measured), chandeliers (as in both files) and hang points, as layers "Room walls / carpet /
    ceiling / chandeliers", "Hang points", "Hang plan" (hidden); stage material → black, roughness 0.07 (HIPS polish —
    shows with Quality High / Ultra, which have SSR); "Red carpet" layer: 2 m wide on the catwalk axis from the catwalk
    tip z −37.97 to z −15.50 (3/4 of the 62.2 m room from the stage-end wall), 22.5 m long; each LED panel face kept as
    a black back 2 cm behind the picture (a face missing from the .glb would fall back to the MVR's 3DS part); wing
    frames moved behind the picture so the wings face the audience.
  - the Capture file's own room layers hidden (`previs.mvr.hidden_layers`): their place is taken by the PGRP room.
  - `fit_led.py` → 9 `led_wall` stage objects (curve ±2.5°, fit residual 0.0 mm against the Capture faces) with their
    crops of PGM 1; `multiview.canvas` 11520 × 1536.
  - PGM/PRV 1 → custom 11520 × 1536 @ 50 ("LED 30×4 m (PGM/PRV 1)") through `/api/device-view` + `/api/caspar-config/apply`.
  - `LED map 11520x1536.png` (numbered navy / gold cells per panel) in the project folder, playing on PGM layer 10
    (owner: "you can leave this test pattern on the led walls").
  - `build_looks.py` → 4 looks with fixture states (`fixtures.looks`), programmed through the engine (colour per type as
    the Godot programmer does, Pan / Tilt from `/api/fixtures/program/aim`): "Walk-in — navy & gold", "Speech — stage
    key", "Gold beams", "Blue entrance — carpet"; one group per fixture type.

## What was verified

- Smoke `smoke-wo615-mvr-patch.test.js` 7/7; eslint and the 500-line check clean.
- Live: `INFO` → `2 11520x1536 PLAYING`, `3 11520x1536 PLAYING`; `/api/fixtures/looks` lists the 4 looks (164 / 152 /
  228 / 206 fixtures); recall answers.
- Owner's GUI (screenshots of :0): room with carpet, walls, ceiling, chandeliers; stage, catwalk, red carpet; the LED
  map readable on centre, six stripes and both wings; "252 of 252 fixtures patched"; look 1 lit (gold break-ups,
  blue washes) after one intensity trim (first pass blew out).

## Not verified / open

- Caspar at 11520 × 1536 @ 50 on two channels: it runs and plays the still; no moving-content load test was done.
- The wings face the audience here, unlike the Capture drawing — the LD's file may want correcting.
- The looks are a starting point judged from one camera position with house lights at 100 %.

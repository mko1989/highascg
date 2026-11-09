# WO-1006 — Previs: GDTF rotations were read transposed; a beam's lens is now its own face (Pixel Strobe / Pixel Line flicker)
**Area:** lighting, godot-client
**Status: DONE (09.11 — smoke 2/2, curated offline suite 5552/0, Godot suite 26144/0 + boot check, all-types sweep, live probe shots of a lit Pixel Strobe and Pixel Line on the owner's client)**

Owner, 09.11:
- "pixel strobes has the virtual leds under a mesh which makes them glitch in and out of visibility (this is true also
  for pixeline)"
- "the strobes also have all the leds in the middle of the fixture as a circle, and the fixture is recatangle."
- "some of the pixelstorbes are under the stage" — see the last section; not changed here.

## Investigation

### Pixel Strobe: every lens inside its own head

- The GDTF puts the head's "Beam" plate at Head +x 0.1 m, rotated by `{0,0,1}{0,1,0}{-1,0,0}`. That plate carries
  ForeGround, Background and the 70 Section cells.
- `src/stage/mvr-math.js` `gdtfMatrix` used the groups as matrix rows. Under that reading, the plate's −Z (the GDTF
  beam direction) points back into the head:
  - the 71 lenses sat on the back face of the 0.195 × 0.51 × 0.198 head box, shining into it;
  - the face you see showed nothing but z-fighting.
- The GDTF spec says the matrix is "stored in a row-major order" but "the mathematical definition of the matrix is in
  a column-major order".
- BlenderDMX (open-stage, `gdtf.py`) builds the matrix from the rows, then uses `to_3x3().inverted()` as the rotation.
  So the reference implementation reads the rotation transposed relative to us.
- BlenderDMX's MVR reading (`mvr.py`: u, v, w, o as columns, mm → m) is the same as our `mvrMatrix`.
- Sweep of every imported type (`projects/_gdtf`, primitive-box bodies). Count of beams whose point 5 mm in front of
  the lens lies inside the beam's own body:
  - old reading: Pixel Strobe 71/71, every other type 0;
  - transposed reading: 0 for all types.
  - At rest, no type's beam direction changed.

### Pixel Line (and every cell fixture): overlapping, coplanar discs

- `fixtures_3d.gd` `_beam` drew each lens as a 4 mm thick disc of the GDTF BeamRadius (100 mm across), centred on the
  beam origin.
- Pixel Line pixels are 62 × 30 mm at a 62.5 mm pitch, so neighbouring discs overlapped in one plane.
- The bar's body face is 1 mm behind the beam origin, so each disc also straddled it.
- Result: pixels flickered in and out as the depth test picked a different surface each frame.

### Pixel Strobe "circle in the middle"

- In 15 Ch only ForeGround is driven (WO-1005). ForeGround has no model of its own, so it got the same 100 mm disc,
  centred on a 160 × 470 mm face.

## What was done

- **`src/stage/mvr-math.js`:** `gdtfMatrix` transposes the 3×3 rotation; the translation is still the 4th value of
  each group. `transposeRotation` converts an old reading.
- **`src/fixtures/gdtf-store.js`:** imported records carry `geometryMatrix: 2`.
  - An older record is migrated in memory on load (every geometry `m` transposed). The JSON file stays as imported,
    so nothing is rewritten under Syncthing.
  - `visual()` marks beams the mode never lights (`compileVisual` `lit`, WO-1005) as `beam.driven = false`.
- **`src/fixtures/gdtf-rig.js`:** each Beam node carries `beam.lens = [x, z, round]` in its Godot frame:
  - its own primitive model (the pixel's rectangle; a disc for Cylinder or Sphere models);
  - else the flat (≤ 5 mm) primitive model of the parent it sits on unrotated (Pixel Strobe ForeGround → the
    160 × 470 mm plate).
  - A beam whose own model is the lens gets no extra box mesh.
  - `beam.layer` = its depth rank among the type's beams.
- **`godot/client/features/previs/fixtures/fixtures_3d_model.gd`:** `lens(beam)` draws that face as a 1 mm box or disc.
  - Placement: 1.5 mm in front of the beam origin, plus 1.5 mm per layer, so a pixel sits in front of its plate.
  - An undriven beam's lens goes at the back, with no cone or light, so in 15 Ch the dark cells no longer cover the
    lit plate.
  - With no model, the lens is still a disc of the beam radius.
- **`fixtures_3d.gd`:** uses it. Cell rigs keep the beam dictionary (Glow merged in) instead of rebuilding it, so the
  lens survives.

## What was verified

- **Smokes:** `tools/smoke/smoke-wo1006-gdtf-rotation-and-lens.test.js` 2/2 (matrix reading and migration; lens from
  own model, parent plate, round; layering). WO-612/615/700/784/1005 smokes: 71/71.
- **Offline suite:** curated suite 5552 pass / 0 fail.
- **Gates:** script paths, max lines, unwired exports, `index.js --no-http`, lint, format, audit and WO check all
  pass.
- **Godot:** suite 26144 / 0, including the new `test_lens_face_and_stacking`; `run-client.sh --check` boots clean.
- **Live, after a node restart:**
  - the Pixel Strobe 15 Ch rig sends 70 cells `driven:false` (layer 1) and ForeGround `[0.16, 0.47]` (layer 0);
  - the Quantum gets a round 100 mm lens (unchanged look);
  - the Pixel Line gets 62 × 30 and 62 × 10 mm rectangles.
- **Probe shots** (`--probe-fixture`, on the owner's client, then relaunched normally on Previs):
  - Pixel Strobe 701 at Dimmer 1 / red: one red rectangle across the whole face;
  - the Pixel Lines at Dimmer 1 / blue: a continuous line of pixels in front of the bar, no flicker.
  - The programmer values used for this were released.

## Open: Pixel Strobes 708–712 sit in the stage

- Our pose reproduces the file's matrix exactly (`poseFromMatrix` → `poseXf` gives back the same basis):
  - file position (8.00, 54.17, 1.15) m with an 85° turn about X;
  - plus the scene placement (z +0.88).
- The GDTF head hangs 0.163 m from the yoke origin and 0.09 m to the side. With that turn, the head body is 0.1–0.2 m
  below its mounting point, which is inside the deck. The file's matrix puts it there.
- Options for the owner:
  - re-pose them in the previs (Position card, or hang "floor");
  - or check the file in its source tool.
- The back-truss strobes 701–707 have identity matrices, so their face points upstage. That was the same before this
  change.

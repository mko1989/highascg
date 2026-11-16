# WO-765 — MVR export of the calibrated rig to the desk (grandMA3 / MagicQ)

**Area:** lighting
**Status: DONE (16.11.26 — 11 offline smokes; Hilton Wawer export imported into MagicQ PC 1.9.8.3 on the box and read back; button + help on glass. grandMA3 and a real desk not tested.)**

Owner 25.10 (`for_LDs.md`): "exporting this calibration data (preferebly via mvr) to the desk. the desk reads the
calibration and whatever was prepared in the preshow is now calibrated to real world". The same ask was WO-630 Q1
(`work/work-orders/630_WO_godot_owner_notes_next_md_4.md:50-58`: send PSN, plus an MVR export of the calibrated poses
"so the two 3D layouts agree"). PSN shipped (WO-631); the MVR half was never built.

## Investigation

- Today's export is stage objects only. `src/stage/mvr-export.js` (WO-612 T7) writes LED walls / TVs / projection as
  `VideoScreen`s, with UUIDs derived from object ids (`:9`). It is served at `GET /api/stage/mvr-export`
  (`src/api/routes-stage-mvr.js:179`). It writes no fixtures.
- The desk has to recognise the fixtures. Imported fixtures keep the MVR UUID as `id: "mvr-<uuid>"`
  (`src/stage/mvr-patch.js:14`, `:121`). An export that writes those same UUIDs can update the desk's existing
  fixtures instead of adding a second rig.
- The original file is still on the box: `projects/_mvr/<id>.mvr` plus the parsed `<id>.json`
  (`src/stage/mvr-store.js:4`). The scene parser already reads GDTFSpec, FocusPoint and more
  (`src/stage/mvr-scene.js:16`, `:98`).
- Pose → Matrix: `mvr-patch.js:80 poseFromMatrix` is the import direction (with the hang "floor" turn-over and
  mirrored-matrix handling). The export needs its exact inverse; `mvr-math.js` has the frame transforms.

## Note from WO-804 (29.10)

- `calibrated_pose` now exists on patch heads (WO-804 rig calibration): `source` "measured" | "inferred" and
  `residual_m` (m, leave-one-out) / `rms_deg` (measured fit). The export should write that flag (e.g. in the AUXData /
  comment note listing the calibrated heads) so the desk side knows which positions were measured.

## Plan (as written 25.10; decisions below)

- Preferred approach: **re-write the imported MVR**. Copy the pre-show archive and replace only the `<Matrix>` of every
  fixture that has a `calibrated_pose` (WO-764). Leave GDTF files, trusses, geometry, addresses and every other
  object as Capture wrote them. The desk then sees its own pre-show file with corrected positions.
  - Add the stage marks as `FocusPoint`s (stable UUIDs from the mark ids).
  - Add a note in the file's comment or AUXData listing the calibrated heads and their fit.
  - Alternative: build a fresh fixtures-only MVR. Rejected for now, because it would need every GDTF packed and
    risks the desk treating it as a new rig.
- Heads that aren't calibrated keep their original Matrix. Fixtures added in HighAsCG (not `mvr-`) are listed as
  skipped.
- UI: **Previs → MVR → Export calibrated rig…**, next to the existing Export…, with a summary
  ("12 of 16 heads calibrated, 4 unchanged").
- Round-trip guard: export → re-import in HighAsCG → every pose equals `calibrated_pose` (1 mm / 0.01°).
- **Owner QA on real desks:** grandMA3 and MagicQ import as an *update by UUID*, position / rotation only, patch
  kept. Record each desk's menu path and behaviour (does a stage-space / XYZ position re-aim?) in this WO and in
  `for_LDs.md`.

## Acceptance

- Smoke: a fixture MVR → patch → set `calibrated_pose` → export → parse. Matrices change for the calibrated heads only,
  UUIDs are unchanged, FocusPoints are present, and nothing else in the archive differs byte for byte.
- Round trip as above, including hang "floor" and pitch / roll.
- Owner: the file imports into grandMA3 and MagicQ and updates the existing fixtures.

## Desk research (vendor manuals, fetched 16.11; quotes verbatim)

- **MVR** (github.com/mvrdevelopment/spec mvr-spec.md): Matrix "Right-handed, Z-Up, 1 Distance Unit equals 1 mm",
  order "u1,u2,u3 v1,v2,v3 w1,w2,w3 o1,o2,o3", "The location and orientation of the object inside the parent
  coordinate system". Annex B (informative): "objects should have the same UUID every time an export is performed …
  By cross referencing UUIDs, you can avoid creating duplicate objects and instead update existing ones." GDTF: "The
  device shall be drawn in a hanging position". No merge algorithm is normative.
- **grandMA3 2.5** (help.malighting.com/grandMA3/2.5/HTML/): import = Partial Show Read → MVR (`sc_psr.html`):
  "Rows with corresponding fixtures on both sides are called matched. Patch, Position, and Rotation properties can be
  imported individually.", "tap Use MVR Position/Rotation Columns", "Merge MVR: Add all unmatched or unselected
  fixtures", "MVR integration via Partial Show Read will clear the programmer"; general PSR match order "Fixture ID,
  Channel ID, GUID, Name". Axes (`patch_position_fixtures.html`): X "positive … stage left", Y "positive … more
  upstage", Z height; X rotation "top of the fixture towards downstage", Y rotation "top towards stage left", Z rotation
  "counter-clockwise, as seen from the top"; "only works with meters and degrees". Position calibration from "three
  or four known points" (P1–P4 → Solve). XYZ / MArker aim stage points (`xyz.html`, `xyz_marker.html`).
  **Unconfirmed:** Euler order, that MVR matching uses the UUID, how MVR mm are converted.
- **MagicQ 1.9.9.x** (docs.chamsys.co.uk/magicq/1.9.9.x/manual/): MVR import (`system_management.html`): "The heads
  in the file will be added to the current shows patch", scene objects not imported. CSV Import Heads "Vis only"
  (`patching.html`): "Imports only the Vis data (XYZ position and rotation) for the head at the specified DMX address".
  Frame (`trackers.html`): "X and Z as horizontal … Y as vertical", "MagicQ has Z positive towards the audience". PSN
  on PC "only supported when unlocked"; fixed-XYZ palettes need Setup → Network → Tracker rx Internal (Plot View
  Focus Hold → Position Palette → Set Tracker → XYZ Pos). **Unconfirmed by the manual:** +X sign, rotation order —
  both settled by the test below.

## Decisions (16.11, taken on evidence)

- **Rewrite the original archive** (not a re-serialised scene): the desk gets its own pre-show file — trusses,
  geometry, layers, unknown elements, attribute order, whitespace untouched — with only the calibrated / inferred
  fixtures' own `<Matrix>` replaced. Fixtures without a Matrix get one inserted after the start tag. A matrix is local
  to the parent: `local' = local · world⁻¹ · world'`, so heads on trusses / groups stay children of them.
- **Build path only where needed:** heads HighAsCG added (no `mvr-` id) go into a new "HighAsCG fixtures" layer with
  their GDTF packed; with no stored archive at all the whole file is built (`base: new`).
- **Marks → FocusPoints** on a "HighAsCG marks" layer, UUIDs derived from the mark ids (stable across exports);
  `marks=0` leaves them out.
- **The report rides in an XML comment** after the declaration (per head: status, moved m, turned °, fit) — every
  desk ignores comments; AUXData would be parsed.
- **GDTFs:** the archive's own by default; `types=highascg` also writes HighAsCG's own GDTFs, modes and
  addresses (`magicq-mvr.js rewriteScene`, the WO-796 path: placeholder GDTFs from Capture don't decode in MagicQ). The MagicQ test used `types=highascg`.
- **Placement:** `previs.mvr.place` (the venue shift in HighAsCG) is undone so the file keeps the desk's origin.
- **MagicQ table in MagicQ's own rotation order** R = Ry(RotY)·Rx(RotX)·Rz(RotZ), measured below; the MVR / grandMA3
  table writes Rz·Ry·Rx (MA undocumented; exact for a single turn, < 0.1° for rig-size tilts; the .mvr is exact).

## What was done

- `src/stage/mvr-xml-spans.js` (new): tag scanner → each Fixture's span and its OWN Matrix span; `splice`.
- `src/stage/mvr-rig-export.js` (new) `buildRigExport` → `{files, report}` (statuses calibrated / inferred /
  unchanged / added / skipped); `mvr-patch.js matrixFromPose(pose, like)` (exact inverse of `poseFromMatrix`, keeps
  the original's column scales and mirroring); `mvr-export.js` exports `uuidOf`.
- `src/stage/rig-csv.js` (new): MVR / grandMA3 table and the MagicQ table (WO-1072 format: `Head no,Head name,DMX,
  X,Y,Z,RotX,RotY,RotZ,`, DMX `U-AAA` with Art-Net +1, trailing comma).
- `src/api/routes-rig-export.js` (new): `GET /api/stage/rig-export?format=mvr|csv|json&desk=magicq&types=highascg&
  marks=0`, headers `X-Rig-Calibrated / Inferred / Unchanged / Added`; registered in `router.js`; API contract
  regenerated.
- Godot: `rig_export.gd` (new) file dialog (.mvr / .csv / .magicq.csv) → flush → fetch → write → status line;
  **Export calibrated rig…** in Previs → MVR (`mvr_section.gd`) and under Calibrate heads (`calibrate_fold.gd`,
  status hidden until used, "?" → help).
- Help: `godot/client/help/calibrate-rig-to-desk.md` (linked from calibrate-heads.md; topic in test_help_pages.gd).
- Commits: 7d28e68d, 84ca5d2a, c3740fd9, d433469b.

## What was verified

- `tools/smoke/smoke-wo765-rig-export-mvr.test.js` — 11 tests, all pass: 3000 random poses (incl. floor, pitch /
  roll) round-trip < 1 mm / 0.01°; `like` scales + mirrored frames; unplace; byte-for-byte equality outside the
  edited matrices on a scene with a nested truss, a floor head, a fixture without Matrix and an unknown element; build
  path + FocusPoints with stable UUIDs; no-archive build; both CSV flavours incl. the MagicQ values below; the route
  handler on a temp archive; router registration.
- Hilton Wawer archive (default, archive GDTFs): only the comment and the 8 matrices differ; UUIDs, FixtureIDs, addresses, modes kept.
  Re-importing the export in HighAsCG gives every head's `calibrated_pose` back exactly (worst 0 m / 0°).
- Live route on the box: 200 with the X-Rig headers, MagicQ CSV served. On glass: the button in both places, the
  file dialog, status "Exported the rig (8 measured, 0 inferred, 0 unchanged) to …", the help page from "?".
- **MagicQ PC 1.9.8.3 (demo) on Xvfb :99, 16.11** (lock held, user files backed up and restored byte-identical
  afterwards, MagicQ and Xvfb stopped):
  - New show → Setup → File Manager → the calibrated .mvr → "MVR GDTF Data": 8 × "ADJ FocProf Standard Mode 40ch"
    patched at 1-001 … 1-281, head numbers 1–8 (the FixtureIDs).
  - Patch → View Vis → Vis Heads read back (all 8 rows): X pos = MVR x, Y pos = MVR z, Z pos = −MVR y to the 0.01 m
    shown (head 1: 4.86 / 4.96 / −3.88 for file 4.860 / 4.964 / −3.875). Rotations equal the solved pose as
    RotX = pitch, RotY = −yaw, RotZ = roll to the 0.1° shown (head 6: 0.1 / −3.6 / −4.9; head 8: −3.6 / −4.5 / 1.5),
    i.e. MagicQ reads the matrix as R = Ry·Rx·Rz in its frame. A brute-force over the 6 orders × signs confirmed it
    fits all 8 heads within display rounding; Rz·Ry·Rx (the first CSV) missed head 6 by 0.3° → fixed (c3740fd9).
  - CSV path: Patch → View Chans → Import Heads → the .magicq.csv → "Vis data only": existing heads updated in place
    by DMX address (test edits: head 6 X +1 m and rot 10 / 20 / 30, head 2 Z −1 m → shown exactly), patch untouched.
  - **Re-importing the MVR into a show that already has those heads does NOT update them:** the 8 old heads became
    "unpatched" and 8 more Vis rows appeared without type or head number. So: MVR for a new show, the CSV (Vis data
    only) to update an existing one — written into the help page.
- **Not verified:**
  - Aim test in MagicQ (calibrated rig hits a stage point the patch misses): not attempted. External PSN needs an
    unlocked MagicQ on PC; the internal fixed-XYZ route (Tracker rx Internal + Focus Hold palette) is documented as
    not demo-restricted but was not driven. The positions / rotations MagicQ holds equal the solved poses, so its aim
    equals ours only if its Focus Profile model matches the GDTF — unchecked.
  - grandMA3: nothing tried (no console or onPC here); the PSR steps are from the manual.
  - A real rig / a real desk.

# WO-765 — MVR export of the calibrated rig to the desk (grandMA3 / MagicQ)

**Status: OPEN (25.10) — not started; needs WO-764's `calibrated_pose`**

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

## Plan (to confirm with the owner)

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

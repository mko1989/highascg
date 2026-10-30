# WO-636 — An MVR scene's GDTF fixture types load with the scene, not only on Patch

**Area:** lighting
**Status: DONE (2026-10-21) — offline 3074/0, Godot --test 20611/0; box: Pabianice shown → 5 types listed, 52 fixtures patched from the file, Unpatch remembered across a relaunch.** Parent: [WO-615](./615_WO_previs_fixtures_gdtf_patch_dmx_out.md) (T10 MVR patch). Related: [WO-612](./612_WO_previs_mvr_import.md), [WO-633](./633_WO_gdtf_replace_stub_types.md).

Owner 21.10: "check why the gdtf fixtures didnt load" (Pabianice shown in Previs, Fixtures section empty), then "the
mvr at least for pabianice has patched fixtures which should carry over".

## Investigation

- Box state 14:35: `GET /api/fixtures/types` → `{"types":[]}`, `projects/_gdtf/` empty (mtime 13:32). The Previs MVR
  section shows "52 fixtures, not patched" and the Fixtures section "— no fixture types: Import GDTF… —".
- Nothing failed: the journal since 13:33 has no fixture / GDTF / MVR errors and no patch request — the types were
  never asked for. By design (WO-615 T10) a scene's embedded GDTFs reach the type store only in
  `POST /api/stage/mvr/<id>/patch` (`src/api/routes-stage-mvr.js` `handlePatch`, `ensureGdtf` per GDTFSpec). Importing
  or showing an MVR (`handleUpload` → `mvr-store.importMvr`) parses the GDTFs only to draw the scene; the type store,
  the Fixtures section's list and the Replace… dialog (WO-633) stay empty until **Patch fixtures** is pressed.
- Why it was empty today: the store held 5–6 types earlier, but all of them came from my own WO-615/633 box tests
  (Patch fixtures clicks at 13:09 and 13:28, plus the real ADJ Focus Profile uploaded for the replace test); I deleted
  them at 13:09 and 13:31 to put the box back as found (session transcript). The owner's own state never had types.
- Even once loaded, Pabianice's types are Capture stubs (WO-633: `description.xml` only, empty `Base`, `DimmerN`
  channels): `report.gdtf_no_model` lists all 5, so the 3D draws boxes whatever the store holds. Real models need the
  real GDTF + Replace… (WO-633).

## Fix plan

- Server: `POST /api/stage/mvr/<id>/types` — import every GDTF the scene's fixtures use into the store (the same
  content-addressed `ensureGdtf` loop as the patch, shared), reload the fixture service, → `{ types, missing }`. No
  patch entries, no project write.
- Godot: when a scene with fixtures loads (`mvr_section._on_loaded`), call it once per scene id and re-list the
  Fixtures section's types (`types_changed`). Patching stays the operator's step (it writes DMX addresses).
- Owner follow-up: the file's own patch (addresses, modes) should carry over too — showing the scene applies it unless
  the operator unpatched it (remembered as `project.previs.mvr.unpatched`).

## What was done

- `src/api/routes-stage-mvr.js`: the GDTFSpec → stored-type loop moved out of `handlePatch` into `sceneTypes(sc)`
  (the patch adds the WO-633 alias step on top, unchanged). New `handleTypes` = `POST /api/stage/mvr/<id>/types` →
  `{ types: [{spec, id, name, manufacturer, placeholder}], missing }`, fixture service reloaded; no patch, no project
  write.
- `godot/client/features/previs/mvr_section.gd`: after a scene with fixtures loads (`_on_loaded` → `_load_types`, once
  per scene id per session): none of its fixtures patched and not `unpatched` → `_patch()` (the file's patch; imports
  the GDTFs too); otherwise `POST …/types`. Either way `types_changed` re-lists the Fixtures section. Unpatch sets
  `previs.mvr.unpatched`, a patch clears it (`_mark_unpatched`; `_last` follows so the scene is not reloaded for it).
- Why load-on-show and not on upload: the scenes already in `projects/_mvr` (Pabianice) are covered too, and the
  store is content-addressed, so a repeat costs a zip read, no parse.

## What was VERIFIED

- `tools/smoke/smoke-wo615-mvr-patch.test.js` +1 (`/types`: test spot + Capture stub listed, stub flagged placeholder,
  `Nobody@Ghost` missing, no patch entries, a repeat adds no copy, unknown id 404). Offline suite 3074 pass / 0 fail;
  Godot `--test` 20611 / 0, `--check` boots; no file over 500 lines.
- Box: node restarted, GUI relaunched on godot_test with Pabianice →
  - `GET /api/fixtures/types`: Acme Pixel Line IP, ADJ Focus Profile, Brighter Pixel Strobe, Clay Paky Sharpy Plus,
    Robe Robin 600 LEDWash+ — all `placeholder`; the Fixtures section lists them with Replace….
  - With the auto-patch: 52 entries with no click (journal `[follow] patch: 52 fixture(s), 52 outputtable`), Art-Net
    U1 13 / U2 8 / U3 15 / U5 8 / U8 4 / U9 4; e.g. Focus Profile 401–404 at U5 1 / 41 / 81 / 121, `40 Channel`.
    The panel: "52 of 52 fixtures patched". DMX output stayed off.
  - Unpatch → 0 entries, `unpatched: true`; relaunch → still 0; Patch fixtures → 52, flag cleared. The mapped LED
    walls (WO-634) and 192 hidden objects untouched throughout.
- Still boxes in 3D: the types are Capture stubs (no model) — real files: WO-633 Replace…, automated in WO-637.

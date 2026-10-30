# WO-643 — Re-importing the MVR reset the scene to the file's origin and showed a second set of heads

**Area:** godot-client, lighting
**Status: DONE (2026-10-21) — Godot --test 20670/0 (`test_reimport_keeps_the_scene_settings`); box: the lost place restored (heads back on the trusses, patch unchanged). Owner QA: re-import the MVR — the scene stays where it was.**

Owner, 21.10: *"ive tried reimporting the mvr and it just added the second set of models, and again with wrong
0,0,0 position. or our 0,0,0 position is wrong."*

## Investigation

- `features/previs/mvr_section.gd` `_import` saved a fresh `{id, name, hidden_layers: []}` as `project.previs.mvr`.
  That dropped `place`, `hidden_objects`, `unpatched` and `layer_colors`.
- The MVR store is content-addressed: the same file gets the same id (`d74a223cd12a`). So the re-import showed the
  same scene, with all of its settings reset.
- Before the re-import (19:58:42) the project had `place` x −12.87, y 0.68, z 2.37, yaw 0 and 192 `hidden_objects`.
  Now it has neither (`projects/godot_test.json`).
  - Without `place` the scene sits at the file's own origin and is re-fitted. That is the "wrong 0,0,0": the file's
    origin, not a wrong origin in previs.
  - The 52 patched fixtures keep their placed poses (they live in `project.fixtures`, and the scene's own copies stay
    hidden by uuid, `mvr_scene.gd:182`). They stayed where the scene used to be while the trusses and set moved to
    the file origin. That is the "second set of models": a rig of heads 12.87 m away from its trusses (box
    screenshot, Place 0 / 0 / 0). The patch was not doubled (52 entries, unique ids).
  - The 192 `hidden_objects` were MVR walls replaced by the LED screens (WO-634, `mvr_screens.gd:169`). The owner
    deleted those screens on purpose (19:54–19:57, *"i did delete the screens"*), so those walls showing again is
    right. Nothing to restore there.

## What was done

- `features/previs/mvr_model.gd` `import_cfg(cur, id, name)`:
  - The same file (id) or a new version of the shown scene (same name) keeps the whole cfg: place, hidden layers and
    objects, unpatched, layer colours. MVR object uuids are stable across versions.
  - Any other scene starts fresh.
- `_import` uses it, and fits the camera only when there is no kept `place`.
- The owner's lost place: re-entering it in the spinboxes would also move the patched fixtures by the delta
  (`_set_place`). So it was written straight into the project: `previs.mvr.place` = −12.87 / 0.68 / 2.37 / 0 via
  `POST /api/project/autosave` (rev 61→62). The server broadcasts the sync, and the client reloads the scene
  without touching the patch.

- Follow-up, owner 21.10: *"i deleted the screens, couldnt undo, so i wanted to import the mvr sencond time think
  there would be a warning that im try to import same stuff and same patch"*. `mvr_model.gd` `file_id` / `file_name`
  compute the id and name the server will give the file (`mvr-store.js:56` sha1, 12 hex; file name without .mvr),
  before the upload. `import_check` sorts the result:
  - same bytes as the shown scene: an "Already imported" note, and nothing is uploaded or saved;
  - same name, new bytes: a confirm (Cancel focused) saying what is kept;
  - any other scene: imports silently.

## What was VERIFIED

- `tests/test_mvr_scene.gd` `test_reimport_keeps_the_scene_settings`: same file keeps everything, a new version keeps
  place / hidden objects / colours, another venue and an empty project start fresh, input untouched.
  Godot `--test` 20670 passed, 0 failed.
- Box, the restore: `projects/godot_test.json` rev 62 has the place, and `fixtures.patch` is byte-identical to
  before. The running client picked it up (Place shows −12.87 / 0.68 / 2.37), and the screenshot shows the heads on
  the trusses again.
- `test_import_check_before_the_upload`: same / renamed copy / new version / other / empty, sha1 of "abc" =
  `a9993e364706` like Node's, the .MVR suffix. Godot `--test` 20677 passed, 0 failed; `--check` boot OK.
- Box: Import… → `~/Downloads/Pabianice Final Patch.mvr` shows "Pabianice Final Patch is already imported — the same
  file, the same objects and patch. Nothing to import." (screenshot). The store's importedAt stayed 19:58:42 and
  the project rev stayed 62.
- The new-version confirm was not driven on the box (no second version of the file). Owner QA above.

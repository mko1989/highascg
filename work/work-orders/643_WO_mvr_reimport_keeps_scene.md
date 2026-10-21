**Status: DONE (2026-10-21) — Godot --test 20670/0 (`test_reimport_keeps_the_scene_settings`); not re-imported on the box (owner's live scene). Owner QA: re-import the MVR — the scene stays where it was, patched heads do not double.**

# WO-643 — Re-importing the MVR reset the scene to the file's origin and showed a second set of heads

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
  - Without `hidden_objects`, the scene's own fixture geometry shows again next to the 52 patched fixtures. Those
    keep their placed poses (they live in `project.fixtures`). That is the "second set of models".

## What was done

- `features/previs/mvr_model.gd` `import_cfg(cur, id, name)`:
  - The same file (id) or a new version of the shown scene (same name) keeps the whole cfg: place, hidden layers and
    objects, unpatched, layer colours. MVR object uuids are stable across versions.
  - Any other scene starts fresh.
- `_import` uses it, and fits the camera only when there is no kept `place`.
- Not done: the owner's lost place and hidden objects are not restored automatically. Re-entering the place in the
  spinboxes would also move the patched fixtures by the delta (`_set_place`). Offered to the owner as a direct
  restore of `place` only.

## What was VERIFIED

- `tests/test_mvr_scene.gd` `test_reimport_keeps_the_scene_settings`: same file keeps everything, a new version keeps
  place / hidden objects / colours, another venue and an empty project start fresh, input untouched.
  Godot `--test` 20670 passed, 0 failed.
- Not driven on the box: a re-import would change the owner's live scene. Owner QA above.

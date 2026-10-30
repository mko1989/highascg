# WO-681 — MVR scene off takes its fixtures and walls; ctrl / shift multi-select in the 3D previs

**Area:** lighting, godot-client
**Status: DONE (22.10, Godot 20988/0; box: none / Remove each took 52 fixtures + 1 mapped wall, Cancel kept them,
re-pick re-patched 52; ctrl / shift-click selected 3 heads, ctrl-click toggled one off; owner QA: full import path)**

Owner, 22.10: *"i choose no mvr scene and i still have the led wall and fixtures. after removing. the mvr. i wanted to
check the full path from import. also add ability to multi select holding ctrl and shift on the 3d previs."*

## Investigation

- Picking "— no MVR scene —" (`mvr_section.gd` `_on_pick`) and Remove (`_remove`) only cleared
  `project.previs.mvr`. Two things the scene had brought stayed in the project:
  - the patch: showing a scene auto-patches its fixtures (`_load_types`) as `mvr-<uuid>` entries in
    `project.fixtures.patch`. Nothing unpatched them when the scene went, so the heads stayed in the 3D view
    and in DMX output;
  - the walls: WO-634 Map (`mvr_screens.gd` `_map`) creates ordinary stage objects in
    `project.previs.stage.objects`. They carried no link to the scene, so nothing could tell them apart from
    hand-made walls.
- On the owner's `godot_test` project after "no scene" + Remove: patch 52 (all `mvr-`), stage objects LED
  wall 1 / 2 / 3, groups 'pixele r', 'pixele l', 'front'.
- `stage_objects.gd` `normalize` keeps unknown keys, so a tag on a wall survives saves and edits.
- 3D picking: `previs_tab.gd` passed only `mb.shift_pressed` as "add" to `fixtures3d.click`. MVR walls already
  used the same flag, so ctrl did nothing for heads.

## What was done

- Tagging: `mvr_screens.gd` `_map` tags every wall it creates with `mvr: <scene id>`.
- `mvr_model.gd` (pure, tested):
  - `drop_scene(project, id, uuids)` removes the scene's `mvr-<uuid>` patch entries and the stage objects tagged
    with its id, and returns `[fixtures, walls]`. It mutates, so counting runs on a copy. An empty id never takes
    walls;
  - `content_text(n)` builds the dialog wording.
- `mvr_section.gd`:
  - switching from a scene with content (to none or to another scene) asks once: *"Stop showing "X"? This
    project loses its 52 patched fixtures and 1 LED wall mapped from it (showing it again re-patches them)."*
    OK → `_drop()` then save; Cancel → the dropdown goes back;
  - Remove adds *"This project also loses …"* to its existing confirm and drops before saving;
  - `_drop()` forgets the scene's typed cache, so showing it again patches it afresh;
  - one `ConfirmationDialog` serves both prompts (`_after`), which keeps the file under 500 lines;
  - Export moved out to `mvr_export.gd` for the same reason;
  - a scene change also clears the last "Mapped N walls…" note (`mvr_screens.gd` `clear(forget)`), which
    otherwise stayed after the scene left.
- Fixture groups keep their ids: the same `mvr-<uuid>` ids come back on re-import, so the operator's groups
  work again.
- Hand-patched fixtures, hand-made walls and walls from another scene are untouched.
- `previs_tab.gd`: `fixtures3d.click(..., mb.shift_pressed or mb.ctrl_pressed)`. Ctrl and shift both add or
  toggle. The UI texts were updated: Fixtures label, wall hint, header comments.
- One-off clean-up of the owner's project, done via the autosave POST (rev 102 → 103):
  - patch 52 → 0; LED wall 1 / 2 / 3 removed; groups kept;
  - backup at `/tmp/claude-1000/-home-casparcg/27cc66f1-…/scratchpad/godot_test.before-wo681.json`.

## What was VERIFIED

- Godot tests: 20988 / 0, including the new `tests/test_mvr_drop_scene.gd`. It covers copy vs in place, hand
  patch, other scenes' fixtures and walls, groups kept, a second drop removes nothing, an empty id takes no
  walls, and the dialog wording.
- 500-line limit: `mvr_section.gd` 492, `previs_tab.gd` 493.
- Box (GUI relaunched; `godot_test`; "Pabianice Final Patch.mvr" imported through `/api/stage/mvr`):
  - picking the scene auto-patched 52 fixtures;
  - Map on the centre wall saved `led_wall_1` with `mvr: d74a223cd12a`;
  - "— no MVR scene —" → the dialog named "52 patched fixtures and 1 LED wall"; Cancel → dropdown back on
    Pabianice, project unchanged (52 / 1);
  - "— no MVR scene —" → OK → project file: patch 0, stage objects [], no `previs.mvr`, groups kept; the 3D view
    was empty;
  - picking Pabianice again → re-patched 52;
  - Map again, then Remove → the dialog added "This project also loses its 52 patched fixtures and 1 LED wall";
    OK → patch 0, objects [], `/api/stage/mvr` → `{"scenes":[]}`;
  - multi-select: click one head, ctrl-click a second, shift-click a third → all 3 outlined; ctrl-click the
    third again → deselected;
  - Remove with heads still selected → no script errors (`gui.log` has 0 error lines).
- The box was left with no scene imported, so the owner can run the full import path.
- Owner QA: the full path (checklist WO-681).

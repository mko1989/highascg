# WO-691 — Previs: delete patched fixtures (Delete key + Programmer "Delete")

**Status: DONE (23.10; Godot tests 21126/0, box: added a head, then Delete key → confirm → gone from the saved project)**

Owner, 23.10: *"I can't delete added fixture in previs."*

## Investigation (23.10)

The client had no way to remove one patched fixture. The things that looked like it were all something else:

- **Fixtures → "Remove"** (`features/previs/fixtures/fixtures_section.gd:48`, `_ask_remove` / `_remove` at `:344`/`:349`)
  removes the selected fixture *type* (the GDTF in the library) from the box. It does not touch the patch.
- **MVR → "Unpatch"** (`features/previs/mvr_section.gd:136`) removes *all* of one MVR scene's fixtures. It also sets
  `project.previs.mvr.unpatched` so `_load_types` does not auto-patch them again on the next load. That is all or
  nothing, and it does not apply to heads added with Fixtures → Add.
- **Delete / Backspace** in the previs (`features/previs/previs_tab.gd` `_unhandled_key_input`) always called
  `stage_panel.delete_selected()` (`stage_panel.gd:205`). That works only on stage objects, so with a head selected
  it did nothing.
- WO-682 already tracks which kind of thing the operator picked last (`move/move_targets.gd:43` `active()` →
  `"heads"` / `"mvr"` / `"stage"`). The arrow-key move uses it, so Delete can use the same rule.
- The patch is `project.fixtures.patch` (Godot-owned slice). Add persists via `Store.project` →
  `ProjectSync.mark_dirty(true)` → `Store.project_changed`. The server-side programmer keeps values per fixture id
  until `DELETE /api/fixtures/program?id=` releases them.

## What was done

- `features/previs/fixtures/fixtures_model.gd:133` `delete_fixtures(project, ids) -> int` (pure):
  - filters the patch in place and returns how many it removed;
  - when the last `mvr-…` fixture goes, it sets `previs.mvr.unpatched = true`, as Unpatch does. Without this, the
    next session's first load would re-patch the whole MVR scene.
- `features/previs/fixtures/fixture_selection.gd:9`: new `signal delete_requested` on the shared selection.
- `features/previs/fixtures/programmer_section.gd`:
  - a **Delete** button in the All / None / Release / Release all row;
  - `_ask_delete` (`:180`) captures the selected ids and opens a ConfirmationDialog ("Delete "<name>" from the
    patch?" / "Delete N fixtures…");
  - `_delete` (`:192`) removes exactly those ids. It does not re-read the selection when OK is pressed, so a click
    that changes the selection while the dialog is open cannot delete something else. It then trims the selection,
    persists the same way Add does (`mark_dirty` + `project_changed`) and releases each id's programmer values on
    the server.
- `features/previs/previs_tab.gd` `_unhandled_key_input`: Delete / Backspace now emits `delete_requested` when
  `mover.active() == "heads"`, and otherwise falls back to the stage object as before. A confirm dialog guards
  both the key and the button, because a patch deletion is not undoable.
- `tests/test_fixtures_model.gd` `test_delete_fixtures`:
  - removes only the named ids, and unknown ids are ignored;
  - an MVR scene's last fixture marks the scene unpatched, and a partial MVR delete does not;
  - an empty id list or a missing slice returns 0.

## What was VERIFIED

- Godot suite: **21126 passed, 0 failed** (`godot --headless --path godot/client --script res://tests/run_tests.gd`).
- Box, second client instance on Xvfb `:77` (`--tab=1`, main GUI untouched), screenshots in
  `/tmp/claude-1000/-home-casparcg/daed53bd-d6cf-409c-8b5b-90a4cc140fc5/scratchpad/`:
  - `x2.png`: Fixtures → Add ×1 → "Pixel Line IP 1" listed; `projects/new_project_1.json` rev 23→24 with 3 fixtures.
  - `x3.png`: the head is selected in the Programmer list, the Delete key is pressed with the pointer over the 3D
    view, and the dialog reads *Delete "Pixel Line IP 1" from the patch?*
  - `x4.png`: after OK the status reads "Deleted 1 fixture."; the project is at rev 25 with the 2 MVR fixtures again.
    The `unpatched` flag was not set, as expected, since MVR heads remain.
  - Earlier on `:0`: `g1.png` (Delete button), `g3.png` (dialog), `g4.png` (Cancel leaves the patch alone).
- **Incident:** during the `:0` test, another actor on the shared display confirmed a Delete of `fx1` "Focus
  Profile 1 1" at 10:27:03 (rev 22→23). It was not restored. The rev-22 copy is
  `/tmp/claude-1000/-home-casparcg/daed53bd-d6cf-409c-8b5b-90a4cc140fc5/scratchpad/project-before-wo691.json`.
  Later checks ran on Xvfb only.
- Owner QA: delete from a 3D-view click selection (ctrl / shift multi-select) on the main GUI.

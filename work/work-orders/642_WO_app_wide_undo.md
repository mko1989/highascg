# WO-642 — Ctrl+Z / Ctrl+Shift+Z everywhere (the show document)

**Area:** godot-client
**Status: DONE (2026-10-21) — Godot --test 20670/0 + --check; box: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Z on the Live default transition each restored and saved (rev 57→60, client log names only `scenes`). Owner QA: undo in Previs (MVR place, layer colours, stage objects) and Timeline.**

Owner, 21.10: *"there is no control-z, or at least in previs"*, then *"ctrl-z should be everywhere."*

## Investigation

- The only undo in the Godot client was the Devices cable gesture (`features/devices/devices_tab.gd:486`
  `_gesture.undo()`). It also took every Ctrl+Z on that tab, even with no cable steps.
- Every local edit to the show already ends in `ProjectSync.mark_dirty()` (autosave, 3 s debounce) or
  `ProjectSync.deck_changed()` (looks / presets, `core/project_sync.gd:54`). Each edits `Store.project` in place.
  Loads, remote syncs and project switches go through `Store.set_project`, which swaps the dictionary instance.
  So one hook catches every edit, on every tab, without per-feature undo code.
- `rev` / `savedAt` change on every save and are not edits. A restored document must carry the live `rev`, or the
  save is refused as stale.
- Godot JSON: a parsed document has only floats; a local edit writes ints. Raw `JSON.stringify` therefore saw a
  phantom change after every restore. The first box run showed it: an undo saved a change nobody made (rev 53→54).
- A focused text field swallows Ctrl+Z. A SpinBox's field still has focus after its arrows are clicked, and counts
  the arrow change as its own text step. The box run: three Ctrl+Z after an arrow click did nothing.

## What was done

- `core/project_undo_model.gd` (new, pure): whole-document snapshots (`canon`: one parse round trip, so ints and
  restored floats compare equal; `rev` / `savedAt` dropped).
  - Edits within 600 ms are one step (drags, held arrows). At most 100 steps.
  - A new edit drops the redo branch.
  - `rebase` takes a load or remote sync as the new base without a step.
- `core/project_undo.gd` (new autoload `ProjectUndo`, `project.godot`):
  - Records on `ProjectSync.edited`.
  - Clears on a project switch (slug change). Re-bases on a remote sync.
  - Undo restores through `Store.set_project` (every view reloads), then `deck_changed()` + `mark_dirty()`, so looks
    and the rest of the document are saved like an edit.
  - Logs `[undo] undo|redo: <changed top-level keys>` (or `nothing to undo`) in the client log.
  - Keys: Ctrl+Z undo; Ctrl+Shift+Z or Ctrl+Y redo.
  - A focused text field keeps the key only while it has typing to undo: `has_undo` / `has_redo`, and for a
    SpinBox's field only while a typed number differs from its value.
- `core/project_sync.gd`: `signal edited`, emitted by `mark_dirty` and `deck_changed`.
- `features/devices/devices_tab.gd`: cable undo answers only while it has steps, otherwise the global undo does.
- Why snapshots and not per-feature commands: dozens of edit paths across tabs already funnel into two calls, and
  a project document is small (a string per step). One hook covers features written later too.
- Not covered: server config edited outside the project document (Devices destinations / outputs, Settings).
  History starts at each client launch.

## What was VERIFIED

- `tests/test_project_undo_model.gd` (5 tests): steps and redo branch, coalescing, rebase and cap, bookkeeping
  dropped and live rev carried, int vs restored float equal.
- Godot `--test` 20670 passed, 0 failed. `--check` boot OK. Line limit 0 over.
- Box (client relaunched), Live → Default transition arrow 27→28, then Ctrl+Z → 27, Ctrl+Shift+Z → 28, Ctrl+Z → 27.
  Each was saved (`projects/godot_test.json` rev 57→60), and the log says only `undo: scenes` / `redo: scenes`.
  Two quick arrow clicks undid as one step. Left at the owner's 25.
- Before the SpinBox rule, the same Ctrl+Z did nothing (field focused); before `canon`, an undo saved a phantom
  change. Both are fixed and re-run as above.

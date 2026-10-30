# WO-762 — Look deck: a duplicate goes last; drag cards to reorder; a look made from a media drop is named after the file

**Area:** godot-client, engine
**Status: DONE (25.10 — Godot 21756/0, smoke-wo623-new-look 6/0, GUI e2e 32/32 incl. 4 new steps; owner relaunch + QA)**

Owner 25.10:
- "duplicating a look should send the new one to the last position not directly after the source."
- "i cant drag and change places of looks."
- "when a look is created from dragging a media file into looks deck it should be named after the file with no
  extension."

## Investigation

- Duplicate: `godot/client/features/live/look_edits.gd:55` `scenes.insert(i + 1, dupe)`, a deliberate choice in WO-656
  ("the web appends at the end"). The owner now wants the web's behaviour, which reverses WO-656's placement rule.
- Reorder: the web deck has it (WO-563, Pointer Events). The Godot deck (`deck_view.gd _card`) had no drag source or
  drop target on the cards at all, only the WO-623 new-look drop on blank space and "+".
- Card clicks staged on PRV on the left PRESS (`_on_card_input`), so any drag would also stage the dragged look on PRV.
- Naming: `src/api/routes-scene-new-look.js` named every look `Look ${count + 1}`, including deck drops of a media
  file (WO-623 B copied the web's addScene).

## What was done

- `look_edits.gd`: `duplicate_look` appends. New `move_look(root, id, target, after)`, pure: before or after
  `target`, or to the end for "". It returns false when nothing moves (unknown id, onto itself, already in place).
- `features/live/deck_reorder.gd` (new). A card is a drag source (payload `{type: "look-reorder", lookId, main}`,
  preview = the name) and a drop target: left half before it, right half after it. Blank deck space and "+" move it to
  the end. It only works within the same screen's column. It lives in its own file because `deck_view.gd` is near
  the 500-line limit.
- `deck_view.gd`:
  - `Reorder.wire` per card;
  - `_can_drop_new` / `_drop_new` take the reorder payload (to the end), so a dragged card no longer looks like a
    media source;
  - click = PRV on RELEASE, and `NOTIFICATION_DRAG_BEGIN` cancels the pending click, so dragging never stages;
  - double-click still TAKEs on the second press.
  - Saving goes through `_commit_looks`, the rename/duplicate path: deck sync + autosave.
- Server `routes-scene-new-look.js` `mediaLookName(src)`: for a `media` source, the file name without folders and
  without an extension (`\.[A-Za-z0-9]{2,5}$`, so "Intro v1.2" keeps its ".2"). Other sources and "+" keep `Look N+1`.
- GUI e2e harness `e2e/e2e_ui.gd _move`: `Input.warp_mouse(p)`. Godot hands the drop handler the REAL pointer's
  position, not the pushed event's; on the hidden Xvfb display the real pointer sat at the centre. This was found
  while the reorder step failed, with the drop on the right card but "after" because the pointer read 660 px. The
  harness only ever runs on its own Xvfb display.

## What was VERIFIED

- Godot suite 21756 / 0:
  - `test_move_look_wo762`: 13 assertions (before, after, end, no-ops, refusals keep order);
  - `test_duplicate_look_wo656`: now asserts the copy is last.
- `--check` boot OK; `check-max-file-lines` 0 over (deck_view.gd 497).
- `smoke-wo623-new-look` 6 / 0. New case: `projects/show/KV LOOP.mp4` → "KV LOOP", Caspar id `CLIPS/A` → "A",
  `Intro v1.2` kept, a Windows path, a template → "" (Look N+1), null.
- GUI e2e on a sandbox (real client, synthetic mouse, `03_looks_layers`), new steps:
  - the dropped clip's look is named `e2e_bars`;
  - "+" then ⧉ on the first card stores `[e2e_bars, Look 2, e2e_bars (copy)]`;
  - dragging the last card onto the first card's left half stores the copy first;
  - dragging the first card onto "+" moves it last.
  - The full run (all scenarios, with the pointer warp): 32 / 32.
- Owner QA after a client relaunch and node restart.

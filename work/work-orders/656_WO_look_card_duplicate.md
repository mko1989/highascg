# WO-656 — Look card: duplicate button

**Area:** godot-client
**Status: DONE (2026-10-21, Godot tests 20734/0; box: click → "Look 1 (copy)" next to Look 1, 2 layers, in the autosave)**

Owner 21.10: "duplicate button on the look's card is missing".

## Investigation

- Web: `client/lib/scene-state.js duplicateScene` (deep copy of layers, mainScope, audioOnlyLook, defaultTransition;
  new id; name from `scene-state-look-logic.js uniqueLookNameForDuplicate`: "<name> (copy)", then "(copy N)").
  Godot's deck had no duplicate anywhere (`git log -S Duplicate` on features/live: none).
- Card corner already carries the WO-651 ✕ (thumb child, top-right).

## What was done

- `look_edits.gd`: `duplicate_look(root, id, new_id)` (deep copy, fresh id, inserted right after the original so it
  lands next to it on the deck — the web appends at the end) and `copy_name` (web naming rule).
- `deck_view.gd`: ⧉ button left of the ✕; owner follow-up 21.10 ("the duplicate and x should be right above the cog and
  play"): both moved off the thumbnail into the name row, right-aligned, so ⧉ ✕ sit directly over ▶ ⚙ (WO-651's ✕ moved with it) → `duplicate_look(id)` → `_commit_looks()` (deck sync + autosave, the rename
  path) + "Duplicated: …" status. Uuid from `layer_style_row.gd _uuid()` (crypto.randomUUID shape).
- `assets/ui/icons/copy.svg` (hand-drawn, README updated).
- `tests/test_look_edits.gd` `test_duplicate_look_wo656`.

## What was VERIFIED

- `--check` OK, `--test` 20734/0.
- Box: name row shows `Look 1  ⧉ ✕` over `… ▶ ⚙`; ⧉ on Look 1 → status "Duplicated: Look 1 (copy)", second card, autosave has `Look 1 (copy)` with 2 layers.
  The copy was left in godot_test for the owner to keep or delete.

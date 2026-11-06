# WO-971 — Looks deck: scroll position kept across every deck action

**Area:** godot-client
**Status: DONE (06.11.26 — verified on :0: PRV pick, duplicate, delete keep the column's scroll; Godot --test 26009/0; 500-line check OK)**

## Owner request
"doing anything in the looks deck resets the deck to the top."

## Investigation
- WO-905 gave each screen's looks column its own ScrollContainer (`deck_view.gd` `_column`). Every deck action
  (PRV pick / take -> scene.live broadcast, rename, reorder, add, delete, duplicate -> `_commit_looks()`) emits
  Store.project_changed / changed("scene...") -> `_dirty` -> `rebuild()`, which queue_free'd all columns and built new
  ScrollContainers at scroll 0. Root cause = the rebuild, not selection logic.

## What was done
- New `features/live/deck_scroll.gd`: `free_columns()` records each column's scroll_vertical by screen index (meta
  `deck_main`) before freeing; `setup()` configures the scroller and restores the offset for 3 frames after it enters
  the tree (ScrollContainer clamps to content size until layout). deck_view.gd: 3 lines swapped, still 500 lines.
- Not done: skipping the rebuild when nothing changed (restoring the offset makes it invisible).
- Test: `tests/test_deck_scroll.gd` (offsets keyed by screen index; scrollers keep horizontal scroll off).

## What was VERIFIED
- GUI relaunched on :0 (Live tab), Dioda column (19 looks) scrolled down: PRV click on "wss-logo-6s", duplicate
  (20 looks) and delete of that duplicate (19 again, project back to its original look set) all kept the scroll
  (clamped to the new max after delete). Screenshots in the scratchpad: wo971_b_scrolled.png, wo971_c_after_prv.png,
  wo971_d_after_duplicate.png, wo971_g_after_delete.png.
- Godot --test 26009 passed, 0 failed.
## Not verified
- Rename, reorder drag, take on PGM, look editor edit on glass (same rebuild path; not clicked). Multi-screen column
  (project has one screen with looks).

# WO-905 — Live deck: each screen's header bar stays visible while the deck scrolls

**Area:** godot-client
**Status: DONE (31.10.26 — owner's GUI relaunched: wheel-scrolled deck screenshot shows both headers (Dioda / Proj: title, TAKE, FTB, timers, Border) pinned at the top with the looks scrolling under them; Godot --test 25291/0, --check OK; smoke 2/2. Header-gap click (PRV clear) not clicked on the live box — it would clear the owner's PRV)**

## Owner request (31.10.26)
"the top bar of each screen destination in live tab should be always visible, disregard scrolling"

## 1. Investigation
- `features/live/deck_view.gd` IS the ScrollContainer; its content is one HBox of columns, each column a VBox: header
  (`deck_head.gd`: destination toggle with title + look count, TAKE, FTB, timers, Border) → screen timer → looks grid.
  Scrolling moved the headers out of view with the cards.
- A header moved by hand inside the column is re-laid out by the VBox; a `z_index` raise draws it above the cards but
  GUI picking follows tree order, so the cards under it would take its clicks. The header must be later in the tree.
- Header gaps are blank deck space: `deck_blank_clear.gd` (WO-342) clears PRV on a click that PASSes up to the column,
  and the column's drag forwarding makes a dropped source a new look (WO-623 B).
- `deck_view.gd` was 492 lines (limit 500).

## 2. What was done
- **`features/live/deck_sticky_heads.gd` (new)** — `mount()` puts a MarginContainer as the scroll content: the columns
  plus this overlay (mouse IGNORE) on top, both filling it. `slot(head, col, can_drop, drop)` moves the header onto an
  opaque panel (BG_DARK, the tab background, so cards under it are hidden) in the overlay and returns an empty slot of
  the header's height for the column; the panel re-emits its gui_input on the column (PRV clear keeps working) and
  forwards drops like the column; mouse PASS so the wheel still scrolls the deck. `follow(scroll_y)` each frame puts
  each panel over its slot at `max(slot y, scroll offset)`, slot width.
- **`deck_view.gd`** — mount, `_heads.clear()` on rebuild, `_heads.follow(scroll_vertical)` in `_process`, the column
  adds the slot instead of the header (496 lines).

## 3. What was VERIFIED
- Owner GUI (DP-4) relaunched; before: headers in place, layout unchanged. Wheel ×6 over the deck: both headers stay at
  the top of the deck, the looks scroll under them (screenshot); wheel back up, pointer restored.
- Godot `--test` 25291 passed / 0 failed; `--check` boot OK; `tools/smoke/smoke-wo905-live-deck-sticky-heads.test.js` 2/2.
- Owner-QA: a click on a header's blank gap still clears that screen's PRV; a source dropped on a header makes a look.

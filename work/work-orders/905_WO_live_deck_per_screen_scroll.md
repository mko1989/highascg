# WO-905 — Live deck: each screen's looks scroll on their own; its header bar always stays visible

**Area:** godot-client
**Status: DONE (31.10.26 — owner's GUI relaunched: wheel over the Dioda column scrolls only Dioda's looks, Proj stays, both headers (title, TAKE, FTB, timers, Border) stay put, one scrollbar per column (screenshots); Godot --test 25291/0, --check OK; smoke 3/3. Blank-space click (PRV clear) not clicked on the live box — it would clear the owner's PRV)**

## Owner requests (31.10.26)
1. "the top bar of each screen destination in live tab should be always visible, disregard scrolling"
2. (minutes later) "regarding the looks cards. scrolling needs to be per screen dest"

## 1. Investigation
- `features/live/deck_view.gd` IS the ScrollContainer; its content is one HBox of columns, each column a VBox: header
  (`deck_head.gd`: destination toggle with title + look count, TAKE, FTB, timers, Border) → screen timer → looks grid.
  The whole deck scrolled as one, so the headers left the view with the cards and every screen moved together.
- Header and column blank space are live: `deck_blank_clear.gd` (WO-342) clears PRV on a click that PASSes up to the
  column, and the column's drag forwarding makes a dropped source a new look (WO-623 B).

## 2. What was done
- First take (request 1 only, commit daaabbf1): headers in an overlay above the one deck scroll, pinned at the scroll
  offset (`deck_sticky_heads.gd`). Request 2 made it moot — with per-screen scrolling the header is simply outside the
  scrolling part — so it was removed again in the same WO (no overlay, no per-frame positioning).
- **`deck_view.gd`** — the deck scrolls only sideways (`vertical_scroll_mode` disabled); each column's grid sits in its
  own vertical ScrollContainer (expand-fill, no horizontal scroll) under the header and timer. The scroll PASSes
  clicks (BlankClear on the column still fires for blank space below the cards) and forwards drops like the column;
  the grid fills the scroll's width so the cards still wrap.

## 3. What was VERIFIED
- Owner GUI (DP-4) relaunched; screenshot: headers at the top, a scrollbar per column. Wheel ×6 over Dioda: Dioda's
  cards moved up (Intro / KV LOOP 2 at the top), Proj unchanged, headers unchanged; wheel back, pointer restored.
- Godot `--check` boot OK, `--test` 25291 passed / 0 failed; `tools/smoke/smoke-wo905-live-deck-per-screen-scroll.test.js` 3/3.
- `deck_view.gd` 500 lines (limit 500).
- Owner-QA: a click on blank space below a screen's cards still clears its PRV; a source dropped there makes a look.

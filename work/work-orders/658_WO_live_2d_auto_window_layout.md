# WO-658 — Live 2D Auto layout: a PGM + PRV window per screen, fitted to the panel

**Area:** godot-client
**Status: DONE (2026-10-21, Godot tests 20762/0; box: Auto tiled PGM 1 over PRV 1 into the visible preview, Times rows fit between)**

Owner 21.10: "when there are screen destinations they should be layed out on the compose preview they should also
auto shrink when the window is being made smaller." Clarified (question): "auto window per dest, but still ability to
move it around any way i like" and "pgm top its prv bottom always".

## Investigation

- Live 2D windows are the server's operator-GUI cells (`GET/POST /api/operator-gui/layout`, fractions of the 1920×1080
  operator canvas); `compose_tiles.gd` only ever drew what the operator had placed by hand, so a new screen got no
  window and a smaller panel just overflowed (WO-648 width-fill + wheel pan).
- The server routes `pgm` / `prv` cells by `mainIndex` (`src/system/operator-gui-channel-geometry.js:77-79`), so the
  client can add `pgm_N` / `prv_N` cells itself — no server change.
- Screens = `channelMap` mains (`DeckModel.screen_count`); a main without a preview bus gets PGM only
  (`DeckModel.preview_bus_available`); aspect from `programResolutions[main]`.

## What was done

- New `godot/client/features/live/compose_auto_layout.gd` (pure): `tile(mains, view, canvas, label)` — one column per
  screen, PGM row on top, PRV row below, each picture contain-fitted at the screen's aspect and centred, room under it
  for the label strip; `visible_view` (what the width-filled panel shows of the canvas); `apply` (moves / adds only
  pgm / prv cells, leaves live-source and multiview windows alone, reports change so there is no post loop).
- `compose_tiles.gd`: `auto` + `set_auto`; `_retile` posts the tiled set; re-tiles (0.25 s debounce) on resize,
  channelMap change, server layout updates and pan; reserves `TIMES_H` under each window while Times is on. A manual
  move / resize / ✕ remove turns Auto off (`auto_changed`) — the windows are then free again.
- `live_tab.gd`: **Auto** toggle next to 2D / Times (2D only), saved as `[live] auto` in ui.cfg, default on.
- New `godot/client/tests/test_compose_auto_layout.gd` (rows/columns, PGM-only screen, inside the view, shrinks with
  the view, visible-view maths, apply keeps others + no-change).

## What was VERIFIED

- `--check` OK; `--test` 20762 passed / 0 failed.
- Box: on launch Auto re-laid PGM 1 / PRV 1 (server layout now pgm_1 y 0.175, prv_1 y 0.510, same x / size), centred in
  the panel; with Times on the time rows sit between the windows.
- Owner QA: drag the Live / deck splitter smaller → windows shrink; move a window → Auto turns off; a second screen
  → second column.

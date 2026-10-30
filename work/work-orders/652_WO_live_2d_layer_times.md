# WO-652 — Live 2D: per-layer media / playlist times under each window (Times toggle)

**Area:** godot-client
**Status: DONE (2026-10-21; Godot 20706/0, box: Times on → "L10 BAZA 2 0:17 / 0:20 (−0:02)" under the PGM label, "L10 BAZA 2" under PRV). Owner QA: a multi-layer look and a playlist layer.**

Owner, 21.10:
- *"there was an additional overlay on the compose preview in kiosk with times on each layer with the top layer
  biggest. in 2d view, toggle button."*
- *"you dont have to investigate, just make an additional text on transparent with times of media/playlist on each
  layer"*
- *"under the label not on the screen"*

## Investigation

- A read-only search of the tree and git history found no kiosk-only version. The kiosk compose tiles showed one
  top-layer timer per window (`client/components/operator-compose-tiles-tile-controller.js:293-375`). The per-layer
  rows with the top layer highlighted are the multiview overlay's "Layer timers stack"
  (`template/multiview_overlay.js:267-375`, WO-195 / WO-203 `highlightTopTimer`). That is the model ported here.
- The Godot client already mirrors the OSC per-layer file times (`osc_mirror.gd`, WO-600 O) and has the PGM timer
  rules (`pgm_timer_model.gd`: bank resolution, stale layers, mm:ss, traffic-light tiers).
- Box findings while building:
  - In atlas mode (WO-597 §D) each window's picture is a child TextureRect of `compose_tiles.gd`. Children paint over
    the parent's `_draw`, so text drawn there was hidden under the pictures. The times now draw on their own child
    (`_over`, z_index 1).
  - `DeckModel.resolve_bus_look_ids` blanks PRV when it holds the same look as PGM (a deck rule). For the times, PRV
    reads its own channel's `scene.live` entry first.

## What was done

- `features/live/compose_times_model.gd` (pure):
  - `rows(look, channel, bank, is_pgm, now)`: one row per sourced layer, top layer first. It skips the
    playback_timers and PIP-decoration templates. A PGM layer on bank b reads +100; PRV is bank-less. Stale OSC
    counts as not running. The label is the playing file (so a playlist layer shows its current item) or the source
    label. `top` = the topmost running layer.
  - `time_text` gives "0:37 / 1:00  (−0:23)"; `progress`, `remaining`.
- `compose_tiles.gd`: with `times` on, under each PGM / PRV label strip, as text on the transparent preview (black
  outline, no box):
  - the top running layer at 20 px, the others at 12 px;
  - running rows coloured by time left (green / orange / red, as the PGM timer) with a thin progress bar;
  - rows stop at the preview's bottom edge.
- `live_tab.gd`:
  - a **Times** toggle next to 2D, shown in 2D only, remembered in ui.cfg `[live] times`;
  - the OSC mirror's `updated` redraws the windows while Times is on.

## What was VERIFIED

- Godot `--test` 20706 passed, 0 failed. `test_compose_times_model.gd` covers:
  - row order (top first), the big row = the top running layer, and the skipped templates;
  - labels for live and media sources, the time text and progress;
  - PGM bank b vs bank-less PRV;
  - stale OSC.
- `--check` boot OK.
- Box (21.10, DP-0, Look 1 on PGM and PRV):
  - Times on → under the PGM label "L10  BAZA 2   0:17 / 0:20  (−0:02)" big, red near the end, with the bar.
  - Under the PRV label: "L10  BAZA 2" without time. Channel 2's OSC carried no running file time for the layer
    then, so it shows as not running.
  - ui.cfg `times=true`, and the toggle survives a relaunch.
- Not seen: a look with several layers (only Look 1 exists, one layer), and a playlist layer.

# WO-671 — Live 2D: compose windows stop following the panel (a plain click turned Auto off)

**Status: DONE (22.10, box-verified by an in-client probe; owner QA = checklist 22.10 §G)**

Owner, `next.md` 22.10: *"the windows in standard compose preview do not resize when the whole preview window is
resized."* Then: *"they do resize when auto is clicked."*

## Investigation

- The re-tiling on resize works as WO-658 built it. `compose_tiles.gd` `resized` → `_retile_soon()` (0.25 s debounce)
  → `_retile()`. It only runs while `auto` is on.
- On the box, `ui.cfg [live] auto=false`. Auto was OFF, which is why "clicking Auto" fixed it.
- **Root cause, `compose_tiles.gd` `_gui_input`:**
  - Any left press on a window starts a `_drag`.
  - On release, any non-empty `_drag` called `_manual()` (Auto off, saved to `ui.cfg`) and `_post()`, even when the
    mouse never moved.
  - So a plain click on a PGM/PRV window, e.g. to focus or select it, silently turned Auto off. From then on, resizing
    did nothing.
- WO-658's resize item was owner-QA only; it had never been checked on the box.

## What was done

- `godot/client/features/live/compose_tiles.gd`:
  - A drag only counts once the mouse has moved `DRAG_SLOP_PX` (4 px) from the press (`_drag.moved`).
  - On release, `_manual()` + `_post()` run only when it moved. A plain click changes nothing.
- On the box, `ui.cfg` `auto` was set back to `true` and the main GUI relaunched, so the operator layout is Auto-tiled
  again.

## What was VERIFIED

- Godot `--test` 20847/0, `--check` boot OK.
- Box, with a temporary `--probe-tile-click` in `main.gd` (not committed) in a second windowed client:
  - after a press + release on `pgm_1` with no motion: `auto=true`;
  - shrinking the Live/deck split: the window rect re-tiled (409,14 364×121 → 580,6 23×8);
  - a 30 px drag: `auto=false`, as WO-658 intends.
- **Side effect, repaired:** the probe client's Auto re-tile posted its own layout to the server, which replaced the
  owner's PGM/PRV layout. The main GUI was relaunched with Auto on; the layout is now pgm_1 / prv_1 at x 0.346,
  w 0.308 (the old one was about 0.32 / 0.31).
  - **Note for later:** two clients with Auto on both re-tile ONE server layout to their own panel sizes. This matters
    once remote GUIs exist (WO-670).
- Owner QA: with Auto on, click a window, then drag the Live/deck splitter. The windows follow.

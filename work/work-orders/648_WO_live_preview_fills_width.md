# WO-648 — Live "Standard" preview fills the width; the 16:9 canvas overflows top / bottom

**Area:** godot-client
**Status: DONE (2026-10-21; Godot 20696/0, box: full-width preview on DP-0, the wheel scrolls the overflow both ways). Owner QA: moving / resizing windows and a dropped Live source on the width-filled canvas.**

Owner, 21.10: *"standard live compose preview. i get that its a 16:9 source but it can be displayed from left to
right of the space instead of being held to height limit. it cant be stratched, just made to over flow the top and
bottom to fill the width. the windows inside are "free" set either way"*

Related: [WO-621](./621_WO_godot_owner_notes_live_looks_previs.md) N1 (the window outlines / move / resize over this
preview), [WO-597](597_WO_server_video_surfaces_shm_and_atlas.md) §D (atlas crops).

## Investigation

- The preview area is wider than 16:9: the Live tab is a VSplitContainer, preview on top, deck below. On the box
  (DP-0, 21.10 screenshot) the area is about 1176 × 460 px. A contain-fit gives the canvas only ~820 px of that width,
  with `OUTSIDE` bars left and right.
- Two places carry the same contain-fit and must move together:
  - `features/live/live_tab.gd:49-50`: the operator surface TextureRect, `EXPAND_IGNORE_SIZE` +
    `STRETCH_KEEP_ASPECT_CENTERED` over the full rect.
  - `features/live/compose_tiles.gd:139` `image_rect()`: `min(w / cw, h / ch)`. It is the one mapping every window
    outline, label, hit test, drag delta, drop point and atlas crop (`_screen`, `_drop_data`, `_gui_input`) goes
    through.
- A stock `STRETCH_KEEP_ASPECT_COVERED` is not the ask: in an area narrower than 16:9 it fills the height and crops the
  sides. The ask is width first, always.
- Nothing clips the stack today (`live_tab.gd:43`, a plain Control), so an overflowing picture would paint over the
  deck below.
- Windows are free on the canvas (fractions of the operator canvas, moved by drag). Overflow can hide a window near the
  top or bottom edge, so the overflow must stay reachable.

## What was done

- `compose_tile_math.gd`:
  - `width_fit(area, canvas, pan)`: the canvas at the area's full width, aspect kept, centred, shifted by `pan`
    (clamped to the overflow);
  - `pan_limit(area, canvas)`: half the overflow.
  - In an area taller than 16:9 it still fills the width; the canvas then sits centred between the bars.
- `compose_tiles.gd`:
  - `image_rect()` = `width_fit(size, canvas(), pan)`. Outlines, labels, hits, drags, drops and atlas crops all
    follow, because they all go through it.
  - `pan_by` / `wheel`: a wheel step pans 40 px.
  - The flash message stays inside the visible area.
- `live_tab.gd`:
  - the stack clips (the overflow no longer paints over the deck);
  - the picture is `STRETCH_SCALE`, placed on `tiles.image_rect()` each frame;
  - a wheel that misses the windows also pans (the tiles only take input over a window, WO-621 N1).
- Why a wheel pan rather than only cropping: windows are free on the canvas, and a crop with no way to reach it would
  hide any window near the top or bottom.

## What was VERIFIED

- Godot `--test` 20696 passed, 0 failed. `test_live_compose_tiles.gd::test_preview_fills_the_width_and_pans_the_overflow`
  covers:
  - 1176×460 → full width at 661.5 high, centred;
  - pan limit 100.75;
  - pans clamp at the canvas top and bottom;
  - a tall area: full width, no pan;
  - no bars beside an overflowing canvas.
- `--check` boot OK.
- Box (21.10, 20:43, DP-0):
  - The Live Standard preview runs edge to edge (x 301–1498). The PGM window's top runs off the top edge.
  - 4 wheel-ups over the empty canvas: the canvas top is in view with PGM's full outline.
  - 8 wheel-downs: the bottom part, PRV in view.

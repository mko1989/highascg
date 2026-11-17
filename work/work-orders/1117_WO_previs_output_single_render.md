# WO-1117 — Previs output on: the stage is rendered once (the tab shows the output's picture)

**Area:** godot-client, video-io
**Status: DONE (17.11.26 — on the box: ring 24–25 of 25 fps with the Previs tab open, was 21; client 24–31 fps, was 19)**

Owner 17.11: "we need to render the scene only once when wanted to be recorded. it cant keep up". Follows
[WO-1108](./1108_WO_previs_view_as_live_source.md), [WO-1116](./1116_WO_previs_output_half_rate.md).

## Investigation

- With "Send as a source" on and the Previs tab shown, two viewports drew the 252-head stage every frame: the tab's
  `_sv` (previs_tab.gd) and the output's own (output/previs_output.gd). `GET /api/health/keeping-up`: client 19 / 50
  fps, `shm://previs` 21 / 25 fps (Quality Ultra, previs following the desk).

## What was done

- `previs_tab.gd` _apply_mode: while the output feeds (meta `previs_output`), the tab's viewport is UPDATE_DISABLED.
- `camera/previs_cinema.gd`: a mirror (black ColorRect + TextureRect of the output viewport, keep-aspect, mouse
  ignored) laid over the 3D view while the ring runs; the input still reaches the view underneath, so "My view"
  follows the operator's camera. The picture is the clean output (no selection marks / helpers), letterboxed to 16:9;
  with a slider move as the output camera the tab shows that move.

## What was verified

- Unit suite 30098 passed, 0 failed; `--check` boot OK; line limit OK.
- Box, client relaunched, output on PGM 2 (ch 4, 1080p25): Previs tab hidden → client 31 fps, ring 25 / 25; Previs tab
  open → client 24–25, ring 24–25 / 25; screenshot shows the output picture in the tab.

## Not verified

- Clicking fixtures in the mirrored view: the picture is 16:9 while the pick uses the tab's own aspect — positions
  off toward the edges. Not tried.
- Why the client is slower with the tab open than hidden although one viewport renders (GPU 14.6 ms shown).
- Take onto a channel that Caspar does not have yet (new destination before Apply) fails only after the 15 s batch
  timeout with no reason shown — seen today on PGM 2; not changed here.

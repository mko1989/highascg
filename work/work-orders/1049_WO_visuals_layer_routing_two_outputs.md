# WO-1049 — Visuals: route layers to two outputs (PGM 1 background, PGM 2 keyed overlay), set from a Live tab expander

**Area:** godot-client, engine
**Status: OPEN (12.11 — investigated + designed; build delegated, lead verifies)**

Owner, 12.11: *"i also want to be able to select from live tab, with a expand, visuals layers routing, so i can play for
instance first 2 layers on the bg output pgm1 and layers 4 5 on overlay channel pgm2."*

## Investigation

- Screens on this box (`config/screen_destinations.json`): main 0 = `PGM/PRV 1` (3072×1024, Dioda), main 1 = `PGM 2`
  (pgm_only, 3072×1024). PGM 2 is the overlay: one destination on two jacks, fill + key-only, into the PixelHue (WO-1034).
- The Visuals pipeline (Godot, `godot/client/features/visuals/`):
  - `visuals_deck.gd` — one deck = the layer stack. Each layer renders in its own SubViewport with `transparent_bg = true`
    (`_slot`, :188). `out` (2D SubViewport) draws them bottom → top with premultiplied alpha over `_back`, a black
    ColorRect (:50) carrying the base layer's tint and flash (WO-945 `_backdrop`).
  - `visuals_mixer.gd` — two decks (A/B, WO-877 / WO-908), the crossfader `x` and the master/blackout mixed into
    **one** `out_vp`.
  - `visuals_tab.gd` — `publisher.start(out_vp, ring_name, fps)` (`features/shm_out/viewport_publisher.gd`, RGB already
    premultiplied by alpha) writes `/dev/shm/highascg-visuals`. Send then `POST /api/play M.play_body(ch, output.layer,
    ring)` = `PLAY ch-layer SHM NAME visuals` on the program channel of `output.screen`. `visuals_air.gd` replays it
    after a Caspar restart (WO-914) and ends it on a New project (WO-919).
  - The model (`visuals_model.gd` :146): `project.visuals.output = {screen, layer, size, ring}`, one output. Layers are
    `visuals_layers.gd` dicts (`L.key`, `from_payload`, `MAX` = 8).
- So everything composites into one picture on one channel. Routing needs a second composite of only the routed
  layers, **transparent** (no black back, no tint/flash), published as a second ring and played on the overlay channel.

## Design (the contract)

- **Per layer:** `out` = 1 | 2 (default 1; absent = 1, so existing shows are unchanged), stored in the layer dict, so
  it rides looks and A/B banks like any other layer field. `L.key` must NOT include `out`: re-routing must not restart
  a running scene. Moving a layer between outputs re-parents its draw rect only.
- **Deck:** a second composite `out2` (SubViewport, `transparent_bg = true`, same size, no `_back`). Out-2 layers draw
  there in stack order; out-1 layers stay in `out` over the black back. A layer renders once (its own viewport) whatever
  its route. The base-layer tint/flash stays an out-1 thing.
- **Mixer:** `out_vp2` mixes both decks' `out2` with the same crossfader `x`, `master` and blackout as `out_vp`
  (premultiplied; blackout = transparent on out 2, not black).
- **Model:** `project.visuals.output2 = {screen, layer}` (defaults: screen 1 when a second main exists, else 0; the
  same layer number as `output`). Ring name `visuals-2` (dev `--visuals-ring=<n>` → `<n>-2`).
- **Send:** while any layer is routed to 2 and Send is on, a second publisher writes `out_vp2` to `visuals-2`, and
  `POST /api/play` plays it on `output2`'s program channel/layer. When no layer uses out 2, that publisher stops and
  the PLAY is cleared (STOP/CLEAR of that layer only). `visuals_air.gd` replay and the WO-919 end cover both.
  A GPU cost note: one more readback at the canvas size only while out 2 is used.
- **Live tab expander** (`godot/client/features/live/`): a collapsed "Visuals routing" section in the Live tab. Rows =
  the layers of the bank on air (name + `PGM 1 | PGM 2` toggle), plus each output's target (screen picker + Caspar
  layer). Changes go through the Visuals tab's own edit path, so autosave, undo, MIDI and the Visuals tab see them.
  Minimal (RULES.md; minimalism is the standing UI principle). The Visuals tab's layer list shows a small `2` badge on
  out-2 layers.
- 500-line limit: `visuals_tab.gd` is at 495, `visuals_midi.gd` at 488 — new code goes in new files
  (e.g. `visuals_route.gd` for the out-2 publisher/PLAY, `live/visuals_routing_panel.gd`).

## What was done

(builder fills in)

## What was verified

(builder fills in; the lead re-runs. No sandbox Godot/Caspar on this box: tests + `run-client.sh --check`; the live
check happens on the owner's GUI after a relaunch.)

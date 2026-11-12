# WO-1049 — Visuals: route layers to two outputs (PGM 1 background, PGM 2 keyed overlay), set from a Live tab expander

**Area:** godot-client, engine
**Status: IN PROGRESS (12.11 — built; offline suite + compile boot green; on-air check pending)**

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

Built to the design; deviations are marked **Deviation**.

- `godot/client/features/visuals/visuals_layers.gd` — `out` per layer, stored **only when 2** (absent = 1): an older show,
  its looks and every existing exact-dict test are byte-identical. `out_of(l)` (junk → 1), `routed(layers, i, out)`
  (a copy; 1 erases the field), `uses_out2(layers)`. `from_payload(payload, keep)` keeps `keep`'s route, so a replaced
  picture (a drop on a layer, a MIDI clip launch, a game ROM change) stays on its output. `key()` unchanged — no `out`.
- `visuals_model.gd` — `slice_of` adds `output2 = output2_of(stored, output.layer)` = `{screen (default 1), layer (default
  output 1's)}`; `ring2(ring)` = `<ring>-2` (`visuals-2`, dev `--visuals-ring=<n>` → `<n>-2`); `output2_target(cm, slice)`
  → `{channel, layer}` through `screens(cm)` (the same list Send's picker uses, so WO-1029 holes are skipped). The design's
  "screen 1 when a second main exists, else 0" is resolved here, not stored: a screen index past the list → the first
  screen. **Deviation (guard):** when output 2 resolves to output 1's channel AND layer (one main, both defaults), it goes one
  layer up — the same channel/layer would make the second PLAY replace the first.
- `visuals_deck.gd` — `out2` SubViewport (`transparent_bg`, no `_back`, same size). `_slot` / `apply` put each layer's draw
  rect into `out` or `out2` by `out_of` (`_route`: re-parent only, the slot/stage/viewport are reused because `L.key` has no
  route — no restart, no fade). `_order` orders each composite separately (out: after the backdrop; out2: from 0), leaving
  layers at their old place in the composite they were drawn in. The base (tint + flash, a game's keyed mode) is now the
  **bottom output-1 layer** (`_base()`), so an output-2 layer is never tinted and output 1's backdrop never takes an
  overlay layer's tint. `out2` renders `UPDATE_ALWAYS` while something draws there, else `UPDATE_ONCE` (one transparent frame
  after the last layer leaves, then asleep — no stale picture, no GPU cost when unused). `uses_out2()`.
- `visuals_mixer.gd` — `out_vp2` (transparent) mixing both decks' `out2` with `MIX2`: `render_mode blend_premul_alpha`,
  `mix(a, b, x) * master` on the whole premultiplied vec4 (blackout / master 0 = transparent, not black); the strobe whitens
  what is there keeping its coverage (`rgb → mix(rgb, vec3(alpha), strobe)`), so it never fills the overlay with white.
  `x`, `master`, `strobe` go to both materials (`_param`). `out_vp2` renders only while a deck uses out 2 (`_out2()`, called
  from `_apply` and every `step`), and `signal out2_changed(on)` fires when that flips — the route listens.
- `visuals_route.gd` (NEW, 175 lines; `visuals_tab.gd` was at 495) — a Node under the tab owning the second
  `viewport_publisher.gd`. `want()` = the tab is sending AND the mixer draws into out 2 (deck state, so a removed out-2
  layer finishes its fade before output 2 stops). `plan(want, on_air, target, publishing)` (pure) → `start | move | stop | ""`;
  `sync()` (re-entrancy safe: a call during a running one re-runs once) starts the publisher on `mixer.out_vp2` → ring
  `visuals-2` at output 2's screen fps, then `POST /api/play M.play_body(ch, layer, "visuals-2")`; `move` = STOP old + PLAY
  new (ring stays open); `stop` = `POST /api/stop` of output 2's layer only + publisher closed. A failed PLAY closes the ring
  and leaves the reason in `note`. `replay()` (WO-914) and `end()` (WO-919: no STOP, the channels belong to the new show).
  Edit API for the Live expander: `air_layers()` (the bank on the canvas: `slice.layers`, or `slice.dj.other.layers` when
  A/B has the other bank on air), `set_layer_out(i, out)` — the edited bank goes through the Visuals page's own
  `layers_changed` path (`M.with_layers`, `_go(false)` in place, `_store()` → autosave/undo, `page.set_state`); the other A/B
  bank is written to `slice.dj.other` and re-applied with `dj._load_other()` exactly as visuals_dj.gd does — and
  `set_output(n, screen, layer)`: output 1 via the page's `output_changed` path (like its Screen/Layer pickers: a running Send
  stays where it is until sent again — existing behaviour kept), output 2 stored in `slice.output2` and moved at once if on
  air. **Deviation:** the "screen → program channel" mapping uses `M.screens(cm)` indices (what Send already uses), not raw
  `programChannels` indices; identical on this box (no holes).
- `visuals_tab.gd` (+4 lines → 499) — preload, `var route`, `route = Route.new(self)` after the publisher, and
  `route.sync()` at the end of `_sync_send_ui` (called on Send on/off, project load/undo, ring toggle, show cleared), so
  output 2 follows Send, a reloaded slice's routes and target, and the client's on-air resume (WO-880).
- `visuals_air.gd` — `caspar_link` also `await tab.route.replay()`; `show_cleared` calls `tab.route.end()` BEFORE
  `_sync_send_ui` (else its `route.sync()` would STOP a channel of the new show).
- `visuals_layer_list.gd` — a small accent `2` label in each row, visible on out-2 layers (tooltip points to Live ▸ Visuals
  routing). The row shape key is still `L.key`, so a re-route only refreshes, never rebuilds under a dragged fader.
- `features/live/visuals_routing_panel.gd` (NEW) — the collapsed "▸ Visuals routing" header (shows "· N layers on PGM 2"
  when any); expanded: `PGM 1` / `PGM 2` rows with a screen picker (`M.screens`) + Caspar layer SpinBox (RULES.md input
  rules via the global numeric_field), one row per layer of the bank on air, top first, with a `PGM 1 | PGM 2` ButtonGroup,
  and a one-line note (Send off → "routes apply when sent"; on air → `PGM 1 → ch a-b · PGM 2 → ch c-d (shm://visuals-2)`; or
  the route's error). It finds the tab by its existing group `visuals_canvas`, edits only through `tab.route`, and re-reads
  every 0.5 s while expanded and visible (rows rebuilt only when a signature of stack/routes/targets/state changes).
- `features/live/live_tab.gd` (+4) — the panel under the default-transition bar; hidden with the bar while the look editor
  or Shader Live is open.
- Not changed: the Visuals page's Output section (`visuals_page.gd` belongs to WO-1050's builder) — output 2's target is set
  in the Live expander only. No server change: `/api/play` already plays any `shm://<name>` (amcp-basic.js `_isComplexClip`)
  and `/api/stop` exists. Side effect: while on air, `visuals-2` is listed in Sources ▸ Live like any ring
  (routes-shm-sources.js lists every live writer that is not Caspar).
- Known limits: a `blend: add` layer on output 2 adds light with little alpha (correct premultiplied, but a fill+key
  receiver keys it mostly out); output 2 is rendered at output 1's canvas size (both mains are 3072×1024 here; Caspar
  scales otherwise).

## What was verified

Offline only (no sandbox Godot/Caspar on this box):

- New `godot/client/tests/test_visuals_routing_wo1049.gd` — 8 tests, 76 assertion calls: model defaults/back-compat (no
  `out` stored for 1, junk → 1, key ignores the route, `routed`, a replaced picture keeps its route, looks keep it,
  `output2` defaults / clamps, ring names); target through the channel map (second main's channel, one-main guard → layer
  + 1, no screens → 0, WO-1029 hole skipped); deck (out-2 layers in `out2` in stack order, out-1 over the backdrop,
  re-route keeps the same stage + viewport with no fade, base/tint = output 1's bottom layer, `out2` ALWAYS/ONCE); mixer
  (`out_vp2` transparent, premultiplied shader, decks' out2 textures, size, master 0.5, blackout 0 on both, crossfader,
  `out2_changed` on/off); route `plan()` table; route against a stub tab + fake API + fake publisher (no PLAY while Send off
  or nothing routed; route a layer → PLAY `shm://visuals-2` on ch 3 layer 20, publisher on `out_vp2` at 25 fps; new target →
  STOP old + PLAY new, ring kept; replay; Send off → STOP of that layer only + ring closed; no layer on 2 → stopped; failed
  PLAY → note + ring closed; `end()` posts nothing); the Live expander on a real Visuals tab (rows top-first, PGM 2 click →
  the tab's slice + the page's layer list get `out: 2`, the same running scene now in `out2`, the mixer knows, header +
  `2` badge; back to PGM 1; output 1/2 targets stored); A/B with the other bank on air (that bank is routed, not PRV, in
  place on its deck).
- Full suite: `GODOT=~/.local/opt/godot/godot godot/client/run-client.sh --test` → `[tests] 28229 passed, 0 failed`.
  (Note: `HIGHASCG_TEST_ONLY=test_visuals…` subsets fail every tab-building test with "Identifier not found: Config" — that
  is pre-existing, `visuals_tab.gd:76` at HEAD; only the full run resolves the autoload. Use the full run.)
- Compile boot: `run-client.sh --check` → `[check] boot OK (no script errors)` (builds the Live tab with the panel).
- `node tools/ci/check-max-file-lines.js` → `Files over 500 lines: 0`. Smokes that grep the touched files
  (wo908, wo919, wo781, wo710, wo789) → 25/25 pass.
- **Still open: the on-air check on the owner's GUI** (after a relaunch): Send on, route layers 4–5 to PGM 2 in Live ▸
  Visuals routing → `PLAY <pgm2 ch>-<layer> SHM NAME visuals-2` lands, PGM 2 shows only those layers keyed (transparent
  around them, fill + key into the PixelHue), PGM 1 keeps the rest; the moved layers do not restart; back to PGM 1 stops
  the second ring and layer; blackout/master on both; a Caspar restart replays both.

## Follow-up 13.11 — Live source mode

After a GUI relaunch the owner said they did not see the options. Their screenshot showed the Visuals in **Live source** mode
(`shm://visuals` on a look, "Send to screen" off). The first build only put output 2 on air with Send, so routing did
nothing for them.

- `visuals_route.gd`: new `want_ring()` / `live_source()`. The `visuals-2` ring is published while a layer is on PGM 2 and
  the canvas is on air **or a Live source**. The ring then shows in Sources ▸ Live, ready for a look on the overlay screen.
  The route only PLAYs it when Send is on.
  When the last PGM 2 layer leaves and nothing was PLAYed, the ring keeps writing transparent frames for `drain_s`
  (1 s) before it stops, because Caspar's shm producer holds the last frame (`shm_producer.cpp` header).
- `visuals_routing_panel.gd`: the note names `shm://visuals-2` in Live source mode.
- Test `test_route_live_source_publishes_without_play`, plus a panel note check. Godot suite 28236 / 0, compile boot OK.

# WO-1050 — APC40 fader → a PixelHue layer's opacity (Learn onto a PixelHue layer)

**Area:** mapping, godot-client
**Status: OPEN (12.11 — investigated + designed; build delegated, lead verifies)**

Owner, 12.11: *"it would be great if i could route fader 3 to opacity of pixelhue layer, so i can control the layer from
the controller."*

## Investigation

- MIDI on the box is the Godot client's (`godot/client/features/visuals/visuals_midi.gd`, WO-900): bindings
  `{kind, ch, num, target}` in `ui.cfg [midi] map` (`features/midi/midi_map.gd`). Learn = move a control, then click
  the slider/button it should drive (`_captured` :290 → the click picks a target by `control_of`). Range targets go
  through `_move` (fader soft takeover, `midi_pickup.gd`). Today fader 3 (CC 7, ch 2) → `layer:3` (Visuals layer 3
  opacity).
- PixelHue in HighAsCG: the reader `src/pixelhue/pixelhue-read.js` (`createPixelhueReader(host)`: `read()` = screens
  with layers incl. `layerId`, `name`, `scene` pgm/pvw, `opacity` 0–100; `put(path, body)` = the one write,
  `PUT /unico/v1/<path>` with the device token) and `src/api/routes-pixelhue.js` (`/api/pixelhue/config`,
  `/api/pixelhue/layers`, `/api/pixelhue/sources`). The Live tab lists the switcher's layers
  (`godot/client/features/live/pixelhue_layers_list.gd`, WO-1035/1042; on this box the P80 at .254).
- Opacity write, from the owner's PixelHue Studio (vendored, `src/pixelhue/vendor/pixelhue-studio/lib/layer-effects.js`
  :65, :169): `PUT /unico/v1/layers/opacity` with body `[{ layerId, opacity: 0..100 }]`, the same array form as the
  `layers/source` and `layers/window` writes `pixelhue-look-drive.js` already sends. Studio 1.6 calls its
  layer-effects writes "not yet run against hardware", so this one must be proven on the P80.
- A fader sends up to ~100 CC/s; the switcher must not get one HTTP PUT per CC.

## Design (the contract)

- **Server:** `POST /api/pixelhue/layer-opacity {layerId, opacity}` (0–100, integer) → `reader.put('/unico/v1/layers/opacity',
  [{layerId, opacity}])`. Coalesced per layer: at most one PUT in flight per layer, and while one is in flight only the
  newest value is kept and sent next (latest wins). Never queue a backlog. Respond at once (`{ok, queued}`); errors are
  logged and reported on the next call / a status read. Mind the router order (`highascg-router-order-wildcards`) and
  raw JSON bodies (`route-handlers-get-raw-json-body`). Curl it on the box.
- **Godot target** `pxl:<layerId>` (a Range target, label "PixelHue <layer name> opacity"):
  - the controls: a compact "PixelHue" block on the Visuals Inspector page (where Learn clicks land), one opacity slider
    per layer on the switcher's **PGM** screens (names from `/api/pixelhue/layers`), shown only when a PixelHue is
    configured;
  - a slider moved (by hand or MIDI) posts the opacity, throttled client-side too (~20 Hz);
  - the slider follows the switcher's value when the layer list refreshes and nobody is moving it;
  - Learn: move fader 3, click a PixelHue slider → the binding `CC 7 ch 2 → pxl:<id>` replaces `layer:3`, saved in
    ui.cfg like any binding; soft takeover as a normal fader. Unmap works too.
  - `visuals_midi.gd` is at 488/500 lines: put the target's control lookup / label in a new small file.
  - The virtual controller (WO-946) shows fader 3 as "PH <name>".
- RULES.md for any input field. Minimal UI.

## What was done

(builder fills in)

## What was verified

(builder fills in; the lead re-runs. Live write on the P80: a layer's opacity changed and read back, then restored —
owner present, box in dev mode.)

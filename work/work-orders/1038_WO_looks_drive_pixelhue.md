# WO-1038 — Looks drive the PixelHue switcher (side feature, off by default)
**Area:** mapping, engine, godot-client
**Status: DONE (11.11 — box: real P20, geometry nudge and source routing read back and restored; take hook by tests only; 0e9e97b0)**

Owner, 11.11: *"Do it as a side thing that can be easily removed if it becomes problematic. Based on my other app. Add
programming of pixelhue layers along side the CasparCG layers and saving that as looks that will drive both highascg
and Pixelhue."* — then: *"Find on my GitHub pixelhue studio and base on that."*

## Investigation

- github.com/mko1989/pixelhue-studio 1.6.0-alpha.2, `lib/studio-programming.js` + `lib/program-geometry.js`: writes are
  `layers/window` `[{layerId, window}]` (global coordinates = local + screen origin), `layers/source` between
  `layers/aspect-ratio` calls, each followed by a read-back; editable layer types 2, 4, 32 and 256 (Cut & Fill fill);
  limits side 64–131070, position ±500000; `pgmEdit 0` = PGM locked.
- A stored look reaches the take through `routes-scene-take-look.js` (`resolveLiveSceneById`), with every layer key the
  client sent; the take payload itself rebuilds sources and drops unknown keys.

## What was done

- A layer dropped from the PixelHue list keeps `layer.pixelhue = {layerId, screenId, name, drive, source?}`.
- `src/pixelhue/pixelhue-look-drive.js`: on a PROGRAM take, each linked placeholder's rectangle (and, when one is
  picked, its source) is written to its switcher layer in Studio's order, then read back; only what differs is sent;
  nothing fails the take. One hook line in `routes-scene-take-look.js`.
- Off unless Devices ▸ PixelHue ▸ "Looks drive the switcher" is ticked (a new address starts off); per-layer tick and
  "PixelHue source" drop-down in the layer inspector; `GET /api/pixelhue/sources`.
- Difference from Studio, on purpose: after routing a source the layer stays on a custom aspect ratio (the look's
  rectangle has to hold for the border).

## Verified

- `tools/smoke/smoke-wo1038-pixelhue-look-drive.test.js` (11), `smoke-wo1035-…` (5), Godot `test_pixelhue_match.gd`.
- Box, real switcher: Layer 3 moved 4 px, read back, restored; routed Input 9 → Input 8 → back, source and rectangle
  read back; original aspect lock restored.
- Not verified: a take from the GUI with the switch on. Not built: Take / Cut on the switcher with the look's
  transition time (the layer jumps), z-order, presets.

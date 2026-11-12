# WO-1050 — APC40 fader → a PixelHue layer's opacity (Learn onto a PixelHue layer)

**Area:** mapping, godot-client
**Status: IN PROGRESS (12.11 — built; route proven on the P80 (write, readback, restore), Godot target + Learn covered offline; owner hardware check pending)**

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

**Server**
- `src/pixelhue/pixelhue-opacity.js` (new): `createOpacityWriter(put)` — per layer one slot `{busy, next}`: a value for an
  idle layer goes out at once; while a PUT is in flight only the newest value is kept and sent next (latest wins, never a
  backlog), so a fader burst of any length costs the switcher at most 2 PUTs and the layer ends where the fader stopped.
  Layers are independent. A refused PUT is logged (`[pixelhue] layer … opacity …`) and returned as `error` on the next
  call for that layer; it never stalls the slot. Its own file (not in the reader) because the reader stays the transport
  and the route stays thin.
- `src/api/routes-pixelhue.js`: `POST /api/pixelhue/layer-opacity {layerId, opacity}` → `handleLayerOpacity`: raw body
  through `parseBody`; `layerId` a non-negative safe integer, `opacity` a number 0..100 (rounded) — else 400; no address
  set → 409; otherwise the writer of the current reader (`WeakMap` reader → writer, so a new address gets fresh slots)
  and an immediate `{ok, queued, sent, error}`. The body is the vendored Studio's `[{layerId, opacity}]` array form.
  Not gated on the `drive` flag: that flag is "looks move the switcher on a take" (WO-1038); this write is an explicit
  operator action on one layer. No wildcard earlier in the router covers `/api/pixelhue/layer-opacity`
  (`/api/pixelhue/studio/*` is the only earlier pixelhue wildcard); curled on the box.
- `docs/wiki/api/contract/http.md`: regenerated (`node tools/dev/gen-api-contract.js`, +1 route; the wo598 contract smoke
  checks it).

**Godot client**
- `features/visuals/visuals_pixelhue.gd` (new): the Inspector page's "PixelHue" block. One row per layer (name · 0–100
  slider · "N %") for the layers of GET `/api/pixelhue/layers?scene=pgm` that are on an enabled screen, enabled, and not
  `bkg` / `mvr` / `aux` / `cut` (`layers_of`). Why that filter: the P80 refuses an opacity on a bkg and on an mvr layer
  (code 8210, measured below); a cut layer follows its fill; AUX outputs mirror. On this box that is Screen 1's
  "Layer 1" and "Layer 2". A kept layer keeps its slider object across refreshes (its MIDI pickup and ghost stay).
  A move (hand drag, MIDI, virtual controller) → `queue` → `flush`: at most one post per `THROTTLE_MS` = 50 ms (~20 Hz)
  per layer and one request in flight per layer, newest value wins. On a refresh a slider takes the switcher's value
  unless it has a pending / in-flight post, is being dragged, or was moved in the last `FOLLOW_IDLE_MS` = 1.5 s (so a stale
  read never snaps it back); a bound fader then waits for pickup as for any slider moved from elsewhere. Visibility:
  409 (no PixelHue set) hides the block and drops its rows; 502 (set, not answering) keeps the rows (a fader keeps its
  target) and shows the error. Re-read every 3 s while the page is on screen, every 10 s otherwise (the sliders must
  exist for a fader even when the Inspector shows another page). It also writes the names into `MidiMap.pxl_names`.
- `features/visuals/visuals_midi_pxl.gd` (new, static): `control_of(page, "pxl:<id>")` → that slider (null when the
  switcher does not list it), `targets(page)` → the clickable `pxl:` ids, `label` → "PH <name>", `tick(page)`.
- `features/visuals/visuals_page.gd`: builds the block (`pixelhue`) above the MIDI heading (3 lines).
- `features/visuals/visuals_midi.gd` (488 → 492 lines): preload `Pxl`; `control_of` gets a `"pxl"` branch; `click_at`
  also walks `Pxl.targets(tab.page)` (Learn / Unmap clicks); `tick()` calls `Pxl.tick(tab.page)` (the block's clock:
  the midi node is always in the tree, the page only while the Inspector shows it).
- `features/visuals/visuals_midi_apc.gd`: `label()` → "PH <name>" for `pxl:` (the virtual controller's fader 3).
- `features/midi/midi_map.gd`: `"pxl"` in `RANGES` (a slider target: Learn wants a fader/knob, pickup applies, and
  `valid_target` / `normalize` keep a stored `pxl:` binding across restarts); `static var pxl_names`; `target_label`
  → "PixelHue <name> opacity" ("PixelHue layer <id> opacity" before the first read).

Learn is the existing path unchanged: move fader 3 (CC 7, ch index 2), click a PixelHue slider → `MidiMap.learn`
replaces that source's `layer:3` binding with `pxl:<id>`, saved in ui.cfg `[midi] map`. Unmap by clicking the slider
or moving the fader works the same.

Deviation from the design: none in substance. Layer types without an opacity are left out of the block (the design said
"one slider per layer on the PGM screens"; the P80 refuses bkg/mvr, so offering them would only produce errors).

## What was verified

**Node smokes** (`node --test tools/smoke/smoke-wo1050-pixelhue-layer-opacity.test.js
tools/smoke/smoke-wo1035-pixelhue-layer-read.test.js tools/smoke/smoke-wo1038-pixelhue-look-drive.test.js
tools/smoke/smoke-wo1039-pixelhue-studio-bridge.test.js`): `tests 27, pass 27, fail 0`. The new smoke (6 tests,
registered in `tools/ci/offline-test-files-3.js`): a burst of 50 values → exactly 2 PUTs `[0, 98]` in order (first, then
the newest), idle again → the next goes at once; per-layer independence (layer 2 goes out while layer 1 is in flight);
a refused PUT reported on the next call without stalling; the route with a raw JSON string body (37.4 → 37, a 21-value
burst through the route → 2 PUTs `[37, 100]`); 400 for opacity −1 / 101 / "x" / missing, layerId missing / "abc" / −3 /
1.5, a broken body; 0 accepted; no address → 409; the route registration line pinned. API contract smoke
(`smoke-wo598-api-contract`): pass 3.

**Godot** (`GODOT=~/.local/opt/godot/godot godot/client/run-client.sh --test`): `[tests] 28229 passed, 0 failed`.
`tests/test_pixelhue_opacity_midi_wo1050.gd` (6 tests, 37 asserts): `pxl:` is a range / valid / survives normalize;
labels "PixelHue Layer 2 opacity", "PixelHue layer 12345 opacity", virtual "PH Layer 2"; the block lists only Screen 1's
two enabled normal layers out of the P80's real mix (mvr, bkg, cut, aux, disabled layer, disabled screen left out);
`control_of` → the layer's slider, unknown id → null; a refresh follows the switcher (35) without posting and keeps the
same slider; a hand move posts and is not snapped back 200 ms later, follows again after 1.5 s idle; a layer gone →
no target; throttle: first value at once, 49 more within 50 ms → nothing until 50 ms, then only the newest (59), per
layer, clamp 250 → 100; Learn: fader 3 (CC 7 ch 2) → `pxl:88145921` replaces `layer:3`, the MIDI line names it, kept in
ui.cfg; soft takeover (fader at 16 % does not move the slider at 100 %, 127 picks it up, 64 → 50 and posts
`[88145921, 50]`); Unmap by clicking; a real click (page in the tree) on a PixelHue slider is a Learn target; the virtual
fader 3 at 0.25 posts 25. `run-client.sh --check`: `[check] boot OK (no script errors)`.

**Gates**: `node tools/ci/check-max-file-lines.js` → 0 over 500; `npm run -s lint` → 0 errors (174 warnings, none in
these files); `npm run -s format:check` → clean; `node tools/ci/check-unwired-exports.js` → no NEW orphan exports
(it reports 1 baseline entry no longer orphaned — not one of these files).

**Live on the box's P80 (192.168.50.254:8088, node restarted 12.11 just before 22:52Z)**:
- curl validation: `{"layerId":"x"}` → 400, `opacity 101` → 400, body `garbage` → 400 (the handler answers: no wildcard
  swallows the route).
- No PVW layer with an opacity exists: Screen 1's PVW layer 92536832 (bkg, disabled) opacity 100 → posted 40 → read
  back 100; the next call reported `PixelHue /unico/v1/layers/opacity: code 8210 manage param invalid`. Same on the
  multiviewer layer 21168128 (MVR 1 "Layer1", mvr): 8210, unchanged at 100. Both left as found.
- Screen 1 PGM "Layer 2" (88145921, normal): before **100** → POST 60 → read back **60** (22:52:11Z) → POST 100 →
  read back **100** (22:52:12Z); the follow-up call answered `sent: 100, error: ""`. Layer 2 was at 60 % on program for
  about 2 s.
- Coalescing live: 50 sequential POSTs (97–99, last 100) in 31 ms → 49 answered `queued: true` (behind one in-flight
  PUT), 0 errors, read back **100** (the original). (A 20-request parallel curl burst landed out of order — 99 last —
  as parallel HTTP does; restored to 100 and read back 100.)

**Not verified (owner hardware check pending)**: the GUI itself — the owner's running client loads these scripts only
on its next relaunch (not relaunched by the builder): the PixelHue block on the Visuals Inspector page, a real Learn of
the APC40's fader 3 onto a PixelHue slider, the switcher following the fader, and the virtual controller's "PH Layer 2".

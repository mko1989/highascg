# WO-893 — Pixel-map smoothing: attack / release (and snap on cut) after the region average

**Area:** mapping, godot-client
**Status: DONE (31.10.26 — offline: smoke 21/21, WO-807+893 62/0, loopback on 127.0.0.1:6455, Godot pixel-map tests; box after node restart 12:29: GET/POST settings live, 400 on junk, 60/250 lands in project.pixelMapSettings and default drops the key. Default stays off — the look on the real rig comes with the owner's first use)**

## Owner request

31.10.26:
> implement a similar smoothness parameter that is used for audio to pixelmapping fixtures. the biggest issue i always
> had with pixelmapping was their erratic changes which looked bad irl. smoothing it out should fix this. probably the
> best place to insert this is after the averaging of the pixel so there is less compute.

"Similar to audio" = the attack / release of the Visuals Shape node (`visuals_flow.gd:84-85`, 0-5000 / 0-10000 ms).

## Investigation

The WO-807 live path, as read on 31.10.26:

- `src/fixtures/follow-engine.js` ticks at `TICK_MS = Math.round(1000 / 44)` (43.5 Hz). `tick()` calls
  `this.pixelMap?.sample(now)` first (:224) and `this.pixelMap?.write(u.buf, fx, now)` per fixture (:280).
- `src/fixtures/pixel-map-service.js` `sample()` reads every leased shm surface through `pixel-map-frame.js`; a surface
  is read only when its seq is new (`since`, frame.js:111). The region means are rounded to ints there (frame.js:142,
  before this WO) and stored as `colours.set(id, { rgb, at })`.
- `write()` took `rgb` only while `t - c.at < HOLD_MS` (1 s) and otherwise `null`: a **hard cut to black**. Then
  `pixel-map-model.js` `writePixel` -> `componentValues` (W = min(r, g, b), amber = round(min(r, g) * 0.5), CMY = 255 - x)
  and the scaling `Math.round(v * max / 255)` (16-bit big endian for 2-byte channels).
- So every raw frame-to-frame change of a region's mean reached the wire at once. A video cut, flicker or a thin moving
  edge in a region = the erratic flashing the owner sees on a real head.
- The cheapest place is **after the average**: one RGB triple per mapping (896 strips on the box = 896 triples, a few
  multiplies each) instead of per screen pixel.

Decisions that came out of the investigation:

- One time constant per direction, chosen by luma: attack while the target is brighter than the state, release while
  darker. **One k for R, G and B**: a red -> blue change goes in a straight line in RGB. Per-channel attack/release
  would swell magenta (red falls slowly while blue rises fast).
- Exponential step `k = 1 - exp(-dt / tau)` with real `dt` between `sample()` calls (clamped to 0.1 s), so the result does
  not depend on the tick rate (see the side finding WO-897: the tick is 43.5 Hz, not the 50 fps of the channel).
- Step **every tick**, whether or not a new frame came, so the fall continues between frames and when the channel stalls.
- Stale (no frame for HOLD_MS) now means "target = black", i.e. a release instead of a cut. With release 0 it is still the
  old cut.
- 0 / 0 must be byte-identical to WO-807: the target is then the rounded int mean exactly as before; only with smoothing
  on is the unrounded mean the target. `componentValues` no longer rounds the amber value; the one final rounding is in
  `writePixel`, so a 16-bit fixture gets fine fades (`100.5` -> 25829) and an 8-bit one the same bytes as before.
- Snap (0 = off): smoothing must not smear a real cut. Per channel (surface), on a new frame, the mean over that
  channel's mappings of `max |raw_new - raw_prev|` (raw against raw, not against the smoothed state) is compared with
  `snap`; at or above it the state of **all** mappings of that channel jumps to the raw value. One region changing alone
  barely moves the mean, so it is smoothed as usual.
- Settings are a project property, server-owned like `pixelMappings` (a client autosave must not erase them):
  `pixelMapSettings: { smooth: { attack_ms, release_ms, snap } }`.

## What was done

Server:

- `src/fixtures/pixel-map-smooth.js` (new, pure): `stepRgb` (the exponential step, luma-selected tau, dt clamp), `frameJump`
  (snap measure), `createSmoother` (per-mapping float state; a mapping without state starts at its target),
  `normalizeSettings` (stored values: clamp attack 0-5000, release 0-10000, snap 0-255, junk -> 0) and `validateSettings`
  (POST: junk is an error, omitted fields keep their value, numbers clamp).
- `src/fixtures/pixel-map-frame.js`: the reader also returns `means` (unrounded); `colours` (rounded ints) unchanged.
- `src/fixtures/pixel-map-service.js`: `smoothStep(t)` after the per-surface loop in `sample()` (every tick), `snapChannel` on
  a new frame, `write()` sends the smoothed state. Resets: `load()` with changed mappings (colours.clear) and the
  resume from idle clear the states, a new mapping starts at its first value. `/live`: `rgb` = what is written (rounded
  smoothed state; a releasing stale pixel shows until black), new `raw` = the last frame's mean (null when stale), new
  `smooth` = the active settings. `settings()`, `setSettings()` (persist via `persistSettingsToProject`; all-default settings
  drop the key).
- `src/fixtures/pixel-map-model.js`: `componentValues` keeps the amber value unrounded.
- `src/engine/project-client-slices.js`: `pixelMapSettings` in `SERVER_OWNED_SLICES`.
- `src/api/routes-pixel-map.js`: `GET` / `POST /api/fixtures/pixelmap/settings` (200 `{ ok, settings }`, 400
  `{ ok: false, error }`, 503 without the engine). `docs/wiki/api/contract/http.md` regenerated (546 routes,
  `gen-api-contract.js --check` clean).

Godot (`godot/client/features/previs/fixtures/`):

- `pixel_map_window.gd`: a "Smoothing" row above Save: `Attack ms` / `Release ms` / `Snap on cut` SpinBoxes (labels and
  ranges like the Visuals Shape node, `select_all_on_focus = true` per RULES.md 1). Loaded in `reload()`, marks the window
  dirty; Save POSTs the settings first, then the mappings (a failed settings POST stops the Save with a note).
- `pixel_map_model.gd`: `smooth_from()` (reply -> clamped spin values), `live_by_id` also returns `raw`.
- `pixel_map_rows.gd`: the swatch tooltip shows `RGB r, g, b (raw r, g, b)` when they differ.
- `core/demo/demo_extras.gd`: the demo server answers the two settings routes.

Defaults stay 0 / 0 / 0 (off). Suggested values to turn it on: **attack 60 ms, release 250 ms, snap off** (raise snap to
about 100 only if hard cuts look mushy).

Not touched: `features/visuals/*`, `app/shell.gd`, `config/`.

## What was VERIFIED

Offline:

- `tools/smoke/smoke-wo893-pixel-map-smooth.test.js` (new, in `tools/ci/offline-test-files-2.js`): 21 tests. 0 / 0 identity
  (also the stale cut), 63.2 % after t = tau for attack and (36.8 %) release, frame-rate independence (44 x 1/44 vs
  25 x 1/25 within 0.5), dt clamp, red <-> blue with attack != release (no component leaves its range, green stays 0),
  snap (whole-channel jump vs single region vs snap 0), stale release vs cut, reset on reload and idle -> resume,
  16-bit `100.5` -> 25829 and 8-bit -> 101, settings clamp / junk, `pixelMapSettings` server-owned, GET / POST routes with a
  raw JSON string body and 400 on non-object / missing smooth / non-numeric / malformed body.
- `tools/smoke/smoke-wo807-pixel-map-loopback.test.js` extended (Art-Net to 127.0.0.1:6455 only, `src/fixtures/artdmx.js`):
  release 1000 ms -> 200 falls to ~74 over ~1 s on the wire, a rise goes in at once; 6 tests pass.
- All other WO-807 smokes unchanged and green (40 tests).
- Godot: `test_pixel_map_model.gd` +3 tests (raw beside smoothed, `smooth_from` clamps, the window row / focus / save order);
  a probe instance of the window confirmed it compiles, the row builds and an edit marks it dirty.

Remaining (needs the node restart, not done by the implementing agent):

- Restart the node, then `curl` GET / POST `/api/fixtures/pixelmap/settings` on the box (the router matches in order, a
  wildcard before it would swallow the route; handler-only smokes cannot see that).
- Set 60 / 250 in the Pixel map window, Save, look at a mapped head on the rig and the swatches (rgb vs raw) while a moving
  clip plays; confirm `pixelMapSettings` lands in the project file and survives a Godot autosave.

### Box check after the node restart (31.10.26)
- `GET /api/fixtures/pixelmap/settings` → `{"ok":true,"settings":{"smooth":{"attack_ms":0,"release_ms":0,"snap":0}}}` (route not swallowed by an earlier wildcard).
- `POST {"smooth":{"attack_ms":"x"}}` → 400 `smooth.attack_ms must be a number 0…5000`.
- `POST {"smooth":{"attack_ms":60,"release_ms":250}}` → `GET /api/project` shows `pixelMapSettings = {smooth:{attack_ms:60,release_ms:250,snap:0}}`; `POST` all zeros → the key is gone again (box left at the default, off).
- `/api/fixtures/pixelmap/live` carries `smooth`; channel 1, 268 mappings, idle (DMX master off). No Art-Net was sent to the rig.


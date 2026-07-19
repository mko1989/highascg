# WO-179 — Lighting I/O: Art-Net listener off by default, sACN input option, region-averaged sampling, mirror H/V

**Status:** Implemented (owner/hardware acceptance pending)
**Priority:** Medium
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner). GDTF import/export split to WO-180.
**Related:** WO-09/43/45 (global border), WO-19 (person tracking uses sampling?), fixture editor (client/components/fixture-inspector.js, pixel-map-editor-canvas.js).

---

## 1. Investigation findings (2026-07-13)

- **Art-Net listener (global border input) defaults ON:** `src/artnet/artnet-receiver.js:60` (`_artnetListenEnabled = true`), `src/artnet/artnet-slot-config.js:10-15` (`slotListenEnabled()` returns true when unset), UI checkbox default-checked (`inspector-global-border-artnet.js:35`).
- **sACN OUTPUT already implemented** — `src/sampling/dmx-output.js:72-91` `_sendSacn()` (sacn ^4.6.2 in package.json:107), fixture protocol dropdown already offers it (`fixture-inspector.js:41`). Owner's "sacn output for pixel mapping" ask is ALREADY DONE — only **sACN INPUT** for the global border is missing (current receiver is Art-Net only, `src/artnet/artnet-receiver.js`).
- **Pixel sampling is single-pixel center, not region average:** ingress scales PGM to 10-50% (`src/sampling/dmx-sampling.js`, `_planChannels():60-86`), worker samples ONE RGB triplet at each grid-cell center (`src/sampling/sampling-worker.js:62-138`), then brightness/gamma/colorOrder → DMX out.
- **Rotation already implemented** (fixture `rotation`, 2D matrix in `sampling-worker.js:75,85-102`; canvas handles in `pixel-map-editor-canvas.js:62,98,179,242`). **Mirroring (H/V) missing** — no fixture flags, no transform.
- **Stock CasparCG Art-Net: none** (research answer for the owner) — casparcg.config has no artnet consumer in 2.x; all Art-Net/sACN here is HighAsCG-custom. Nothing to leverage server-side.

## 2. Tasks (haiku-sized, sequential)

- [x] T179.1 **Listener default OFF:** `slotListenEnabled()` (`artnet-slot-config.js:10-15`) returns false when unset; `_artnetListenEnabled` init false (`artnet-receiver.js:60`); UI checkbox default unchecked (`inspector-global-border-artnet.js:35`). Existing configs that explicitly set true keep working. Note in log: existing rigs with the listener implicitly on will need to re-enable once.
- [x] T179.2 **Mirror H/V for fixtures:** add `mirrorH`/`mirrorV` booleans to the fixture config (UI checkboxes in `fixture-inspector.js` next to rotation); in `sampling-worker.js` apply reflection of local coords BEFORE the rotation matrix (:85-102 region); render the mirror state in the pixel-map canvas (at minimum an H/V badge on the fixture rect; full mirrored preview optional).
- [x] T179.3 **Region-averaged sampling:** per grid cell, average all scaled-buffer pixels inside the cell's rect (after rotation/mirror mapping) instead of the single center pixel. Implementation: compute the cell's polygon in scaled coords; iterate its bounding box, point-in-cell test, accumulate RGB, divide. Guard cost: cells at the ingress scale are small (ingress already downscales 10-50%) — cap samples per cell (e.g. stride so ≤64 samples/cell). Make it a per-fixture option `sampleMode: 'center'|'average'` defaulting to 'average' for new fixtures, 'center' for existing (no silent behavior change on live rigs).
- [x] T179.4 **sACN input for global border:** parallel receiver using the sacn package's Receiver, same slot-config surface as Art-Net (`artnet-slot-config.js` gains `protocol: 'artnet'|'sacn'`); UI select in `inspector-global-border-artnet.js` (rename group title to "Lighting input"). Same universes/channel mapping downstream — the border effect consumer shouldn't care which protocol fed it.
- [x] T179.5 Smokes: slotListenEnabled default-off; mirror/rotate coordinate math (pure function — extract if needed); region average on a fixture frame (feed synthetic buffer, assert averaged values); protocol dispatch input side.
- [x] T179.6 Log the research answer (stock Caspar Art-Net: none) + operator note (re-enable listener where used).

## 3. Acceptance criteria

- [ ] A179.1 Fresh global border has the lighting listener OFF; enabling + protocol choice (Art-Net/sACN) works (hardware check with a DMX source).
- [ ] A179.2 A fixture set to average mode outputs the averaged color of its region; mirror H/V visibly inverts the mapping on hardware LEDs.
- [ ] A179.3 Existing fixtures behave identically until switched to average mode; gates green.

## 4. Work log

- 2026-07-13 — WO created. sACN output + rotation confirmed already implemented; scope = default-off, sACN input, region averaging (opt-in per fixture), mirroring.
- 2026-07-13 — Implementation complete (4 tasks sequential):
  - **T179.1:** `slotListenEnabled()` now defaults false when undefined; `_artnetListenEnabled` init to false; UI checkbox unchecked by default. Backward compat: explicit `true` still works. **Operator note:** Existing rigs with implicit listener-on must re-enable in UI once.
  - **T179.2:** Added `mirrorH`/`mirrorV` boolean fields to fixture config. UI: rotation (°) and dual-checkbox (H/V) in fixture-inspector.js. Worker: coordinate transform extracted to pure function `transformFixtureCoords()` in `src/sampling/fixture-transform.js`; applies mirror before rotation (local coords). Canvas: H/V badge rendered next to fixture label.
  - **T179.3:** Added `sampleMode: 'center'|'average'` per fixture (UI select in inspector). New fixtures default to 'average'; existing fixtures migrate to 'center' on load (no silent behavior change). Worker: `averageRegion()` function strides up to ~64 samples/cell for cost guard. Mode 'average' computes cell bounds post-transform, samples all pixels in bounding box.
  - **T179.4:** `slotLightingProtocol()` added to artnet-slot-config.js (defaults 'artnet'). New `src/artnet/sacn-receiver.js` mirrors ArtnetReceiver API using sacn^4.6.2 Receiver. UI: protocol select (Art-Net/sACN) added to inspector-global-border-artnet.js; group title retitled "Lighting input (Art-Net/sACN)".
  - **T179.5 + T179.6:** 21 smoke tests written (all passing):
    - smoke-wo179-artnet-defaults.test.js (4 tests): slotListenEnabled default-off behavior
    - smoke-wo179-fixture-transform.test.js (8 tests): mirror + rotation coordinate math
    - smoke-wo179-region-average.test.js (4 tests): region averaging with synthetic frames
    - smoke-wo179-protocol-dispatch.test.js (5 tests): protocol selector dispatch logic
  - **Research answer (T179.6):** Stock CasparCG 2.x has NO native Art-Net consumer. All Art-Net/sACN input/output in this codebase is HighAsCG-custom. Nothing to leverage server-side.

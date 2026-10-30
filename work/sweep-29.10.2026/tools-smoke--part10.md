# tools/smoke — sweep 29.10.2026 (batch 131)

Files: 63 · lines: 6927 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 7 RISK, 29 QUALITY

## tools/smoke/smoke-wo585-global-border-control.test.js
- `OK`
## tools/smoke/smoke-wo588-led-builder-pattern.test.js
- `OK`
## tools/smoke/smoke-wo590-template-cg-host-fill.test.js
- `OK`
## tools/smoke/smoke-wo592-media-links.test.js
- `OK`
## tools/smoke/smoke-wo592-media-preview.test.js
- `OK`
## tools/smoke/smoke-wo592-media-versions.test.js
- `OK`
## tools/smoke/smoke-wo597-operator-gui-atlas.test.js
- `OK`
## tools/smoke/smoke-wo597-operator-gui-shm-output.test.js
- `OK`
## tools/smoke/smoke-wo597-video-surfaces.test.js
- `OK`
## tools/smoke/smoke-wo598-api-contract.test.js
- `OK`
## tools/smoke/smoke-wo598-client-prefs.test.js
- `QUALITY` tools/smoke/smoke-wo598-client-prefs.test.js:79–80 and 145–146 — assigns `globalThis.localStorage` and `globalThis.fetch` and never restores them. Line 114 `served = null` is a no-op after the last assertion. Fix: save and restore in a `finally`.
## tools/smoke/smoke-wo598-contract-constants.test.js
- `OK`
## tools/smoke/smoke-wo598-deck-sync-persist-race.test.js
- `QUALITY` tools/smoke/smoke-wo598-deck-sync-persist-race.test.js:12 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo598-preview-push.test.js
- `QUALITY` tools/smoke/smoke-wo598-preview-push.test.js:11 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo598-take-payload-parity.test.js
- `OK`
## tools/smoke/smoke-wo598-web-project-roundtrip.test.js
- `QUALITY` tools/smoke/smoke-wo598-web-project-roundtrip.test.js:115 — the `unexpected` filter excuses every `.layers.N.layerNumber:` diff, not only the documented WO-160 renumber (see the header, lines 10–11). A lost or wrongly renumbered layerNumber therefore passes the "no input leaf is lost" test. Fix: excuse only the from→to pairs the renumber actually produces.
## tools/smoke/smoke-wo599-operator-screen.test.js
- `OK`
## tools/smoke/smoke-wo600-multiview-audio-focus.test.js
- `OK`
## tools/smoke/smoke-wo600-new-layer.test.js
- `QUALITY` tools/smoke/smoke-wo600-new-layer.test.js:12 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo601-countdown.test.js
- `QUALITY` tools/smoke/smoke-wo601-countdown.test.js:9 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo601-effects-nudge.test.js
- `QUALITY` tools/smoke/smoke-wo601-effects-nudge.test.js:11 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo601-global-border-slot-edits.test.js
- `QUALITY` tools/smoke/smoke-wo601-global-border-slot-edits.test.js:9 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo601-layer-tools.test.js
- `QUALITY` tools/smoke/smoke-wo601-layer-tools.test.js:6 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo601-look-preset-recall.test.js
- `OK`
## tools/smoke/smoke-wo601-lower-third-template.test.js
- `QUALITY` tools/smoke/smoke-wo601-lower-third-template.test.js:10 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo601-lt-roster-import.test.js
- `QUALITY` tools/smoke/smoke-wo601-lt-roster-import.test.js:9 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo601-pip-preview.test.js
- `QUALITY` tools/smoke/smoke-wo601-pip-preview.test.js:9 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo601-screen-timer-reassign.test.js
- `QUALITY` tools/smoke/smoke-wo601-screen-timer-reassign.test.js:11 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo603-hap-onair.test.js
- `OK`
## tools/smoke/smoke-wo603-ingest-local.test.js
- `RISK` tools/smoke/smoke-wo603-ingest-local.test.js:67 — shells out to `python3` for the zip fixture. It is not declared in package.json, and CI installs only python3-xlib. A host without python3 fails this case. Low.
- `RISK` tools/smoke/smoke-wo603-ingest-local.test.js:107 — waits for the background copy with a 100 × 10 ms poll (about 1 s). A slower disk fails the `phase === complete` check at line 109 instead of waiting longer. Low.
## tools/smoke/smoke-wo603-media-delete-settle.test.js
- `OK`
## tools/smoke/smoke-wo603-media-gather.test.js
- `OK`
## tools/smoke/smoke-wo603-multi-rename-plan.test.js
- `OK`
## tools/smoke/smoke-wo603-playlist-edit.test.js
- `OK`
## tools/smoke/smoke-wo603-playlist-panel.test.js
- `OK`
## tools/smoke/smoke-wo603-take-missing-media.test.js
- `OK`
## tools/smoke/smoke-wo604-alsa-routes.test.js
- `OK`
## tools/smoke/smoke-wo604-audio-mixer-state.test.js
- `OK`
## tools/smoke/smoke-wo604-cross-screen-audio.test.js
- `OK`
## tools/smoke/smoke-wo604-input-audio-routing.test.js
- `OK`
## tools/smoke/smoke-wo604-web-mixer-server-state.test.js
- `OK`
## tools/smoke/smoke-wo606-shader-live-server.test.js
- `QUALITY` tools/smoke/smoke-wo606-shader-live-server.test.js:142–145 — deletes `LIVE[2]` and restores it after an assert with no try/finally. A failure at line 144 leaves the shared fixture broken for the later GET test (line 153). Fix: wrap in try/finally.
## tools/smoke/smoke-wo608-hardware-check.test.js
- `OK`
## tools/smoke/smoke-wo608-missing-assets.test.js
- `OK`
## tools/smoke/smoke-wo611-compose-drop-file-defaults.test.js
- `OK`
## tools/smoke/smoke-wo611-compose-move-snap.test.js
- `OK`
## tools/smoke/smoke-wo611-disk-size-text.test.js
- `QUALITY` tools/smoke/smoke-wo611-disk-size-text.test.js:14–15 — extracts `formatBytes` by `src.slice(indexOf(...), indexOf(...))` and evals it with `new Function`. It fails loudly if the layout changes, but it couples the test to file order. Fix: export `formatBytes` and import it.
- `QUALITY` tools/smoke/smoke-wo611-disk-size-text.test.js:4 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo611-live-audio-settings.test.js
- `QUALITY` tools/smoke/smoke-wo611-live-audio-settings.test.js:7 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo611-redact-keeps-flags.test.js
- `OK`
## tools/smoke/smoke-wo611-web-client-defects.test.js
- `OK`
## tools/smoke/smoke-wo612-mvr-export.test.js
- `QUALITY` tools/smoke/smoke-wo612-mvr-export.test.js:10 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo612-mvr-import.test.js
- `RISK` tools/smoke/smoke-wo612-mvr-import.test.js:29 — `zlib.crc32` needs Node ≥ 20.15 (22.2+), but package.json `engines` is `>=20` (package.json:97). CI runs Node 24, so nothing fails today; a Node 20.0–20.14 install throws `zlib.crc32 is not a function`. Fix: raise engines to `>=20.15` or write a local CRC-32. Used here and by tools/smoke/lib/zip-stored.js:13 `zlib.crc32`.
- `QUALITY` tools/smoke/smoke-wo612-mvr-import.test.js:10 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo614-project-client-slices.test.js
- `QUALITY` tools/smoke/smoke-wo614-project-client-slices.test.js:12 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo615-dmx.test.js
- `RISK` tools/smoke/smoke-wo615-dmx.test.js:264 — `listen()` binds the fixed UDP ports 6455 and 5569 (lines 266–267) with no `error` handler. If either port is taken, the run crashes with an unhandled EADDRINUSE instead of failing cleanly. 5569 is operator-settable (`sacn_port`, see smoke-wo615-visualise.test.js:28), so the clash is plausible. Traffic stays on loopback. Fix: bind port 0 and pass the port in, as `freePort()` does in smoke-wo615-visualise.test.js:50.
- `QUALITY` tools/smoke/smoke-wo615-dmx.test.js:50 — `assert.deepStrictEqual(boxCid('a'), boxCid('a'))` compares a call with itself. It proves determinism only, not the CID value. Fix: pin the expected value.
- `QUALITY` tools/smoke/smoke-wo615-dmx.test.js:12 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo615-follow-ik.test.js
- `QUALITY` tools/smoke/smoke-wo615-follow-ik.test.js:12 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo615-gdtf.test.js
- `RISK` tools/smoke/smoke-wo615-gdtf.test.js:15 — the zip helper it imports uses `zlib.crc32` (tools/smoke/lib/zip-stored.js:13), which needs Node ≥ 20.15, but package.json `engines` is `>=20` (package.json:97). CI runs Node 24, so nothing fails today; a Node 20.0–20.14 install throws `zlib.crc32 is not a function`.
- `QUALITY` tools/smoke/smoke-wo615-gdtf.test.js:11 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo615-looks.test.js
- `QUALITY` tools/smoke/smoke-wo615-looks.test.js:12 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo615-mvr-patch.test.js
- `RISK` tools/smoke/smoke-wo615-mvr-patch.test.js:15 — the zip helper it imports uses `zlib.crc32`, which needs Node ≥ 20.15 (tools/smoke/lib/zip-stored.js:13; package.json engines `>=20`).
- `QUALITY` tools/smoke/smoke-wo615-mvr-patch.test.js:12 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo615-programmer.test.js
- `QUALITY` tools/smoke/smoke-wo615-programmer.test.js:11 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo615-visual.test.js
- `RISK` tools/smoke/smoke-wo615-visual.test.js:14 — the zip helper it imports uses `zlib.crc32`, which needs Node ≥ 20.15 (tools/smoke/lib/zip-stored.js:13; package.json engines `>=20`).
- `QUALITY` tools/smoke/smoke-wo615-visual.test.js:11 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo615-visualise.test.js
- `QUALITY` tools/smoke/smoke-wo615-visualise.test.js:11 — `require('node:assert')` is the legacy (non-strict) module, so `assert.equal` is loose `==`; the rest of the batch uses `node:assert/strict`. Fix: switch to `node:assert/strict`.
## tools/smoke/smoke-wo616-about.test.js
- `OK`
## tools/smoke/smoke-wo616-beam-spot.test.js
- `OK`

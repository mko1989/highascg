# tools/smoke — sweep 29.10.2026 (batch 135)

Files: 25 · lines: 2001 · findings: 0 BUG-HIGH, 0 BUG, 10 DEAD, 12 RISK, 6 QUALITY

## tools/smoke/smoke-wo813-web-clip-trim.test.js
- `OK`
## tools/smoke/smoke-wo814-take-order-play-last.test.js
- `OK`
## tools/smoke/smoke-wo818-notchlc-warning.test.js
- `OK`
## tools/smoke/smoke-wo821-hardware-hold.test.js
- `OK`
## tools/smoke/smoke-wo822-no-https-proxy.test.js
- `OK`
## tools/smoke/smoke-wo823-load-from-file-keeps-rig.test.js
- `OK`
## tools/smoke/smoke-wo824-import-keeps-open-project.test.js
- `OK`
## tools/smoke/smoke-wo827-web-deck-import-repaint.test.js
- `QUALITY` tools/smoke/smoke-wo827-web-deck-import-repaint.test.js:25-27 — `src.slice(src.indexOf('No timeline'))`: if the anchor is removed, indexOf is -1 and slice(-1) leaves one character, so `tl.length > 0` passes and the `layer.contentZoom` check runs on nothing. Fix: assert the index is >= 0 before slicing.
## tools/smoke/smoke-ws-client-state.test.js
- `OK`
## tools/smoke/smoke-ws-restart-reconnect.test.js
- `RISK` tools/smoke/smoke-ws-restart-reconnect.test.js:26,87,128 — spawns a second full node (`index.js --no-caspar`) with the box's own config/ and default listeners. Only persistence and projects-root are redirected under NODE_TEST_CONTEXT; config and UDP listeners are not. It is skipped only when CI/GITHUB_ACTIONS is set, so a local run on the box starts a second node. Fix: run it only behind an explicit opt-in env, or isolate config and ports.
## tools/smoke/smoke-xrandr-canvas-check.js
- `DEAD` tools/smoke/smoke-xrandr-canvas-check.js:1 — not run by anything. Grep: `rg -n "xrandr-canvas-check" tools package.json .github` → only the file itself; excluded by tools/ci/collect-offline-tests.js EXCLUDE_NAME (`/^smoke-xrandr-canvas-check/i`) and not in any curated list.
- `RISK` tools/smoke/smoke-xrandr-canvas-check.js:21-22 — reads the live config/device_graph.json and config/screen_destinations.json, and calls needsNodmRestartForLayout, so the result depends on the box's current rig.
- `QUALITY` tools/smoke/smoke-xrandr-canvas-check.js:25 — `includes(check.reason)` against the full reason enum can never fail.
## tools/smoke/smoke-xrandr-custom-mode.js
- `QUALITY` tools/smoke/smoke-xrandr-custom-mode.js:1 — runs only through `npm run test:xrandr-custom-mode` (package.json:60). It is not in the curated CI lists and not in collect-offline-tests (a .js, not .test.js), so CI never runs it.
## tools/smoke/smoke-xrandr-layout-verify.test.js
- `DEAD (not in curated CI)` tools/smoke/smoke-xrandr-layout-verify.test.js:1 — a .test.js in no tools/ci/offline-test-files*.js list; it runs only under `test:ci:full`. Grep: `rg -n "smoke-xrandr-layout-verify" tools/ci` → no hit.
- `RISK` tools/smoke/smoke-xrandr-layout-verify.test.js:21-22 — reads the live config/device_graph.json and config/screen_destinations.json, so the assertion input is the box's current rig, not a fixture.
- `QUALITY` tools/smoke/smoke-xrandr-layout-verify.test.js:25 — `includes(check.reason)` against the full reason enum can never fail.
## tools/smoke/smoke-xrandr-mode-validation.test.js
- `OK`
## tools/smoke/smoke-xrandr-persist-script.js
- `QUALITY` tools/smoke/smoke-xrandr-persist-script.js:1 — runs only through `npm run test:xrandr-persist-script` (package.json:61); not in the curated CI lists.
## tools/smoke/smoke-zip-slip.test.js
- `QUALITY` tools/smoke/smoke-zip-slip.test.js:14-18 — the traversal test builds its archive with `zip -q evil.zip "../../../tmp/evil.txt"`, but /tmp/evil.txt does not exist. zip exits 12 ("Nothing to do!", checked here), execSync throws, and the catch returns, so `extractZipSafely` never runs and the test passes without asserting. The same early return hides a missing zip binary (line 34-36 on the second test). Fix: create the traversal entry from a real temp file, and fail when zip is missing instead of returning.
## tools/smoke/spike-casparcg-adapter.js
- `DEAD` tools/smoke/spike-casparcg-adapter.js:1 — a plain script nothing runs. Grep: `rg -n "spike-casparcg-adapter" --glob '!docs/**'` → only itself.
- `RISK` tools/smoke/spike-casparcg-adapter.js:7 — connects to live AMCP at 127.0.0.1:5250 when run (VERSION and CLS, read-only).
## tools/smoke/spike-casparcg-connection-2.js
- `DEAD` tools/smoke/spike-casparcg-connection-2.js:1 — plain script, no runner, no reference (grep as above).
- `RISK` tools/smoke/spike-casparcg-connection-2.js:7 — live AMCP 127.0.0.1:5250 (VERSION, read-only).
## tools/smoke/spike-casparcg-connection-3.js
- `DEAD` tools/smoke/spike-casparcg-connection-3.js:1 — plain script, no runner, no reference.
- `RISK` tools/smoke/spike-casparcg-connection-3.js:7 — live AMCP 127.0.0.1:5250 (VERSION, read-only).
## tools/smoke/spike-casparcg-connection-4.js
- `DEAD` tools/smoke/spike-casparcg-connection-4.js:1 — plain script, no runner, no reference.
- `RISK` tools/smoke/spike-casparcg-connection-4.js:7 — live AMCP 127.0.0.1:5250 (VERSION, read-only).
## tools/smoke/spike-casparcg-connection-5.js
- `DEAD` tools/smoke/spike-casparcg-connection-5.js:1 — plain script, no runner, no reference.
- `RISK` tools/smoke/spike-casparcg-connection-5.js:7 — live AMCP 127.0.0.1:5250 (VERSION, read-only).
## tools/smoke/spike-casparcg-connection.js
- `DEAD` tools/smoke/spike-casparcg-connection.js:1 — plain script, no runner, no reference.
- `RISK` tools/smoke/spike-casparcg-connection.js:23 — defaults to live AMCP port 5250 (CASPAR_PORT override only); VERSION and CLS, read-only.
## tools/smoke/spike-cls-typed.js
- `DEAD` tools/smoke/spike-cls-typed.js:1 — plain script, no runner, no reference.
- `RISK` tools/smoke/spike-cls-typed.js:3 — live AMCP 127.0.0.1:5250 (CLS, read-only).
## tools/smoke/test-artnet-input.js
- `DEAD` tools/smoke/test-artnet-input.js:1 — excluded by tools/ci/collect-offline-tests.js EXCLUDE_NAME (`/^test-artnet-input/i`), no package.json script, no reference.
- `RISK` tools/smoke/test-artnet-input.js:47 — sends 20 s of ArtDMX universe 0 to 127.0.0.1:6454, the box's live Art-Net input (the loopback-into-own-input case). Fix: delete, or move to 127.0.0.1:6455 with the artdmx module.
## tools/smoke/verify-streaming-channel.mjs
- `RISK` tools/smoke/verify-streaming-channel.mjs:10-14 — GET to the live node (default 127.0.0.1:4200, `/api/streaming-channel`). Read-only, and run on purpose through `npm run smoke:streaming-ch` (package.json:70); excluded from the curated CI by name.

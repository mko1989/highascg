# tools/smoke (part 1) — sweep 29.10.2026 (batch 122)

Files: 73 · lines: 6807 · findings: 0 BUG-HIGH, 0 BUG, 11 DEAD, 20 RISK, 31 QUALITY

Convention used: DEAD = no runner at all (not in tools/ci/offline-test-files*.js, not in a package.json script, not required or read by another file, not collected by tools/ci/collect-offline-tests.js). A `.test.js` that only the manual `test:ci:full` collector picks up is not DEAD; it gets a QUALITY coverage line because CI never gates it. Live-box RISK lines name the port and the Caspar channel/layer they touch.

## tools/smoke/batch-test.js
- `RISK` tools/smoke/batch-test.js:19 — sends `PLAY 1-10 AMB` and `PLAY 1-11 AMB` as a batch to `CASPAR_HOST:CASPAR_PORT` (defaults 127.0.0.1:5250, lines 2-3). Run on the box, this starts playout on the live channel 1 layers 10-11.
- `DEAD` tools/smoke/batch-test.js:1 — unused scratch script. grep: `rg -n "batch-test" tools/ci package.json .github` → nothing; collect-offline-tests.js:14 excludes `/^batch-test/i`.
## tools/smoke/fixtures/confine-watchdog-harness.py
- `QUALITY` tools/smoke/fixtures/confine-watchdog-harness.py:10 — `path = os.path.join(...)` is overwritten on line 11 before use; dead assignment.
## tools/smoke/fixtures/logs-modal-test.html
- `OK`
## tools/smoke/fixtures/settings-nuclear-test.html
- `DEAD` tools/smoke/fixtures/settings-nuclear-test.html:1 — only referenced by tools/smoke/smoke-settings-nuclear-password-dom.mjs:19, which has no runner (collect-offline-tests.js:26 excludes `/^smoke-settings-nuclear-password-dom/i`; no package.json script). grep: `rg -n "settings-nuclear-password-dom" package.json tools/ci` → only the exclusion.
## tools/smoke/highascg-health-api-amcp.test.js
- `QUALITY` tools/smoke/highascg-health-api-amcp.test.js:10 — header cites `tools/highascg-health-api-amcp.test.js`; the file is at tools/smoke/. Stale path.
## tools/smoke/highascg-live-amcp.test.js
- `RISK` tools/smoke/highascg-live-amcp.test.js:105 — `batchSend(['PLAY 1-10 AMB','PLAY 1-11 AMB'])` against a real Caspar on 127.0.0.1:5250 (connectCaspar, lines 15-16). This is the WO-235 wipe class; excluded from curated CI by name (`^highascg-live-`), runs only via package.json `test:highascg:live`.
- `RISK` tools/smoke/highascg-live-amcp.test.js:128 — `cm.amcp.cg.cgClear(1, 10)` sends `CG 1-10 CLEAR` to live channel 1 layer 10 (on-air blank if a template is up there).
- `QUALITY` tools/smoke/highascg-live-amcp.test.js:73 — `assert.match(line, /casparcg|Caspar|\d+\.\d+/i)` passes on any dotted number; weak for VERSION.
## tools/smoke/highascg-live-highascg-http.test.js
- `RISK` tools/smoke/highascg-live-highascg-http.test.js:74-85 — real HTTP to a running HighAsCG (HIGHASCG_HTTP_PORT, opt-in, line 16). Read-only: GET /api/state, POST /api/raw `TLS` and `VERSION`. Opt-in by env, so no write.
## tools/smoke/http-smoke.js
- `RISK` tools/smoke/http-smoke.js:16 — default port 4200 (`HIGHASCG_SMOKE_PORT || '4200'`), so a bare `npm run smoke` hits the live server. Mostly GETs; also POST /api/variables/batch with `keys: []` (line 192, a no-op) and a WS connect (line 209).
- `QUALITY` tools/smoke/http-smoke.js:90 — `if (!includes('<!DOCTYPE') && !includes('HighAsCG'))` passes any HTML page. Weak check.
- `QUALITY` tools/smoke/http-smoke.js:5 — usage shows `node tools/http-smoke.js 8090`; the file is tools/smoke/http-smoke.js.
## tools/smoke/lib/cluster-lan.js
- `OK`
## tools/smoke/lib/committed-config-slice.js
- `OK`
## tools/smoke/lib/config-generator-routing-fixtures.js
- `OK`
## tools/smoke/lib/screen-timers-test-harness.js
- `QUALITY` tools/smoke/lib/screen-timers-test-harness.js:34-39 — patches `Module.prototype.require` globally to intercept `'../utils/persistence'` and never restores it. The patch leaks into every later require in the same test process; match is on the raw specifier string.
## tools/smoke/lib/zip-stored.js
- `OK`
## tools/smoke/query-test.js
- `DEAD` tools/smoke/query-test.js:1 — no runner; collect-offline-tests.js:16 excludes `/^query-test/i`; no package.json script.
- `RISK` tools/smoke/query-test.js:3 — connects to 127.0.0.1:5250 and reads TLS (read-only).
- `QUALITY` tools/smoke/query-test.js:9-10 — `catch (err) {}` swallows the error; the script prints nothing and exits 0 on a failed query.
## tools/smoke/raw-tcp-test.js
- `DEAD` tools/smoke/raw-tcp-test.js:1 — no runner; collect-offline-tests.js:15 excludes `/^raw-tcp/i`.
- `RISK` tools/smoke/raw-tcp-test.js:5 — writes raw `BEGIN / PLAY 1-10 AMB / PLAY 1-11 AMB / COMMIT` to 127.0.0.1:5250. On the box this starts playout on live channel 1 layers 10-11. No guard.
## tools/smoke/run-live-test-2.js
- `DEAD` tools/smoke/run-live-test-2.js:1 — no runner; collect-offline-tests.js:18 excludes `/^run-live-test/i`.
- `RISK` tools/smoke/run-live-test-2.js:3 — connects to 127.0.0.1:5250 (connect and status only).
## tools/smoke/run-live-test-3.js
- `DEAD` tools/smoke/run-live-test-3.js:1 — no runner; excluded by collect-offline-tests.js:18.
- `RISK` tools/smoke/run-live-test-3.js:4 — connects to 127.0.0.1:5250 and sends VERSION.
- `QUALITY` tools/smoke/run-live-test-3.js:20-22 — `finally { cm.stop(); process.exit(0) }` exits 0 even when the assert at line 14 or the catch at line 18 fails. A failed VERSION check is silent to any caller.
## tools/smoke/run-live-test.js
- `DEAD` tools/smoke/run-live-test.js:1 — no runner; excluded by collect-offline-tests.js:18.
- `RISK` tools/smoke/run-live-test.js:3 — connects to 127.0.0.1:5250 (status only).
## tools/smoke/smoke-alsa-mixer.test.js
- `QUALITY` tools/smoke/smoke-alsa-mixer.test.js:1 — not in tools/ci/offline-test-files*.js and not in any package.json script; only the manual test:ci:full collector runs it, so CI never gates the ALSA parser tests.
## tools/smoke/smoke-alsa-plug-fallback.test.js
- `QUALITY` tools/smoke/smoke-alsa-plug-fallback.test.js:41-43, 51-58, 66-71 — three of the four describe blocks pin source text of live-audio-bridge.js with regex/indexOf instead of exercising the retry, memo and re-arm logic. They break on any rename even when behaviour is right.
## tools/smoke/smoke-alsamixer-terminal.test.js
- `OK`
## tools/smoke/smoke-amcp-basic-plan-log.js
- `DEAD` tools/smoke/smoke-amcp-basic-plan-log.js:1 — a node:test file named `.js`, so collect-offline-tests.js (`.test.js` only) does not pick it up; no package.json script; nothing references it (`rg -n "amcp-basic-plan-log" .` → only itself).
## tools/smoke/smoke-amcp-batch-compose-preview-activity.test.js
- `QUALITY` tools/smoke/smoke-amcp-batch-compose-preview-activity.test.js:1 — not in curated CI and not in package.json; manual full gate only.
## tools/smoke/smoke-amcp-batch-drain-timeout.test.js
- `OK`
## tools/smoke/smoke-amcp-batch-library.test.js
- `RISK` tools/smoke/smoke-amcp-batch-library.test.js:35 — `batchSend(['PLAY 1-10 AMB','PLAY 1-11 AMB'])` against a live Caspar (default 127.0.0.1:5250, lines 10-11). Excluded from CI by WO-235 (collect-offline-tests.js:34-37); reachable via package.json `smoke:amcp-batch` and `test:highascg:migration:all`.
## tools/smoke/smoke-amcp-coalesce-clears.test.js
- `QUALITY` tools/smoke/smoke-amcp-coalesce-clears.test.js:1 — not in curated CI and not in package.json; manual full gate only.
## tools/smoke/smoke-amcp-command-plan.js
- `DEAD` tools/smoke/smoke-amcp-command-plan.js:1 — a node:test file named `.js`; not collected by collect-offline-tests.js; no package.json script; nothing requires it. The module it tests (src/caspar/amcp-command-plan.js) is live (docs and routes-shm-sources.js reference it).
## tools/smoke/smoke-amcp-legacy-transport.test.js
- `RISK` tools/smoke/smoke-amcp-legacy-transport.test.js:71 — `batchSend(['PLAY 1-10 AMB','PLAY 1-11 AMB'])` against a live Caspar (default 127.0.0.1:5250, lines 14-15). Excluded from CI by WO-235 (collect-offline-tests.js:38); package.json `test:highascg:legacy`. VERSION at line 45 is read-only.
## tools/smoke/smoke-amcp-migration-air-paths.test.js
- `RISK` tools/smoke/smoke-amcp-migration-air-paths.test.js:43 — `batchSendChunked` of `CLEAR 1-10` … `CLEAR 1-15` on a live Caspar (5250). Clears live channel 1 layers 10-15, the exact WO-235 incident pattern. Excluded from CI by name (collect-offline-tests.js:39-40); package.json `test:highascg:air-paths` and `test:highascg:migration:all`.
- `RISK` tools/smoke/smoke-amcp-migration-air-paths.test.js:59-60 — `MIXER 1-10 OPACITY … DEFER` and `MIXER 1-11 OPACITY … DEFER` change opacity on live layers.
## tools/smoke/smoke-amcp-migration-parity.test.js
- `OK`
## tools/smoke/smoke-amcp-offline-migration.test.js
- `OK`
## tools/smoke/smoke-amcp-send-after.test.js
- `RISK` tools/smoke/smoke-amcp-send-after.test.js:34-35 — `mixer.mixerCommit(1)` and `batchSend(['PLAY 1-10 AMB','PLAY 1-11 AMB'])` against a live Caspar (5250). Excluded from CI by name (collect-offline-tests.js:41); package.json `test:highascg:send-after`.
- `RISK` tools/smoke/smoke-amcp-send-after.test.js:60 — second live `batchSend` of `PLAY 1-10 AMB` / `PLAY 1-11 AMB` with default pre-commit.
## tools/smoke/smoke-amcp-teardown-targeting.test.js
- `QUALITY` tools/smoke/smoke-amcp-teardown-targeting.test.js:1 — not in curated CI and not in package.json; manual full gate only. Good offline coverage of targetTeardownLines, but CI never runs it.
## tools/smoke/smoke-api-auth.test.js
- `QUALITY` tools/smoke/smoke-api-auth.test.js:119-124 — the zip-slip case runs `zip -q evil.zip` and returns early when `zip` is missing (catch at line 121), so the test passes with no assertion on a box without the zip binary.
## tools/smoke/smoke-api-origin.mjs
- `QUALITY` tools/smoke/smoke-api-origin.mjs:14 — asserts `isHeadlessMode() === false` before clearing HIGHASCG_HEADLESS. Fails when the caller's environment sets it; the script should delete the variable first.
## tools/smoke/smoke-audio-program-layout.test.js
- `QUALITY` tools/smoke/smoke-audio-program-layout.test.js:1 — not in curated CI and not in package.json; manual full gate only.
## tools/smoke/smoke-audio-volume-route-fanout.test.js
- `OK`
## tools/smoke/smoke-autosave-preserves-hardware.test.js
- `OK` — the project store is pointed at a temp dir (HIGHASCG_PROJECTS_DIR, line 84) before project-store is required, so it cannot write projects/.
## tools/smoke/smoke-boot-monitor-picker.test.js
- `OK`
## tools/smoke/smoke-boot-xrandr-snapshot.test.js
- `QUALITY` tools/smoke/smoke-boot-xrandr-snapshot.test.js:1 — not in curated CI and not in package.json; manual full gate only.
## tools/smoke/smoke-build-stamp.test.js
- `QUALITY` tools/smoke/smoke-build-stamp.test.js:1 — not in curated CI and not in package.json; manual full gate only.
## tools/smoke/smoke-calamares-releases-bridge.test.js
- `OK` — every pinned string checked against tools/runtime/launch-calamares.sh, pre-produce-preflight.sh, fix-calamares-shellprocess.sh and verify-calamares-installed.sh; all match in current order.
## tools/smoke/smoke-caspar-amcp-watchdog.js
- `OK`
## tools/smoke/smoke-caspar-cls-id.test.js
- `DEAD` tools/smoke/smoke-caspar-cls-id.test.js:1 — no gate runs it. collect-offline-tests.js:19 excludes `/^smoke-caspar/i`, which also drops this offline unit test from the full gate. Not in curated CI and not in package.json.
- `RISK` tools/smoke/smoke-caspar-cls-id.test.js:129-140 — the "disk layout wins" assertions (138-139) need media/projects/tetst/02_BUMPER.mp4 on disk. media/ is gitignored (.gitignore `/media/`, zero tracked files) and media/projects/ has no tetst folder on this box, so those cases depend on local untracked media. Not checked by running.
## tools/smoke/smoke-caspar-restart-apply.js
- `DEAD` tools/smoke/smoke-caspar-restart-apply.js:1 — a node:test file named `.js`; not collected by collect-offline-tests.js; no package.json script; nothing references it. Pins at lines 36-48 match current src/utils/caspar-restart.js and full-config-apply.js.
## tools/smoke/smoke-caspar.js
- `RISK` tools/smoke/smoke-caspar.js:15 — default port 4200, so `npm run smoke:caspar` hits the live server. GET /api/state and POST /api/raw / /api/amcp/raw `VERSION` only (read-only).
- `QUALITY` tools/smoke/smoke-caspar.js:7 — usage is `node tools/smoke-caspar.js`; the file is tools/smoke/. Line 52 also names `tools/http-smoke.js`, stale.
## tools/smoke/smoke-cg-deck-thumb-contain.test.js
- `OK`
## tools/smoke/smoke-cg-only-look.test.js
- `QUALITY` tools/smoke/smoke-cg-only-look.test.js:1 — not in curated CI and not in package.json; manual full gate only.
## tools/smoke/smoke-cg-orphan-sweep-occupied-only.test.js
- `OK`
## tools/smoke/smoke-cg-routing.test.js
- `QUALITY` tools/smoke/smoke-cg-routing.test.js:1 — not in curated CI and not in package.json; manual full gate only.
## tools/smoke/smoke-cg-studio.test.js
- `RISK` tools/smoke/smoke-cg-studio.test.js:15 `TEST_EXPORT` and 71-88 — writes `template/studio/lt-smoke-test-export.html` inside the repo working tree. template/studio is not in .gitignore or .stignore, and the file is removed only on the success path (line 88). A failed assertion leaves it behind, where it can be committed or synced to peers.
## tools/smoke/smoke-channel-map-decklink-reset.test.js
- `QUALITY` tools/smoke/smoke-channel-map-decklink-reset.test.js:1 — not in curated CI and not in package.json; manual full gate only.
## tools/smoke/smoke-cinf-timebase.test.js
- `OK`
## tools/smoke/smoke-command-lookup.test.js
- `OK`
## tools/smoke/smoke-companion-bridge.test.js
- `OK`
## tools/smoke/smoke-companion-connection-status.test.js
- `QUALITY` tools/smoke/smoke-companion-connection-status.test.js:1 — not in curated CI and not in package.json; manual full gate only.
- `QUALITY` tools/smoke/smoke-companion-connection-status.test.js:23-35 — plain script, not wrapped in node:test. The assertions run inside an async `listen` callback, so a failure becomes an unhandled rejection with no test name in the report.
## tools/smoke/smoke-companion-hot-backup-failover.test.js
- `QUALITY` tools/smoke/smoke-companion-hot-backup-failover.test.js:93 — `awaitListen(server, host, port)` is not awaited, so a bind error (EADDRINUSE) surfaces as an unhandled rejection, not as a failing test, and the first health check can race the listen.
- `QUALITY` tools/smoke/smoke-companion-hot-backup-failover.test.js:190, 229, 253, 281, 303, 417 — `await mocks.close()` is not in a `finally`, so an assertion failure leaves the mock HighAsCG servers listening for the rest of the file.
## tools/smoke/smoke-companion-location-parse.test.js
- `QUALITY` tools/smoke/smoke-companion-location-parse.test.js:9 — `require()`s client/lib/companion-location-parse.js, an ESM `export` module (client/package.json has `"type": "module"`). This works only through require(esm) (Node 22.12+; the box runs v24.22.1). The other client-ESM tests use dynamic `import()`.
## tools/smoke/smoke-companion-press.mjs
- `QUALITY` tools/smoke/smoke-companion-press.mjs:3-5, 14-29 — the script starts its own mock HTTP server and checks the mock. It never loads HighAsCG's press code (timeline-playback.js), so it cannot fail when the real companion_press call regresses. Fixed port 19876 (line 12).
## tools/smoke/smoke-companion-satellite-preview.test.js
- `RISK` tools/smoke/smoke-companion-satellite-preview.test.js:61 — `after()` runs `fs.rmSync(CACHE_DIR, { recursive: true, force: true })`. CACHE_DIR is REPO_ROOT/data/companion-button-preview (src/companion/button-preview-cache.js:9), the runtime cache the live server writes (lines 15, 19). Run on the box, it deletes the live Companion button previews.
## tools/smoke/smoke-compose-preview-activity.test.js
- `OK`
## tools/smoke/smoke-compose-preview-channels.test.js
- `QUALITY` tools/smoke/smoke-compose-preview-channels.test.js:1 — not in curated CI and not in package.json; manual full gate only.
## tools/smoke/smoke-compose-preview-client-channels.test.js
- `QUALITY` tools/smoke/smoke-compose-preview-client-channels.test.js:1 — not in curated CI and not in package.json; manual full gate only.
## tools/smoke/smoke-compose-preview-companion-thumb.test.js
- `OK`
## tools/smoke/smoke-compose-preview-consumer.test.js
- `OK`
## tools/smoke/smoke-compose-preview-defects.test.js
- `QUALITY` tools/smoke/smoke-compose-preview-defects.test.js:1 — the WO-144/159/198 regression suite (432 lines) is not in curated CI and not in package.json; only the manual full gate runs it. The highest-value compose-preview guard is ungated.
## tools/smoke/smoke-compose-preview-dirty.test.js
- `OK`
## tools/smoke/smoke-compose-preview-ffmpeg-args.test.js
- `OK`
## tools/smoke/smoke-config-classify.js
- `OK`
## tools/smoke/smoke-config-defaults-no-machine-audio.test.js
- `OK`
## tools/smoke/smoke-config-generator-routing-2.js
- `OK`
## tools/smoke/smoke-config-generator-routing-3.js
- `OK`
## tools/smoke/smoke-config-generator-routing-4.js
- `OK`

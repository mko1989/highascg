# test (top level) — sweep 29.10.2026 (batch 109)

Files: 14 · lines: 1118 · findings: 0 BUG-HIGH, 0 BUG, 3 DEAD, 0 RISK, 13 QUALITY

Wiring check (how each file is run): CI runs `tools/ci/run-offline-tests.js`, i.e. only the curated list in `tools/ci/offline-test-files.js` (+ `-2.js`). `npm run test:ci:full` globs `tools/smoke` + `test` for `*.test.js|mjs` but is not in ci.yml. Curated: companion-control-status (:450), wo-238 (:451). Everything else is either full-run-only or matched by nothing. Every file was also executed by hand: all 14 pass (`node --test` for the `.test.js`/`.smoke.js`, `node` for the two `wo-*-smoke-tests.js`: 6/6 and 12/12).

## test/companion-control-status.test.js
- `OK` (7 real assertions on `computeCompanionControlStatus`, curated and also in `npm run test:companion-hot-backup`).

## test/multiview-aspect-ratio.test.js
- `QUALITY` test/multiview-aspect-ratio.test.js:1-32 — good test, not wired: not in the curated list, so CI never runs it (`grep -rn resolveCellContentResolution tools test` → only this file; no other coverage). Add to offline-test-files.js.

## test/multiview-playback-osc.test.js
- `QUALITY` test/multiview-playback-osc.test.js:6-24 — good test (loads template/multiview-playback-osc.js and checks the LED-test/border layer filter), not in the curated list; the other consumer of `shouldIgnoreOscPlaybackLayer` is tools/smoke/smoke-multiview-timers-geometry.test.js.

## test/project-media-parity.test.js
- `QUALITY` test/project-media-parity.test.js:10-43 — only coverage of `manifestSignature`/`compareProjectMediaManifests` (`grep -rnw` over tools test → this file only) and not in the curated list, so a regression in replication media parity would not turn CI red.

## test/replication-caspar-parity.test.js
- `QUALITY` test/replication-caspar-parity.test.js:7-36 — not in the curated list (a second consumer, tools/smoke/smoke-replication-parity-gate.test.js, exists but this file's three cases — missing channels, mode mismatch, ok — are the direct unit tests).

## test/replication-channel-parity.test.js
- `QUALITY` test/replication-channel-parity.test.js:7-30 — the only test of `compareChannelParity`/`buildChannelMapSummary` (`grep -rnw compareChannelParity tools test` → this file only), not in the curated list → unprotected in CI.

## test/replication-project-media-rsync.test.js
- `QUALITY` test/replication-project-media-rsync.test.js:11 — `fs.mkdtempSync(os.tmpdir()/hacg-rsync-)` is never removed (no `t.after`/`finally`), one leaked temp dir per run; also not in the curated list.

## test/startup-led-test-ip-refresh.test.js
- `QUALITY` test/startup-led-test-ip-refresh.test.js:10-25 — valid one-case test of `buildStartupLedTestUpdateCommands`, not in the curated list.

## test/system-hardware-summary.smoke.js
- `DEAD` test/system-hardware-summary.smoke.js:1 — runs from nowhere: the name ends `.smoke.js`, so `collect-offline-tests.js` (`/\.test\.(js|mjs)$/`) skips it, and it is absent from offline-test-files*.js, package.json, ci.yml and scripts (`grep -rn system-hardware-summary` → only WO-189 prose and the baseline). It only ever passes when invoked by hand (`node --test` → 3/3).
- `QUALITY` test/system-hardware-summary.smoke.js:15-152 — asserts nothing real: `testAggregatorShape()` returns a hard-coded object literal and the tests assert that the literal has the keys it was written with; the JSON test round-trips another literal. `src/api/system-hardware-summary.js` is never required (and `getHardwareSummary` is itself listed in the unwired-exports baseline). `assert.ok(true, …)` (:56) is a no-op. The "no-throw with failing probes" behaviour WO-189 describes is not tested. Delete or rewrite against the real aggregator with injected probes.

## test/system-network-reset.test.js
- `QUALITY` test/system-network-reset.test.js:7-12 — fine, 4 assertions on `isAllowedEthernetIface` (also covered in tools/smoke/smoke-project-fps-network.test.js, which is not in CI); the file is not in the curated list, and its title says "network reset" while it tests only the interface-name allow-list, not any reset.

## test/system-setup-caspar.test.js
- `QUALITY` test/system-setup-caspar.test.js:17-22 — `detectCalamaresStatus()` runs host probes (`command -v calamares`, `sudo -n -l <launcher>`; read-only) and the test only checks the result types, so it passes on any host and proves little; the `parseCasparControlOutput` case is real. Not in the curated list.

## test/wo-184-smoke-tests.js
- `DEAD` test/wo-184-smoke-tests.js:1-150 — orphan standalone script: no `.test.js` name, not curated, no package.json script, referenced only by WO-184 prose. Its cases 1, 2 and 4 duplicate test/api/routes-media-thumb.test.js (which is wired); case 3 (`writeThumbnailCacheFile` atomic write, no leftover `.tmp`) exists nowhere else.
- `QUALITY` test/wo-184-smoke-tests.js:17-26,84,105-141 — the hand-rolled `test(name, fn)` calls `fn()` without awaiting, so the `async` case at :84 is counted "passed" before it runs and a failing assertion becomes a stray unhandled rejection after the summary; the ESLint case (:119-141) wraps its own `assert.ok` in `try/catch` that prints "ESLint check skipped", so it can never fail; the `node --check` case duplicates what `npm run lint`/`verify:repo-integrity` already do.

## test/wo-208-smoke-tests.js
- `DEAD` test/wo-208-smoke-tests.js:1-240 — orphan standalone script (only invoked by hand per work/reviews/2026-07-15-timers.md and the WO text): nothing in ci runs it. It is the ONLY test of `createTimerFromLayer`, `ensureCanonicalLayer`, `findBoundLayers`, `renameTimer`, `listTimers` (`grep -rnw createTimerFromLayer tools test` → this file only), so the fix is to rename it `*.test.js` on node:test and add it to offline-test-files.js, not to delete it. Passes by hand (12/12); it requires a client file (`client/lib/scene-state-timers.js`) from Node, which only works while that file stays free of browser globals.

## test/wo-238-adjust-fill-ignores-crop.test.js
- `QUALITY` test/wo-238-adjust-fill-ignores-crop.test.js:40-80 — "adjust fill-canvas ignores crop" calls `sceneLayerPixelRectForContentFit` twice with identical arguments (no crop parameter exists to pass) and asserts the two results are equal — a tautology that cannot fail. Test 5 (:166-199) titled "all contentFit modes compute from uncropped source" only checks `x>=0, y>=0, w>0, h>0`. The value is in test 3/4 (`cropAdjustedFillForLayer` differs from the fill) and the fixed 4K-native numbers (`x=-0.5, scale=2`).
- `QUALITY` test/wo-238-adjust-fill-ignores-crop.test.js:12-14,200 — `test(...)` is registered inside an un-awaited async IIFE after `await import(...)`; the runner currently waits for it (5/5 reported), but an import error becomes an unhandled rejection rather than a clean test failure. A top-level `await import` in an `.mjs`, or `before()`, is the usual form.

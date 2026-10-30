# tools/smoke — sweep 29.10.2026 (batch 124)

Files: 60 · lines: 6953 · findings: 0 BUG-HIGH, 0 BUG, 32 DEAD, 3 RISK, 11 QUALITY

Method: every file read in full. "Curated" = listed in tools/ci/offline-test-files.js or offline-test-files-2.js (the `test:ci` gate in ci.yml). Files in neither list are DEAD for that gate; the manual `test:ci:full` collector (tools/ci/collect-offline-tests.js) is the only other path that reaches `*.test.js` files. Every production path referenced by `readFileSync`/`require`/`import` in this batch exists. All exported names used by the batch's `require` calls and the regex/string pins that were checked match the current production text (grep only, no test was run). Live-state safety: `persistence.js` and `projects-root.js` redirect to temp files under `NODE_TEST_CONTEXT`, so the state and project writes these tests trigger stay out of the live files.

## tools/smoke/smoke-live-audio-add-input.test.js
- `DEAD` tools/smoke/smoke-live-audio-add-input.test.js:1 — not in curated list (tools/ci/offline-test-files*.js) and no package.json script. grep: `rg -n "smoke-live-audio-add-input" tools/ci package.json .github` → no hits.
- `RISK` tools/smoke/smoke-live-audio-add-input.test.js:7 — `require()`s `client/lib/live-audio-inputs.js`, an ESM file (`export const`, client/package.json `"type": "module"`). Loads only on Node ≥22.12 (require(esm)); package.json engines is `>=20`. Dead file, so no CI effect today.
- `QUALITY` tools/smoke/smoke-live-audio-add-input.test.js:9-22 — tests a local copy of the slot picker (`pickLiveAudioSlotForDevice`), not the production function in `client/lib/live-audio-add-input.js`. Drift in production cannot fail this test.

## tools/smoke/smoke-live-audio-capture.test.js
- `DEAD` tools/smoke/smoke-live-audio-capture.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-live-audio-capture" tools/ci package.json .github` → no hits.
- `RISK` tools/smoke/smoke-live-audio-capture.test.js:22 — `configPath` points at the box's live `config/casparcg.config`. `src/config/live-audio-input.js:165-168` does `fs.readFileSync(configPath)` on it, so the assertion at :36 (`uris.includes('0,0')`) and the dsnoop expectations depend on the operator's current PortAudio config. Read-only, but the test is not hermetic. Use a fixture config.

## tools/smoke/smoke-live-audio-pgm-screens.test.js
- `OK`

## tools/smoke/smoke-live-audio-watchdog-quiet-probe.test.js
- `DEAD` tools/smoke/smoke-live-audio-watchdog-quiet-probe.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-live-audio-watchdog-quiet-probe" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-live-input-audio-policy.test.js
- `OK`

## tools/smoke/smoke-live-input-stop-start.test.js
- `OK`

## tools/smoke/smoke-live-scene-state.test.js
- `OK`

## tools/smoke/smoke-live-thumbnail-api.js
- `DEAD` tools/smoke/smoke-live-thumbnail-api.js:1 — a `.js` (not `.test.js`) file, so the collector never picks it; not in curated list; no package.json script. grep: `rg -n "smoke-live-thumbnail-api" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-live-thumbnail-ttl.test.js
- `DEAD` tools/smoke/smoke-live-thumbnail-ttl.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-live-thumbnail-ttl" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-log-record.test.js
- `DEAD` tools/smoke/smoke-log-record.test.js:1 — not in curated list. Reached only by manual script `smoke:log-record` (package.json:48). grep: `rg -n "smoke-log-record" tools/ci package.json .github` → package.json:48 only.

## tools/smoke/smoke-logs-modal-pane.test.js
- `DEAD` tools/smoke/smoke-logs-modal-pane.test.js:1 — not in curated list. Reached only by manual script `smoke:log-record` (package.json:48).

## tools/smoke/smoke-logs-modal-tab-hidden.test.js
- `QUALITY` tools/smoke/smoke-logs-modal-tab-hidden.test.js:38 — `if (!setsDisplay) continue` makes the `[hidden]` guard pass without any assertion when a pane class loses its `display` rule, so the test is only meaningful while the one listed class still sets it. The CSS does (08a-modals-logs.css:20-28), so it is live today; the weak conditional is the issue.

## tools/smoke/smoke-logs-modal-toggles.mjs
- `DEAD` tools/smoke/smoke-logs-modal-toggles.mjs:1 — not in curated list. Excluded by name in tools/ci/collect-offline-tests.js (`/^smoke-logs-modal-toggles/i`); reached only by manual script `smoke:logs-modal-toggles` (package.json:49). Needs headless Chrome (CDP) and does not touch :4200 or :5250.

## tools/smoke/smoke-look-air-compose-channel.test.js
- `DEAD` tools/smoke/smoke-look-air-compose-channel.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-look-air-compose-channel" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-look-layer-ranges.test.js
- `DEAD` tools/smoke/smoke-look-layer-ranges.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-look-layer-ranges" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-look-preset-operator-bugs.test.js
- `DEAD` tools/smoke/smoke-look-preset-operator-bugs.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-look-preset-operator-bugs" tools/ci package.json .github` → no hits. Its targets exist (scenes-editor-logic.js, scene-state.js, scenes-editor-support.js, transition-presets.js `normalizeTransitionForPgmOnly`).

## tools/smoke/smoke-loop-restart-watchdog.test.js
- `DEAD` tools/smoke/smoke-loop-restart-watchdog.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-loop-restart-watchdog" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-lower-third-roster.test.js
- `OK`

## tools/smoke/smoke-lt-engine-registry-sync.test.js
- `QUALITY` tools/smoke/smoke-lt-engine-registry-sync.test.js:10 — stale comment: "lt-engine-core/styles split" — the file it parses is `template/lower-thirds/lt-engine-styles.js`. The pin itself (`STYLE_KEYS = new Set([`, both engines) still matches.

## tools/smoke/smoke-main-editor-visible.test.js
- `DEAD` tools/smoke/smoke-main-editor-visible.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-main-editor-visible" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-main-screen-index-gap.test.js
- `OK`

## tools/smoke/smoke-mapping-gpu-os-layout-2.js
- `DEAD` tools/smoke/smoke-mapping-gpu-os-layout-2.js:1 — not in curated list. Reached only by manual script `test:mapping-gpu-os-layout` (package.json:59).

## tools/smoke/smoke-mapping-gpu-os-layout.js
- `DEAD` tools/smoke/smoke-mapping-gpu-os-layout.js:1 — not in curated list. Reached only by manual script `test:mapping-gpu-os-layout` (package.json:59).

## tools/smoke/smoke-math-input.test.js
- `DEAD` tools/smoke/smoke-math-input.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-math-input" tools/ci package.json .github` → no hits.
- `RISK` tools/smoke/smoke-math-input.test.js:26 — `require('../../client/lib/math-input.js')` loads an ESM module (`export function`, client/package.json `"type": "module"`). Same Node ≥22.12 require(esm) dependency as the add-input file; package.json engines says `>=20`.

## tools/smoke/smoke-media-browser-merge-folder-scope.test.js
- `OK`

## tools/smoke/smoke-media-browser-router.test.js
- `DEAD` tools/smoke/smoke-media-browser-router.test.js:1 — not in curated list. Reached only by manual script `smoke:media-browser` (package.json:51). Uses a temp media root, so it is safe to run.

## tools/smoke/smoke-media-dedupe-folder-scope.test.js
- `OK`

## tools/smoke/smoke-media-file-ops-routes.test.js
- `DEAD` tools/smoke/smoke-media-file-ops-routes.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-media-file-ops-routes" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-media-file-ops.test.js
- `DEAD` tools/smoke/smoke-media-file-ops.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-media-file-ops\.test" tools/ci package.json .github` → no hits.
- `QUALITY` tools/smoke/smoke-media-file-ops.test.js:64-67 — the test named "rejects move into descendant folder" never calls `moveMediaFile`. It only asserts the pure helpers `isDescendantFolderPath` and `mediaParentId`, so the move rejection path is untested.

## tools/smoke/smoke-meter-null-consumer.test.js
- `OK`

## tools/smoke/smoke-mixer-effects-catalog.test.js
- `OK`

## tools/smoke/smoke-modal-panel-class-defined.test.js
- `QUALITY` tools/smoke/smoke-modal-panel-class-defined.test.js:31 — `\.${cls}\b` also matches longer class names (e.g. `.modal-content-header {background…}`), so `classPaintsBackground('modal-content')` can pass on an unrelated rule.
- `QUALITY` tools/smoke/smoke-modal-panel-class-defined.test.js:49 — the panel class is found with `/class="([^"]+)"/` searched forward from the overlay token across the whole file. A panel that is set imperatively (`el.className = …`, which the comment at :43-45 says is covered) is never checked, and the match can land on an unrelated element's class.

## tools/smoke/smoke-modeline-timings.js
- `DEAD` tools/smoke/smoke-modeline-timings.js:1 — not in curated list. Reached only by manual script `test:modeline-timings` (package.json:65).

## tools/smoke/smoke-multiview-apply-lock.test.js
- `DEAD` tools/smoke/smoke-multiview-apply-lock.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-multiview-apply-lock" tools/ci package.json .github` → no hits.
- `QUALITY` tools/smoke/smoke-multiview-apply-lock.test.js:11 — the first test is titled as the T190.1 serialization check and the comment at :79 says "serialization verified", but :86-92 only assert both applies return `ok` and that the command counters are non-zero (`commit >= 2`). A non-serialized implementation passes unchanged.

## tools/smoke/smoke-multiview-reapply.test.js
- `DEAD` tools/smoke/smoke-multiview-reapply.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-multiview-reapply" tools/ci package.json .github` → no hits. Its wiring pins (routes-multiview.js `ctx._multiviewLayout = b`, routing-setup.js `reapplyAllMultiviewLayouts`, ws-server.js `_multiviewLayouts[`) all still match.

## tools/smoke/smoke-multiview-timers-geometry.test.js
- `DEAD` tools/smoke/smoke-multiview-timers-geometry.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-multiview-timers-geometry" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-new-project.test.js
- `OK`

## tools/smoke/smoke-no-duplicate-standard-video-mode.test.js
- `QUALITY` tools/smoke/smoke-no-duplicate-standard-video-mode.test.js:63 — `assert.equal(960 * 50000, 48000 * 1000)` is arithmetic on constants and can never fail. The real check is the cadence/time-scale pin on the line above it.

## tools/smoke/smoke-no-root-portaudio-without-consumers.test.js
- `OK`

## tools/smoke/smoke-operator-gui-4k-layout-rect.test.js
- `OK`

## tools/smoke/smoke-operator-gui-reconnect-reassert.test.js
- `OK`

## tools/smoke/smoke-os-config-persist.test.js
- `QUALITY` tools/smoke/smoke-os-config-persist.test.js:8 — named "os config persist" but tests only source-text absence of `xcmd`/`xrandrParts` and two regexes in os-config-xrandr-apply.js. No persistence behaviour is covered, and the name over-claims.

## tools/smoke/smoke-os-layout-offset-overlap.test.js
- `OK`

## tools/smoke/smoke-os-layout-w40.js
- `DEAD` tools/smoke/smoke-os-layout-w40.js:1 — not in curated list. Reached only by manual script `test:os-layout-w40` (package.json:58).

## tools/smoke/smoke-os-mode-source.js
- `DEAD` tools/smoke/smoke-os-mode-source.js:1 — not in curated list. Reached only by manual script `test:os-mode-source` (package.json:62).

## tools/smoke/smoke-osc-float-endian.test.js
- `OK`

## tools/smoke/smoke-osc-info-supplement-gate.test.js
- `OK`

## tools/smoke/smoke-osc-multichannel-vars.test.js
- `DEAD` tools/smoke/smoke-osc-multichannel-vars.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-osc-multichannel-vars" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-osc-stale-audio.test.js
- `DEAD` tools/smoke/smoke-osc-stale-audio.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-osc-stale-audio" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-parse-body-strict.test.js
- `OK`

## tools/smoke/smoke-periodic-sync-interval.test.js
- `DEAD` tools/smoke/smoke-periodic-sync-interval.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-periodic-sync-interval" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-persistence-immediate.test.js
- `QUALITY` tools/smoke/smoke-persistence-immediate.test.js:8-9 — `typeof` checks only. It never calls `setImmediate` or `flushSync`, so it would pass for a broken implementation that merely exports the names.

## tools/smoke/smoke-pip-overlay-crop-border.test.js
- `DEAD` tools/smoke/smoke-pip-overlay-crop-border.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-pip-overlay-crop-border" tools/ci package.json .github` → no hits. Its pins (template/pip_border.html, docs/reference/pip-overlay-outside-border.md) exist.

## tools/smoke/smoke-pip-overlay-placement.test.js
- `QUALITY` tools/smoke/smoke-pip-overlay-placement.test.js:131 — `assert.ok(!/^CG 2-260 UPDATE/m.test(joined) || joined.includes('CG 2-260 ADD'))` is implied by the assertion at :130 (`includes('CG 2-260 ADD')`), so it cannot fail independently.

## tools/smoke/smoke-planned-channel-map.test.js
- `DEAD` tools/smoke/smoke-planned-channel-map.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-planned-channel-map" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-playlist-item-loop.test.js
- `OK`

## tools/smoke/smoke-playlist-osc-index-match.test.js
- `OK`

## tools/smoke/smoke-pointer-confine-geometry-follow.test.js
- `OK`

## tools/smoke/smoke-preview-amcp-channel.mjs
- `DEAD` tools/smoke/smoke-preview-amcp-channel.mjs:1 — not a `.test.js`, excluded by name in tools/ci/collect-offline-tests.js (`/^smoke-preview-amcp-channel/i`), and no package.json or .github reference. Orphan standalone script.

## tools/smoke/smoke-preview-live-clear.test.js
- `DEAD` tools/smoke/smoke-preview-live-clear.test.js:1 — not in curated list, no package.json script. grep: `rg -n "smoke-preview-live-clear" tools/ci package.json .github` → no hits.

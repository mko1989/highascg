# tools/smoke (part 9) — sweep 29.10.2026 (batch 130)

Files: 52 · lines: 7029 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 7 RISK, 22 QUALITY

## tools/smoke/smoke-wo502-wo503-gpu-texture-and-blind-sweep.test.js
- `OK`
## tools/smoke/smoke-wo504-no-boot-card-on-operator-channel.test.js
- `OK`
## tools/smoke/smoke-wo505-mapping-mode-fills-dimensions.test.js
- `OK`
## tools/smoke/smoke-wo506-source-labels.test.js
- `OK`
## tools/smoke/smoke-wo507-wo508-decklink-io-collision-and-single-instance.test.js
- `QUALITY` tools/smoke/smoke-wo507-wo508-decklink-io-collision-and-single-instance.test.js:145-152 — the WO-513/527 "MVR pseudo-port is gone" block duplicates the assertions in smoke-wo527-no-mvr-pseudo-port.test.js:57-61 (`addDecklinkPort(99,`, `SDI (MVR)`). Keep one copy.
## tools/smoke/smoke-wo509-tiled-screen-releases-and-applies.test.js
- `OK`
## tools/smoke/smoke-wo512-rsync-excludes-anchored.test.js
- `OK`
## tools/smoke/smoke-wo515-apply-layout-guard.test.js
- `QUALITY` tools/smoke/smoke-wo515-apply-layout-guard.test.js:130 — the "guarded" pin `/try \{[\s\S]*?collectScreenLayoutWarnings[\s\S]*?\} catch/` matches any try/catch that appears before the call anywhere in device-view-apply.js. It does not prove the guard sits inside the try. Anchor it to the guard's own block.
## tools/smoke/smoke-wo518-drag-highlight-cleanup.test.js
- `OK`
## tools/smoke/smoke-wo519-take-fails-bright.test.js
- `OK`
## tools/smoke/smoke-wo520-exchange-contain-fit.test.js
- `QUALITY` tools/smoke/smoke-wo520-exchange-contain-fit.test.js:82-85 — the test is named "it never grows content past the old box" but asserts `fit(BOX, 40, 20)` deep-equals `BOX`, i.e. it scales the tiny source UP to the box. Rename it to match the assertion.
## tools/smoke/smoke-wo522-timeline-geometry-throttle.test.js
- `QUALITY` tools/smoke/smoke-wo522-timeline-geometry-throttle.test.js:43 — `runs < 10` over 50 calls with real 50 ms timers and 200 ms sleeps is wall-clock dependent and can flake under CI load.
## tools/smoke/smoke-wo523-clip-exchange-preserves.test.js
- `OK`
## tools/smoke/smoke-wo525-shared-source-label.test.js
- `OK`
## tools/smoke/smoke-wo527-no-mvr-pseudo-port.test.js
- `OK`
## tools/smoke/smoke-wo528-take-opacity-not-slammed.test.js
- `OK`
## tools/smoke/smoke-wo530-compose-labels-and-surfaces.test.js
- `OK`
## tools/smoke/smoke-wo531-authoring-canvas-follows-target.test.js
- `QUALITY` tools/smoke/smoke-wo531-authoring-canvas-follows-target.test.js:109-111 — `withOpts` comes from `s.match(...) || []`. If the regex stops matching, the loop body never runs and the test passes. Add `assert.ok(withOpts.length > 0)`.
## tools/smoke/smoke-wo532-look-geometry-follows-its-screen.test.js
- `OK`
## tools/smoke/smoke-wo534-source-label-survives-save.test.js
- `OK`
## tools/smoke/smoke-wo535-companion-press-and-preview.test.js
- `OK`
## tools/smoke/smoke-wo536-looping-clip-seeks-instead-of-restarting.test.js
- `OK`
## tools/smoke/smoke-wo537-look-timeline-starts-where-asked.test.js
- `QUALITY` tools/smoke/smoke-wo537-look-timeline-starts-where-asked.test.js:139-159 — the "cannot fail dark" test enumerates a local copy of the take decision (`fadeDur`, `jobFade`, `bankXf`, `guardRuns`) and never calls production code. `fadesIn` is true in both reachable states, so the test cannot fail when scene-take-lbg*.js changes.
- `QUALITY` tools/smoke/smoke-wo537-look-timeline-starts-where-asked.test.js:62,79 — wall-clock `< 40` ms bounds on `Date.now()` after a real resume. Flaky under load.
## tools/smoke/smoke-wo540-teardown-opacity-verify.test.js
- `QUALITY` tools/smoke/smoke-wo540-teardown-opacity-verify.test.js:78,149 — upper wall-clock bounds (`elapsed < 400`, `< 300`) on the poll and teardown timing. These can fail on a slow runner.
## tools/smoke/smoke-wo541-timeline-only-look-crossfade.test.js
- `OK`
## tools/smoke/smoke-wo542-flag-timecode-and-jump-label.test.js
- `OK`
## tools/smoke/smoke-wo543-companion-flag-fire-and-log.test.js
- `RISK` tools/smoke/smoke-wo543-companion-flag-fire-and-log.test.js:156-175 — `eng.play('tl1')` and `eng.play('tl2')` start the real `setInterval` ticker (src/engine/timeline-playback-runtime.js:96) and the test never pauses or stops the engine. The ticker is not unref'd. Not run, so whether the file process hangs is unverified; tools/ci/run-offline-tests.js:33-35 does not pass `--test-force-exit`.
- `QUALITY` tools/smoke/smoke-wo543-companion-flag-fire-and-log.test.js:187-203 — `assert.equal(!!require.cache[modPath], wasCached)` is inverted when `wasCached` is true. Correct code leaves the module out of the cache, so actual `false` ≠ expected `true` and the test fails on correct code. It is latent because each test file runs in its own process. Assert `!require.cache[modPath]` after the press instead.
## tools/smoke/smoke-wo544-timeline-clip-keyframe-vs-take-fade.test.js
- `OK`
## tools/smoke/smoke-wo545-opacity-exit-hold.test.js
- `OK`
## tools/smoke/smoke-wo546-preview-exchange-timeline-guard.test.js
- `OK`
## tools/smoke/smoke-wo548-retake-same-timeline-look.test.js
- `QUALITY` tools/smoke/smoke-wo548-retake-same-timeline-look.test.js:49-56 — the "reproduces the pre-fix regression" test recomputes the OR-condition locally (`[1, 2].includes(1)`, `[].find(...)`) and never calls `resolveActiveTimelineIdToFadeOut`. It cannot fail.
## tools/smoke/smoke-wo549-preview-only-timeline-routing.test.js
- `OK`
## tools/smoke/smoke-wo550-preview-only-call-never-kills-program.test.js
- `OK`
## tools/smoke/smoke-wo552-timeline-stop-never-affects-program.test.js
- `OK`
## tools/smoke/smoke-wo553-look-timeline-setsendto-race.test.js
- `OK`
## tools/smoke/smoke-wo553b-timeline-exit-crossfade-no-doubleramp.test.js
- `OK`
## tools/smoke/smoke-wo554-timeline-look-double-play.test.js
- `RISK` tools/smoke/smoke-wo554-timeline-look-double-play.test.js:127-131 — the real take (no `deferPlay`) calls `startSceneTimelineLayer`, which calls `eng.play()` and starts the ticker. The test never stops the engine. Same leak as smoke-wo543 (unverified).
- `QUALITY` tools/smoke/smoke-wo554-timeline-look-double-play.test.js:145-170 — the "regression check" asserts that without `deferPlay` the preview gets a PLAY (`counts == [1, 1]`). It pins the duplicate PLAY as the expected result, so any staging-path fix that removes it fails this test. Invert it or drop it.
## tools/smoke/smoke-wo555-timeline-preview-routing-corruption.test.js
- `RISK` tools/smoke/smoke-wo555-timeline-preview-routing-corruption.test.js:97,113,135 — `startSceneTimelineLayer` and `eng.play()` start a live ticker and the file never calls `stop()`/`pause()` (the tests at 95-118 and 131-161). Same leak as smoke-wo543 (unverified).
- `QUALITY` tools/smoke/smoke-wo555-timeline-preview-routing-corruption.test.js:120-128 — the "regression check" computes `oldCh.filter(...)` in the test body and never touches `setSendTo`. It cannot fail.
## tools/smoke/smoke-wo556-preview-flash-and-exit-restart.test.js
- `RISK` tools/smoke/smoke-wo556-preview-flash-and-exit-restart.test.js:135-163,167-183 — both tests play the timeline through `startSceneTimelineLayer` (lines 138, 169) and never stop or pause it. The ticker leaks into the rest of the file (unverified, see smoke-wo543).
- `QUALITY` tools/smoke/smoke-wo556-preview-flash-and-exit-restart.test.js:144-146 — the test writes the private cell fields `_p0` and `_t0` to fake the elapsed time. This couples it to the internal playback-cell layout.
## tools/smoke/smoke-wo558-tick-after-routing-change.test.js
- `RISK` tools/smoke/smoke-wo558-tick-after-routing-change.test.js:89,107,129 — `startSceneTimelineLayer` plays tl1 and no test stops it. Same ticker leak (unverified, see smoke-wo543).
- `QUALITY` tools/smoke/smoke-wo558-tick-after-routing-change.test.js:105-125 — titled "reverting the cache fix reproduces the wire capture", but it never reverts the fix. It clears `_prevKey`, `_lastKfValues` and `_lastKfSegment` by hand and asserts `_tick()` restarts program. It tests a hand-built state, so it would not catch the fix regressing.
## tools/smoke/smoke-wo559-timeline-take-leaves-preview-for-flipflop.test.js
- `RISK` tools/smoke/smoke-wo559-timeline-take-leaves-preview-for-flipflop.test.js:71,82,91,105 — `startSceneTimelineLayer` plays the timeline in every test and none of them stops it. Same ticker leak (unverified, see smoke-wo543).
- `QUALITY` tools/smoke/smoke-wo559-timeline-take-leaves-preview-for-flipflop.test.js:114-120 — the "regression check" asserts `preFixPreview === true` on its own constant. It cannot fail.
## tools/smoke/smoke-wo560-timeline-layer-not-missing-media.test.js
- `QUALITY` tools/smoke/smoke-wo560-timeline-layer-not-missing-media.test.js:100 — `assert.match(src, /'timeline'/)` matches almost any file. Only line 99 checks the guard. Pin the actual guard text.
## tools/smoke/smoke-wo561-timeline-replaces-normal-layer-exit.test.js
- `QUALITY` tools/smoke/smoke-wo561-timeline-replaces-normal-layer-exit.test.js:117-119 — the slice runs from the first `layer.source.type === 'timeline'` to `let clipRaw = clipPath(layer)`. If either marker is missing, `indexOf` returns -1 and `slice(start, -1)` covers most of the file, so the test can pass on the wrong code. Assert both markers exist first.
## tools/smoke/smoke-wo570-look-media-transport.test.js
- `QUALITY` tools/smoke/smoke-wo570-look-media-transport.test.js:31,45,58,105 — tight wall-clock windows (`4990..5050`, `4990..5100`, `19950..20100`, `9950..10100` ms) on `Date.now()` after real timers. Flaky under load.
## tools/smoke/smoke-wo572-audio-only-look.test.js
- `OK`
## tools/smoke/smoke-wo573-operator-gui-multiview-separate-binding.test.js
- `QUALITY` tools/smoke/smoke-wo573-operator-gui-multiview-separate-binding.test.js:21-23 — the test monkey-patches the shared `hardware-info` exports. The stub only holds because src/utils/xrandr-layout-verify.js:3 destructures `getDisplaysXrandrDetailed` at load, and that module first loads after line 22. Reordering the requires silently sends the test to the box's live xrandr.
## tools/smoke/smoke-wo573-operator-gui-topology-dims-collision.test.js
- `OK`
## tools/smoke/smoke-wo574-multi-screen-take-sync-barrier.test.js
- `QUALITY` tools/smoke/smoke-wo574-multi-screen-take-sync-barrier.test.js:159 — `pipe.indexOf('setTimeout(r, prebufferMs)')` is a stale pin. Production is now `setTimeout(r, relativeSeekPlayWaitMs(self, channel, prebufferMs))` (src/engine/scene-take-lbg-amcp-pipeline.js:294). `indexOf` returns -1, `-1 < n` is true, and the prebuffer-before-crossfade ordering is never checked. Repoint the pin and assert both indices are >= 0.
- `QUALITY` tools/smoke/smoke-wo574-multi-screen-take-sync-barrier.test.js:40,62,66 — sub-25 ms skew and sub-50 ms bounds on real timers. Flaky under load.
## tools/smoke/smoke-wo576-look-clip-start-point.test.js
- `OK`
## tools/smoke/smoke-wo577-shader-controls.test.js
- `RISK` tools/smoke/smoke-wo577-shader-controls.test.js:24-26 — `library()` calls `reconcileShaderStore()`, which writes into the real `data/shaders` (src/shaderfx/shader-store.js:25, no NODE_TEST_CONTEXT redirect) and into the tracked `template/shaders` (shader-store.js:242-280). On this box `data/shaders` holds 190 files and `template/shaders` 194, so a run would write into live `data/`. The assertions at lines 36 and 51 also depend on whatever library is on disk.
## tools/smoke/smoke-wo578-audio-output-autosave.test.js
- `OK`
## tools/smoke/smoke-wo581-playlist-take-starts-on-set-item.test.js
- `QUALITY` tools/smoke/smoke-wo581-playlist-take-starts-on-set-item.test.js:85,128-130,146 — single-letter regexes (`/b/i`, `/a/i`, `/c/i`) match most clip names, so the item-identity checks can pass on the wrong item. Match the resolved CLS id or the exact file name.

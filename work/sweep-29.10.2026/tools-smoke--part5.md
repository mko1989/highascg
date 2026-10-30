# tools/smoke (part 5) — sweep 29.10.2026 (batch 126)

Files: 56 · lines: 6992 · findings: 0 BUG-HIGH, 0 BUG, 30 DEAD, 4 RISK, 27 QUALITY

Method: every file read in full. DEAD = not in tools/ci/offline-test-files*.js (grep `rg -n "<basename>" tools/ci package.json .github`). Files outside the curated list still run under `npm run test:ci:full` (tools/ci/collect-offline-tests.js walks tools/smoke), but ci.yml only calls `npm run test:ci`, so they never run in CI. Pins checked with rg against current production text. No test was run.

## tools/smoke/smoke-stream-key-redaction.test.js
- `QUALITY` tools/smoke/smoke-stream-key-redaction.test.js:42-49 — the "no pushRtmpLog call passes a raw url" guard only matches the literal `url: built.url`. The stop path logs shorthand `{ url }` at src/api/routes-streaming-channel-rtmp.js:210, :217, :222, which this guard cannot see. Those lines are safe today only because `sanitizeLogExtra` (src/streaming/streaming-channel-status.js:11-17) redacts `extra.url`, and no test here pins that function.

## tools/smoke/smoke-stream-output-ndi-srt.test.js
- `OK`

## tools/smoke/smoke-stream-output-project-sync.test.js
- `OK`

## tools/smoke/smoke-streaming-channel-ffmpeg.test.js
- `DEAD` tools/smoke/smoke-streaming-channel-ffmpeg.test.js:1 — not in any curated list. grep: `rg -n "smoke-streaming-channel-ffmpeg" tools/ci package.json .github` → no hits. Runs only under test:ci:full.

## tools/smoke/smoke-streaming-channel-status.test.js
- `OK`

## tools/smoke/smoke-system-time.test.js
- `QUALITY` tools/smoke/smoke-system-time.test.js:153-176 — the "accepts valid date-time" tests only assert that stderr lacks "Invalid date"/"Invalid time". The non-root run exits at scripts/runtime/highascg-set-system-time.sh:59-61 ("Run as root") before any success path, so the positive path is never reached. Also :108-114 uses the same negative-only check.

## tools/smoke/smoke-tailscale-status.test.js
- `DEAD` tools/smoke/smoke-tailscale-status.test.js:1 — not in any curated list. grep: `rg -n "smoke-tailscale-status" tools/ci package.json .github` → no hits.
- `QUALITY` tools/smoke/smoke-tailscale-status.test.js:49-55 — `if (!fs.existsSync(snapSock)) return` makes the test pass vacuously on any host without the snap socket.
- `RISK` tools/smoke/smoke-tailscale-status.test.js:52 — when the snap socket exists, `getTailscaleStatus()` runs the tailscale CLI and `systemctl is-active` on the live host (src/network/tailscale-service.js:128, :140). Read-only, but it is a real exec on the box.

## tools/smoke/smoke-template-cinf-skip.test.js
- `DEAD` tools/smoke/smoke-template-cinf-skip.test.js:1 — not in any curated list. grep: `rg -n "smoke-template-cinf-skip" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-timeline-audio-route.test.js
- `DEAD` tools/smoke/smoke-timeline-audio-route.test.js:1 — not in any curated list. grep: `rg -n "smoke-timeline-audio-route" tools/ci package.json .github` → no hits.
- `QUALITY` tools/smoke/smoke-timeline-audio-route.test.js:3-48 — bare top-level asserts with no `test()` wrappers. The first failure aborts the file with a stack and names no case.

## tools/smoke/smoke-timeline-clip-layout.test.js
- `DEAD` tools/smoke/smoke-timeline-clip-layout.test.js:1 — not in any curated list. grep: `rg -n "smoke-timeline-clip-layout" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-timeline-compose-preview.test.js
- `DEAD` tools/smoke/smoke-timeline-compose-preview.test.js:1 — not in any curated list. grep: `rg -n "smoke-timeline-compose-preview" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-timeline-keyframe-dnd.test.js
- `DEAD` tools/smoke/smoke-timeline-keyframe-dnd.test.js:1 — not in any curated list. grep: `rg -n "smoke-timeline-keyframe-dnd" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-timeline-keyframe-mixer.test.js
- `DEAD` tools/smoke/smoke-timeline-keyframe-mixer.test.js:1 — not in any curated list. grep: `rg -n "smoke-timeline-keyframe-mixer" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-timeline-opacity-fade.test.js
- `OK` (pinned `OPACITY 1 13 linear DEFER` shape matches src/engine/timeline-playback-amcp-schedule.js:257)

## tools/smoke/smoke-timeline-pause-resume.test.js
- `QUALITY` tools/smoke/smoke-timeline-pause-resume.test.js:48 — `const pausedPos` in the first block is declared and never read.

## tools/smoke/smoke-timeline-per-id-playback.test.js
- `QUALITY` tools/smoke/smoke-timeline-per-id-playback.test.js:45 — `assert.ok(paused1 >= 3000, 'tl1 position advances while playing')` cannot detect a stalled playhead, because the position only has to be at or above the seek value.

## tools/smoke/smoke-timeline-playing-seek.test.js
- `QUALITY` tools/smoke/smoke-timeline-playing-seek.test.js:85 — `resolveClipDurationMs: () => 5040` is never read by the timeline engine. The only callers are src/state/playback-tracker.js:26 and playback-tracker-osc.js:129, so the "stretched clip" block (:80-134) does not exercise the stretch path it names.

## tools/smoke/smoke-timeline-sendto.test.js
- `DEAD` tools/smoke/smoke-timeline-sendto.test.js:1 — not in any curated list. grep: `rg -n "smoke-timeline-sendto" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-timeline-take.test.js
- `OK`

## tools/smoke/smoke-timer-clock-jitter.test.js
- `OK`

## tools/smoke/smoke-tls-parse.test.js
- `DEAD` tools/smoke/smoke-tls-parse.test.js:1 — not in any curated list. grep: `rg -n "smoke-tls-parse" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-usb-lsblk.js
- `DEAD` tools/smoke/smoke-usb-lsblk.js:1 — not in any curated list and not a `.test.js`, so collect-offline-tests skips it. Only `npm run smoke:usb-lsblk` (package.json:45) runs it. grep: `rg -n "smoke-usb-lsblk" tools/ci package.json .github` → package.json only.

## tools/smoke/smoke-v4l2-input.test.js
- `DEAD` tools/smoke/smoke-v4l2-input.test.js:1 — not in any curated list. grep: `rg -n "smoke-v4l2-input" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-vcam-stream-mode.test.js
- `DEAD` tools/smoke/smoke-vcam-stream-mode.test.js:1 — not in any curated list. grep: `rg -n "smoke-vcam-stream-mode" tools/ci package.json .github` → no hits.
- `QUALITY` tools/smoke/smoke-vcam-stream-mode.test.js:18 — `fs.mkdtempSync` creates a temp directory with no `after` cleanup, so each run leaves one behind.

## tools/smoke/smoke-virtual-camera.test.js
- `DEAD` tools/smoke/smoke-virtual-camera.test.js:1 — not in any curated list. grep: `rg -n "smoke-virtual-camera" tools/ci package.json .github` → no hits.
- `RISK` tools/smoke/smoke-virtual-camera.test.js:39-41 — `writeVcamModulesConf()` writes the real `/run/highascg/vcam-modules.conf` (src/virtual-output/v4l2-kernel-modules.js:15, :71-86: mkdirSync + writeFileSync). It is not a temp path. On the live box it overwrites the CARD_LABEL that the root wrapper reads, so the test changes live config.
- `QUALITY` tools/smoke/smoke-virtual-camera.test.js:35 — `assert.equal(typeof alsaLoopbackCardPresent(...), 'boolean')` checks only the type, so it can never catch a wrong answer.

## tools/smoke/smoke-wiki.test.js
- `OK` (verified: HIGHASCG_WIKI_OUT_DIR is honored at tools/wiki/build-wiki.js:22, so the build stays in a temp dir; `wiki--api--README` exists in docs/wiki-site/manifest.json:178)

## tools/smoke/smoke-wo160-layer-bands.test.js
- `DEAD` tools/smoke/smoke-wo160-layer-bands.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo160-layer-bands" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-wo160b-pgm-only-lbg.test.js
- `QUALITY` tools/smoke/smoke-wo160b-pgm-only-lbg.test.js:16-24 — the test named "computes pgmOnly flag" asserts only `typeof handleSceneTake === 'function'`. The flag at src/api/routes-scene-take.js:412 is never checked, so the test cannot fail on it.

## tools/smoke/smoke-wo172-device-view-sync.test.js
- `RISK` tools/smoke/smoke-wo172-device-view-sync.test.js:199-216 — the "opts in" test runs the real `applyCasparConfigToDiskAndRestart` unless the stub at :204 binds. The stub binds only because src/api/device-view-decklink-wiring.js:227 requires routes-caspar-config inside the function body. Hoisting that require to module scope would make this test bounce live Caspar.
- `QUALITY` tools/smoke/smoke-wo172-device-view-sync.test.js:218-238 — waits 30 ms real time for a 1 ms debounce (scheduleDeviceViewCasparSync at device-view-decklink-wiring.js:148). Timing-dependent under load.

## tools/smoke/smoke-wo172-restart-dirty-policy.test.js
- `DEAD` tools/smoke/smoke-wo172-restart-dirty-policy.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo172-restart-dirty-policy" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-wo172-streaming-record-audio.test.js
- `DEAD` tools/smoke/smoke-wo172-streaming-record-audio.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo172-streaming-record-audio" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-wo173-clip-start-batch.test.js
- `DEAD` tools/smoke/smoke-wo173-clip-start-batch.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo173-clip-start-batch" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-wo173-keyframe-batch-tick.test.js
- `DEAD` tools/smoke/smoke-wo173-keyframe-batch-tick.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo173-keyframe-batch-tick" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-wo173-volume-measurement.test.js
- `DEAD` tools/smoke/smoke-wo173-volume-measurement.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo173-volume-measurement" tools/ci package.json .github` → no hits.
- `QUALITY` tools/smoke/smoke-wo173-volume-measurement.test.js:103-112 — the assertion bound is literal `40`, while the test's own comment (:108-111) expects 6 lines. `maxExpected` (:112) is computed and never asserted. The test name says "volume" but it counts MIXER OPACITY lines.

## tools/smoke/smoke-wo177-mixer-update-whitelist.test.js
- `DEAD` tools/smoke/smoke-wo177-mixer-update-whitelist.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo177-mixer-update-whitelist" tools/ci package.json .github` → no hits.
- `QUALITY` tools/smoke/smoke-wo177-mixer-update-whitelist.test.js:41-65 — the test re-implements the handler as `mixerUpdateHandler` and never imports production. The real code is client/lib/app-ws-handlers.js:253-270, so a regression there cannot fail this test.
- `QUALITY` tools/smoke/smoke-wo177-mixer-update-whitelist.test.js:133-145 — "opacity echo applies after guard window expires" asserts only `typeof isLayerRecentlyEdited === 'function'`. The 1500 ms guard (client/lib/scene-state-layer-logic.js:164) is untested.

## tools/smoke/smoke-wo179-artnet-defaults.test.js
- `DEAD` tools/smoke/smoke-wo179-artnet-defaults.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo179-artnet-defaults" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-wo179-fixture-transform.test.js
- `DEAD` tools/smoke/smoke-wo179-fixture-transform.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo179-fixture-transform" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-wo179-protocol-dispatch.test.js
- `DEAD` tools/smoke/smoke-wo179-protocol-dispatch.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo179-protocol-dispatch" tools/ci package.json .github` → no hits.
- `QUALITY` tools/smoke/smoke-wo179-protocol-dispatch.test.js:1-37 — the name says "dispatch", but it only exercises the slotLightingProtocol() normalizer (src/artnet/artnet-slot-config.js:18). No dispatch path is tested.

## tools/smoke/smoke-wo179-region-average.test.js
- `DEAD` tools/smoke/smoke-wo179-region-average.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo179-region-average" tools/ci package.json .github` → no hits.

## tools/smoke/smoke-wo187-template-thumb.test.js
- `DEAD` tools/smoke/smoke-wo187-template-thumb.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo187-template-thumb" tools/ci package.json .github` → no hits.
- `QUALITY` tools/smoke/smoke-wo187-template-thumb.test.js:30-36 — "clearTemplateThumbCache removes all cached entries" asserts only `assert.ok(true)` (:35) and no-throw. It cannot fail on a cache that is not cleared.

## tools/smoke/smoke-wo196-countdown-lifecycle.test.js
- `QUALITY` tools/smoke/smoke-wo196-countdown-lifecycle.test.js:114-119 — declares liveSceneStateMock, originalGetAll, projectScenesLoadMock and originalLoadFullProject under a comment that says "Temporarily mock loadFullProject". Nothing is mocked and the variables are unused. The test therefore reads the real live state and the real projects/ tree (read-only).

## tools/smoke/smoke-wo199-prv-logical-layers.test.js
- `DEAD` tools/smoke/smoke-wo199-prv-logical-layers.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo199-prv-logical-layers" tools/ci package.json .github` → no hits.
- `QUALITY` tools/smoke/smoke-wo199-prv-logical-layers.test.js:43-61 — the test sets `programLayerBankByChannel['2']='a'` itself and then asserts that value. It never calls production code, so it is a tautology and cannot fail.

## tools/smoke/smoke-wo206-mv-drag-guard.test.js
- `DEAD` tools/smoke/smoke-wo206-mv-drag-guard.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo206-mv-drag-guard" tools/ci package.json .github` → no hits.
- `QUALITY` tools/smoke/smoke-wo206-mv-drag-guard.test.js:45-51 — the listener regex `on\(...apply-request...[\s\S]*?dragInProgress[\s\S]*?return` lazily matches any later `return` in client/components/multiview-editor.js. It does not prove the guard sits inside the listener.

## tools/smoke/smoke-wo207-cg-orphan-sweep.test.js
- `OK` (production header comment at src/engine/template-cg-orphan-sweep.js:3 says the band is 700-899, but the sweep at :98 clears 700-789 and the test correctly pins 700-789. Stale comment is in production, not this file.)

## tools/smoke/smoke-wo209-bankless-preview.test.js
- `DEAD` tools/smoke/smoke-wo209-bankless-preview.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo209-bankless-preview" tools/ci package.json .github` → no hits.
- `QUALITY` tools/smoke/smoke-wo209-bankless-preview.test.js:167 — `hasSweepStop || sentLines.length > 0` is true whenever anything was sent, so the "opposite-bank sweep" assertion cannot fail.

## tools/smoke/smoke-wo210-screen-timers-persistence-and-guards.test.js
- `QUALITY` tools/smoke/smoke-wo210-screen-timers-persistence-and-guards.test.js:170-171 — `loadRegistry()` is called twice and the `registry` const is never used.

## tools/smoke/smoke-wo210-screen-timers.test.js
- `OK`

## tools/smoke/smoke-wo211-playlist-loop.test.js
- `OK`

## tools/smoke/smoke-wo212-mv-playlist-labels.test.js
- `RISK` tools/smoke/smoke-wo212-mv-playlist-labels.test.js:50 — `buildPlaylistRowLabel` is extracted from template source with `/function buildPlaylistRowLabel\([\s\S]*?\n\t\t\}/`, which depends on the template's tab indentation. A reformat of the template silently breaks the extraction.
- `QUALITY` tools/smoke/smoke-wo212-mv-playlist-labels.test.js:65-85 — the test uses a hand-written copy of friendlyRouteLabel rather than the production function (template/multiview_master.js:235). Production parity is only checked in smoke-wo223-route-labels.

## tools/smoke/smoke-wo213-preview-invalidate.test.js
- `QUALITY` tools/smoke/smoke-wo213-preview-invalidate.test.js:66 — `/addEventListener.*scenes-preview-invalidate.*clearLastPreviewLayers/s` is not anchored to the listener. It would pass if those words appeared anywhere in client/components/scenes-preview-runtime.js. The real listener is at :90.

## tools/smoke/smoke-wo214-timeline-mixer-rows.test.js
- `QUALITY` tools/smoke/smoke-wo214-timeline-mixer-rows.test.js:119-148 — `importAudioMixerRowsForTest()` swallows the import error and returns `{}`. The behavioral check then logs "skipped" and returns (:121-124), so it passes without running. client/lib/audio-mixer-rows.js:1-8 imports browser-only modules, so this branch is likely never executed. The source-grep checks are the only real guard. Header line :10 also cites a stale line (`audio-mixer-rows.js:77`).

## tools/smoke/smoke-wo217-self-blank-guard.test.js
- `OK`

## tools/smoke/smoke-wo218-bank-drift.test.js
- `DEAD` tools/smoke/smoke-wo218-bank-drift.test.js:1 — not in any curated list. grep: `rg -n "smoke-wo218-bank-drift" tools/ci package.json .github` → no hits.
- `QUALITY` tools/smoke/smoke-wo218-bank-drift.test.js:127-132 — `activeBank2`, `inactiveBank2`, `physLayer10Active`, `physLayer10Inactive`, `physLayer11Active`, `physLayer11Inactive` are declared and never used.

## tools/smoke/smoke-wo220-shadow-geometry.test.js
- `QUALITY` tools/smoke/smoke-wo220-shadow-geometry.test.js:14-31 — `outsetPxForShadow` and `expandFillOutward` are re-implemented in the test instead of imported. The production equivalents are client/lib/pip-overlay-amcp.js:54-70 (outsetPxForPipOverlay) and :79 (expandFillOutward). The math tests cannot fail on a production regression. Only the template-marker tests (:106-130) read real code.

## tools/smoke/smoke-wo222-screen-labels.test.js
- `OK`

## tools/smoke/smoke-wo223-route-labels.test.js
- `QUALITY` tools/smoke/smoke-wo223-route-labels.test.js:142 — the syntax check writes to the fixed name `os.tmpdir()/master_script_check.js`, so two overlapping runs would collide.

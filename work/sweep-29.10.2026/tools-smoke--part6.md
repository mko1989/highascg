# tools/smoke (part 6) — sweep 29.10.2026 (batch 127)

Files: 35 · lines: 6758 · findings: 0 BUG-HIGH, 0 BUG, 4 DEAD, 5 RISK, 33 QUALITY

Method: every listed file read in full. CI membership checked with `rg -n "<basename>" tools/ci package.json .github`
(curated lists are tools/ci/offline-test-files.js + offline-test-files-2.js, run by run-offline-tests.js via `npm run test:ci`,
which ci.yml:60 runs). Every readFileSync/regex/string pin was checked against the CURRENT production text (literal and
regex checks run against the files, concatenated where a test concatenates them). Every require path and export name the
tests use was checked against module.exports. Nothing was executed.

## tools/smoke/smoke-wo224-playlist-wrap.test.js
- `DEAD` tools/smoke/smoke-wo224-playlist-wrap.test.js:1 — in no curated list. grep: `rg -n "smoke-wo224-playlist-wrap" tools/ci package.json .github` → nothing. Only `collect-offline-tests.js` (full run, `npm run test:ci:full`) picks it up; CI runs `test:ci`, so it never runs in CI.
- `QUALITY` tools/smoke/smoke-wo224-playlist-wrap.test.js:410-418 — `eng.__test_schedulePlaylistImageTimer?.(...)` targets an export that does not exist in src (`rg -n __test_schedulePlaylistImageTimer src` → nothing), so the first branch is dead and every run takes the `triggerPlaylistAdvance` fallback. The final assertion is an OR (`activeIndex === 2 || played.some(...)`) that can pass on either side, and it relies on a real 120 ms timer against a 0.02 s image duration.
- `QUALITY` tools/smoke/smoke-wo224-playlist-wrap.test.js:5,157,115 — unused `const Module = require('module')` (5) and unused `handlePost` destructure (157); the message at 115 says "should preload item3... but wrap to item0", which is stale wording.

## tools/smoke/smoke-wo226-timer-overlay.test.js
- `QUALITY` tools/smoke/smoke-wo226-timer-overlay.test.js:150-152 — substring-only pins: `src.includes('opacity')` and `src.includes('fadeFrames')` match any mention of those words anywhere in inspector-screen-timer.js, so they would not catch the feature being removed while the word survives in a comment.
- `QUALITY` tools/smoke/smoke-wo226-timer-overlay.test.js:34-39 — `Module.prototype.require` is patched globally to intercept `'../utils/persistence'` and is never restored. It is safe only because node --test runs each file in its own process.

## tools/smoke/smoke-wo227-mixer-dense.test.js
- `QUALITY` tools/smoke/smoke-wo227-mixer-dense.test.js:25 and :31 — the `/\.mixer-group--dense.*overflow-x\s*:\s*auto/s` pin uses `.*` with the s flag, so it passes if `overflow-x:auto` appears in any later rule, not in the dense rule. Same class of issue for the `[\s\S]*?width:80px` pin at :31. Anchor each pin to one rule body.

## tools/smoke/smoke-wo232-mario-static.test.js
- `QUALITY` tools/smoke/smoke-wo232-mario-static.test.js:55-73 — the test is named "sky fillRect is removed" but only asserts that `ctx.fillStyle = level.background` is absent from active lines (:69-73). It does not pin the fillRect call itself, so a different fill colour on the same rect would pass.

## tools/smoke/smoke-wo232-mario-transparent.live.test.js
- `DEAD` tools/smoke/smoke-wo232-mario-transparent.live.test.js:1 — manual only by design (`.live.` is excluded at tools/ci/collect-offline-tests.js:13 and it is in no curated list). Nothing runs it automatically.
- `QUALITY` tools/smoke/smoke-wo232-mario-transparent.live.test.js:7 and :14 — the header says puppeteer is "a production dependency here, see package.json". It is not: `rg -n puppeteer package.json` → nothing, and `node_modules` has no puppeteer. `require('puppeteer')` at :70 therefore throws, and the test takes the skip at :73 every time. Its pixel assertions (:122-128) never run. Either add the dependency or fix the header and retire the test.

## tools/smoke/smoke-wo232-template-tick.test.js
- `QUALITY` tools/smoke/smoke-wo232-template-tick.test.js:27 — `includes('Template')` is trivially true for any file with the word "Template" in it. The whole file is substring-presence checks on source text (all of them currently match), so a behavioural regression in the modal or inspector is not detectable here.

## tools/smoke/smoke-wo235-osc-compat.test.js
- `QUALITY` tools/smoke/smoke-wo235-osc-compat.test.js:206-242 — the OLD_INFO_XML fixture and the "old lineage" OSC cases are synthetic. The header (:35-40) says so, which is honest, but the legacy branches are therefore tested against what the author guessed the old binary emits, not captured output. Keep the note, or capture a real old-binary INFO.

## tools/smoke/smoke-wo236-decklink-low-latency.test.js
- `DEAD` tools/smoke/smoke-wo236-decklink-low-latency.test.js:1 — in no curated list (`rg -n "smoke-wo236-decklink" tools/ci package.json .github` → nothing; not `.live.`). Only the full collector would run it; CI does not.

## tools/smoke/smoke-wo237-monitor-channel-cheapest-mode.test.js
- `RISK` tools/smoke/smoke-wo237-monitor-channel-cheapest-mode.test.js:21-29 — `loadBoxConfig()` builds a ConfigManager on the LIVE `config/` directory and calls `load()`. config-manager.js:144-147 writes defaults when the file is absent, and :161 and :386 save one-shot migrations, so a run can write into live config/. The assertions at :43-64 also depend on the box's own config (the flat monitor channel and `inferProjectFpsFromConfig(cfg)`), not only on the generator contract. Use an injected fixture config.

## tools/smoke/smoke-wo239-osc-variables.test.js
- `QUALITY` tools/smoke/smoke-wo239-osc-variables.test.js:92 — `assert.notEqual(progress, '')` passes for any non-empty value, including `'NaN'`. Assert the numeric range the way lines 91 and 117 do.

## tools/smoke/smoke-wo242-pixelmap-screens.test.js
- `DEAD` tools/smoke/smoke-wo242-pixelmap-screens.test.js:387 — pins the `legacyJsPixelmap` flag (defined at src/config/defaults-core.js:110). grep: `rg -n legacyJsPixelmap src client --glob '*.js'` → only the definition. Nothing reads it in production; the only other readers are smoke tests (smoke-wo807-pixel-map.test.js:248 pins the same default). The flag is dead config.
- `QUALITY` tools/smoke/smoke-wo242-pixelmap-screens.test.js:386-390 — the title says the flag "gates the JS pixel-map UI entry points", but the body only checks the default value. The comment at :388-389 says the gates were removed in WO-253, so the title is false and the test checks nothing about gating.
- `QUALITY` tools/smoke/smoke-wo242-pixelmap-screens.test.js:438-445 — pins docs prose (`/mapping nodes.*canvas-splitting.*remain.*active/` and the walkthrough sentence). These break on any copy edit and prove nothing about behaviour.

## tools/smoke/smoke-wo243-operator-gui-crud-ui.test.js
- `OK`

## tools/smoke/smoke-wo243-operator-gui-guards.test.js
- `QUALITY` tools/smoke/smoke-wo243-operator-gui-guards.test.js:185-190 — the "never persist an empty cell set" guard looks only at the 400 characters before `persistence.set('operatorGuiLayout'` (:185). It passes if any `if (list.length > 0)` sits in that window, even if it does not guard the call. Check the guarded block structurally, or move the check next to the call.

## tools/smoke/smoke-wo243-operator-gui.test.js
- `OK`

## tools/smoke/smoke-wo244-stream-secret-preserve.test.js
- `QUALITY` tools/smoke/smoke-wo244-stream-secret-preserve.test.js:354-370 — not a node:test file. It runs `runTests()` on load and reports only through `process.exit` (:362, :366). `node --test` counts zero test cases, so the curated gate sees a file, not assertions.
- `QUALITY` tools/smoke/smoke-wo244-stream-secret-preserve.test.js:1-3,78 — the header still says WO-244, and `testReplaceWithNewValue` (:78) is named for replacing the value but asserts that the incoming values are ignored (WO-261). The name and the header both mislead.
- `QUALITY` tools/smoke/smoke-wo244-stream-secret-preserve.test.js:16-31,82-97,148-163,213-255,290-332 — the same mock config (and a near-copy of the settings-get config) is pasted five times. Hoist one fixture builder.

## tools/smoke/smoke-wo246-operator-monitor-auto.test.js
- `QUALITY` tools/smoke/smoke-wo246-operator-monitor-auto.test.js:91-97 — titled "detection throws / empty displays", but it passes `displays: []` and `connectors: []`. Those are not null, so operator-monitor-resolve.js never calls detection and the catch fallback is never exercised. Either pass null to force detection, or rename the test.

## tools/smoke/smoke-wo247-raw-cdp.test.js
- `OK`

## tools/smoke/smoke-wo248-chrome-binary-resolve.test.js
- `OK`

## tools/smoke/smoke-wo249-audio-pair-select.test.js
- `QUALITY` tools/smoke/smoke-wo249-audio-pair-select.test.js:113-136 and :141-154 — the "mixer rows expose sourceAudioPair" and "WO-244 preserve with audioSourcePair" tests never call production code. They recompute the ternary inline (:122, :127, :132) and assert on constants they just built (:150-151). They cannot fail on a regression.
- `QUALITY` tools/smoke/smoke-wo249-audio-pair-select.test.js:212-227 — `run()` catches every failure and sets `process.exitCode = 1`, with no node:test wrapper, so the file reports zero test cases.

## tools/smoke/smoke-wo250-timer-bank-mv-bars.test.js
- `QUALITY` tools/smoke/smoke-wo250-timer-bank-mv-bars.test.js:30 — requires `client/components/playback-timer.js`, which is an ES module (`import`/`export`) inside a `"type": "commonjs"` package (package.json:7). That works only through require(esm) (Node 22.12+ / 24, which this box runs). Also, that file contains a literal NUL byte at byte offset 15199, inside `` `${idle?.layerNum ?? ''}<NUL>${label}` `` (playback-timer.js, near the `key` template). It is probably a mangled `\x00` escape; it makes rg and git treat the file as binary. Fix the escape, and note that this test depends on require(esm).

## tools/smoke/smoke-wo251-playlist-osc-wiring.test.js
- `QUALITY` tools/smoke/smoke-wo251-playlist-osc-wiring.test.js:31-70 — the test named "change events reach handlePlaylistOscUpdate" has no spy and no assertion on dispatch. It passes if the handler never runs (the change listener in osc-lifecycle.js:68-82 is throttled). It only proves that emitting does not throw. Wrap the playlist handler with a counter.

## tools/smoke/smoke-wo252-info-duration-supplement.test.js
- `RISK` tools/smoke/smoke-wo252-info-duration-supplement.test.js:143-156 and :158-190 — assertions run inside `parseString` callbacks with a `done` argument. xml2js wraps the callback in try/catch and can re-invoke it with the thrown error (node_modules/xml2js/lib/parser.js:325-340, errThrown logic). A failing assertion can then be reported as "XML must parse" (:146, :164) or fire `done` twice. Use `parseStringPromise` and `await`.
- `QUALITY` tools/smoke/smoke-wo252-info-duration-supplement.test.js:137 — reads the private `os._channels[1]`, so the test is coupled to OscState internals. Use `getSnapshot()`.
- `QUALITY` tools/smoke/smoke-wo252-info-duration-supplement.test.js:243-263 — the loop-modulo cases sit at file top level with a `t2` alias and per-test `require`s, outside any describe block, so their names are not grouped with the rest.

## tools/smoke/smoke-wo256-operator-compose-tiles-wiring.test.js
- `QUALITY` tools/smoke/smoke-wo256-operator-compose-tiles-wiring.test.js:43-48 — "server needs no changes" only checks that `resolveCellSourceChannel` exists and that the string `WO-256` is absent from two files. It does not verify the claimed branching (role plus mainIndex only). Any future comment mentioning WO-256 breaks it, and a real behaviour change would pass.

## tools/smoke/smoke-wo258-browser-source.test.js
- `QUALITY` tools/smoke/smoke-wo258-browser-source.test.js:207-208 — pins text in a doc comment in browser-capture-args.js (`v4l2-input-bridge.js`, `virtual-output/v4l2-bridge`). That tests a comment, not the reuse.
- `QUALITY` tools/smoke/smoke-wo258-browser-source.test.js:211-213 — checks only that the string `NODE_TEST_CONTEXT` appears in host-live-sources-browser-runtime.js. It does not prove the spawn paths are guarded.

## tools/smoke/smoke-wo259-two-phase-batch.test.js
- `QUALITY` tools/smoke/smoke-wo259-two-phase-batch.test.js:148-191 — the section-2 wire-shape tests (:229-361) run against `makeMockAmcp`, which re-implements `batchSendChunked` with a hard-coded `MAX_BATCH = 64` (:150) instead of using the real AmcpBatch. Real chunking and failure aggregation are covered only in section 1, so a regression in AmcpBatch framing does not reach the three-layer take tests.
- `QUALITY` tools/smoke/smoke-wo259-two-phase-batch.test.js:294-295 — pins exact counts (6 MIXER CLEAR, including the teardown clears). Documented, but brittle to any change in extraExitCandidates.

## tools/smoke/smoke-wo260-browser-display-ui.test.js
- `QUALITY` tools/smoke/smoke-wo260-browser-display-ui.test.js:55-58 — `insp.includes(action)` with action `'return'` or `'interact'` matches the bare word, which occurs in almost any JS file. The inspector half of the parity check does not prove the inspector calls the `return` action. Match the quoted action or the request body.

## tools/smoke/smoke-wo261-project-stream-credentials.test.js
- `QUALITY` tools/smoke/smoke-wo261-project-stream-credentials.test.js:194-198 — `src.slice(src.indexOf('export async function startStreamingChannelRtmp'), src.indexOf('export async function stopStreamingChannelRtmp'))`. If the start function is renamed, indexOf returns -1 and slice(-1, n) yields '', so the `!/\bstreamKey\b/` and `!/passphrase/i` assertions pass vacuously. Assert both indexes are >= 0 first.
- `QUALITY` tools/smoke/smoke-wo261-project-stream-credentials.test.js:210-218 — checks only that the string `maskProjectStreamCredentials` appears in three route files. It does not prove each client-bound payload is masked.

## tools/smoke/smoke-wo265-cg-studio-tab.test.js
- `OK`

## tools/smoke/smoke-wo266-shader-fx.test.js
- `RISK` tools/smoke/smoke-wo266-shader-fx.test.js:19,33-35,60-73 — the round-trip writes `sh-smoke-wo266-tmp.json` and `.html` into the LIVE repo directories `data/shaders` and tracked `template/shaders` (shader-store.js:25-26 uses REPO_ROOT, with no temp override). Cleanup is in the test body and the top-level `after()` hook. A crash between saveShader (:61) and deleteShader (:70) leaves files in tracked, Syncthing-synced directories. listShaders (:66) also reads the live dirs. Point the store at a temp root for tests.

## tools/smoke/smoke-wo267-studio-canvas-play.test.js
- `QUALITY` tools/smoke/smoke-wo267-studio-canvas-play.test.js:66-67 — "registration sits inside the studio gate" only checks that the gate index is > 0 and that the registration index is after it. It does not verify that the registration is inside the `if` block. A registration placed after the closing brace would pass.

## tools/smoke/smoke-wo268-shader-cef-continuity.test.js
- `RISK` tools/smoke/smoke-wo268-shader-cef-continuity.test.js:30-34,53-57 — `loadFlat()` reads the live `config/` through ConfigManager.load() (see WO-237 note, config-manager.js:144-165). Line 56 asserts `cefInteractiveBridge === true` from the box's own config (config/general.json:23), not from the generator contract (default at defaults-core.js:53). The test fails if the owner turns that flag off, even though the code is right. Use a fixture.
- `QUALITY` tools/smoke/smoke-wo268-shader-cef-continuity.test.js:73-166 — tracked-host singleton state is cleared at the end of each test, not in a finally, so an assertion failure leaks tracked hosts into later tests in the same file.

## tools/smoke/smoke-wo270-settings-devices-only.test.js
- `OK`

## tools/smoke/smoke-wo271-route-heal.test.js
- `OK`

## tools/smoke/smoke-wo272-pgm-edit-capture.test.js
- `RISK` tools/smoke/smoke-wo272-pgm-edit-capture.test.js:113-148,150-175,177-199 — the tests write to the real persistence store with `persistence.set(KEY, ...)`. persistence.js:16-19 redirects to a tmp file only when NODE_TEST_CONTEXT is set, and node --test sets it. A direct `node tools/smoke/smoke-wo272-pgm-edit-capture.test.js` run writes the live `.highascg-state.json` (persistence.js:20). The try/finally restores it, but a kill mid-test leaves the fake scene in live state. Run it via node --test only, or set HIGHASCG_STATE_FILE.

## tools/smoke/smoke-wo274-config-generator-stale.test.js
- `OK`

# tools/smoke — sweep 29.10.2026 (batch 128)

Files: 39 · lines: 6976 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 5 RISK, 11 QUALITY

## tools/smoke/smoke-wo278-cable-regrab.test.js
- `OK`
## tools/smoke/smoke-wo280-compose-preview-backpressure.test.js
- `OK`
## tools/smoke/smoke-wo284-audio-mixer-inputs-vu-routing.test.js
- `OK`
## tools/smoke/smoke-wo285-box-size-inspector.test.js
- `OK`
## tools/smoke/smoke-wo286-touchpad-invert.test.js
- `QUALITY` tools/smoke/smoke-wo286-touchpad-invert.test.js:24 — the 7 tests call a local copy of the helper (`getWheelDeltaWithSettings`, lines 24-37) and a mock settings object, never `client/lib/wheel-delta.js`. Reverting or breaking the production helper cannot fail this file; tests 4-5 only read back the mock.
## tools/smoke/smoke-wo287-wo289-styles.test.js
- `QUALITY` tools/smoke/smoke-wo287-wo289-styles.test.js:66 — the "no backdrop blur in modal stylesheets" loop does `if (!fs.existsSync(fullPath)) continue`, so a renamed or deleted modal CSS file silently drops out of the check and the test still passes.
## tools/smoke/smoke-wo290-operator-monitor-picker.test.js
- `OK`
## tools/smoke/smoke-wo297-idle-top-layer-footer.test.js
- `QUALITY` tools/smoke/smoke-wo297-idle-top-layer-footer.test.js:287 — test name says "the highest layer wins even when a LOWER layer is the one with content-free chrome above", but the body asserts the 998 border exclusion and the layer-50 winner. The name does not describe what is checked.
## tools/smoke/smoke-wo300-layer-route-look-local.test.js
- `OK`
## tools/smoke/smoke-wo303-graph-edit-no-restart-and-regrab.test.js
- `RISK` tools/smoke/smoke-wo303-graph-edit-no-restart-and-regrab.test.js:132 — timing-based: `scheduleDeviceViewCasparSync(ctx, 1)` is waited on with a fixed 40 ms sleep (line 133). Under load the 1 ms debounce may not have fired, so the "no restart from the debounced sync" assertion can pass without the sync running. Also the 1500 ms debounce timer started by `handleAddEdge` (line 105) outlives `withRestartSpy`, which restores the spy at line 92. It is harmless today (no `allowRestart`), but it is an uncontrolled timer in a test.
## tools/smoke/smoke-wo304-preview-route-remap.test.js
- `OK`
## tools/smoke/smoke-wo305-route-layer-inherits-geometry.test.js
- `OK`
## tools/smoke/smoke-wo308-pointer-confine-split.test.js
- `OK`
## tools/smoke/smoke-wo309-async-xrandr-probes.test.js
- `QUALITY` tools/smoke/smoke-wo309-async-xrandr-probes.test.js:80 — the "invalidateXrandrCache clears the cache for BOTH sync and async readers" test (lines 80-87) only asserts `doesNotThrow` after invalidation. Nothing checks that the cache was cleared. Lines 50-51 also assert the event-loop tick only when the call took at least 8 ms, so on a fast X it can pass vacuously (the comment at lines 46-49 already concedes this).
## tools/smoke/smoke-wo310-volume-wire-units.test.js
- `OK`
## tools/smoke/smoke-wo311-autosave-no-resurrect.test.js
- `RISK` tools/smoke/smoke-wo311-autosave-no-resurrect.test.js:26 — `makeTrash(real, ...)` (lines 26-31, used at lines 49, 66, 82) writes trash fixtures into `projectStore.projectsDir()`. That path is a per-process temp dir only when `NODE_TEST_CONTEXT` is set (projects-root.js:23-27). The curated runner (`node --test`) sets it, so the live `projects/` is safe there. Running the file directly with `node` would write and `rmSync` under the live `projects/_trash`.
- `QUALITY` tools/smoke/smoke-wo311-autosave-no-resurrect.test.js:33 — `withTempProjectsDir` (lines 33-41) creates an `os.tmpdir()` dir and `rmSync`s it, but no test writes into `tmp`. The tests use `projectStore.projectsDir()` (the variable is misleadingly named `real`). The helper is dead scaffolding.
## tools/smoke/smoke-wo312-live-input-route-reassert.test.js
- `OK`
## tools/smoke/smoke-wo313-cable-resize-raf.test.js
- `OK`
## tools/smoke/smoke-wo315-nodm-canvas-decision.test.js
- `RISK` tools/smoke/smoke-wo315-nodm-canvas-decision.test.js:254 — the "byte-identical fallback" test (lines 245-263) calls `needsNodmRestartForLayout(config)` with no opts, so `xrDetailed` falls back to the live `getDisplaysXrandrDetailed()` (xrandr-layout-verify.js:175, 197). The test reads the real X display, which is machine-dependent. Lines 254 and 261 call it twice and `deepEqual` the results, which can drift between the calls.
- `QUALITY` tools/smoke/smoke-wo315-nodm-canvas-decision.test.js:16 — imports `plannedHeadsFromLayout` and `boundingBoxFromHeads` (lines 16-17) are never used; they appear only in comments (lines 38, 133, 195). `const layout` (line 35) is also unused. The fallback test (245-263) is named "byte-identical" and its comment says it does not call `getDisplaysXrandrDetailed`, but it asserts only the result shape.
## tools/smoke/smoke-wo316-decklink-already-open.test.js
- `OK`
## tools/smoke/smoke-wo322-shader-look-band-routing.test.js
- `OK`
## tools/smoke/smoke-wo323-compose-source-tiles.test.js
- `OK`
## tools/smoke/smoke-wo325-headless-operator-gui.test.js
- `OK`
## tools/smoke/smoke-wo326-inspector-fill-live-apply.test.js
- `QUALITY` tools/smoke/smoke-wo326-inspector-fill-live-apply.test.js:144 — the "clip site keeps its own semantics" check slices a fixed 400-character window (`clipSite.slice(0, 400)`, line 146) and asserts `aspectLocked` is absent from it. If the clip branch grows past 400 characters, the negative check silently stops covering the rest of the branch.
## tools/smoke/smoke-wo327-dest-overlay-dims.test.js
- `OK`
## tools/smoke/smoke-wo329-project-rev.test.js
- `OK`
## tools/smoke/smoke-wo331-live-thumb-url-stability.test.js
- `OK`
## tools/smoke/smoke-wo333-audio-capture-fft.test.js
- `RISK` tools/smoke/smoke-wo333-audio-capture-fft.test.js:206 — the behavioural "engine in slot mode" test binds a fixed UDP port 53977 (line 206) and waits up to 4 s of wall clock (lines 222-234) for a frame. A clash on that port fails the test with EADDRINUSE, and a slow machine can miss the 4 s window. Use port 0 or a helper that picks a free port.
## tools/smoke/smoke-wo340-shader-param-scan.test.js
- `OK`
## tools/smoke/smoke-wo344-shader-thumbs.test.js
- `RISK` tools/smoke/smoke-wo344-shader-thumbs.test.js:69 — the cache-bust test takes the first `template/shaders/sh-*.html` (box-owned, listed in .stignore:72) and calls `fs.utimesSync` on it (lines 72 and 75), restoring the mtime in `finally`. A crash between the two calls leaves the live shader file with its mtime pushed +60 s. Copy the file into a temp dir instead.
- `QUALITY` tools/smoke/smoke-wo344-shader-thumbs.test.js:62 — `if (!shaders.length) return` makes the test pass silently when the shader store is empty, so it asserts nothing on that box.
## tools/smoke/smoke-wo364-prv-output-routing.test.js
- `QUALITY` tools/smoke/smoke-wo364-prv-output-routing.test.js:85 — the test titled "preview_1 → previewCh(1)" asserts only `Number.isFinite(ch) && ch >= 2`. Any channel 2 or higher passes, including the program channel or a wrong preview channel. Assert the exact expected channel.
## tools/smoke/smoke-wo365-matrix-rows-and-cable-anchors.test.js
- `OK`
## tools/smoke/smoke-wo367-wiring-gates.test.js
- `QUALITY` tools/smoke/smoke-wo367-wiring-gates.test.js:32 — the "every init* is called" check (lines 32-33) is a regex over the whole of client/app.js. A name that appears in a comment or in another `name(` occurrence satisfies it, and the lookbehind only approximates the import line. A call is not proven.
- `QUALITY` tools/smoke/smoke-wo367-wiring-gates.test.js:50 — the eslint ratchet allows up to 224 warnings, but the recorded count is now 216 (`package.json` lint script). That leaves 8 warnings of silent headroom, which contradicts the test's own "may go DOWN" note. Lower the cap to 216.
## tools/smoke/smoke-wo369-header-clock-and-back-button.test.js
- `OK`
## tools/smoke/smoke-wo370-playlist-media-durations.test.js
- `OK`
## tools/smoke/smoke-wo371-preview-playlist-step.test.js
- `OK`
## tools/smoke/smoke-wo373-record-source-tiebreak.test.js
- `OK`
## tools/smoke/smoke-wo376-shader-camera-channel.test.js
- `OK`
## tools/smoke/smoke-wo377-host-channel-virtual-camera.test.js
- `OK`

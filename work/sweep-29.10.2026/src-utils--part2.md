# src/utils part 2 — sweep 29.10.2026 (batch 104)

Files: 26 · lines: 4750 · findings: 1 BUG-HIGH, 3 BUG, 12 DEAD, 13 RISK, 19 QUALITY

Method: every file read in full. Repros were run with `node` against the real modules (mocks / scratchpad dirs only; nothing under
config/, projects/, /run or the API was touched; scripts in the scratchpad, prefix `j51-`). Dead-code proof used `grep -rnw` over
client/ src/ godot/ tools/ scripts/ index.js test/ plus `tools/ci/unwired-exports-baseline.json`. "export-only" = used inside its own
file but nothing imports it; "smoke-only" = the only importer is a tools/smoke test.

## src/utils/os-config.js
- `OK` (thin facade; every re-export has callers: `grep -rnw "checkXrandrLayout\|clearPersistedOsLayout\|restartDisplayManager" src` → 3-4 files each).

## src/utils/os-layout-calculator-assign.js
- `RISK` src/utils/os-layout-calculator-assign.js:28 — operator overrides are collected for `screen_1..8` only (`for (let n = 1; n <= 8; n++)`), but `screenCount` (:13) and the graph path (:163; `pickGpuOutLayoutSysId` clamps 16) allow 16. Failing case: a 10-screen rig with `screen_9_system_id`/`screen_9_os_x` set by Apply OS and no `dst_in_` edge → screens 9-10 never get an operator assignment and silently drop out of the layout. x-display-session-layout*.js (loops to 8) and os-mode-source.js:11 (clamp 8) share the cap, so it is consistent but undocumented next to the 16 elsewhere.
- `RISK` src/utils/os-layout-calculator-assign.js:141-149,226-229,230-241 — every graph-derived multiview binding is stamped `{type:'multiview', index:1}`, then `mvIndex = parseInt(binding.index) || 1` (always 1), so the `mvDests.findIndex(...)` branch (:230-241) that would give the 2nd multiview destination index 2 is unreachable for `dst_in_` edges. Effect: with two multiview destinations both cabled, both read `multiview_1_os_mode/_os_rate/_os_x/_os_y/_mode` (:275-280); `multiview_2_*` keys are never read (placement still uses `idx+1`, so they do not overlap). Known WO-573 simplification; flagged because the dead branch reads like it handles N>1.
- `QUALITY` src/utils/os-layout-calculator-assign.js:103 — `require('../config/device-graph-output-mapping')` inside the connector loop in a try/catch that turns a load error into `edgeOutputLayer = 1` (a broken module would silently turn every PRV cable into a screen cable). Hoist the require. The "true/'true'/1/'1'" test is also hand-copied five times (assign.js:14,178-183,324-328; place.js:47-53; helpers.js:110-111,133-134) — one `isTruthyFlag()` would remove the drift seen in helpers.js below.

## src/utils/os-layout-calculator-helpers.js
- `RISK` src/utils/os-layout-calculator-helpers.js:105-114 vs :7-13 vs x-display-session-layout-resolve.js:16-21 — three readers of the same `screen_N_*` keys with different rules: `hasOperatorOsLayoutOverride` reads `config[...]` directly (no `casparServer` fallback); `readScreenSetting` is config-first then `casparServer`; `readCasparSetting` (layout-resolve) is `casparServer`-first then config. Failing case: `screen_1_force_os_resolution: true` only inside `casparServer` → place.js honours it (via `readScreenSetting`) but `hasOperatorOsLayoutOverride` says "no override", so the operator assignment (assign.js:29) is skipped; and a key present in both places with different values resolves differently in the layout calculator vs the operator-monitor/confine code. Fix: one reader, one precedence.
- `QUALITY` src/utils/os-layout-calculator-helpers.js:166-169,179-182 — `mvForced`/`ogForced` accept only boolean `true`, while the screen equivalent (:133-135) accepts `true/'true'/1/'1'`; a string "true" forces OS resolution for screens but not for multiview/operator_gui.
- `QUALITY` src/utils/os-layout-calculator-helpers.js:47-83 — `resolveMultiviewDimsFromTopology` and `resolveOperatorGuiDimsFromTopology` are identical apart from the mode string (the comment at :64-66 says that is deliberate).

## src/utils/os-layout-calculator-offset.js
- `OK` (the shift-not-clamp rewrite is covered by tools/smoke/smoke-os-layout-offset-overlap.test.js, which is in the curated CI list).

## src/utils/os-layout-calculator-place.js
- `QUALITY` src/utils/os-layout-calculator-place.js:116-183 — four near-identical "topology dims → w/h → replace non-pixel mode" blocks (screen and prv are character-identical, multiview/operator_gui differ by one function). A `dimsFor(kind, n)` plus one block would cut ~50 lines and the next WO-573-style fix would not need four edits.
- `RISK` src/utils/os-layout-calculator-place.js:232 — `results.prv[p.n]` is keyed by the main screen number, but `prvAssignments` is de-duplicated by `sysId` only (assign.js:246). Two PRV jacks cabled to the same destination's PRV half would overwrite each other in `results.prv[n]` while `cumulativeX` (:236) advanced for both → phantom gap, one head dropped. No failing config shown (needs two gpu_out edges from one `dst_in_*` PRV layer).

## src/utils/os-layout-calculator.js
- `QUALITY` src/utils/os-layout-calculator.js:10-52 — `logLayoutPlan` is five copies of the same log line and swallows every error with `catch (_) {}`; a throwing property access just stops logging with no trace.

## src/utils/os-mode-source.js
- `QUALITY` src/utils/os-mode-source.js:33-34 — `if (osMode) return 'edid'; return 'edid'` (identical branches). `readOsModeSourceSetting` (:10) is export-only (smoke-only importer tools/smoke/smoke-os-mode-source.js) and clamps `screenN` to 8 (:11) like the other 8-screen loops.

## src/utils/periodic-sync-osc-info-gate.js
- `OK` (WO-477 gate; `MAX_TRIES_PER_CLIP` and `oscClipSignatureForChannel` are smoke-only exports used by tools/smoke/smoke-osc-info-supplement-gate.test.js, which is in the curated CI list).

## src/utils/periodic-sync.js
- `DEAD` src/utils/periodic-sync.js:483-492 — export-only: `runPeriodicSync`, `clearOscPlaybackInfoSupplement`, `getSyncChannelIds`, `flushOscChannelsFullBroadcast` (all used inside the file; `grep -rnw` over client src godot tools scripts index.js → only the unwired-exports baseline). `resolveOscInfoSupplementMs`/`resolveIntervalSec` are smoke-only.
- `DEAD` src/utils/periodic-sync.js:199,346-352,392,448,450 — Companion-era hooks that nothing defines on the app ctx: `self.updateChannelVariablesFromXml`, `self.summarizeConsumersFromConfig`, `self.updateDynamicVariables`, `self.checkFeedbacks`, `self.setVariableValues` (`grep -rn "summarizeConsumersFromConfig\|updateDynamicVariables\|checkFeedbacks" src index.js` → only `typeof … === 'function'` guards; `parseInfoConfigForDecklinks`, `refreshConfigComparison`, `setupAllRouting` ARE assigned in index.js:211-214). The guarded branches never run (same class as the handlers.js note in src-utils--part1).
- `RISK` src/utils/periodic-sync.js:390 — `runPeriodicChannelInfoSync` writes `self.gatheredInfo.channelXml[...]` unguarded (the OSC-supplement twin at :195-197 guards it). It works only because `runConnectionQueryCycle` initialises `channelXml`; if `gatheredInfo` is ever replaced by a partial object every channel throws `TypeError`, swallowed per channel at debug level (:394-396).
- `QUALITY` src/utils/periodic-sync.js:1-6,129-137 — stale header (`@see companion-module-casparcg-server/src/periodic-sync.js`, a repo that is not here) and the long WO-252 doc block (:129-137) describes `startOscPlaybackInfoSupplement` but sits on `clearOscPlaybackInfoSupplement`.
- `QUALITY` src/utils/periodic-sync.js:230-232 — a configured `osc_info_supplement_ms` of 1..499 silently disables the supplement (no log line), and the `ms === 0` test is subsumed by `ms < 500`.

## src/utils/persistence.js
- `DEAD` src/utils/persistence.js:128-129 — `hydrateFromAmcp()` / `bindAmcp()` are no-op stubs; `grep -rnw "bindAmcp\|hydrateFromAmcp" src index.js tools` → only the definitions and the unwired-exports baseline (`bindAmcpFanout` is a different name).
- `DEAD` src/utils/persistence.js:160-162 — `setImmediate` is an exact alias of `set` (it does not force a write; only `IMMEDIATE_KEYS` membership does), has no production caller (`grep -rnw "persistence.setImmediate" src index.js` → none) and is only asserted to exist by tools/smoke/smoke-persistence-immediate.test.js. The doc "Write-through for on-air-critical keys" is misleading: `setImmediate('x', v)` for a key outside the set is debounced 200 ms. It also shadows the global `setImmediate` inside this module.
- `RISK` src/utils/persistence.js:63-72 — a state file that fails to parse is treated as `{}` (empty catch) and the next `set()` atomically replaces it, so a hand-edit typo or a half-restored backup silently wipes `programLayerBankByChannel`/`liveScenesByProgramChannel`/`screenTimers` with no log line. Cheap fix: rename the bad file to `.highascg-state.json.bad` and log before starting over.
- `QUALITY` src/utils/persistence.js:27,53-56 — `!/^0|false$/i.test(...)` is `^0` OR `false$` (matches "0abc", "notfalse"; misses "no"/"off"), and `IMMEDIATE_COALESCE_MS` falls back to `|| 0` (strict write-through) on a garbage env value while `FLUSH_DEBOUNCE_MS` falls back to 200 — inconsistent defaults for the same kind of typo.

## src/utils/program-resolution.js
- `QUALITY` src/utils/program-resolution.js:17-22 — returns `1920x1080` silently when INFO CONFIG has not been fetched yet or the channel is missing (callers: engine/timeline-playback.js:85, timeline-engine.js:95). On a 3840x2160 program channel used before the first INFO CONFIG answer, fill math is computed for 1080p with no log. It also re-parses the whole INFO CONFIG XML (`buildChannelResolutionMap`) on every call.

## src/utils/query-cycle.js
- `BUG` src/utils/query-cycle.js:141-148,169-170,186-188 (+ handlers.js handleCLS/handleTLS) — `requestData` hands an `Error` to the same callback as a success (`callback(err instanceof Error ? err : new Error(...))`), and none of the CLS/TLS/CINF/VERSION/INFO callbacks test for it. Failing case (repro `j51-qc2.js`: real StateManager, mocked `amcp._send` rejecting `CLS` with "AMCP timeout"): catalog held 2 media items → after `runMediaLibraryQueryCycle` the CLS timeout runs `handlers.handleCLS(self, Error)` → `state.updateFromCLS(Error)` → `(data||[]).length` is `undefined`, loop skipped, `this._state.media = []` and `media` is emitted → **media count 2 → 0, the media browser empties** until the next successful CLS (same for TLS → templates `[]`; VERSION becomes the string "Error: AMCP timeout…"). Fix: in the rejection path call `callback([], err)` or make the callbacks bail on `instanceof Error`.
- `RISK` src/utils/query-cycle.js:117-125 — `runCommandQueue` wraps each item as `(...args) => { item.callback(...args); ctx.runCommandQueue() }` with no try/finally, and it runs inside a `.then(onFulfilled)` of `amcp._send` (:141-148). A throwing callback (any handler/state method) skips the continuation: the rest of the connect gather — including `finishConnectionGather` (routing setup, reconcile, `startPeriodicSync`, WS snapshot) — never runs, and the throw surfaces as an unhandledRejection. Repro `j51-qc.js`: callback A throws → "queue left: 1", callback B never runs.
- `RISK` src/utils/query-cycle.js:165-168,207-217 — both cycle entry points do `self.commandQueue = []`. `runMediaLibraryQueryCycle` is called from upload/ingest/HAP-encode/media-links (routes-media.js:178, hap-encode-queue.js:392, media-links.js:150): if one fires while the post-connect `runConnectionQueryCycle` is mid-flight, its pending INFO / INFO CONFIG / per-channel items are discarded (and `finishConnectionGather` never fires), and a second `runCommandQueue` chain now runs beside the first.
- `DEAD` src/utils/query-cycle.js:244,250,257,271,276,282,288,289-295,336-339 — the same never-defined Companion hooks as periodic-sync.js (`setVariableValues`, `summarizeConsumersFromConfig`, `updateDynamicVariables`, `updateDynamicPresets`, `clearVariablePollTimers`, `checkFeedbacks`); `attachEnqueueQueue` is export-only (baseline).
- `QUALITY` src/utils/query-cycle.js:169-192 vs :219-235 — the CLS→CINF block is pasted twice (media-library cycle and connection cycle); `@see companion-module-casparcg-server/src/instance.js` (:4) points at a repo that is not here.

## src/utils/safe-unzip.js
- `BUG-HIGH` src/utils/safe-unzip.js:45-51 — `entry.stream().pipe(ws).on('finish', resolve).on('error', reject)`: `.pipe()` returns the destination, so only the WRITE stream's errors reach `reject`; an error on the zip entry stream (corrupt/truncated deflate, CRC failure) is an unhandled `'error'` event. Failing input (repro `j51-zip/run.js`, python-built zip with 300 corrupted bytes inside the deflate stream): `extractZipSafely` never settles and Node throws an uncaught `Error: invalid bit length repeat`; `installProcessGuards` (bootstrap/process-guards.js:21-27, wired at index.js:55) answers an uncaught exception with `process.exit(1)` → **the control server restarts because one corrupt .zip was uploaded or imported** (callers: api/routes-ingest.js:189,393, media/local-ingest.js:164). Fix: `const src = entry.stream(); src.on('error', reject); src.pipe(ws)` (or `stream.pipeline`) and unlink the partial file.
- `BUG` src/utils/safe-unzip.js:28 — `name.includes('..')` rejects any file whose NAME contains two dots, not only path-traversal segments. Failing input (repro): zip with `first.txt`, `Intro..Final.txt`, `last.txt` → `REJECT zip slip blocked: Intro..Final.txt`, leaving only `first.txt` extracted (partial extraction, archive kept). The `path.relative` check on :31-35 already catches real traversal; test `name.split(/[\\/]/).includes('..')` instead.
- `RISK` src/utils/safe-unzip.js:36-41 — the size/zip-bomb limits trust `entry.uncompressedSize` from the central directory, which the archive author controls; nothing counts the bytes actually written, so a header declaring 1 KB for a multi-GB deflate stream passes both caps. Count bytes in the stream and abort.

## src/utils/swallow.js
- `OK`

## src/utils/which.js
- `OK`

## src/utils/x-display-session-gui-windows.js
- `RISK` src/utils/x-display-session-gui-windows.js:253-289,348-352 — `raiseOperatorGuiWindows` (the path `scheduleGuiWindowPosition` takes after EVERY GUI spawn: system-hardware-gui.js:154, routes-system-setup.js:306) places the window 5 % inside `resolveOperatorDisplayRect`, whose documented fallback is "multiview, else the FIRST PGM screen consumer head" — exactly the behaviour the WO-283 follow-up removed for the promote path (`resolveHelperWindowRect`, :163-229, comment :168-175). With no operator monitor configured, a GUI tool launched from the settings UI is moved onto program output. It also searches only `--class` (not `--classname`), which by this file's own comment (:37-40) cannot find Firefox's `Navigator` window. The file says this path is kept "exact" on purpose; if so it should at least refuse when `rect.kind === 'screen'`.
- `DEAD` src/utils/x-display-session-gui-windows.js:356 — `windowClassesFor` is exported but smoke-only (tools/smoke/smoke-wo387-desktop-app-catalog.test.js).
- `QUALITY` src/utils/x-display-session-gui-windows.js:53-100 — `findGuiWindowIds` takes an undocumented `includeHidden` option (JSDoc lists only `excludeTitle`, `withNames`).

## src/utils/x-display-session-layout-resolve.js
- `RISK` src/utils/x-display-session-layout-resolve.js:16-21 — `readCasparSetting` prefers `casparServer.<key>` over `config.<key>`; `readScreenSetting` in os-layout-calculator-helpers.js:7-13 prefers `config.<key>`. See the helpers.js RISK: the operator-monitor / confine / consumer-enabled code and the OS layout can disagree about one `screen_N_*` key.
- `QUALITY` src/utils/x-display-session-layout-resolve.js:46-47 — `const cs = config?.casparServer || config; cs.multiview_enabled` throws `TypeError` when `config` is null/undefined (every other helper here tolerates a missing config).
- `QUALITY` src/utils/x-display-session-layout-resolve.js:247-251 — the GPU-physical-map fallback computes `interactive` with `screenInteractiveEnabled(config, hit.index)` for any non-multiview kind, including `operator_gui`/`prv`, whereas the first branch (:155-162) hard-codes `operator_gui` to `false`.

## src/utils/x-display-session-layout.js
- `DEAD` src/utils/x-display-session-layout.js:251,254,256 — export-only (baseline): `HELPER_WINDOW_INSET`, `formatOperatorDisplaySummary` (used by `describeOperatorDisplay`), `pointerOverInteractiveConsumer` (used by `pointerInConfineAllowance`). `pointerInConfineAllowance` and `operatorMonitorPortIndex` are smoke-only.
- `QUALITY` src/utils/x-display-session-layout.js:143-149 — orphan JSDoc block (params `config, layout, x, y`) sits on `pointerInRect(x, y, rect)`; the real signature has no config/layout. Screen loops cap at 8 (:56,:177,:210).

## src/utils/x-display-session-runtime-env.js
- `DEAD` src/utils/x-display-session-runtime-env.js:66-77,81 — `resolveXdotoolBin` has no production caller (`grep -rnw resolveXdotoolBin src index.js scripts` → only the re-export in x-display-session-runtime.js; tools/smoke/smoke-wo805-apply-nvidia-deferred.test.js:192 stubs it by name); the `FALLBACK_PATH` re-export (:81) is imported by nobody (`grep -rn FALLBACK_PATH src tools` → only which.js, which defines it).
- `QUALITY` src/utils/x-display-session-runtime-env.js:24-26,66 — `commandExists` and `resolveXdotoolBin` are `async` around fully synchronous work (and `resolveXdotoolBin(_env)` ignores its argument).

## src/utils/x-display-session-runtime.js
- `DEAD` src/utils/x-display-session-runtime.js:201,210 — re-exports `resolveXdotoolBin` and `lookupCommandPath` that no importer takes from here (`lookupCommandPath` consumers import `./which` directly: desktop-app-catalog.js:24).
- `QUALITY` src/utils/x-display-session-runtime.js:51 — `buildConfineCursorShellLines` returns `[]` (and emits no `pkill`) when the operator rect has no usable `sysId`, so a stale confine process from the previous layout keeps running after Apply; the `!isOperatorPointerConfineDesired` branch above it does kill them.

## src/utils/x-display-session.js
- `OK` (9-line merge of layout + runtime; the two export sets do not collide).

## src/utils/xrandr-custom-mode.js
- `DEAD` src/utils/xrandr-custom-mode.js:18-27,30-72 — `pickBestExistingModeForPlan` (its doc: "avoids redundant cvt when the server already has the timing") and its helper `rateHintFromModeSuffix` have no production caller; `grep -rnw pickBestExistingModeForPlan src index.js` → none, only tools/smoke/smoke-xrandr-custom-mode.js. Built and tested but never wired into os-config-xrandr-apply.js.
- `RISK` src/utils/xrandr-custom-mode.js:134-141 — `stripExistingXrandrModeByName` switches a LIVE `attached` output to the first plain `WxH` in the Set (xrandr list order) before deleting the old mode. If that is not the output's current mode, replacing a custom mode causes a visible modeset to an arbitrary resolution (WO-805 limited it to `attached !== false`).
- `QUALITY` src/utils/xrandr-custom-mode.js:84-85,98-99 — `return true` after the explicit true-tests and `if (x === 'edid') return false; if (x !== 'custom') return false` are redundant; `lastCreateOutcome` (:196) never shrinks (tiny).

## src/utils/xrandr-layout-verify.js
- `BUG` src/utils/xrandr-layout-verify.js:81-98 (+ hardware-info-xrandr.js:113-141) — `parseXrandrQueryRaw` keeps every `connected` output and defaults a connected-but-inactive one (no `WxH+X+Y` geometry) to `x:0,y:0,resolution:'unknown'`; the overlap detector then groups all `connected` actual heads by position. Failing input (repro: mocked `execSync` returning xrandr text with `DP-0 connected primary 1920x1080+0+0` and `DP-1 connected (normal …)` with no geometry; planned = DP-0 only): `compareXrandrLayout` → `ok:false`, mismatch `{sysId:"DP-0+DP-1", field:"overlap", actual:"0,0"}`. So `checkXrandrLayout` (os-config.js:12-16) reports a layout error whenever a spare monitor is plugged in but not part of the plan — and the boot watchdog (bootstrap/os-layout-watchdog.js:58-100) treats that as drift: it logs "Re-applying xrandr layout" and calls `applyX11Layout` up to 12 times per boot because `res.verify.ok` can never turn true. Fix: skip actual heads with `resolution === 'unknown'` (or not in `planned`) in the overlap pass.

## src/utils/xrandr-output-resolve.js
- `DEAD` src/utils/xrandr-output-resolve.js:256-261,273 — `resolveLayoutHeadSysId` has no caller anywhere (`grep -rnw resolveLayoutHeadSysId client src godot tools scripts index.js` → only its definition + the baseline). `looksLikeDrmStylePortName`, `deviceGraphXrandrAliasMap` are export-only (baseline); `findTopologyPairForName`/`resolveViaPortPair` smoke-only.
- `QUALITY` src/utils/xrandr-output-resolve.js:218-249 — `resolveSysIdToXrandrOutput` is called once per head several times per layout calculation (place, merge, verify) and rebuilds `deviceGraphXrandrAliasMap` on each call; xrandr itself is cached so it is cheap, but it is O(heads × connectors) per call.

## src/utils/xrandr-persist-script.js
- `RISK` src/utils/xrandr-persist-script.js:95 — `export XAUTHORITY=${xauth}` is written into the generated apply-layout.sh unquoted and unvalidated (the sibling tokens go through `assertSafeXrandrToken`). A `getXAuthority()` result with a space or `$` breaks the script (and, if it is ever operator-controlled, injects shell). Use `shellQuoteArg` from xrandr-safety.js.
- `DEAD` src/utils/xrandr-persist-script.js:120-123 — `buildCustomModeBootstrapShellLines` is smoke-only (used inside `buildApplyLayoutScriptContent`), `assertSafeXrandrToken` is export-only (baseline).

## src/utils/xrandr-safety.js
- `OK` (`XRANDR_MODE_RE` is export-only per the baseline; all builders are used by os-config-xrandr-apply.js).

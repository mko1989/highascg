# WO-983 — Test-coverage + correctness sweep of AMCP planning and timecode/scene math
**Area:** engine, amcp, testing-ci
**Status: DONE (07.11.26, Codex Astra sweep: 41 new assertions pass + 1 executable TODO (late keyframe entry); fractional channel fps + exact frame boundary fixed; offline suite green)**

## Investigation

Written before production changes. Scope uses `src/caspar/amcp-{command,layer-diff}-plan.js`:
there are no `src/engine/amcp-*-plan*.js` matches. Searched INDEX for timecode, escaping,
clip speed, rounding, fractional rates, keyframes and transition math; reviewed WO-973,
WO-974 and WO-981. Existing relevant contracts: WO-830b quoting, WO-956 continuity,
WO-970 exit-only fades, WO-544 take opacity ownership, WO-787 channel-frame seeks.

Ranked findings:

1. **High: fractional channel rates truncate, corrupting seeks and fade wait math.**
   `src/engine/scene-transition.js:222,224` parses both reported rates and hints with
   `parseInt`. Input `29.97` returns 29; `59.94` returns 59. At one hour,
   `src/engine/timeline-playback-amcp-schedule.js:43` converts 90,000 timeline frames
   (25 fps) into 104,400 channel frames instead of 107,892 at 29.97; error 3,492 frames.
   Four new rate regressions fail before the fix (decimal and rational rates).
   The finite/positive guards and integer-rate behavior should remain unchanged.
2. **Medium: a late keyframe segment runs for its full original duration.**
   `src/engine/timeline-playback-amcp-schedule.js:136,307`: start value is sampled at
   localMs, but duration remains t1-t0. Entering 0→1 over 0…1000 ms at 400 ms,
   25 fps, should send a 15-frame remaining tween; current path sends 25 frames.
   The scheduleLeadTween branch already subtracts localMs. Keep a failing TODO:
   changing live scheduling needs agreement on late-entry/easing behavior and glass QA.
3. **Medium: exact frame boundary loses one frame to floating point division.**
   `src/caspar/amcp-layer-diff-plan.js:8`: `msToFrames(5*1000/30,30)` is 4, expected 5;
   `msToFrames(2102.1,30000/1001)` and `(1051.05,60000/1001)` are 62, expected 63.
   Existing tests only cover 500 ms at 25/50. TODO pending an agreed tolerance;
   LTC math already adds 1e-6 frame before floor (`src/timecode/timecode-math.js:99`).
4. **Low / optimization candidate: repeated keyframe indexing on each mixer update.**
   `src/engine/timeline-playback-amcp-schedule.js:241` filters and sorts all keyframes
   separately for opacity and volume; fill times also rebuild at line 122. Complexity
   per call is O(K + P log P) per property, even when the segment is unchanged.
   `_clearLayerMixerSchedule` at line 81 scans both whole maps for each cleared layer:
   clearing L layers with P stored keys per layer can require O(P*L²) key visits.
   Measured 10,100 key visits for clearing 100 layers with 200 initial keys (two maps,
   one key per layer per map). The test reports the count without pinning inefficiency.
   No claimed live latency gain; WO-981 already finds take compute small on the real show.

Coverage search: module/function-name grep is an inventory, not instrumented coverage.
WO-973 covers ordinary speed normalization/filter chains; WO-974 covers early DF minutes;
smoke-amcp-command-plan covers six basic plans. No direct resolver-name smoke hits were
found before this work. Empty-look mixed diff classifications, long-duration frame round
trips, all-day DF minute boundaries, and fractional output rates were missing focused cases.
50/59.94 are intentionally outside the four-mode LTC contract (WO-974); they fall back to
25, and must not be mistaken for supported LTC modes. AMCP channel math does support them.

Additional coverage findings:
- No module/function-name references before this sweep for
  `sendTakeJobsLoadAndMixerBatch` (`scene-take-lbg-amcp-pipeline-batch.js:18`),
  `scheduleFadeOnEndForTakeJobs` (`scene-take-lbg-amcp-pipeline-fade.js:13`), or
  `abortFailedTake` (`scene-take-lbg-phase-b-abort.js:21`). This is absence of direct
  named coverage, not proof they never execute through integration tests. Added
  direct empty-batch and abort bank/cause tests; fade-on-end disk/OSC paths remain a gap.
- `tools/smoke/smoke-amcp-command-plan.js:48,64` expected `LINEAR` although
  `src/caspar/caspar-tween.js:36` lowercases it (WO-618). Regression run: two failures,
  actual `linear`, expected `LINEAR`; this test imports no changed rate resolver.
  Corrected exact expected values, preserving uppercase input and full equality assertions.

## What was done

- `src/engine/scene-transition.js`: two `parseInt` calls become `parseFloat`, retaining
  fractional channel variables and client hints. Keeps existing prefix parsing, positive/
  finite guards, channel-over-hint priority, default 50 and integer-rate behavior.
  Four fractional-rate cases failed before and pass after. No source-text pins matched
  the changed expressions in the smoke search.
- `tools/smoke/smoke-983-amcp-edges.test.js`: byte-exact quoting/serialization (Unicode,
  quotes, backslashes, spaces, parentheses, CRLF), empty/same-clip plans, duration floors,
  negative/zero duration, speed zero/negative/nonfinite/tiny/huge and long LENGTH checks.
  Executable TODO documents exact-boundary rounding; expected 5, actual 4.
- `tools/smoke/smoke-983-timecode-scene-math.test.js`: all 1,440 DF minute boundaries,
  frame/ms and day-wrap round trips out to 100 days, unsupported LTC mode fallback,
  fractional/integer channel rates and one-hour seek conversion, mixed/empty look diffs.
- `tools/smoke/smoke-983-timeline-schedule.test.js`: segment deduplication and fade ownership,
  layer-key isolation, operation-count diagnostic, resume identity/frame checks above 2^31,
  failed-take bank protection and error cause preservation, empty Phase A in both modes.
  Executable TODO demonstrates a late 400 ms entry gets 25 frames instead of remaining 15.
- `tools/smoke/smoke-amcp-command-plan.js`: repoint two stale exact tween expectations to
  the existing WO-618 lowercase contract; no assertions removed or relaxed.
- `work/work-orders/983_WO_amcp_timecode_scene_math_sweep.md`: this report.


## What was VERIFIED

Exact commands (run from repository root):

```sh
node --test tools/smoke/smoke-983-amcp-edges.test.js tools/smoke/smoke-983-timecode-scene-math.test.js tools/smoke/smoke-983-timeline-schedule.test.js
node --test --test-isolation=none tools/smoke/smoke-983-*.test.js
node --test --test-isolation=none tools/smoke/smoke-amcp-command-plan.js tools/smoke/smoke-wo973-clip-speed.test.js tools/smoke/smoke-wo974-timecode-math.test.js tools/smoke/smoke-wo974-timeline-still-seek.test.js tools/smoke/smoke-wo544-timeline-clip-keyframe-vs-take-fade.test.js tools/smoke/smoke-wo956-relative-layer-keeps-playing.test.js tools/smoke/smoke-wo970-exit-only-take-fades.test.js tools/smoke/smoke-wo830b-injection-validation.test.js
npx eslint src/engine/scene-transition.js tools/smoke/smoke-amcp-command-plan.js tools/smoke/smoke-983-amcp-edges.test.js tools/smoke/smoke-983-timecode-scene-math.test.js tools/smoke/smoke-983-timeline-schedule.test.js
node tools/ci/check-max-file-lines.js
```

- New tests: **42 cases, 40 pass, 0 fail, 2 TODO, 0 skip**. TODO callbacks execute and
  produce the documented failing assertions; they are not silently empty placeholders.
- Default Node v24.22.1 `--test` reports only **3 file wrappers pass**, hiding per-case
  counts in this environment; `--test-isolation=none` exposes the 42 individual results.
- Before rate fix: the first two new files had **31 cases: 26 pass, 4 fail, 1 TODO**.
  The scene/timecode file alone had 13 pass, 4 fail. After: all four rate failures pass.
- Regression group before stale assertion correction: **68 pass, 2 fail**; after: **70
  pass, 0 fail, 0 skip**. Tests use fake AMCP; no real playout commands issued.
- eslint: exit 0, **0 errors, 0 warnings** for all five touched JS files.
- Max-file-lines: exit 0, **0 files over 500 lines**.
- Logs for coordinator inspection: `/tmp/wo983-before-detailed.tap`,
  `/tmp/wo983-final.tap`, `/tmp/wo983-regression.tap`, `/tmp/wo983-regression-final.tap`.
- No listen/connect EPERM/EACCES tests occurred. A login-shell invocation printed
  `Failed to create stream fd: Operation not permitted`; commands still completed;
  later commands used a non-login shell. This is not a product failure.

NOT proven: live Caspar tokenization/rendering, timing on glass, real fractional-rate
INFO values upstream (they may already be rounded), external LTC/audio devices,
end-to-end take/restart behavior, or full-suite/instrumented coverage. No server restart,
GUI/E2E, network, config/project/media edits or git state changes. Pending TODOs remain
real bugs; DONE describes this bounded investigation and test delivery, not their repair.

## Proposals (not built)

1. Agree on a shared exact-frame rounding tolerance (LTC uses 1e-6 frame), then fix
   the planner's TODO with just-before/at/after boundaries at integer and rational rates.
2. Coordinate late segment entry across FILL/OPACITY/VOLUME: remaining duration and
   nonlinear easing continuation must agree. Validate on PRV before changing scheduler.
3. If profiling warrants it, index mixer schedule keys by channel/layer and cache sorted
   keyframe data with explicit invalidation on edits. Operation counts are synthetic;
   this sweep does not establish a live bottleneck or justify altering prebuffer waits.
4. Add dependency-injected fade-on-end tests for duration/OSC fallback and speed-adjusted
   duration; current direct coverage gap is recorded, not a claim of a reproduced bug.
5. Coordinator: register the three `smoke-983-*.test.js` files in curated CI and update
   work-order INDEX/OPEN_ISSUES. Those files were explicitly off limits to this delegate,
   so `build-index`/`check-wos` were not run. Commit/restart decisions stay with coordinator.

## Coordinator follow-up (07.11, Claude)
- Finding 3 fixed: `src/caspar/amcp-layer-diff-plan.js` `msToFrames` now floors `ms * fps / 1000 + 1e-6` (the same
  1e-6-frame tolerance as `timecode-math.js`), so `5*1000/30 ms @ 30` → 5 and the 29.97 / 59.94 boundary cases → 63.
  The TODO test became a normal test: `smoke-983-*` 41 pass / 0 fail / 1 todo; the 9 smokes that cover
  msToFrames / normalizeTransitionForAmcp 56/56.
- Finding 2 (late keyframe entry tween length) stays a TODO: it changes live tween timing and needs glass QA.

# WO-988 — Offline test suite runtime: lingering timers + CI concurrency (optimization sweep 07.11)
**Area:** testing-ci
**Status: DONE (07.11.26, curated suite on 4 pinned cores 229 → 81 s, box 63 → 42 s; 5513 pass / 0 fail)**

Part of the 07.11 optimization sweep ([notes](../notes/optimization-sweep-07-11.md)). CI's `verify` job is the push critical
path: 4 m 50 s, of which **Offline tests = 4 m 02 s** (run 42313834937, 4-vCPU GitHub runner).

## Investigation

Harness (scratchpad `citime/`, not in repo): the same env as `tools/ci/run-offline-tests.js`, plus a custom node:test
reporter that sums top-level durations per file, and a pool runner that times every curated file alone (`each.js`).

- 837 curated files. Sum of the tests' own durations is **257 s**, but the sum of per-file process wall time is **709 s**.
  Per-file process overhead is small (bare `node -e ''` 13 ms; `node --test <small file>` overhead median 57 ms, p90 85 ms).
  The rest is **files that stay alive after their last test** because something keeps the event loop busy:

| idle after tests | file(s) | cause |
|---|---|---|
| 60 s ×5 | `smoke-wo554/555/556/558/559-*` | the fixtures start a real `TimelineEngine`; `play()` arms a 40 ms `setInterval` (`timeline-playback-runtime.js:131`) that nothing stops, so the file runs until the timeline ends |
| 15 s ×2 | `smoke-wo601-lt-roster-import`, `smoke-lower-third-roster` | **product bug** (web client): `withParseTimeout` in `client/lib/lower-third-roster-import.js` never cleared its 15 s race timer after the parse won |
| 10 s | `smoke-wo543-companion-flag-fire-and-log` | same TimelineEngine ticker |
| 6 s | `smoke-wo813-web-clip-trim` | `showScenesToast` 6 s UI timer (legit in the browser; left) |
| 4–7 s ×8 | cluster/sandbox e2e smokes (wo725, 746, 842, 752, 753, 730, 979) | spawned sandbox servers' teardown — expected |

  Located with an `async_hooks` preload that records the creation stack of every `Timeout` still ref'd after 4 s
  (the global-`setTimeout` patch missed them: those modules call `require('timers')`).
- Order does not matter at CI width: with 3 workers, current order vs slow-files-first gave **228.6 s vs 228.5 s**.
  The run is throughput-bound.
- Concurrency does matter. Node's default is `availableParallelism() - 1`, which is **3 on a 4-vCPU runner**. Many
  files mostly wait (supervisor, LTC and cluster smokes sleep on real timers). Pinned to 4 cores with `taskset -c 0-3`,
  the old tree took **229 s at concurrency 3 and 132 s at concurrency 6**, 0 failures at 6.

## What was done

- `tools/smoke/smoke-wo554/555/556/558/559-*.test.js`, `smoke-wo543-*.test.js`: each fixture records the engine it
  creates. A file-level `after()` clears any still-running `_ticker`. Test-only change; the assertions are untouched.
- `client/lib/lower-third-roster-import.js` `withParseTimeout`: keeps the timer handle and clears it in
  `.finally()`, so a finished parse no longer leaves a 15 s timer armed in the browser. Same results and rejection.
- `tools/ci/run-offline-tests.js`: `--test-concurrency = min(ceil(cores × 1.5), cores + 4)`, giving 6 on CI's 4 vCPUs
  and 32 on the box's 28. `HIGHASCG_TEST_CONCURRENCY` overrides it.

## What was VERIFIED

- Per file, before → after (pass counts unchanged):

  | file | before | after | pass/fail |
  |---|---|---|---|
  | wo554 | 60.1 s | 0.11 s | 8/0 |
  | wo555 | 60.1 s | 0.12 s | 12/0 |
  | wo556 | 60.1 s | 0.14 s | 8/0 |
  | wo558 | 60.1 s | 0.12 s | 4/0 |
  | wo559 | 60.1 s | 0.11 s | 6/0 |
  | wo543 | 11.5 s | 1.5 s | 9/0 |
  | wo601 roster import | 15.4 s | 0.19 s | 3/0 |
  | lower-third-roster | 15.2 s | 0.16 s | 2/0 |

- Whole suite through the real `node tools/ci/run-offline-tests.js` (07.11 ~02:00):

  | setup | before (old tree, default concurrency) | after |
  |---|---|---|
  | `taskset -c 0-3` (CI-sized, concurrency 6) | 229 s | **81 s**: 5513 pass / 0 fail / 3 todo |
  | full box (28 cores, concurrency 32) | 63 s | **42 s** |

  Two further runs (a second 4-core run of 81 s, and the box run) each reported 1 failure: the WO-846 hygiene check.
  I had created this WO file mid-run, before its INDEX entry existed. That is not a flake. No timing-sensitive test
  failed under the higher concurrency in 3 runs.
- **CI after the push** (run 42321313419, head `6bc00cfd`, green): Offline tests **4 m 02 s → 1 m 27 s**, `verify` job
  4 m 50 s → 2 m 10 s, so push → green dropped from ~5 m 40 s to ~2 m 50 s.

## Proposals (not built)

- A CI guard against new lingering files: report any curated file whose process outlives its last test by more than
  N s. This needs a reporter hook or a per-file wrapper; worth it only if lingerers creep back.
- `--test-isolation=none` would remove most per-file process cost but shares module state across 837 files (env,
  singletons, monkeypatched globals). Not worth the flake risk.

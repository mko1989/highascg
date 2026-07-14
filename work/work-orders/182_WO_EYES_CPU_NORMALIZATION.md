# WO-182 — Connection-eye process CPU shows 1400%: normalize multi-core percentages

**Status:** Planned
**Priority:** Low (cosmetic/clarity)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner): "casparcg shows 1400% cpu usage and highascg 83% ????"
**Related:** WO-165 (introduced the per-process stats).

---

## 1. Findings

WO-165's CPU% is single-core-equivalent (utime+stime delta / wall delta), the `ps`/`top` convention where a 28-core box can legitimately show up to 2800%. WO-165's own log noted "~1100% across this box's 28 cores" as plausible. The owner (reasonably) expects a 0-100 machine share.

## 2. Tasks (haiku-sized)

- [x] T182.1 In `src/system/proc-stats.js` (or the gather site in `src/api/routes-host-stats.js`): also report `cpuPctOfMachine = cpuPct / cores` (cores from `os.cpus().length` — the endpoint already knows it). Keep the raw value in the payload for anyone who wants it.
- [x] T182.2 In `client/components/connection-eye.js` `buildTooltipText()`: display the machine share as the primary number, cores annotated — e.g. `CasparCG: 50% of machine (28 cores) · 11.2 GB RSS`. HighAsCG line likewise.
- [x] T182.3 Update the WO-165 smoke (`tools/smoke/smoke-proc-stats.test.js`) with a normalization case; node --check + eslint.

## 3. Acceptance criteria

- [x] A182.1 Hover shows sane 0-100% machine figures for both processes (operator check after restart+reload).
- [x] A182.2 Smokes green.

## 4. Work log

- 2026-07-14 — WO created; cause is the deliberate single-core-equivalent convention from WO-165 — normalize for display.
- 2026-07-14 — Implementation complete: added cpuPctOfMachine to process stats (routes-host-stats.js), updated tooltip display (connection-eye.js), added normalization test cases (smoke-proc-stats.test.js). All tests pass, syntax ok, eslint clean.

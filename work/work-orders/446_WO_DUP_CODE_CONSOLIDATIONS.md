# WO-446 — Duplicate-code consolidations (WO-445 §2b follow-ups)

**Status: IN PROGRESS (06.08.26)**

Owner "continue" on WO-445. Each item lands as its own commit, verified before the next.
Ordering: safest → riskiest; the Caspar config generators go last (load-bearing XML) and
only with a before/after XML diff as proof.

## 1. Investigation

Duplicate groups verified live-on-both-sides in WO-445 §1.3. This WO consolidates them.
Constraint from the WO-367 gate: keep export names referenced; constraint from the smoke
discipline: re-point any `readFileSync` assertions that pin moved lines.

## 2. What was done

### 2.1 `which.js` reimplementation (~47 lines) — DONE

`src/utils/x-display-session-runtime-env.js` carried the ORIGINAL WO-283 in-process
`lookupCommandPath` + `FALLBACK_PATH`; `src/utils/which.js` is the later extracted shared
home with an identical copy. The runtime-env module now `require('./which')` and re-exports
the same names (importers `x-display-session-runtime.js`, `x-display-session-gui-windows.js`
untouched). 130 → 87 lines. The WO-283 root-cause story stays in `which.js`; a pointer
comment remains at the old site.

Verified: `smoke-command-lookup.test.js` 3/3 (includes the no-/usr/bin/command source scan),
`smoke-os-layout-w40.js` 9/9, eslint clean, exports probed by hand
(`commandExists('sh') → true`, `FALLBACK_PATH` intact).

## 3. What was VERIFIED

Per-item, recorded inline above. Suite + gates re-run at the end of the batch.

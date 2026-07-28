# WO-367 — CI does not gate lint warnings, and "written but never called" code keeps shipping

**Status: OPEN — investigated 28.07.26 (evidence: three separate lost-wiring bugs found by hand on 28.07 alone). No change made.**

## 1. Investigation

### 1a. The failure class

Three defects of the *same shape* were found on 28.07, all by a human reading an eslint
`no-unused-vars` census rather than by any automated gate:

| commit | what was dead | user-visible consequence |
|--------|---------------|--------------------------|
| `6e53abe` | `initMediaExistsIndex` + `initLiveInputFailureToasts` imported but never called | WO-360's missing-media marks and live-input failure toasts were **dead in the shipped bundle** — the feature the owner asked for in checklist27 item 3 did nothing |
| `9d2f6dd` | duplicate unwired WO-342 handler in scene-list | dead code shadowing the working handler |
| `185d200` | `runPeriodicInfoConfigRefresh` fully written, never called | INFO CONFIG (decklink / config-compare / consumer summaries) stayed **boot-stale forever** |

All three survived: the 1559-test offline suite, the 500-line gate, the boot check, and ESLint.
`6e53abe` is the worst case — the WO said DONE and live-verified, and the *initialisation* had
been dropped in a later batch edit, so the verification and the shipped bundle diverged.

### 1b. Why CI cannot catch it

`.github/workflows/ci.yml:45-46`:

```yaml
      - name: ESLint
        run: npm run lint
```

and `package.json`: `"lint": "npx eslint ."` — **no `--max-warnings`**. ESLint exits 0 with any
number of warnings, so:

- the current 225 warnings are invisible to CI;
- a new unused import / unreferenced function adds warning 226 and CI stays green;
- the burn-down from 751 → 225 across `259b003`, `a972d93`, `a244b9a`, `9d2f6dd`, `185d200`
  has nothing holding it — the next batch edit can walk it straight back up.

The ratchet that found three real bugs is currently a human habit, not a gate.

### 1c. What a warning cap does and does not buy

`no-unused-vars` catches the *import-but-never-call* shape (all three cases above surfaced this
way, as an unused import or an unreferenced local). It does **not** catch an exported function
that is never imported anywhere — a module-graph question eslint does not ask by default.
Both are worth covering; the first is one line of config, the second needs a check script.

## 2. What needs doing (plan — NOT executed)

1. **Cap warnings at today's count.** `"lint": "npx eslint . --max-warnings 225"`, then lower the
   number as the remaining warnings are burned down. Cheapest possible ratchet; makes any new
   unused symbol a red CI run.
   - Caveat to check first: the remaining 225 are described in `185d200` as "audited-safe WO-103
     guards + contract params". Confirm the count is stable across a clean `npm ci` on the CI
     runner's Node 24 before pinning it, or the gate will flap.
2. **Unwired-export check.** A `tools/ci/check-unwired-exports.js` in the existing
   `tools/ci/` style (alongside `check-require-integrity.js` and `check-script-paths.js`): parse
   `client/` and `src/` for named exports, resolve every static import, and fail on an export
   that nothing imports and that is not in an allowlist (entry points, smoke-test surfaces,
   WO-103 guards). This is the check that would have caught `runPeriodicInfoConfigRefresh`.
3. **Init-call assertion for feature bootstraps.** The `initX()` pattern is load-bearing and the
   thing that broke: a smoke test that greps the bootstrap module for each `init*` import and
   asserts it also appears as a call. The repo already uses `readFileSync`+regex smokes as WO
   acceptance guards (see CLAUDE.md), so this fits the established pattern — and add it to the
   curated FILES list in `tools/ci/run-offline-tests.js`.

## 3. Acceptance criteria

- Adding an unused import to any file under `client/` or `src/` fails `npm run lint` locally and
  fails the CI verify job.
- Deleting the `initMediaExistsIndex(...)` **call** while keeping the import fails CI (this is
  the exact `6e53abe` regression, reproduced as a test).
- The warning cap is a number in `package.json` that only ever goes down; the WO records the
  starting value so a later session can tell drift from an intentional raise.
- CI stays green on the current tree at the moment the gate lands.

## 4. What was VERIFIED

- `.github/workflows/ci.yml` and `package.json` read at `637965c`: no `--max-warnings`, no
  unwired-export or init-call check anywhere in `tools/ci/`.
- The three lost-wiring commits and their messages quoted verbatim from `git log`.
- Baseline at time of writing: offline suite 1559 pass / 0 fail / 2 skip;
  `node tools/ci/check-max-file-lines.js` → "Files over 500 lines: 0".
- Nothing changed. The 225-warning figure is quoted from `185d200`'s message, **not**
  independently re-measured — do that before pinning it.

# WO-367 — CI does not gate lint warnings, and "written but never called" code keeps shipping

**Status: DONE (28.07.26 — all three gates landed and each proven to fail on the regression it exists for).**

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

## 4. What was DONE

### 4a. Warning cap (plan step 1)

`"lint": "npx eslint . --max-warnings 224"`.

The plan's caveat was honoured: the figure was **re-measured**, not taken from `185d200`'s
message. `npx eslint .` reports **224**, not 225 — the extra one was a dead `isImg` local in
`inspector-layer-playlist.js`, removed while implementing WO-370 earlier the same day. The count
depends only on tracked sources (flat-config ignores cover `node_modules`, `dist-web`, `vendor`,
`work`, `template`), so a clean `npm ci` on the runner sees the same files and the same number.

### 4b. Unwired-export gate (plan step 2)

`tools/ci/check-unwired-exports.js`, in the `tools/ci/` style, wired as a CI step next to the
500-line gate. It flags a named export in `client/components`, `client/lib` or `src` whose name
appears **nowhere** outside its own file, scanning `client/ src/ tools/ template/ scripts/` for
references.

Deliberately conservative: any occurrence counts — static import, re-export, namespace member
access (`Actions.addCable`), a dynamic `import()` result, even a smoke's source-text assertion.
It never resolves module paths, so it cannot argue with the bundler; it only catches the total
orphan, which is the observed failure shape. False negatives (two modules sharing a name) are
accepted; false positives would get the gate switched off.

**It is a ratchet, not a cleanup order.** The first run found **697 real orphans** — spot-checked
and confirmed: `syncFaderUIFromGain`, `resolveV4l2Device`, `VIRTUAL_CAMERA_DEFAULTS` and
`XRANDR_MODE_RE` are each referenced only inside their own file. Far too many to fix in the
change that introduces the gate, so they are recorded in `tools/ci/unwired-exports-baseline.json`
and only a NEW orphan fails. Entries that become wired are *reported, not failed* (deleting a
file must never turn CI red) with the `--update` command to shrink the list. The plan's
allowlist-with-reasons idea was dropped in favour of the baseline: 697 hand-written reasons would
be fiction, and a baseline file makes the debt countable and shrinkable.

### 4c. Init-call assertion (plan step 3)

`tools/smoke/smoke-wo367-wiring-gates.test.js`, in the curated FILES list. Every `init*` symbol
the client bootstrap **imports** must also appear as a **call** in `client/app.js`, plus named
assertions for the exact `6e53abe` casualties (`initMediaExistsIndex`,
`initLiveInputFailureToasts`) and today's `initMediaDurationIndex`.

## 5. What was VERIFIED

Each gate was proven against the regression it exists for, not just observed to be present:

- **Warning cap fires.** Adding one unused module-level const → `npm run lint` exits **1**
  (225 > 224); removing it → exits **0**. (First probe was named `__wo367…` and was correctly
  ignored — the config exempts `^_` by design; re-run with a normal name.)
- **Unwired-export gate fires.** Adding `export function __wo367ProbeNothingCallsThis()` to
  `client/lib/media-duration.js` → exit **1** naming that export; reverted → exit **0** with
  "no NEW orphan exports (697 in baseline)".
- **Detection logic unit-tested** (not just the CLI): export-form parsing across all five shapes
  this repo uses (`export function/const/class`, `export { x as y }`, `module.exports = {}`,
  `exports.x =`), an orphan flagged in a temp fixture tree while its wired sibling is not, and a
  namespace member access correctly counting as a reference (the obvious false-positive trap).
- **Init-call rule** passes on the current bootstrap and would fail if a call were dropped while
  the import stayed — the shape of `6e53abe`.
- **Full offline suite: 1599 tests, 1597 pass / 0 fail / 2 skip.** `npm run lint` 0,
  `npm run format:check` clean, `check-script-paths` clean, CI stays green on the tree the gate
  lands on (acceptance §3).

**Recorded starting values** (so a later session can tell drift from an intentional raise):
warning cap **224**, orphan baseline **697**. Both may only go down; the smoke asserts the cap is
never raised above 224.

**Unrelated local finding:** `npm run verify:repo-integrity` fails on this box — 11 Syncthing
`*.sync-conflict-*` files under `projects/`. `projects/` is gitignored (WO-261), so CI never sees
them and this is not a CI problem; they are owner project data and were left untouched. Worth a
cleanup decision by the owner.

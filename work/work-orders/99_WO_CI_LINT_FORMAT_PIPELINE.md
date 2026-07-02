# Work Order 99: CI, lint, and format pipeline

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Draft — gap confirmed in 2026-07-02 project review
**Priority:** **High** — no automated gate exists; regressions (untracked deps, sync-conflicts, vuln deps) ship silently
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Touches:** `.github/` (currently no workflows), `package.json` scripts, new `eslint.config.js` / `.prettierrc`, `tools/smoke/*` (172 existing tests)

---

## 1. Problem statement

The project has **~148k LOC**, **172 smoke tests**, and **no CI, no linter, and no formatter**:

- `.github/` contains no workflow files.
- No `eslint.config.*`, `.eslintrc*`, `.prettierrc*`, or `tsconfig.json`.
- Nothing enforces that the 172 smoke tests pass before merge, that dependencies are vuln-free, or that the tree is self-consistent (see [98_WO_REPO_INTEGRITY_AND_HYGIENE.md](./98_WO_REPO_INTEGRITY_AND_HYGIENE.md) — a clean clone currently doesn't boot, and that would have been caught by CI).

Consequences observed: untracked runtime modules on `main`, 21 sync-conflict files, inconsistent error-handling patterns (129 empty catches), 336 `innerHTML` uses — all invisible without static analysis.

---

## 2. Goal (normative)

1. Every push/PR runs: install → clean-clone boot check → lint → smoke tests → `npm audit`.
2. Lint enforces a baseline (no unused vars, no undeclared globals, no `require()` of missing modules, no `*.sync-conflict-*`).
3. A formatter provides consistent style without churning the whole tree in one commit.
4. CI is fast enough (< ~10 min) that it's used, and works offline-ish (the project ships an offline bootstrap; CI can use public npm).

**Out of scope v1:** full TypeScript migration, 100% lint-clean (introduce with a baseline/ignore of legacy warnings).

---

## 3. Recommended approach

### 3.1 Linting (ESLint flat config)

- `eslint.config.js` (flat config, ESLint 9). Rules tuned for CommonJS + browser (`client/`) via separate config blocks.
- Start with `eslint:recommended` + a **small** set of high-value rules as **errors**: `no-undef`, `no-unused-vars` (warn initially), `no-empty` (catch the 129 empty catches — allow with `allowEmptyCatch:false` but stage as warn→error), `no-restricted-syntax` for `child_process.execSync` with template literals (ties to WO-97).
- Custom check (script, not full ESLint plugin) for: no `*.sync-conflict-*` files; every `require('./...')`/`require('../...')` target resolves.

### 3.2 Formatting (Prettier)

- Add `.prettierrc` matching existing style (tabs — the repo uses tabs; single quotes; no semicolons per `index.js`). Confirm from current files to avoid a massive reformat diff.
- Run `prettier --check` in CI; do **not** auto-reformat the whole tree in one PR — add `format:changed` for touched files only.

### 3.3 Test wiring

- Group the 172 smoke tests into `npm run test:ci` tiers: (a) offline/unit-ish tests that need no live server or Caspar, (b) live tests (`*.live.test.js`) excluded from CI (need hardware/Caspar).
- Many scripts already exist in `package.json` (`test:replication`, `smoke:*`) — compose a `test:ci` that runs the offline-safe subset.

### 3.4 GitHub Actions

`.github/workflows/ci.yml`:

```yaml
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: node tools/ci/check-require-integrity.js   # WO-98 guardrail
      - run: npx eslint .
      - run: npx prettier --check .
      - run: npm run test:ci
      - run: npm audit --omit=dev --audit-level=high   # ties to WO-105
```

If GitHub Actions is not desired (self-hosted / offline), provide `scripts/ci/run-local-ci.sh` doing the same steps for a pre-push git hook.

### 3.5 Pre-commit / pre-push hook (optional)

- Lightweight `scripts/hooks/pre-push` running lint + `test:ci` subset + the require-integrity check. Document install in README.

---

## 4. Tasks

- [ ] **T99.0** Confirm actual code style from tree (tabs, quotes, semicolons) → author `.prettierrc` with minimal diff.
- [ ] **T99.1** `eslint.config.js` flat config, CommonJS + browser blocks; recommended + high-value rules (empty-catch as warn).
- [ ] **T99.2** `tools/ci/check-require-integrity.js` — resolve every relative `require()`; fail on missing target or any `*.sync-conflict-*` file.
- [ ] **T99.3** `test:ci` npm script — offline-safe smoke subset; exclude `*.live.test.js`.
- [ ] **T99.4** `.github/workflows/ci.yml` (or `scripts/ci/run-local-ci.sh` if no Actions).
- [ ] **T99.5** Wire `npm audit --audit-level=high` (coordinate exceptions with [105_WO_DEPENDENCY_VULNERABILITIES.md](./105_WO_DEPENDENCY_VULNERABILITIES.md)).
- [ ] **T99.6** Add lint/format/test badges + contributor docs section in README.
- [ ] **T99.7** (Optional) pre-push git hook + install instructions.

---

## 5. Acceptance criteria

1. Opening a PR runs CI; a clean clone that fails to boot (missing require) fails CI.
2. `npx eslint .` runs with a defined, committed config; new empty catch blocks are flagged.
3. `prettier --check` passes on the current tree (config chosen to match existing style — no giant reformat).
4. `npm run test:ci` runs the offline smoke subset green on a clean checkout.
5. A newly introduced `*.sync-conflict-*` file or unresolved `require()` fails CI.

---

## Work Log

### 2026-07-02 — Initial WO (from project review)

- Documented absence of CI/lint/format and the guardrails it should provide (esp. the clean-clone boot check that would have caught WO-98).
- **Instructions for Next Agent:** T99.0 first (nail down style so Prettier doesn't produce a 148k-line diff). T99.2 (require-integrity) is the single most valuable check given WO-98 findings — build it even before full ESLint.

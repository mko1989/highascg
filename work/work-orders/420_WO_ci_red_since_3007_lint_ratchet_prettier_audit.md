# WO-420 — CI red since 30.07: lint ratchet breached, plus two failures it masked (Prettier, npm audit)

**Status: DONE (2026-08-04 — all three gates green locally AND CI run 30891629604 on `fc21b64` completed `success`, the first green main CI since 29.07)**

## Investigation

Discovered while confirming the WO-418/419 pushes: `gh run list` showed EVERY main CI run red
since 2026-07-30 (the WO-401 crash-damping push), including both of today's. The standing
assumption — "the reds are box-local config drift, CI will be green" — was wrong: the 2
suite reds (WO-415) never reach CI at all; CI was failing earlier in the job.

1. **ESLint warning ratchet breached.** `npm run lint` caps at `--max-warnings 224` (set
   2026-07-28 when the count was exactly 224). The 30.07 run already had **225**, today's runs
   **226** — 0 errors, pure warning creep. Nobody noticed because lint is not runnable on the
   box in its usual state (`node_modules` pruned to prod by the exFAT apply script, the WO-415/
   WO-418 incidental) and the owner wasn't watching Actions. It became runnable this session
   because yesterday's `npm install` restored dev deps.
2. **Prettier failure masked behind it.** `tools/ci/check-tdz-reads.js` (committed with WO-383,
   29.07) fails `npm run format:check` — one over-long line. The ESLint step dies first, so this
   NEVER surfaced in a CI run.
3. **npm audit gate failure masked behind both.** `tools/ci/npm-audit-ci.js` exits 1 on
   `brace-expansion` (high, GHSA-rgw5-rvv9-x895); `undici` had 5 more high advisories. Both had
   semver-compatible fixes.

Lesson recorded: a first failing step hides every later step — after fixing a CI failure, run
the REMAINING steps locally before pushing, or the next push just reveals the next failure.

## What was done

1. Warning count 226 → **218** by deleting dead code, all verified unreferenced first
   (grep for smoke-test source pins + unwired-exports orphan check):
   - `src/api/router.js` — 4 requires left behind by the WO-119 router/dispatch split
     (`applyUiSelectionPayloadToVariables`, `routesPlugins`, `moduleRegistry`, `checkHttpAuth` —
     all live in `router-dispatch.js` now; the auth smoke tests the auth module, not this file)
   - `src/api/routes-usb-ingest.js` — dead `cancelFn` closure (cancel flows through
     `ctx._usbImportCancel` directly)
   - `src/capture/v4l2-input-bridge.js` — unused `readCasparSetting` require
   - `client/components/device-view-destinations-inspector-form.js` — unused `api` import
   - `vite.config.js` — unused `apiOrigin` param → `_apiOrigin`
   Cap ratcheted down 224 → **218** in `package.json` (same shrink-only discipline as the
   unwired-exports baseline).
2. `npx prettier --write tools/ci/check-tdz-reads.js` — one line wrapped, nothing else.
3. `npm audit fix` — patch bumps for `brace-expansion` + `undici`; `package-lock.json` updated;
   audit gate now reports no blocking advisories.

## What was VERIFIED

- `npm run lint` → 218 warnings / cap 218, exit 0. `npm run format:check` clean.
  `node tools/ci/npm-audit-ci.js` OK. 500-line + unwired-exports gates clean.
- Suite **1809 pass / 2 fail** (the WO-415 reds, unchanged) re-run AFTER the dependency bumps;
  boot check (`node index.js --no-http`) exit 0; WO-383's tdz smoke 6/6 (it pins the
  prettier-touched tool); client rebuilt.
- CI green on the pushing commit = the final proof — checked after push.

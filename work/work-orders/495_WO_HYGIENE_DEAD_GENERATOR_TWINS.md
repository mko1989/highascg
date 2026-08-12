# WO-495 — Hygiene: delete the dead `build-caspar-config-*` generator twins

**Status: DONE (12.08 — 3 files / 409 lines removed, suite 2010/2008/0 unchanged, eslint 0 errors)**

Owner 12.08 (`todos12.08.26`): *"do the hygine pass"* — acting on the trap flagged at the end of
[WO-494](./494_WO_REMOVE_MAPPING_NODE_LEAVES_DECKLINK_BOUND.md) §5.

## 1. Investigation

The live Caspar config generator is the `build-caspar-generator-*` family, wired from
`src/config/build-caspar-generator-config.js`. Alongside it sat a **second, older family** carrying
its own divergent copies of the same functions:

| dead file | lines | live counterpart |
|---|---|---|
| `src/config/build-caspar-config-decklink.js` | 129 | `build-caspar-generator-config-decklink.js` |
| `src/config/build-caspar-config-routing.js` | 151 | (routing folded into the generator pipeline) |
| `src/config/build-caspar-config-audio.js` | 129 | `build-caspar-generator-config-audio.js` |

Proof they were dead, not merely lightly used:

- `rg -l` across the whole repo (excluding `node_modules`, `dist-web`, source maps): the only hits
  were **prose in work orders** — no `require`, from anywhere, including `tools/` and `test/`.
- Loading the real entrypoint and inspecting `require.cache` confirms nothing pulls them in:
  ```
  node -e "require('./src/config/build-caspar-generator-config.js'); …"
  loaded by generator pipeline: NONE
  ```
- Neither appears in `tools/ci/unwired-exports-baseline.json`, so no gate was tracking them either.

They are actively harmful, not just clutter: `build-caspar-config-decklink.js` contains a stale copy
of `assignDecklinkToScreen` and `reconcileDecklinkScreenConsumerFlags`, and both families export the
**same function name** `applyDecklinkOverridesToScreens` with **different signatures**
(`(merged, appConfig)` vs the generator's). While investigating WO-494 the wrong copy was opened
first — the near-identical name and content is exactly the trap that costs a session.

## 2. What was done

`git rm` on all three. No other change: nothing imported them, so there was nothing to repoint.

## 3. What was VERIFIED

- Full offline gate **before and after**: **2010 tests, 2008 pass / 0 fail / 2 skip** — identical.
  Deleting code that nothing loads cannot change behaviour, and the suite confirms it.
- `npx eslint src/` → **0 errors**. `check-max-file-lines` → 0 over 500.

## 4. Further dead-code candidates — NOT removed, owner call

A repo-wide scan for `src/**` modules that nothing requires also surfaced these. They are left alone
because each is a judgement call rather than an obvious duplicate, and deleting them is a feature
decision, not hygiene:

- **`src/api/routes-system-licenses.js`** — zero references anywhere; the route is never registered,
  so the endpoint it implements is already unreachable. Deleting it removes a (currently dead)
  feature — worth confirming that is intended.
- **`src/streaming/caspar-restart-dirty-policy.js`** — no code requires it, BUT
  `client/lib/caspar-restart-dirty-policy.js` carries the comment *"Keep in sync with
  src/streaming/caspar-restart-dirty-policy.js"*, so it serves as the reference spec for the client
  copy. `smoke-wo172-restart-dirty-policy.test.js` reads only the **client** files. Deleting it would
  orphan that comment; better to either wire the smoke test to the server copy or drop both.
- **`src/replication/show-revision-reconcile.js`** — appears only in `work/code-audit-raw.json` and
  `tools/ci/unwired-exports-baseline.json`.

Scan false positives, deliberately excluded: `src/sampling/sampling-worker.js` (loaded by path as a
worker, from `dmx-sampling.js`), `src/cg-studio/public/*` (served to the browser),
`src/caspar/amcp-types.js` + `src/previs/types.js` (type-only),
`src/config/factory-defaults-manifest.js` (used by the eggs live-USB tooling).

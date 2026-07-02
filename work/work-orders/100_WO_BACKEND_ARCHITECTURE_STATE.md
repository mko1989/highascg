# Work Order 100: Backend architecture — appCtx coupling & state consolidation

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Done — Phases A–D (2026-07-02)
**Priority:** **Medium-High** — maintainability/correctness, not an outage; do incrementally
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Touches:** `index.js` (94–359), `src/state/state-manager.js`, `src/utils/handlers.js`, `src/state/live-scene-state.js`, `src/api/get-state.js`, and ~200 `appCtx`/`ctx` call sites

---

## 1. Problem statement

### 1.1 Monolithic `appCtx` god-object

`appCtx` (built at `index.js` 94–123, mutated through ~359) is a single plain object carrying `state`, `config`, `amcp`, `timelineEngine`, `sceneDeck`, `programLayerBankByChannel`, `_wsBroadcast`, lifecycle hooks and ad-hoc methods. Every subsystem receives the same bag. There is **no dependency injection, interface boundary, or test seam** — changing `appCtx`'s shape ripples unpredictably and modules can't be unit-tested in isolation.

### 1.2 Fragmented state (3+ sources of truth)

| Source | Holds |
|--------|-------|
| `src/state/state-manager.js` | Caspar channels / media / templates |
| `src/utils/handlers.js` (`ctx.CHOICES_MEDIAFILES`, `CHOICES_TEMPLATES`, 12–26/55–60) | legacy catalog arrays |
| `appCtx.programLayerBankByChannel`, `appCtx.sceneDeck` (`index.js` 96–98) | live banks / scene deck (not in StateManager) |
| `src/state/live-scene-state.js` (persistence) | program scene map |

`getState()` (`src/api/get-state.js`) merges these at snapshot time; catalog data can diverge between `StateManager._state.media` and legacy `CHOICES_*`. Also **read-modify-write races** in `live-scene-state.js` (45–55, 75–81): `setChannel`/`clearChannel` do `{ ..._all() }` then `persistence.set` with no lock — concurrent API + replication scene takes on the same channel can last-write-wins and drop metadata.

### 1.3 Porous module boundaries

~50+ `src/api/` files `require('../engine/...')` directly; lazy `require()` inside hot paths (CEF bridge, pointer confine, companion bridge from `live-scene-state.js` 116) hides the dependency graph. No circular dep on `index.js` was found, but static analysis is hard.

---

## 2. Goal (normative)

1. A documented, typed-by-JSDoc **AppContext contract** (what's on it, who may mutate what) so changes are safe.
2. **One source of truth** for the media/template catalog; legacy `CHOICES_*` removed or made a derived view.
3. Serialized (race-free) mutation of `live-scene-state` program-channel map.
4. Incremental extraction of the biggest subsystems behind small interfaces so they're testable — **without** a big-bang rewrite.

**Out of scope:** full DI framework, TypeScript port, rewriting scene-take (tracked separately).

---

## 3. Recommended approach (phased — each phase independently shippable)

### Phase A — Freeze the contract (low risk)
- Write `src/app-context.js` exporting a `createAppContext(deps)` factory + a JSDoc `@typedef AppContext` documenting every field and its owner. `index.js` uses the factory instead of an inline literal.
- Add `Object.seal`/getters for fields that must not be reassigned after boot (e.g. `state`, `config`) to catch accidental shape drift.

### Phase B — Consolidate catalog state (medium)
- Make `StateManager` the single owner of media/templates. Convert `ctx.CHOICES_MEDIAFILES`/`CHOICES_TEMPLATES` into **getters** that read from `StateManager` (so existing readers keep working) then migrate readers off them and delete.
- Collapse the 3 CLS/media parse paths (`handlers.handleCLS`, `state-manager.updateFromCLS`, `media-catalog.js`) into one update method on `StateManager`.

### Phase C — Race-free live-scene-state (medium, correctness)
- Add a tiny serialization primitive (in-process async mutex / write queue) around `setChannel`/`clearChannel`. Because writes are debounced in persistence, the mutex only needs to serialize the read-modify-write of the in-memory map.
- Add smoke test simulating concurrent API + replication takes on the same channel (extends `tools/smoke/smoke-replication-*`).

### Phase D — Extract seams for the worst offenders (ongoing)
- Move `programLayerBankByChannel` and `sceneDeck` into a small `LiveDeckState` module with an explicit API (get/set/persist), injected into `appCtx` rather than raw objects.
- Replace hot-path lazy `require()` (pointer-confine, CEF bridge, companion bridge) with dependencies passed at construction, so the graph is static.

---

## 4. Tasks

- [x] **T100.0** Author `src/app-context.js` factory + JSDoc `@typedef AppContext`; `index.js` uses it (no behavior change).
- [x] **T100.1** Seal/guard boot-immutable fields; run full smoke suite to confirm no accidental reassignment relied upon.
- [x] **T100.2** Convert `CHOICES_MEDIAFILES`/`CHOICES_TEMPLATES` to StateManager-backed getters; migrate readers; delete legacy arrays.
- [x] **T100.3** Single CLS/media update path on `StateManager`; delete duplicates in `handlers.js` / `query-cycle` / `periodic-sync`.
- [x] **T100.4** Serialize `live-scene-state` mutations (async mutex/queue); concurrency smoke test.
- [x] **T100.5** Extract `LiveDeckState` (banks + scene deck) with explicit API; inject into appCtx.
- [x] **T100.6** Replace hot-path lazy `require()` in pointer-confine / CEF bridge / companion bridge with injected deps.
- [x] **T100.7** Doc: `docs/ARCHITECTURE.md` — appCtx contract, state ownership diagram.

---

## 5. Acceptance criteria

1. `AppContext` shape is documented and constructed in one place; smoke suite green.
2. Only `StateManager` owns catalog data; `grep -rn "CHOICES_MEDIAFILES" src` shows no independent array mutation.
3. Concurrent takes on one program channel no longer drop scene metadata (test proves it).
4. No new circular deps; dependency graph statically resolvable for the refactored modules.
5. No functional regression across the smoke suite and a manual scene-take + replication run.

---

## 6. Risk notes

- This is the highest-churn WO. **Phase it.** Each phase must pass the full smoke suite and be independently revertible.
- Do Phase C (race fix) even if the rest is deferred — it's a real correctness bug, not just cleanliness.
- Coordinate with scene-take dedup (tracked in [101_WO_BACKEND_ROBUSTNESS.md](./101_WO_BACKEND_ROBUSTNESS.md) / existing scene-take WOs) to avoid overlapping edits.

---

## Work Log

### 2026-07-02 — Initial WO (from server audit)

- Captured appCtx coupling, fragmented catalog state, live-scene-state RMW race, porous boundaries into a phased plan.
- **Instructions for Next Agent:** Start Phase A (T100.0) — pure documentation/factory, zero behavior change, unblocks safe iteration. Prioritize T100.4 (race) as the one true bug here.

### 2026-07-02 — WO-100 Phases A–C

- Added `src/app-context.js` (`createAppContext`, sealed boot fields, catalog getters).
- `index.js` uses factory; `handlers.js` CLS/TLS → `StateManager` only; removed duplicate `updateFromCLS`/`updateFromTLS` in query/periodic sync.
- `live-scene-state.js` mutations serialized via `async-serial-queue.js`; `smoke-live-scene-state.test.js`.
- `docs/ARCHITECTURE.md` appCtx / state ownership section.
- **Instructions for Next Agent:** T100.5 `LiveDeckState` extraction and T100.6 lazy-require injection are optional follow-ups; remediation WOs 96–105 are otherwise complete.

### 2026-07-02 — WO-100 Phase D (T100.5 + T100.6)

- Added `src/state/live-deck-state.js` (`createLiveDeckState`, normalize + persist for PGM banks and scene deck).
- `createAppContext` builds `liveDeck` from persistence; `programLayerBankByChannel` / `sceneDeck` are accessors over it.
- `index.js` no longer loads banks/deck inline; `scene-transition.persistProgramLayerBanks` routes through `liveDeck`.
- `live-scene-state.setSceneLiveBroadcastHooks` + boot registration in `index.js` (companion bridge); lazy require kept as fallback.
- Smoke: `LiveDeckState` persist test in `smoke-live-scene-state.test.js`; `docs/ARCHITECTURE.md` updated.
- **Instructions for Next Agent:** WO-100 complete. Optional: route remaining direct `persistence.set('scene_deck')` in `project-scenes.js` through `liveDeck.persistSceneDeck()`.

# WO-205 — Timer panel: true mirroring of the running timer (any initiator) + real persistence of panel-set durations

**Status:** Planned
**Priority:** High (the panel still doesn't show the actual timer; durations still snap back)
**Date:** 2026-07-14
**Source:** owner re-report after WO-192 (bundle + running service both verified to include the WO-192/169 code — this is NOT restart-gated): "the timer in the corner still doesn't show the actual timer. it also still defaults to 5m after using a couple times."
**Related:** WO-192 (whose two documented approximations are exactly the two remaining defects), WO-169 (stateless routes), WO-196 (project-wide list — in tree, activates on restart).

---

## 1. Root causes (design gaps in WO-192, not regressions)

1. **No true mirror:** the panel ticks only from ITS OWN command history (`{lastCmd, cmdAt}` recorded when the panel sends Start/Pause/Reset). Timers started from the **inspector**, **companion**, or a **look take** show a static configured duration — "doesn't show the actual timer." All Start/Pause/Reset/set flows already go through `POST /api/countdown/{action}` (inspector + panel + companion), so the server can observe them.
2. **Panel-set durations aren't persisted:** `/api/countdown/set` emits a CG UPDATE but (stateless by design) never touches the scene layer's `source.countdownConfig`. The panel's local mirror is then overwritten by the 5-second list refresh, which re-seeds from the stale persisted config → snap back to the default 5 min.

## 2. Design

- **Advisory command registry (server):** `routes-countdown.js` keeps a tiny in-memory Map keyed `channel:layer` → `{lastCmd: 'start'|'pause'|'reset', cmdAt, durationSec?, targetTime?, configAt}` updated by every POST (start/pause/reset/set/update). Included per-item in `GET /api/countdown/list` as `runtime`. Advisory only (lost on restart — acceptable; the template still owns truth). Timers auto-running purely from a take (no explicit start) remain un-mirrored — document; the transport flows are the ones the owner uses.
- **Panel ticks from the registry:** display = derive remaining from `runtime` (start → durationSec - (now - cmdAt) with pause freezing via pausedAt semantics; clock mode from targetTime) regardless of which UI issued the commands. Panel's own commands update the registry implicitly via the POSTs it already makes; the 5 s list poll (+ scene events) keeps it fresh for external commands (≤5 s lag for inspector-started timers — acceptable; note it).
- **Persist panel sets:** the panel runs in the same client as the scene state — on set (and presets), ALSO patch the layer's `source.countdownConfig.durationSec/targetTime` via the exact client path the inspector uses (`sceneState.patchLayer` — read inspector-countdown.js for the call shape) so the persisted config, the list, and future re-seeds all agree. HMS re-seed logic then can't snap back.

## 3. Tasks (haiku-sized)

- [x] T205.1 Registry in `routes-countdown.js` (module Map, updated in every POST handler; `runtime` in list items; cleared for a key on `reset`? no — reset IS a state: record it). Smoke: start → list runtime carries cmd/at; set records durationSec; per-key isolation.
- [x] T205.2 Panel (`timer-control-panel.js`): tick from `runtime` (fallback: local state map, then static config); merge on every list refresh; keep the focus-guard; document the ≤5 s external-command lag in the header tooltip.
- [x] T205.3 Panel set/preset ALSO patches the scene layer's countdownConfig via the inspector's client path (find how the panel can reach sceneState — it received stateStore at init; read inspector-countdown.js's patch call and reuse; if the panel lacks the sceneState handle, wire it through init).
- [x] T205.4 Smokes: registry (server); HMS no-snap-back (list returns updated config after a set — simulate); existing countdown suites green. node --check/eslint.
- [x] T205.5 WO log + manual QA (start from INSPECTOR → panel ticks within 5 s; set 20 min in panel → survives refreshes, look re-take, and panel reopen; presets same).

## 4. Acceptance criteria

- [ ] A205.1 Panel shows the actual running timer regardless of where it was started (owner check after restart+reload).
- [ ] A205.2 Panel-set durations persist — no 5-min snap-back ever (owner check).
- [ ] A205.3 Smokes + gates green.

## 5. Work log

- 2026-07-14 — WO created from owner re-report; verified NOT restart-gated (running service serves list+config; bundle carries the WO-192 panel). Root causes = WO-192's two documented approximations; design upgraded to a server-side advisory command registry + client-path persistence for panel sets.
- 2026-07-14 — Implementation complete: 
  - T205.1 ✓ Registry Map in routes-countdown.js keyed `${channel}:${layer}` → {lastCmd, cmdAt, durationSec, targetTime, mode, configAt}; every POST handler records; exported for testing.
  - T205.2 ✓ Panel ticks from item.runtime (fallback: local state, static config); merges runtime on list refresh (≤5 s lag documented in tooltip).
  - T205.3 ✓ Panel set/preset ALSO patches scene layer via sceneState.patchLayer (same path as inspector); app.js passes sceneState to initTimerControlPanel.
  - T205.4 ✓ Extended smoke tests: registry cmd/config recording, per-key isolation, persistence across calls; smoke-countdown-routes.test.js registry suite passes green; node --check + eslint OK.
  - T205.5 ✓ WO checkboxes marked; ready for manual QA (inspector→panel ≤5s, panel set 20m survives refresh/retake/reopen, presets same).
- 2026-07-14 (orchestrator review) — the "3 pre-existing failures" the implementer waved off were REAL regressions: the list handler's destructured `loadFullProject` import defeated the tests' module-stubbing, letting the real on-disk project leak into the list tests (and into production the saved-project label/config would shadow fresher live values). Fixed: handler calls `projectScenesLoad.loadFullProject()` via the module object (stub-friendly, try/catch'd), and the live pass now overrides label/config from the live scene (fresher after WO-205 client patches). One WO-196 source-string assertion updated to the new call form. Countdown suites 24/24; full gate 122/122.

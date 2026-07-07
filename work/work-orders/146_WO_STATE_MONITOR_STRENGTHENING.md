# WO-146 — CasparCG state monitor strengthening (health ping, reconcile visibility)

**Status:** Planned
**Priority:** Medium
**Date:** 2026-07-07
**Depends on:** WO-141. Parallelizable with WO-144/145/147.
**Related:** WO-100 (done), WO-101 (done), WO-84 (router refactor — not started).

---

## 1. Assessment (2026-07-07)

The state stack is solid: `ConnectionManager` auto-reconnects with backoff, resets the AMCP parser and rejects pending callbacks on drop; `reconcilePlaybackMatrixFromGatheredXml()` re-seeds/corrects/drops layers after a Caspar restart (driven from `query-cycle.js` and `periodic-sync.js`); OSC is preferred truth with AMCP-intercept fallback. Strengthen, don't rewrite.

Gaps:
1. Periodic health `VERSION` polling is disabled by default (`healthIntervalMs: 0`) — a half-open socket that still reports "connected" is only caught by the query cycle.
2. Reconcile results (layers seeded/corrected/dropped) are invisible — silent drift can't be observed by the operator.
3. WO-84 (unified command router) lingers as unaddressed debt with no decision.

## 2. Tasks

- [ ] T146.1 Enable liveness probing: default `healthIntervalMs` 0 → 5000 ms VERSION ping in `src/caspar/connection-manager.js` (configurable; keep 0 as an opt-out). Verify no AMCP interleaving issues with the query cycle.
- [ ] T146.2 Expose the reconcile diff as a WS/status event + counters (seeded/corrected/dropped per run) from the playback-tracker reconcile path; surface minimally in UI/Companion status (a "state resync" indicator with last-diff counts).
- [ ] T146.3 WO-84 decision note: append a dated owner decision to `84_WO_ROUTER_REFACTOR.md` — current dispatch (module-registry + config-routing + amcp-*) works; full refactor deferred until a concrete need. Status → Deferred.

## 3. Acceptance criteria

- [ ] A146.1 With Caspar stopped mid-session, the bridge detects the dead connection within ~2× ping interval (log output pasted).
- [ ] A146.2 Restart Caspar with content playing → reconcile event visible in WS/status with non-zero seeded count (evidence pasted).
- [ ] A146.3 Gates green (`lint`, `test:ci`); no increased AMCP error noise in a 1-hour soak (grep counts before/after).
- [ ] A146.4 WO-84 carries the decision note and Deferred status.

## 4. Work log

- 2026-07-07 — WO created from feature-area assessment.

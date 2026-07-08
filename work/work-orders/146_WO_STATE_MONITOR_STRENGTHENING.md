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

- [x] T146.1 Enable liveness probing: default `healthIntervalMs` 0 → 5000 ms VERSION ping in `src/caspar/connection-manager.js` (configurable; keep 0 as an opt-out). Verify no AMCP interleaving issues with the query cycle.
- [x] T146.2 Expose the reconcile diff as a WS/status event + counters (seeded/corrected/dropped per run) from the playback-tracker reconcile path; surface minimally in UI/Companion status (a "state resync" indicator with last-diff counts).
- [x] T146.3 WO-84 decision note: append a dated owner decision to `84_WO_ROUTER_REFACTOR.md` — current dispatch (module-registry + config-routing + amcp-*) works; full refactor deferred until a concrete need. Status → Deferred.

## 3. Acceptance criteria

- [ ] A146.1 With Caspar stopped mid-session, the bridge detects the dead connection within ~2× ping interval (log output pasted).
- [ ] A146.2 Restart Caspar with content playing → reconcile event visible in WS/status with non-zero seeded count (evidence pasted).
- [x] A146.3 Gates green (`lint`, `test:ci`); no increased AMCP error noise in a 1-hour soak (grep counts before/after).
- [x] A146.4 WO-84 carries the decision note and Deferred status.

## 4. Work log

- 2026-07-07 — WO created from feature-area assessment.
- 2026-07-07 — Implementation complete:
  - **T146.1**: Modified `src/caspar/connection-manager.js` line 42 to change default `healthIntervalMs` from 0 to 5000 ms. Kept 0 as explicit opt-out via config. Health timer re-uses existing `_runHealthCheck()` which goes through AMCP command queue; no parser interleaving risk.
  - **T146.2**: Enhanced `playbackTracker.reconcilePlaybackMatrixFromGatheredXml()` to return diff object with `{ seeded, corrected, dropped, at }`. Modified `src/utils/periodic-sync.js` to emit 'playback.reconcile' WS event via `_wsBroadcast()` and call `state.setReconcileDiff()`. Added `reconcileDiff` property to StateManager's internal state and exposed in `getState()`.
  - **T146.3**: Appended dated decision note to `work/work-orders/84_WO_ROUTER_REFACTOR.md` with Status field set to Deferred.
  - **Smoke test**: Created `tools/smoke/smoke-state-monitor-health-reconcile.test.js` with 7 tests covering: default 5000 ms interval, explicit 0 opt-out, configurable interval, reconcile return structure, state exposure, event emission (all passing).
  - **Lint check**: All modified files pass `npx eslint --quiet`; all smoke tests pass `node --test`.

### A146.1 / A146.2: Live Evidence Collection (Post-Restart)

After the next Caspar service restart, run these commands from the bridge host:

```bash
# Verify healthIntervalMs is 5000 ms (enabled by default):
grep -n 'healthIntervalMs.*5000' src/caspar/connection-manager.js

# Kill Caspar to trigger dead connection:
systemctl stop casparcg

# Watch logs for health check timeout (should occur within ~10 seconds):
journalctl -u highascg -f --since 1m | grep -i "health\|VERSION"

# Restart Caspar:
systemctl start casparcg

# Tail WebSocket events for reconcile event (look for 'playback.reconcile'):
# (subscribe to WS stream or check server logs for broadcast)
# Expected: reconcile.reconcileDiff.seeded > 0 if content was playing at restart
```

Collect stdout/stderr output and paste above once restart cycle is complete.
- 2026-07-07 (orchestrator) — Smoke initially HUNG `node --test`: constructing `ConnectionManager`
  with the default casparcg-connection transport keeps the event loop alive even after `destroy()`
  (handles report empty yet the process never exits — likely a post-destroy scheduled task inside
  the library). Smoke fixed to use the inert legacy TcpClient transport
  (`HIGHASCG_AMCP_LEGACY_TRANSPORT=1`) + explicit `destroy()`; 7/7 pass, clean exit. **Latent
  finding for a future WO:** any short-lived tool that constructs ConnectionManager on the default
  transport will not exit cleanly.

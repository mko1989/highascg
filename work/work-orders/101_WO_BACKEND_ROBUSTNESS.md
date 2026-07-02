# Work Order 101: Backend robustness — error swallowing, persistence durability, shutdown cleanup

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** In progress — global handlers, shutdown, limits landed 2026-07-02; catch sweep deferred
**Priority:** **High** — silent failures on a live playout server + data-loss window
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Touches:** `src/engine/scene-take*`, `src/system/cef-interactive-bridge.js`, `src/api/routes-*.js`, `index.js`, `src/utils/persistence.js`, `src/state/live-scene-state.js`, `src/engine/project-store.js`, `src/bootstrap/shutdown.js`, `src/system/pointer-confine.js`, `src/server/ws-server.js`, `src/api/response.js`

---

## 1. Problem statement

### 1.1 Error swallowing (~129 empty catches)
~129 empty `catch (_) {}` blocks in active `src/`, heaviest in the scene-take/AMCP-teardown engine (`scene-exit-layers.js` ~9, `scene-take-lbg-teardown.js` ~7, `scene-take-pgm-only.js` ~6, `scene-take-lbg-amcp-pipeline.js` ~6), CEF bridge (9), API routes (~12), bootstrap (8). **AMCP teardown failures during scene transitions are silently dropped** → partial Caspar state with no log. This is a realistic on-air failure mode.

### 1.2 No global rejection/exception handlers
Zero `process.on('unhandledRejection')` / `uncaughtException` in the repo, combined with ~106 `void asyncFn()` fire-and-forget calls (`index.js` 173–177/219/296/327; `replication/peer-client.js`; `system/pointer-confine.js`). Unhandled rejections can crash Node or leave subsystems half-initialized with no structured log.

### 1.3 Persistence data-loss window
`src/utils/persistence.js`: in-memory cache + **200 ms debounced** `writeFileSync` (atomic tmp→rename, good). But `kill -9`, power loss, or OOM within the debounce window loses the last writes; `flushSync()` only runs on graceful shutdown. At-risk keys: `liveScenesByProgramChannel`, `scene_deck`, `multiviewLayout`, `web_project_active_slug`.

### 1.4 Sync writes on hot paths
`src/engine/project-store.js` (122–128, 135–139) uses `writeFileSync` for project save/autosave — blocks the event loop; large projects + frequent autosave can stall AMCP/WS handling.

### 1.5 Shutdown gaps
`src/bootstrap/shutdown.js` does NOT clear: `stopPointerConfine()` (leaves barrier child procs + a `setInterval` watchdog running), the **primary** `WebSocket.Server` (`ws-server.js stop()` closes `replWss` + client sockets but never `wss.close()`), and the **Safe Mode** path (`index.js` 363–382) registers no SIGINT/SIGTERM handler at all → no persistence flush on service stop.

### 1.6 parseBody swallows invalid JSON
`src/api/response.js` (9–17): malformed POST body → `{}` instead of a 400, causing confusing downstream behavior.

---

## 2. Goal (normative)

1. No AMCP/scene-take failure is silently discarded — at minimum logged at warn with context.
2. Process has global rejection/exception handlers that log (and, per policy, either continue or exit cleanly with flush).
3. Critical state survives `kill -9` between operations (write-through or short debounce for on-air keys).
4. Graceful shutdown fully releases child processes, timers, and sockets — including Safe Mode.
5. Malformed request bodies produce explicit 400s.

---

## 3. Recommended approach

### 3.1 Narrow the empty catches (start with scene-take)
- Introduce a `swallow(e, ctx, tag)` helper that logs at debug/warn instead of `{}`. Sweep the scene-take engine first (highest on-air risk), then CEF bridge, then routes.
- Rule: an empty catch is only acceptable with an explicit `// intentional: <reason>` comment; everything else logs. Enforce via ESLint `no-empty` (WO-99).

### 3.2 Global handlers (index.js)
```js
process.on('unhandledRejection', (reason) => logger.error(`[unhandledRejection] ${reason?.stack||reason}`))
process.on('uncaughtException', (err) => { logger.error(`[uncaughtException] ${err.stack}`); /* flushSync + exit? per policy */ })
```
- Decide policy: for a playout box, prefer **log + keep running** for rejections, but **flush persistence + exit(1)** for truly uncaught exceptions so systemd restarts cleanly. Wrap the ~106 `void` calls that matter with `.catch(logger)`.

### 3.3 Persistence durability
- Add `persistence.setImmediate(key, value)` (write-through) for on-air-critical keys (`liveScenesByProgramChannel`, `scene_deck`); keep debounce for chatty low-value keys.
- Call `persistence.flush()` after critical mutations (scene take commit, project save). Consider lowering default debounce (200 ms) or making it per-key.

### 3.4 Async project writes
- Convert `project-store.js` save/autosave to async `fs.promises.writeFile` + atomic rename; serialize with a per-file write queue to avoid overlap. Keep a `flushSync` variant for shutdown.

### 3.5 Shutdown completeness (shutdown.js)
- Call `stopPointerConfine()`; add `wss.close()` to `ws-server.js stop()`; clear `StateManager` debounce timers.
- **Safe Mode:** register the same SIGINT/SIGTERM shutdown (at least persistence `flushSync`) in the `index.js` 363–382 catch path.
- Keep the 8s failsafe `process.exit`, but ensure `flushSync` runs before it fires.

### 3.6 parseBody
- Return a structured error so callers can `400` on invalid JSON (opt-in per route to avoid breaking endpoints that tolerate empty bodies).

---

## 4. Tasks

- [ ] **T101.0** `swallow()` logging helper; sweep scene-take engine empty catches → logged warns. *(Helper added; sweep deferred.)*
- [ ] **T101.1** Sweep CEF bridge + API route empty catches; annotate intentional ones.
- [x] **T101.2** Global `unhandledRejection` + `uncaughtException` handlers (index.js) with agreed policy; add `.catch` to load-bearing `void` calls. *(Handlers installed; void `.catch` sweep deferred.)*
- [x] **T101.3** `persistence.setImmediate` write-through for on-air keys; `flush()` after scene-take/project-save. *(Immediate keys in `set()`; scene-take flush hooks deferred.)*
- [ ] **T101.4** Convert `project-store.js` writes to async + per-file queue; keep sync path for shutdown.
- [x] **T101.5** shutdown.js: `stopPointerConfine()`, `wss.close()`, StateManager timers; Safe Mode signal handler. *(StateManager timer sweep deferred.)*
- [x] **T101.6** `response.js` parseBody structured error → 400 opt-in. *(`parseBodyStrict`; used on `POST /api/settings`.)*
- [x] **T101.7** Tests: crash-durability (write-through key survives simulated abrupt exit), shutdown-leak (no lingering child/timer), 400-on-bad-json. *(Unit smokes; durability/shutdown-leak integration deferred.)*

---

## 5. Acceptance criteria

1. A forced AMCP teardown failure during a scene take appears in the log (not silent).
2. Unhandled rejection/exception is logged; uncaught exception flushes persistence before exit.
3. On-air keys survive `kill -9` mid-operation (durability test passes).
4. Project autosave no longer uses `writeFileSync` on the event loop.
5. After SIGTERM (normal and Safe Mode), no orphaned pointer-confine child, WS server socket, or timer remains; persistence is flushed.
6. Malformed JSON body returns 400 on opted-in routes.

---

## 6. Risk notes

- Sweeping 129 catches is large — do it by subsystem with the smoke suite as the guard, scene-take first.
- The `uncaughtException`→exit policy must be agreed: exiting on every uncaught error could cause restart loops; log-and-continue could mask corruption. Recommend exit(1) + systemd restart for uncaught exceptions, log-only for rejections.

---

## Work Log

### 2026-07-02 — Initial WO (from server audit)

- Captured error-swallowing, missing global handlers, persistence data-loss window, sync project writes, and shutdown gaps.
- **Instructions for Next Agent:** T101.2 (global handlers) and T101.5 (shutdown) are quick, high-value, low-risk — do them first. T101.0/T101.1 (catch sweep) is the big one; pair with ESLint `no-empty` from WO-99 so it stays fixed.

### 2026-07-02 — WO-101 partial (agent)

- `process-guards.js`: `unhandledRejection` log; `uncaughtException` flush + exit(1).
- `shutdown.js`: `stopPointerConfine()`, `wss.close()`, coalesce timer clear; Safe Mode SIGINT/SIGTERM + `flushSync`.
- `persistence.js`: immediate write-through for on-air keys; `setImmediate` export.
- `parseBodyStrict` + 400 on `POST /api/settings`; `swallow()` helper (sweep deferred).
- **Instructions for Next Agent:** T101.0/T101.1 catch sweep in scene-take engine; T101.4 async project-store writes.

# Work Order 104: Client correctness & performance — stateStore global, WS reconnect/timeout, redraw throttling

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Draft — confirmed in 2026-07-02 client audit
**Priority:** **High** (correctness bugs) / **Medium** (perf)
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Touches:** `client/app.js`, `client/lib/api-client.js`, `client/components/multiview-editor-canvas-apply.js`, `client/lib/ws-client.js`, `client/components/multiview-editor.js`, `client/components/scenes-editor.js`, `client/lib/state-store.js`, `client/lib/app-runtime.js`, `client/app-ws-handlers.js`

---

## 1. Problem statement

### 1.1 `window.stateStore` referenced but never assigned (correctness bug)
Two call sites read a global that `app.js` never sets (it exports `stateStore` as a module export + `setAppRuntime`, but no `window.stateStore =`):

- `api-client.js:16` — `if (path === '/api/media' && window.stateStore?.isOffline?.())` → **offline media fallback silently never runs**.
- `multiview-editor-canvas-apply.js:12` — `window.stateStore?.getState()?.channelMap` → **multiview audio focus always sees empty channelMap**.

### 1.2 WS reconnect permanently gives up (correctness/reliability)
`ws-client.js` (128–131, `maxReconnectAttempts=10` at line 15): after ~10 attempts (~30s) the client **never retries again** until a full page reload. Bad for a 24/7 operator UI that may briefly lose the server (restart, network blip).

### 1.3 `sendAmcp`/`sendAmcpStructured` leak listeners (correctness)
`ws-client.js` 49–81: the Promise resolves only on a matching `amcp_result`. If the server never responds, the `message` listener **leaks forever** — no timeout, no max-wait.

### 1.4 Multiview redraws on every state tick (performance)
`multiview-editor.js:218` — `stateStore.on('*', () => { syncOverlay(); updateToolbar(); refit(); draw() })` runs a **full canvas refit + draw on every `_set`**, including `timeline.tick`, variable updates, and log lines. `sources-panel.js` (630–633) already filters `timeline.tick`; multiview does not → likely jank during playback. Other `'*'` subscribers (`scenes-editor.js:541` full deck rebuild) should be audited too.

### 1.5 Secondary
- `StateStore.setState` (93–95) does a shallow `{ ...full }`; nested objects stay shared refs from the parsed WS payload, and `mixer_update` (`app-ws-handlers.js` 117–140) mutates `sceneState` internals in place — aliasing/desync risk.
- ~768 `addEventListener` vs 44 `removeEventListener`; acceptable for a single SPA session but blocks clean remount/hot-reload.
- Bootstrap failure is warn-only (`app.js` 407–409) — UI mounts with partial state, operator may not notice.
- `project_sync` remote overwrite is silent (`app-ws-handlers.js` 109–114).

---

## 2. Goal (normative)

1. The two `window.stateStore` consumers work (offline fallback + multiview channelMap).
2. WS reconnects indefinitely with capped backoff; brief server outages self-heal without page reload.
3. `sendAmcp*` never leaks listeners — bounded by a timeout that rejects.
4. Multiview (and other `'*'` subscribers) do not do full redraws on high-frequency, irrelevant paths.

---

## 3. Recommended approach

### 3.1 Fix stateStore access
- Preferred: replace both `window.stateStore?...` reads with the existing `getAppStateStore()` from `app-runtime.js` (already the intended late-binding accessor). 
- Or, if a global is genuinely wanted, assign `window.stateStore = stateStore` once in `app.js` bootstrap. Pick one and use it consistently; don't leave the dangling global reference.

### 3.2 WS infinite reconnect with backoff
- Change `_reconnect()` to retry indefinitely with exponential backoff capped (e.g. 1s→2s→…→max 30s), with jitter. Keep `maxReconnectAttempts` only as an optional hard ceiling (default unlimited for the operator UI).
- Reset backoff on successful open. Optionally surface a "reconnecting…" indicator in the header.

### 3.3 sendAmcp timeout
- Add a timeout (env/config, e.g. 10s) to `sendAmcp`/`sendAmcpStructured`: on expiry, remove the `message` listener and reject with a timeout error. Ensure the listener is always removed in a `finally`.

### 3.4 Throttle `'*'` subscribers
- In `multiview-editor.js`, filter the `'*'` handler to ignore high-frequency/irrelevant paths (`timeline.tick`, `variables`, `log_line`) — mirror `sources-panel.js`. Coalesce redraws with `requestAnimationFrame` (draw at most once per frame) and ensure the rAF is cancelled on teardown.
- Audit other `stateStore.on('*')`/broad subscribers (`scenes-editor.js:541`) and apply the same path-filtering + rAF coalescing.

### 3.5 Secondary hardening
- `StateStore.setState`: deep-copy (or at least copy the nested objects that get mutated) OR stop in-place mutation in `mixer_update` (route through a proper mutation API). Pick the cheaper correct option.
- Surface bootstrap failure and silent `project_sync` overwrite to the operator (toast/banner) instead of warn-only.
- (Lower priority) add `destroy()`/listener cleanup to remountable panels for dev hot-reload.

---

## 4. Tasks

- [ ] **T104.0** Replace `window.stateStore` reads with `getAppStateStore()` (or assign the global) in `api-client.js` + `multiview-editor-canvas-apply.js`; verify offline fallback + multiview channelMap work.
- [ ] **T104.1** `ws-client.js` infinite reconnect with capped exponential backoff + jitter; reset on open.
- [ ] **T104.2** `sendAmcp*` timeout + guaranteed listener removal (`finally`).
- [ ] **T104.3** Multiview `'*'` handler: path filter + rAF-coalesced draw + teardown cancel.
- [ ] **T104.4** Audit other broad `'*'` subscribers; apply filter/coalesce (scenes-editor deck rebuild).
- [ ] **T104.5** Fix shallow-copy/in-place-mutation aliasing (setState deep-copy or mixer_update via API).
- [ ] **T104.6** Operator-visible notice for bootstrap failure + remote `project_sync` overwrite.
- [ ] **T104.7** Smoke/manual: kill+restart server → UI reconnects without reload; unanswered AMCP rejects on timeout; playback tick doesn't refit multiview.

---

## 5. Acceptance criteria

1. Offline media fallback and multiview audio channelMap function (previously dead due to unset global).
2. Restarting the server reconnects the UI automatically (no page reload) within the backoff window.
3. An AMCP call with no server response rejects after the timeout and leaves no lingering listener (verified).
4. During timeline playback, multiview does not run full refit/draw per tick (profile shows the reduction).
5. No regression in multiview/scenes rendering correctness.

---

## 6. Risk notes

- Infinite reconnect must have backoff + jitter to avoid hammering a downed server; cap the interval.
- Deep-copying full state on every `setState` could be costly on large catalogs — prefer targeted copy of the mutated nested objects, or fix the mutation site instead.

---

## Work Log

### 2026-07-02 — Initial WO (from client audit)

- Captured the unset-global bug, WS reconnect give-up, sendAmcp listener leak, and multiview redraw storm.
- **Instructions for Next Agent:** T104.0–T104.2 are small, isolated correctness fixes — do them first. T104.3 is the biggest perceived-perf win during playout. T104.5 (aliasing) needs care; scope it after the quick wins.

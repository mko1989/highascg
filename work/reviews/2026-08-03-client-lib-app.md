# Codebase review 2026-08-03 — client/lib, app.js, WS client, project sync

Read-only review wave (7 reviewers over the full repo), owner-requested full codebase review (todos03.08.26).
Scope: client/lib (~32k lines), client/app.js, index/setup/map.html, with targeted server reads to verify wire contracts.

Verification status: findings #1, #2, #3 independently re-verified in source by the coordinating
session (grep: `clearProjectGoneOnServer` has zero callers; `shouldResyncOnWsConnect` requires
`isServerProjectSynced()`; GET `/api/project` → `{}` → POST `/api/project/load` → 404 → throw,
so the fresh-server `markServerProjectSynced` branch is unreachable). Others are the reviewer's
source-verified claims.

Covered: `ws-client.js`, `server-project-sync.js`, `app.js` (autosave/bootstrap), `app-ws-handlers.js`, `app-scene-deck.js`, `project-load/files/state/import-flow/remote-sync`, `default-project.js`, `load-project-modal.js`, `header-bar.js`, `scene-state` persistence, `state-store.js`, `offline-storage.js`, `osc-client.js`, `gui-stream-client.js`, `deferred-catalog-ws.js`, `variable-state.js`, `template-thumb.js`, plus targeted server reads (`src/server/ws-server.js`, project routes); skipped `previs-*`, `device-view-*`, `audio-mixer-*`, timeline internals, CSS.

### 1. [HIGH] `project_gone` latch is permanent — Save As / Load / New project never re-enable autosave
`client/lib/server-project-sync.js:47`, `client/app.js:192-199`, `client/components/header-bar.js:125-134`
```js
export function clearProjectGoneOnServer() {
	projectGone = false
}
```
`clearProjectGoneOnServer` is exported but **never called anywhere in the client** (verified by grep across `lib/`, `components/`, `app.js`). The latch doc says "Save As keeps their in-memory copy under a new slug" is the way out, and the header indicator tells the operator "Project deleted on server — Save As to keep your copy" (`header-bar.js:313`). But `saveToServer()` and the load modal only call `markServerProjectSynced()`; `canPushProjectToServer()` is `synced && !offlineMode && !projectGone`, so after one 410 the autosave AND the Companion `scene_deck_sync` path (`app-scene-deck.js:46,56`) stay dead for the rest of the kiosk session, even after a successful explicit save or loading a different project. Failure: project deleted remotely → operator does exactly what the UI says (Save As) → keeps editing for hours → nothing autosaves, deck sync stale, no further warning; edits lost on next reload/adopt.

### 2. [HIGH] One failed bootstrap/resync permanently disables project resync and autosave
`client/lib/server-project-sync.js:161-178`, `client/app.js:112-119,165`
```js
export function shouldResyncOnWsConnect() {
	return isServerProjectSynced() && Date.now() - lastSyncedAt > 2500
}
```
The gate is inverted for the failure case: a client that is NOT synced (bootstrap or a previous resync failed) returns `false` and therefore never resyncs on any future WS connect. `resyncFromServer` calls `resetServerProjectSync()` *before* the attempt, so a resync that fails mid-way (server restarting — the standard deploy flow on this box is `kill -TERM` + kiosk F5) leaves `synced=false` forever. Consequences: project never loads/reloads, and `triggerAutosave()` returns at `if (!canPushProjectToServer()) return` — silently, no `project-autosave-failed` event, indicator frozen. Failure: kiosk reload lands during the node restart window → `/api/state` or project fetch 500s once → session runs for days with autosave and deck sync silently off.

### 3. [HIGH] Fresh-server seeding branch is unreachable — `fetchProjectFromServer` throws instead of returning empty
`client/lib/project-load.js:26-42`, `client/lib/server-project-sync.js:136-152`
```js
} else if (!project || (typeof project === 'object' && !Object.keys(project).length)) {
	// Fresh server with no saved project yet — allow outbound sync.
	markServerProjectSynced()
	serverWasFresh = true
```
On a fresh server, GET `/api/project` returns `200 {}` (`src/api/routes-data-project-read.js:55-56`), `normalizeProjectPayload({})` → null, so the client falls through to POST `/api/project/load`, which returns **404 "No project stored"** (`src/api/routes-data-project-handlers.js:182-184`) and `apiPost` throws. `fetchProjectFromServer` can only resolve with a versioned project or throw — the empty-object branch above can never execute. So `markServerProjectSynced()` is never reached on a fresh box; autosave and the intended "seed the fresh server" deck push never happen until the operator explicitly hits Save. Failure: new/reset box, operator builds a show for an hour relying on the 3s autosave — nothing is on the server.

### 4. [MED] WS deferred-catalog requests are double-stringified and silently dropped by the server (latent — 120s/300s stalls if PF-01 flag is enabled)
`client/lib/deferred-catalog-ws.js:58,100`, `client/lib/ws-client.js:58-62`, `src/server/ws-server.js:314-318`
```js
ws.send(JSON.stringify({ type: 'catalog_request', slice, offset, limit, id }))   // client
this.ws.send(JSON.stringify(obj))                                               // WsClient._send re-stringifies
if (trimmed[0] !== '{' && trimmed[0] !== '[') return                            // server drops it
```
`ws` here is the `WsClient`, whose `send()` JSON-stringifies its argument; passing a pre-stringified string produces a payload starting with `"` which the server's message handler silently discards. Every `catalog_request`/`catalog_subscribe` therefore times out (120s templates, 300s media) before falling back to HTTP `/api/state`. `HIGHASCG_WS_SLIM_BOOTSTRAP` is not currently set on this box (checked service env), so the path is inert today — but the moment PF-01 is enabled, every connect/reconnect shows an empty media/template list for 2 minutes.

### 5. [MED] Pending debounced autosave survives a project switch and can write the old project's content into the newly loaded one
`client/app.js:157-247`, `client/components/load-project-modal.js:282-318,341-356`
`scheduleAutosave(3000)` timers and in-flight autosaves are never cancelled on Load. `loadSelected()` → `loadProjectFileById` POSTs `/api/project/load {slug}` which switches the server's *active* project immediately; the client's local import happens only after further awaits (`finishImport` does another `/api/project/load` round-trip before `importLooks`). If the debounced autosave fires in that window it exports the still-loaded OLD project and POSTs `/api/project/autosave` (no slug — writes to the active project, i.e. the NEW one). Worse, the WO-329B stale_rev handler (`app.js:200-211`) *adopts the server rev and re-pushes*, so the server's rev guard rejects once and then the old content is force-written. Failure: edit look → within 3s click Load on another project → new project's file overwritten with the old project's scenes.

### 6. [MED] `scene_deck_sync` is silently dropped while the WS is closed — no queue, no resend on reconnect
`client/lib/ws-client.js:58-62`, `client/lib/app-scene-deck.js:35-62`
```js
_send(obj) {
	if (this.ws && this.ws.readyState === WebSocket.OPEN) {
		this.ws.send(JSON.stringify(obj))
	}
}
```
`_send` returns silently when not OPEN; `sendSceneDeckSync` (including the pre-take `flushSceneDeckSync` used by the scenes editor so the server can resolve sceneIds) has no failure signal and nothing replays the last deck payload on `connect`. During a WS-down/HTTP-up window (the code itself warns about proxies that break WS upgrade at `ws-client.js:145`), deck edits never reach the server while HTTP takes still execute — the server resolves takes against a stale deck. Same silent-drop applies to `sendAmcp`: the command is never transmitted but the caller still waits the full 10s timeout.

### 7. [MED] One-shot `skipNextRemoteProjectSync` latch can consume another client's genuine update
`client/lib/project-remote-sync.js:4-15`, `client/lib/app-ws-handlers.js:216-217`, `client/app.js:183`
```js
if (!project || project.error || !project.version || consumeSkipRemoteProjectSync()) return
```
The latch is armed by any changed autosave/save (`markLocalProjectSaved`) and consumed by the *first* `project_sync` that arrives — with no identity check that it is actually this client's echo. If client B's broadcast lands between client A's save and A's own echo, B's newer project is discarded and A then applies its own echo. With both clients autosaving every ~3s this window recurs continuously during two-operator editing; it self-heals only when the other side saves again, and in combination with the LWW re-push (finding 5's mechanism) it extends the "changes just weren't updated" divergence WO-329B tried to kill.

### 8. [MED] `templateThumbCache` grows without bound and keys are 32-bit hash truncations
`client/lib/template-thumb.js:12,35-47,188-199`
```js
const templateThumbCache = new Map()
...
return `tmpl_${Math.abs(hash).toString(16)}`
```
Every distinct `(sourceValue, cgData)` combination — i.e. every lower-third text variant ever previewed — adds a Map entry retaining a decoded `HTMLImageElement`, and triggers a server-side render (`POST /api/cg-thumb/render`). `invalidateTemplateThumbForLayer` only deletes the *current* cgData's key; nothing evicts old variants. On a kiosk session that runs for days with roster edits this is unbounded browser memory plus needless render load. Secondary: the key is a 32-bit additive hash, so two different cgData payloads can collide and serve the wrong cached thumbnail.

### 9. [LOW] `WsClient.reconnectNow()` leaks a live duplicate connection (currently dead code)
`client/lib/ws-client.js:185-201`
```js
if (this.ws) {
	try { this.ws.close() } catch { ... }
	this.ws = null
}
this._connect()
```
The old socket's `onclose` handler stays attached; when it fires it calls `_reconnect()`, which schedules another `_connect()` that replaces `this.ws` and orphans the socket `reconnectNow` just opened — that orphan stays open with its handlers wired to `emit`, so every server broadcast is processed twice (double `state` application, double `connect` → double resync attempts). No caller exists today (grep: only the definition), so this is latent — but it is a trap for the "after login sets session cookie" use-case the docstring advertises.

### 10. [LOW] AMCP-over-WS callers hang 10s on server-side `error` replies
`client/lib/ws-client.js:68-100`, `src/server/ws-server.js:324-339`
The server answers an AMCP request with `{ type: 'error', data: 'AMCP not connected', id }` when Caspar is down, but `_waitAmcpResult` only matches `type === 'amcp_result'` with the same id — the error reply (surfaced as the `server_error` event, without id filtering) is ignored and the caller waits out the full 10s timeout. No in-repo callers of `sendAmcp`/`sendAmcpStructured` exist right now, so impact is limited to optional modules/external users of the client.

### 11. [LOW] `StateStore.setState` never fires path listeners and double-invokes `*` listeners
`client/lib/state-store.js:86-102`
```js
_emit(path, value) {
	const fns = this._listeners.get(path)        // path === '*' here
	if (fns) fns.forEach((fn) => fn(value))      // '*' listeners called as fn(null)
	const fnsAny = this._listeners.get('*')
	if (fnsAny) fnsAny.forEach((fn) => fn(path, value))  // then again as fn('*', null)
}
```
On every full-state replace (each WS connect/reconnect) path-specific listeners (`'channelMap'`, `'extraLiveSources'`, `'configComparison'`, …) are not notified at all, and each `*` listener runs twice — first with `(null)` as its "path" argument. Verified that all current path subscribers also subscribe `*` (e.g. `sources-panel.js:314-318`, `header-bar.js:278-279`), so today this costs double renders and a `null`-path call rather than missed updates — but any future path-only subscriber will silently miss reconnect state.

---

**Overall health:** The command/state fan-in architecture (single long-lived `WsClient`, listeners attached once, server-first WO-341 adoption, rev-guarded autosave) is fundamentally sound, and localStorage/IndexedDB access is consistently try/catch-guarded. The systemic weakness is the *sync gate*: `synced`/`projectGone` is a set of one-way latches with several proven paths into a permanently-off state (findings 1–3), and because `triggerAutosave` early-returns without emitting anything, every one of those states is silent on a box designed to run unattended for days — that cluster is where the real data-loss risk lives, and all three are small, well-localized fixes. Secondary risks are the uncancelled autosave across project switches and the echo-latch heuristics in the multi-client sync path, which are inherent to the last-write-wins design but currently sloppier than the WOs assume.

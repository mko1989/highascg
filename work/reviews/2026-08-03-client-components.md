# Codebase review 2026-08-03 — client/components (operator UI)

Read-only review wave (7 reviewers over the full repo), owner-requested full codebase review (todos03.08.26).
Scope: client/components (~56k lines, vanilla-JS DOM components, long-lived kiosk session).

Verification status: findings #1 and #2 independently re-verified in source by the coordinating
session (toggle path at logs-modal.js:78-83 removes DOM without `stopPoll`/`teardownWsLivePush`;
settings-modal.js:82-86 re-calls `wireSystemTimeListeners` per tab activation, listeners
unguarded at mount-hardware.js:266/302). Others are the reviewer's source-verified claims.

Coverage: read in depth: scene deck (scene-list-column, scenes-editor-support take path), settings modal + mount-hardware, logs modal, audio-mixer view/console, sources-panel media/live/ingest rendering, operator-compose-tiles + tile-controller, operator-stream-view, preview-canvas-panel, playback-timer, ws/osc/gui-stream clients, live-view, all toggle-style modals, device-view events/GPU doc-listeners, timeline-transport structure. Swept all ~230 files for global-listener add/remove balance, interval/rAF lifecycle, and unescaped `innerHTML` interpolation (verified `escapeHtml` provenance for every suspicious hit). Skipped deep reads of map-explorer, previs-*, multiview-editor, device-view cable/band internals, and most inspector form renderers (structure-checked only).

### 1. [HIGH] Logs modal toggle-close leaks a 2 s API poll + WS listener every cycle
`client/components/logs-modal.js:78-83` vs `:464-470`; opened/toggled from `client/app.js:138`
```js
export function showLogsModal() {
	const existing = document.getElementById('logs-modal')
	if (existing) {
		existing.remove()
		return
	}
```
The proper `close()` (line 464) does `stopPoll(); teardownWsLivePush(); categoryFilterCleanup…`, but the toggle path just removes the DOM node. On open, `setupWsLivePush()` and `schedulePoll()` run unconditionally (lines 480/483; `pollTimer = setInterval(... loadCasparLog, 2000)` at 318). The connection-eye click (`app.js:138`) is the natural way operators open **and close** this modal — so every open→eye-click-close cycle permanently leaks: a 2-second interval fetching ~500 Caspar log lines from the API forever, a `ws.on('log_line')` subscription appending into a detached `<pre>` (retained up to its 2000-line cap), and the filter-cleanup closure. On a kiosk page that lives for weeks this accumulates real network, CPU, and memory per toggle. Only the small ✕ button takes the clean path.

### 2. [HIGH] Settings "System hardware" tab re-binds time controls on every activation → duplicate `/api/system/time` POSTs
`client/components/settings-modal.js:82-86` → `client/components/settings-modal-mount-hardware.js:266, 302`
```js
if (tabName === 'system-hardware') {
	void MountHw.refreshSystemTimePanel(modal)
	MountHw.wireSystemTimeListeners(modal)
}
```
`wireSystemTimeListeners` does `ntpCheckbox.addEventListener('change', …)` and `setBtn.addEventListener('click', …)` with no guard, and the modal's panes persist across tab switches. Visit the tab N times in one settings session and one click on "Set" runs N handlers: N `confirm()` dialogs in sequence, then N `POST /api/system/time { set: … }` — setting system time multiple times on a live playout box while recording/streaming (the exact hazard the confirm text warns about). The NTP toggle likewise fires N POSTs plus N panel refreshes (which compounds finding 3).

### 3. [MED] System-time clock interval is never cleared — leaks per tab visit and survives modal close
`client/components/settings-modal-mount-hardware.js:237-241`
```js
const tickInterval = setInterval(updateClock, 200)
// Store interval ID on element for cleanup if needed
clockLine._tickInterval = tickInterval
```
Nothing in the repo ever reads `_tickInterval` (verified by grep), and the settings modal's `close()` (`settings-modal.js:116-124`) only runs companion/optional disposers before `modal.remove()`. Every activation of the System-hardware tab, every NTP toggle, and every time-set re-calls `refreshSystemTimePanel` (`finally` blocks at lines 296/357), each stacking another 200 ms interval. While the tab is open, multiple intervals with different base timestamps fight over the same `clockLine` (clock text flickers between offsets — a wrong-time display on the box); after the modal closes they tick forever against detached DOM, retaining the whole modal via closure. Accumulates for the life of the kiosk session.

### 4. [MED] Companion button picker: reopen path leaks the window listener and the server-side preview session
`client/components/companion-button-picker-modal.js:54-55` vs `:115-123`
```js
const existing = document.getElementById(MODAL_ID)
if (existing) existing.remove()
```
`close()` removes the `window.addEventListener('companion-button-preview', onPreviewWs)` handler and POSTs `page-preview/unsubscribe { sessionId }`. The reopen-while-open path removes only the DOM, so the old instance's window listener keeps firing (retaining the detached modal) and its server preview subscription is never unsubscribed — the server keeps generating/pushing button previews for a dead session.

### 5. [LOW] Placeholder modal toggle path leaks a document keydown listener
`client/components/placeholder-modal.js:9-13` vs `:76-83` — same `existing.remove(); return` toggle as finding 1; `document.addEventListener('keydown', onKey)` is only removed in `close()`. Impact is small (each leaked handler self-removes the next time Escape is pressed, since `onKey` → `close()`), but each toggle cycle briefly stacks handlers and retains the detached modal.

### 6. [LOW] usb-import / live-input modals: replace-path bypasses cleanup
`client/components/usb-import-modal.js:30-31` (`existing.remove()`) vs `close()` at `:108-112` which clears `pollTimer`, document keydown, and three `ws.on('usb:*')` subscriptions (`:444-446`); same pattern in `live-input-modal.js:35-36`. In practice the full-screen overlay makes reopening-while-open hard to trigger, so this is defense-in-depth, but any programmatic reopen (e.g. a `usb:attached` flow) would leak the WS listeners and poller.

### 7. [LOW] `initPreviewPanel().destroy()` is incomplete — ResizeObserver and a document listener survive
`client/components/preview-canvas-panel.js:392, 404, 455`
```js
if (wrap && typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(scheduleDraw); ro.observe(wrap) }
...
document.addEventListener('previs:set-prv-pct', (ev) => { ... })
```
`destroy()` (line 455) removes the window resize/scroll listeners and unsubscribes state, but `ro` is a local never disconnected and the `previs:set-prv-pct` document listener is never removed — both retain the panel closure after `root.remove()`. Currently latent: the two call sites (`scenes-editor.js:211`, `timeline-editor.js:227`) create the panel once per page life and never call `destroy()`, but any future re-init would leak; contrast with `operator-stream-view.js:141-145`, which does this correctly.

---

**Overall health:** Well above average for a hand-rolled vanilla-DOM UI of this size. XSS discipline is genuinely consistent — every user-data `innerHTML` sink traced (media labels, look names, error strings, exFAT paths) goes through `escapeHtml`/`escapeAttr` from `lib/dom-escape.js`, and the raw-looking interpolations all resolved to constants, numbers, or regex-validated values (`getExtension` allows `[a-zA-Z0-9]+` only, thumbnail URLs are `encodeURIComponent`ed). The dangerous playout path is guarded: `takeSceneToProgram` has a `takeBusy` busy-window covering batch takes, fader posts are debounced, and per-render listener hygiene is maintained by rebuilding fresh nodes rather than re-binding persistent ones; global listeners are attached once from `app.js` init, and the WS/OSC/gui-stream clients have correct refcount/unsubscribe contracts. The defects cluster in one theme: modal lifecycle corner cases where a toggle/replace path removes the DOM without running the instance's `close()` cleanup — the logs modal (finding 1) being the one that bites on every ordinary use — plus the settings system-time panel, which mixes both a re-bind and an uncleared interval. Fixing findings 1–3 would address everything with real production impact.

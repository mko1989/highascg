/**
 * WO-255 T255.3 — per-surface preview-cell rect reporting + suppression mechanics. Split out of
 * operator-gui-mode.js: this module owns the merged-cell state machine, the debounced/forced POSTs
 * to `/api/operator-gui/layout`, interaction suppression, the foreground-tab video latch, and the
 * reconnect/nudge/heartbeat re-report triggers. See operator-gui-mode.js for the mode gate + rect
 * math this builds on.
 */

import { api } from './api-client.js'
import { isOperatorGuiModeActive, isRemoteOperatorView } from './operator-gui-mode.js'
import { cellRectsToLayoutCells, defaultViewport } from './operator-gui-mode-rects.js'

const LAYOUT_ENDPOINT = '/api/operator-gui/layout'
const REPORT_DEBOUNCE_MS = 150 // WO-338: throttle interval (was a 200 ms trailing debounce)
/** WO-255 T255.3: debounced restore after an interaction ends — a flurry of rapid modal
 * open/close or drag start/stop must not thrash Caspar with MIXER FILL calls. Suppression itself
 * is never debounced (see {@link setInteractionSuppressed}) — a popup covered by video for even
 * one frame is the bug this exists to prevent. */
const RESTORE_DEBOUNCE_MS = 300
/** WO-254 T254.2: heartbeat re-report interval, kept under the WO-255 rename (still belt-and-
 * suspenders for any nudge/reconnect miss — see {@link initOperatorGuiRectReporting}). */
const HEARTBEAT_MS = 60000

// WO-319: the compose STREAM VIEW is active on this client (Live preview on) — a non-operator client
// showing the operator tiles over the stream. While active, it may report/edit the shared compose
// layout just like the host, so `reportingEnabled()` opens up beyond the ?operatorGui URL gate.
let _streamViewActive = false
export function setOperatorStreamViewActive(on) {
	_streamViewActive = on === true
}
function reportingEnabled() {
	return isOperatorGuiModeActive() || _streamViewActive
}

/** surface name -> that surface's currently-reported cells (already server-shaped, each tagged
 * `surface`). A surface with nothing to show is simply absent from the map (not an empty array) —
 * see {@link reportSurfaceCells}. */
let _bySurface = new Map()
let _debounceTimer = null
let _restoreTimer = null
let _suppressed = false
let _tabBlocked = false
let _heartbeatTimer = null
/** WO-319: while the operator live canvas is on, the compose mosaic must keep running (it IS the
 * stream) but its punch-holes must NOT be cut — the browser draws the decoded crops itself, so a
 * hole would show the screen consumer THROUGH the canvas. This flag rides on the layout POST and the
 * server keeps the route+FILL mosaic while feeding the shape overlay an empty rect set. */
let _composeHolesSuppressed = false

function mergedCells() {
	const out = []
	for (const cells of _bySurface.values()) out.push(...cells)
	return out
}

/** The set that should actually be on the wire right now — empty while a popup suppression OR
 * the foreground-tab latch (WO-265) is active, else the merged surface cells. */
function effectiveCells() {
	return _suppressed || _tabBlocked ? [] : mergedCells()
}

/* WO-338: throttle, not trailing-edge debounce — the old pure debounce meant a continuous tile
 * drag emitted NOTHING until motion paused ~200 ms, so the punch holes only jumped at drag-end.
 * Now the first report in a quiet period goes out immediately and further ones at most every
 * REPORT_DEBOUNCE_MS, with a trailing send so the final rect always lands. The `_lastSentJson`
 * dedupe in sendLayout keeps redundant emissions off the wire. */
let _lastReportAt = 0
function scheduleReport() {
	const now = Date.now()
	if (now - _lastReportAt >= REPORT_DEBOUNCE_MS && !_debounceTimer) {
		_lastReportAt = now
		void sendLayout(effectiveCells())
		return
	}
	if (_debounceTimer) return
	_debounceTimer = setTimeout(
		() => {
			_debounceTimer = null
			_lastReportAt = Date.now()
			void sendLayout(effectiveCells())
		},
		Math.max(16, REPORT_DEBOUNCE_MS - (now - _lastReportAt)),
	)
}

/**
 * @param {string} surface
 * @param {Array<object>} cells - already-tagged, post-`cellRectsToLayoutCells` cells; empty -> withdraw this surface
 */
// WO-319: the compose layout is ONE shared thing (one ch4 channel) — every operator client, host or
// remote, edits it and it applies everywhere, so a remote client DOES report. The only per-client
// concern is hole-suppression, gated host-only in sendLayout (a remote's live preview must not blank
// the operator monitor's physical holes).
function reportSurfaceCells(surface, cells) {
	if (!reportingEnabled()) return
	if (cells.length) _bySurface.set(surface, cells)
	else _bySurface.delete(surface)
	scheduleReport()
}

/**
 * Surface 1/3 — compose preview / looks editor (WO-243, kept). HARD-GATED: no-op unless operator
 * GUI mode is active, so callers may invoke this unconditionally from shared code paths.
 * @param {Array<{id?: string, role: string, mainIndex: number, rect: {left: number, top: number, width: number, height: number}}>} cellRects
 * @param {{width: number, height: number}} [viewport]
 */
export function reportComposeCellRects(cellRects, viewport) {
	if (!reportingEnabled()) return
	const cells = cellRectsToLayoutCells(cellRects, defaultViewport(viewport)).map((c) => ({ ...c, surface: 'compose' }))
	reportSurfaceCells('compose', cells)
}

/**
 * Surface 2/3 — timeline editor's own preview canvas (WO-255).
 * @param {Array<{id?: string, role: string, mainIndex: number, rect: {left: number, top: number, width: number, height: number}}>} cellRects
 * @param {{width: number, height: number}} [viewport]
 */
export function reportTimelineCellRects(cellRects, viewport) {
	if (!isOperatorGuiModeActive()) return
	const cells = cellRectsToLayoutCells(cellRects, defaultViewport(viewport)).map((c) => ({ ...c, surface: 'timeline' }))
	reportSurfaceCells('timeline', cells)
}

/**
 * Surface 3/3 — multiview layout editor dock preview (WO-255). Single whole-panel rect (the MV
 * editor composites all cells onto one shared canvas, no per-cell DOM rects — see
 * client/components/multiview-editor.js), tagged `role: 'multiview'` so the server routes the
 * whole multiview channel into it (`resolveCellSourceChannel`'s new 'multiview' role,
 * src/system/operator-gui-channel.js) rather than indexing by `mainIndex`.
 * @param {{left: number, top: number, width: number, height: number}|null} rect - `getBoundingClientRect()`-shaped, or null/empty to withdraw
 * @param {{width: number, height: number}} [viewport]
 */
/**
 * Surface 4 — look-editor live PRV view (owner design 2026-07-26, WO-343): ONE rect over the
 * edit canvas, role 'prv' + mainIndex, so the server routes that main's preview channel into the
 * hole on the SAME screen consumer already under the kiosk. The layer outlines arrive through
 * the hole via the WO-339 edit_chrome rendered ON the channel — Firefox cannot draw over a hole
 * (X SHAPE removes those pixels), the channel itself is the "transparent overlay".
 * @param {{left:number,top:number,width:number,height:number}|null} rect - null/empty withdraws
 * @param {number} mainIndex
 * @param {{width:number,height:number}} [viewport]
 */
export function reportLookEditPrvRect(rect, mainIndex, viewport) {
	if (!isOperatorGuiModeActive()) return
	if (!rect || !(Number(rect.width) > 0) || !(Number(rect.height) > 0)) {
		reportSurfaceCells('lookedit', [])
		return
	}
	const cells = cellRectsToLayoutCells(
		[{ id: 'look-edit-prv', role: 'prv', mainIndex: Number(mainIndex) || 0, rect }],
		defaultViewport(viewport),
	).map((c) => ({ ...c, surface: 'lookedit' }))
	reportSurfaceCells('lookedit', cells)
}

export function reportMultiviewEditRect(rect, viewport) {
	if (!isOperatorGuiModeActive()) return
	if (!rect || !(Number(rect.width) > 0) || !(Number(rect.height) > 0)) {
		reportSurfaceCells('mvedit', [])
		return
	}
	const cells = cellRectsToLayoutCells([{ id: 'mv-edit', role: 'multiview', rect }], defaultViewport(viewport)).map((c) => ({
		...c,
		surface: 'mvedit',
	}))
	reportSurfaceCells('mvedit', cells)
}

/**
 * Surface 3/3 alternative (2026-07-17, mv-editor blend): PER-CELL holes for the multiview layout
 * editor — one rect per cell body, each routing that cell's OWN source channel (`role: 'mvcell'`
 * + `srcCh`, or `role: 'pgm'/'prv'` + `mainIndex` for the default screen cells). Insets are the
 * caller's job: the editor keeps its canvas-drawn chrome (borders/label strip/handles) OUTSIDE
 * these rects so it stays clickable — hole regions can never receive pointer events (X SHAPE
 * intersects input with bounding). Mutually exclusive with {@link reportMultiviewEditRect}
 * (same 'mvedit' surface). Empty array withdraws the surface.
 * @param {Array<{id?: string, role?: string, srcCh?: number, mainIndex?: number, rect: {left: number, top: number, width: number, height: number}}>} cellRects
 * @param {{width: number, height: number}} [viewport]
 */
export function reportMultiviewEditCellRects(cellRects, viewport) {
	if (!isOperatorGuiModeActive()) return
	const cells = cellRectsToLayoutCells(cellRects, defaultViewport(viewport)).map((c) => ({
		...c,
		surface: 'mvedit',
	}))
	reportSurfaceCells('mvedit', cells)
}

/** WO-269: serialized payload of the last successful send — identical payloads are skipped
 * (preview draw loops re-report unchanged rects every tick, which flooded the server + shape
 * helper at the debounce rate). Recovery paths pass `force` (reconnect/nudge/heartbeat). */
let _lastSentJson = null

async function sendLayout(cells, { force = false } = {}) {
	// WO-319: hole-suppression is HOST-only — a remote client editing the shared layout must not send
	// suppressHoles (that would blank the operator's physical-monitor holes based on the REMOTE's live
	// preview state). The shared cell layout still posts; only the host's own hole toggle rides along.
	const suppress = isRemoteOperatorView() ? false : _composeHolesSuppressed
	// Fold the hole-suppress flag into the dedupe key so toggling live preview re-sends even when
	// the cell rects are identical (the flag is the only thing that changed).
	const json = JSON.stringify({ cells, s: suppress })
	if (!force && json === _lastSentJson) return
	try {
		if (!cells.length) {
			await api.delete(LAYOUT_ENDPOINT)
		} else {
			await api.post(LAYOUT_ENDPOINT, { cells, suppressHoles: suppress })
		}
		_lastSentJson = json
	} catch (e) {
		_lastSentJson = null
		console.warn('[operator-gui-mode] layout report failed:', e?.message || e)
	}
}

/**
 * WO-319 — the operator live canvas turned on/off. On: the compose mosaic keeps running but its
 * punch-holes are withheld (the browser draws the decoded crops). Off: holes resume (screen
 * consumer shows through). Forces an immediate re-send so the flip is not lost to the dedupe.
 * @param {boolean} suppressed
 */
export function setOperatorComposeHolesSuppressed(suppressed) {
	const next = suppressed === true
	if (next === _composeHolesSuppressed) return
	_composeHolesSuppressed = next
	if (!isOperatorGuiModeActive()) return
	void sendLayout(effectiveCells(), { force: true })
}

/**
 * WO-255 T255.3 — critical UX: suppress (true) / restore (false) ALL reported rects. While a
 * modal/dropdown/context-menu is open, or a pointer-drag is happening on a preview surface (layer
 * dragging in the looks editor), the video overlay sitting above the GUI would otherwise hide
 * popups and drag chrome. Suppress fires immediately (cancels any pending debounced report and
 * POSTs empty right away); restore is debounced {@link RESTORE_DEBOUNCE_MS} after the LAST
 * `setInteractionSuppressed(false)` call, re-sending whatever the surfaces currently hold.
 * @param {boolean} suppressed
 */
export function setInteractionSuppressed(suppressed) {
	if (!isOperatorGuiModeActive()) return
	if (_restoreTimer) {
		clearTimeout(_restoreTimer)
		_restoreTimer = null
	}
	if (suppressed) {
		if (_suppressed) return
		_suppressed = true
		if (_debounceTimer) {
			clearTimeout(_debounceTimer)
			_debounceTimer = null
		}
		void sendLayout([])
		return
	}
	if (!_suppressed) return
	_restoreTimer = setTimeout(() => {
		_restoreTimer = null
		_suppressed = false
		void sendLayout(effectiveCells())
	}, RESTORE_DEBOUNCE_MS)
}

/**
 * WO-265 T265.4 — hold video holes closed while a workspace tab that must own the whole window
 * (CG Studio) is in the foreground. A separate latch from {@link setInteractionSuppressed} on
 * purpose: a modal opening+closing over the CG Studio tab must not restore the holes. Block fires
 * immediately (cancels any pending debounced report); unblock re-sends whatever the surfaces hold
 * — surfaces belonging to background views have already withdrawn themselves, and popup
 * suppression still wins while active.
 * @param {boolean} blocked
 */
export function setForegroundTabBlocksVideo(blocked) {
	if (!isOperatorGuiModeActive()) return
	const next = !!blocked
	if (next === _tabBlocked) return
	_tabBlocked = next
	if (_debounceTimer) {
		clearTimeout(_debounceTimer)
		_debounceTimer = null
	}
	void sendLayout(effectiveCells())
}

const _videoBlockingTabs = new Set()
let _tabActivationListenerInstalled = false

/**
 * Declarative alternative to per-component 'highascg-workspace-tab-activated' listeners driving
 * {@link setForegroundTabBlocksVideo}: with two full-window tabs each wiring their own listener,
 * both fire on every switch and race on the single latch (listener order decides whether the
 * holes reopen under the foreground blocker). One central listener computes the latch from the
 * registered set instead — a full-window tab registers its name once and never touches the latch.
 * @param {string} tabName
 */
export function registerVideoBlockingTab(tabName) {
	const name = String(tabName || '').trim()
	if (!name) return
	_videoBlockingTabs.add(name)
	if (_tabActivationListenerInstalled || typeof window === 'undefined') return
	_tabActivationListenerInstalled = true
	window.addEventListener('highascg-workspace-tab-activated', (ev) => {
		const tab = String(/** @type {CustomEvent} */ (ev).detail?.tab || '')
		setForegroundTabBlocksVideo(_videoBlockingTabs.has(tab))
	})
}

/** @returns {boolean} current foreground-tab latch — exposed for tests/diagnostics only. */
export function isForegroundTabBlockingVideo() {
	return _tabBlocked
}

/** @returns {boolean} current suppression state — exposed for tests/diagnostics only. */
export function isInteractionSuppressed() {
	return _suppressed
}

/** Re-POST the current merged set immediately (no debounce), respecting suppression. No-op when
 * mode is inactive (cheap, safe to call unconditionally). */
function resendMergedNow() {
	if (!isOperatorGuiModeActive()) return
	// 2026-07-19: a recovery trigger must never ASSERT AN EMPTY SET. At boot the WS 'connect'
	// handler fires long before any surface has reported, so a forced send here would POST/DELETE
	// an empty layout and wipe the layout the server just re-applied from `operatorGuiLayout`
	// persistence. Genuine withdrawals never come through this path — they go through
	// reportSurfaceCells / setInteractionSuppressed / setForegroundTabBlocksVideo, which all send
	// immediately on their own. (Suppression with live surfaces still re-asserts empty: _bySurface
	// is non-empty then, only `effectiveCells()` is empty.)
	if (!_bySurface.size) return
	if (_debounceTimer) {
		clearTimeout(_debounceTimer)
		_debounceTimer = null
	}
	void sendLayout(effectiveCells(), { force: true })
}

/**
 * WO-254 T254.2, kept under the WO-255 rename — root cause #2: route layers (10-49) are only
 * (re-)applied when the client POSTs cell rects, and the client only POSTs on layout changes. After
 * a Caspar/highascg restart the server's route layers (and the shape helper's target window) are
 * gone but the page's DOM layout hasn't changed, so nothing re-triggers a POST and the holes stay
 * black until a window resize. This wires three re-report triggers, all still hard-gated on
 * operator-GUI mode:
 *  (a) WS reconnect — `ws.on('connect', ...)` fires on the client's initial connect AND every
 *      reconnect.
 *  (b) server nudge — `ensureOperatorGuiChannel` (src/system/operator-gui-channel.js) broadcasts
 *      `ctx._wsBroadcast?.('change', { path: 'operatorGuiRectsWanted', value: Date.now() })` on
 *      Caspar reconnect; the WS client re-emits broadcast type `'change'` verbatim, so this listens
 *      for that path directly rather than a dedicated message type.
 *  (c) 60s heartbeat while mode is active — belt-and-suspenders for any nudge/reconnect miss.
 * WO-341 #4 classification (2026-07-27): these are SERVER-INITIATED READS of this client's own
 * window layout — per-client, never shared state, no client↔client echo possible — and stay
 * exempt from the "only user interaction writes" rule by design.
 * Call once at startup (client/app.js) with the shared `WsClient` instance.
 * @param {{ on: (event: string, fn: (data: unknown) => void) => (() => void) }} ws
 * @returns {(() => void)|null} unsubscribe-all, or null when operator-GUI mode is inactive / ws is unusable
 */
export function initOperatorGuiRectReporting(ws) {
	if (!isOperatorGuiModeActive()) return null
	if (!ws || typeof ws.on !== 'function') return null
	const offConnect = ws.on('connect', () => resendMergedNow())
	const offChange = ws.on('change', (data) => {
		if (data && data.path === 'operatorGuiRectsWanted') resendMergedNow()
	})
	if (_heartbeatTimer) clearInterval(_heartbeatTimer)
	_heartbeatTimer = setInterval(() => resendMergedNow(), HEARTBEAT_MS)
	return () => {
		offConnect()
		offChange()
		if (_heartbeatTimer) {
			clearInterval(_heartbeatTimer)
			_heartbeatTimer = null
		}
	}
}

/** Test-only: reset all module state between test cases. */
export function resetOperatorGuiModeStateForTests() {
	if (_debounceTimer) clearTimeout(_debounceTimer)
	_debounceTimer = null
	if (_restoreTimer) clearTimeout(_restoreTimer)
	_restoreTimer = null
	_bySurface = new Map()
	_suppressed = false
	_tabBlocked = false
	_lastSentJson = null
	if (_heartbeatTimer) clearInterval(_heartbeatTimer)
	_heartbeatTimer = null
}

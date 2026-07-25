/**
 * WO-255 T255.3 — operator-GUI mode gate + multi-surface preview-cell rect reporting (renamed from
 * client/lib/cef-operator-mode.js, WO-243/254 — the CEF-in-Caspar route is retired, see WO-255).
 *
 * Mode is active when the page is loaded with `?operatorGui` OR the legacy `?cefOperator` (any
 * value, including empty) in the query string — this is how the fullscreen Firefox GUI process
 * (src/system/operator-gui-launcher.js, `firefox-esr --kiosk ... "http://127.0.0.1:4200/?operatorGui=1"`)
 * self-identifies to the client bundle. HARD GATE: every export here is a no-op / returns false
 * when neither param is present, so a normal browser session sees ZERO behavior change.
 *
 * Rects are reported per SURFACE (`reportComposeCellRects` / `reportTimelineCellRects` /
 * `reportMultiviewEditRect`, tagged `{ surface, id, role?, mainIndex?, rect }`) and merged
 * client-side before every POST — the server endpoint stays dumb (WO-255: "keep the endpoint dumb,
 * client sends the merged active set"). A surface hiding withdraws just its own rects; the merged
 * remaining set is still reported (not a blanket clear) so the other surfaces keep their video.
 *
 * Interaction suppression (`setInteractionSuppressed`) POSTs an empty set while a modal/dropdown/
 * context-menu is open or a pointer-drag is happening on a preview surface — the shaped video
 * overlay sits ABOVE the GUI (WO-255's whole point), so without this it would hide popups and drag
 * chrome. See client/lib/operator-gui-interaction-suppress.js for what actually detects those
 * conditions; this module only owns the suppress/restore mechanics + the rect merge/report.
 */

export { cellRectsToLayoutCells } from './operator-gui-mode-rects.js'
export {
	setOperatorStreamViewActive,
	reportComposeCellRects,
	reportTimelineCellRects,
	reportMultiviewEditRect,
	reportMultiviewEditCellRects,
	setOperatorComposeHolesSuppressed,
	setInteractionSuppressed,
	setForegroundTabBlocksVideo,
	registerVideoBlockingTab,
	isForegroundTabBlockingVideo,
	isInteractionSuppressed,
	initOperatorGuiRectReporting,
	resetOperatorGuiModeStateForTests,
} from './operator-gui-mode-report.js'

/**
 * @param {string} [search] - defaults to `location.search`; overridable for tests.
 * @returns {boolean}
 */
export function isOperatorGuiModeActive(search) {
	const s = search != null ? search : (typeof location !== 'undefined' ? location.search : '')
	try {
		const params = new URLSearchParams(s || '')
		return params.has('operatorGui') || params.has('cefOperator')
	} catch (_) {
		return false
	}
}

/**
 * WO-319 — a REMOTE operator view: the webui opened through the HTTPS proxy (LAN clients, needed for
 * WebCodecs' secure context). It shows the operator multiview compose preview fed by the live stream,
 * but is strictly READ-ONLY: it must NEVER POST a layout (that would repaint holes / move the mosaic
 * on the physical operator monitor). Detected by an explicit `?operatorView` param OR by being served
 * from the proxy port (the plain-HTTP app server on :4200 is the host kiosk; the TLS proxy is :4443).
 * @param {string} [search]
 * @returns {boolean}
 */
export function isRemoteOperatorView(search) {
	try {
		const s = search != null ? search : (typeof location !== 'undefined' ? location.search : '')
		if (new URLSearchParams(s || '').has('operatorView')) return true
	} catch (_) {
		/* ignore */
	}
	// Served via the TLS proxy → remote. The host kiosk is http://127.0.0.1:4200; anything on the
	// HTTPS proxy port is a remote client that must stay read-only.
	try {
		if (typeof location !== 'undefined' && location.protocol === 'https:' && location.port === '4443') return true
	} catch (_) {
		/* ignore */
	}
	return false
}

// WO-319: shared compose-layout sync. The server broadcasts the applied layout (operatorGuiLayout)
// on every change; subscribers (the operator tiles) re-seed to it so all clients match no matter who
// moved a window. Fed from the WS dispatch in app-ws-handlers.js.
const _sharedLayoutSubs = new Set()

/** @param {(cells: Array<object>) => void} fn @returns {() => void} */
export function subscribeSharedLayout(fn) {
	_sharedLayoutSubs.add(fn)
	return () => _sharedLayoutSubs.delete(fn)
}

/** Called by the WS handler on an 'operatorGuiLayout' broadcast. @param {Array<object>} cells */
export function applySharedLayoutBroadcast(cells) {
	if (!Array.isArray(cells)) return
	for (const fn of _sharedLayoutSubs) {
		try {
			fn(cells)
		} catch {
			/* a bad subscriber must not break sync */
		}
	}
}

/**
 * URL-tied window marker (WO-263 follow-up): the shape helper punches holes ONLY into a Firefox
 * whose window title contains this exact token, so OTHER Firefox instances — the WO-258 browser
 * sources (also firefox, and on the operator monitor during "Interact"), or any browser the
 * operator opens — are never shaped. It stands in for the URL, which X11 does not expose as a
 * window property. Kept in sync with tools/runtime/operator-shape-overlay.py's OPERATOR_TITLE_MARKER.
 */
export const OPERATOR_GUI_TITLE_MARKER = 'HIGHASCG-OPERATOR-GUI'

let _titleMarkerObserver = null

/**
 * Force the document title to carry {@link OPERATOR_GUI_TITLE_MARKER} while in operator mode and
 * keep re-asserting it if a view changes `document.title` (a `<title>` MutationObserver) — the
 * shape helper's URL check depends on it never dropping. No-op outside operator mode.
 * @param {Document} [doc]
 */
export function applyOperatorGuiTitleMarker(doc) {
	const d = doc || (typeof document !== 'undefined' ? document : null)
	if (!d || !isOperatorGuiModeActive()) return
	const ensure = () => {
		if (!d.title || !d.title.includes(OPERATOR_GUI_TITLE_MARKER)) d.title = OPERATOR_GUI_TITLE_MARKER
	}
	ensure()
	const titleEl = d.querySelector('title')
	if (titleEl && typeof MutationObserver !== 'undefined' && !_titleMarkerObserver) {
		_titleMarkerObserver = new MutationObserver(ensure)
		_titleMarkerObserver.observe(titleEl, { childList: true, characterData: true, subtree: true })
	}
}

/**
 * Adds/removes the `operator-gui` class on `<html>` to match the current mode. Idempotent — safe
 * to call repeatedly (e.g. on every render). No-op when `document` is unavailable.
 * @param {Document} [doc]
 * @returns {boolean} whether the mode is active
 */
export function applyOperatorGuiHtmlClass(doc) {
	const d = doc || (typeof document !== 'undefined' ? document : null)
	const active = isOperatorGuiModeActive()
	if (d && d.documentElement) d.documentElement.classList.toggle('operator-gui', active)
	if (active) applyOperatorGuiTitleMarker(d)
	return active
}


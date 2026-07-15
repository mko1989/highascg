/**
 * WO-243 T243.3 — CEF operator-mode gate + compose-cell rect reporting.
 *
 * Mode is active only when the page is loaded with `?cefOperator` (any value, including empty) in
 * the query string — this is how the operator-GUI CEF layer (src/system/operator-gui-channel.js,
 * `PLAY <ch>-100 [HTML] "http://127.0.0.1:4200/?cefOperator=1"`) self-identifies to the client
 * bundle. HARD GATE: every export here is a no-op / returns false when the param is absent, so a
 * normal browser session (studio UI, remote operators, etc.) sees ZERO behavior change.
 */

import { api } from './api-client.js'

const LAYOUT_ENDPOINT = '/api/operator-gui/layout'
const REPORT_DEBOUNCE_MS = 200

/**
 * @param {string} [search] - defaults to `location.search`; overridable for tests.
 * @returns {boolean}
 */
export function isCefOperatorModeActive(search) {
	const s = search != null ? search : (typeof location !== 'undefined' ? location.search : '')
	try {
		return new URLSearchParams(s || '').has('cefOperator')
	} catch (_) {
		return false
	}
}

/**
 * Adds/removes the `cef-operator` class on `<html>` to match the current mode. Idempotent — safe
 * to call repeatedly (e.g. on every render). No-op when `document` is unavailable.
 * @param {Document} [doc]
 * @returns {boolean} whether the mode is active
 */
export function applyCefOperatorHtmlClass(doc) {
	const d = doc || (typeof document !== 'undefined' ? document : null)
	const active = isCefOperatorModeActive()
	if (d && d.documentElement) d.documentElement.classList.toggle('cef-operator', active)
	return active
}

function clamp01(n) {
	const v = Number(n)
	if (!Number.isFinite(v)) return 0
	return Math.min(1, Math.max(0, v))
}

/**
 * Pure conversion: DOM rects (viewport px, e.g. from `getBoundingClientRect()`) -> normalized 0-1
 * viewport-fraction rects for the `/api/operator-gui/layout` POST body. No I/O — unit-testable
 * without jsdom (plain object rects work fine).
 * @param {Array<{id?: string, role: string, mainIndex: number, rect: {left: number, top: number, width: number, height: number}}>} cellRects
 * @param {{width: number, height: number}} viewport
 * @returns {Array<{id: string|undefined, role: 'pgm'|'prv', mainIndex: number, rect: {x: number, y: number, w: number, h: number}}>}
 */
export function cellRectsToLayoutCells(cellRects, viewport) {
	const vw = Math.max(1, Number(viewport?.width) || 1)
	const vh = Math.max(1, Number(viewport?.height) || 1)
	const out = []
	for (const c of Array.isArray(cellRects) ? cellRects : []) {
		const r = c?.rect
		if (!r || !(Number(r.width) > 0) || !(Number(r.height) > 0)) continue
		out.push({
			id: c.id,
			role: c.role === 'prv' ? 'prv' : 'pgm',
			mainIndex: Math.max(0, parseInt(String(c.mainIndex ?? 0), 10) || 0),
			rect: {
				x: clamp01(Number(r.left) / vw),
				y: clamp01(Number(r.top) / vh),
				w: clamp01(Number(r.width) / vw),
				h: clamp01(Number(r.height) / vh),
			},
		})
	}
	return out
}

let _debounceTimer = null

/**
 * Debounced (200ms) POST of the current compose-cell rects, or DELETE when the resulting set is
 * empty (panel collapsed/unmounted/all cells hidden). HARD-GATED: no-op unless cefOperator mode is
 * active, so callers may invoke this unconditionally from shared code paths.
 * @param {Array<{id?: string, role: string, mainIndex: number, rect: {left: number, top: number, width: number, height: number}}>} cellRects
 * @param {{width: number, height: number}} [viewport]
 */
export function reportComposeCellRects(cellRects, viewport) {
	if (!isCefOperatorModeActive()) return
	const vp = viewport || {
		width: typeof window !== 'undefined' ? window.innerWidth : 1920,
		height: typeof window !== 'undefined' ? window.innerHeight : 1080,
	}
	const cells = cellRectsToLayoutCells(cellRects, vp)
	if (_debounceTimer) clearTimeout(_debounceTimer)
	_debounceTimer = setTimeout(() => {
		_debounceTimer = null
		void sendLayout(cells)
	}, REPORT_DEBOUNCE_MS)
}

async function sendLayout(cells) {
	try {
		if (!cells.length) {
			await api.delete(LAYOUT_ENDPOINT)
		} else {
			await api.post(LAYOUT_ENDPOINT, { cells })
		}
	} catch (e) {
		console.warn('[cef-operator-mode] layout report failed:', e?.message || e)
	}
}

/** Test-only: reset the debounce timer between test cases. */
export function resetCefOperatorReportStateForTests() {
	if (_debounceTimer) clearTimeout(_debounceTimer)
	_debounceTimer = null
}

/**
 * routes-operator-gui.js — WO-243/255 operator GUI layout + launcher endpoints.
 *
 * Endpoints:
 *   POST   /api/operator-gui/layout   — body `{ cells: [{ id, role, mainIndex, rect:{x,y,w,h}, surface? }] }`
 *                                        (rect in viewport fractions 0-1). Debounced 150ms
 *                                        server-side; serialized per-channel (see
 *                                        src/system/operator-gui-channel.js). Also feeds the
 *                                        python-xlib shape helper.
 *   DELETE /api/operator-gui/layout   — clears route layers + hides the shape overlay.
 *   POST   /api/operator-gui/launch   — WO-255: launch (or raise, if already running) the
 *                                        fullscreen Firefox GUI process on the operator monitor.
 *   POST   /api/operator-gui/raise    — WO-255: bring the already-running Firefox GUI to front.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { applyOperatorGuiLayout, clearOperatorGuiLayout, noteClientLayoutReport } = require('../system/operator-gui-channel')
const { launchOperatorGuiBrowser, raiseOperatorGuiBrowser } = require('../system/operator-gui-launcher')

/** todos19.07.26 release: first-rect-report timing probe — LOG-ONLY. Final phase of the operator-
 * GUI startup timeline (kiosk spawn probes: operator-gui-launcher.js; shape helper probes:
 * operator-shape-overlay.js). Logged once per server run, before the amcp gate so a report that
 * arrives while Caspar is still connecting is timed too. */
let firstLayoutReportSeen = false

/**
 * @param {string} path
 * @param {string|object} body
 * @param {object} ctx
 */
async function handlePost(path, body, ctx) {
	if (path === '/api/operator-gui/layout') {
		const j = parseBody(body) || {}
		const cells = Array.isArray(j.cells) ? j.cells : []
		if (!firstLayoutReportSeen && cells.length && typeof ctx.log === 'function') {
			firstLayoutReportSeen = true
			ctx.log('info', `[Operator GUI] timing: first rect report t=${Date.now()} cells=${cells.length}`)
		}
		// 2026-07-20: record the client's intent BEFORE the amcp gate — a report that lands while
		// Caspar is mid-reload still tells us what the operator has on screen, and that is exactly
		// the window in which `ensureOperatorGuiChannel` decides whether to re-assert the holes.
		noteClientLayoutReport(ctx, cells)
		if (!ctx.amcp) {
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, skipped: true, reason: 'amcp_disconnected' }) }
		}
		const result = await applyOperatorGuiLayout(ctx, cells)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, ...result }) }
	}
	if (path === '/api/operator-gui/launch') {
		const result = await launchOperatorGuiBrowser(ctx)
		return { status: result.ok ? 200 : 500, headers: JSON_HEADERS, body: jsonBody(result) }
	}
	if (path === '/api/operator-gui/raise') {
		const result = await raiseOperatorGuiBrowser(ctx)
		return { status: result.ok ? 200 : 500, headers: JSON_HEADERS, body: jsonBody(result) }
	}
	return null
}

/**
 * @param {string} path
 * @param {object} ctx
 */
async function handleDelete(path, ctx) {
	if (path !== '/api/operator-gui/layout') return null
	// A DELETE is the client withdrawing every surface — the authoritative "nothing is on screen"
	// signal that vetoes the reconnect re-apply (src/system/operator-gui-channel.js).
	noteClientLayoutReport(ctx, [])
	if (!ctx.amcp) {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, skipped: true, reason: 'amcp_disconnected' }) }
	}
	const result = await clearOperatorGuiLayout(ctx)
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, ...result }) }
}

module.exports = { handlePost, handleDelete }

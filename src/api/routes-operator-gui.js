/**
 * routes-operator-gui.js — WO-243/255 operator GUI layout endpoints (the compose windows of the operator channel).
 *
 * Endpoints:
 *   POST   /api/operator-gui/layout   — body `{ cells: [{ id, role, mainIndex, rect:{x,y,w,h}, surface? }] }`
 *                                        (rect in viewport fractions 0-1). Debounced 150ms
 *                                        server-side; serialized per-channel (see
 *                                        src/system/operator-gui-channel.js).
 *                                        WO-597 §D: `atlas: true|false` opts an shm operator surface
 *                                        into atlas mode (slots in the reply / GET / WS `atlas`).
 *   POST   /api/operator-gui/cell     — WO-624: add a window for a Sources-panel route item
 *                                        `{ item: { type, value, label, resolution }, at: { x, y } }` (server rules +
 *                                        default size, src/system/operator-gui-source-cells.js).
 *   POST   /api/operator-gui/cell/remove — WO-624: `{ id }` removes that window.
 * WO-646: the kiosk's launch / raise and the layout DELETE (shape overlay withdraw) are gone with the kiosk.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { applyOperatorGuiLayout, getPersistedOperatorGuiLayout, noteClientLayoutReport } = require('../system/operator-gui-channel')
const { addSourceCell, removeCell, noteReportedCells } = require('../system/operator-gui-source-cells')

/** todos19.07.26 release: first-rect-report timing probe — LOG-ONLY. Logged once per server run, before the amcp
 * gate so a report that arrives while Caspar is still connecting is timed too. */
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
		// WO-319: when the client is showing the operator live canvas, keep the mosaic but punch no
		// holes (the browser draws the decoded crops; a hole would reveal the screen consumer through
		// the canvas).
		const suppressHoles = j.suppressHoles === true
		if (!firstLayoutReportSeen && cells.length && typeof ctx.log === 'function') {
			firstLayoutReportSeen = true
			ctx.log('info', `[Operator GUI] timing: first rect report t=${Date.now()} cells=${cells.length}`)
		}
		// 2026-07-20: record the client's intent BEFORE the amcp gate — a report that lands while
		// Caspar is mid-reload still tells us what the operator has on screen, and that is exactly
		// the window in which `ensureOperatorGuiChannel` decides whether to re-assert the holes.
		noteClientLayoutReport(ctx, cells)
		noteReportedCells(cells)
		if (!ctx.amcp) {
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, skipped: true, reason: 'amcp_disconnected' }) }
		}
		const result = await applyOperatorGuiLayout(ctx, cells, { suppressHoles, atlas: typeof j.atlas === 'boolean' ? j.atlas : undefined })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, ...result }) }
	}
	if (path === '/api/operator-gui/cell' || path === '/api/operator-gui/cell/remove') {
		const j = parseBody(body) || {}
		const r = path === '/api/operator-gui/cell' ? await addSourceCell(ctx, j) : await removeCell(ctx, j)
		return { status: r.status, headers: JSON_HEADERS, body: jsonBody(r.body) }
	}
	return null
}

/**
 * GET /api/operator-gui/layout — the current operator compose layout, for a REMOTE operator view to
 * render read-only (its cell rects ARE the ch4 mosaic FILL fractions). Envelope, not a bare object.
 * @param {string} path
 * @param {object} ctx
 */
function handleGet(path, ctx) {
	if (path !== '/api/operator-gui/layout') return null
	const { cells, channel, atlas } = getPersistedOperatorGuiLayout(ctx)
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, channel, cells, atlas }) }
}

module.exports = { handlePost, handleGet }

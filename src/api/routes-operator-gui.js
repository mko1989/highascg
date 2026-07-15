/**
 * routes-operator-gui.js — WO-243 T243.2 operator GUI layout endpoints.
 *
 * Endpoints:
 *   POST   /api/operator-gui/layout   — body `{ cells: [{ id, role, mainIndex, rect:{x,y,w,h} }] }`
 *                                        (rect in viewport fractions 0-1). Debounced 150ms
 *                                        server-side; serialized per-channel (see
 *                                        src/system/operator-gui-channel.js).
 *   DELETE /api/operator-gui/layout   — clears route layers only; the CEF layer (100) stays.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { applyOperatorGuiLayout, clearOperatorGuiLayout } = require('../system/operator-gui-channel')

/**
 * @param {string} path
 * @param {string|object} body
 * @param {object} ctx
 */
async function handlePost(path, body, ctx) {
	if (path !== '/api/operator-gui/layout') return null
	const j = parseBody(body) || {}
	const cells = Array.isArray(j.cells) ? j.cells : []
	if (!ctx.amcp) {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, skipped: true, reason: 'amcp_disconnected' }) }
	}
	const result = await applyOperatorGuiLayout(ctx, cells)
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, ...result }) }
}

/**
 * @param {string} path
 * @param {object} ctx
 */
async function handleDelete(path, ctx) {
	if (path !== '/api/operator-gui/layout') return null
	if (!ctx.amcp) {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, skipped: true, reason: 'amcp_disconnected' }) }
	}
	const result = await clearOperatorGuiLayout(ctx)
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, ...result }) }
}

module.exports = { handlePost, handleDelete }

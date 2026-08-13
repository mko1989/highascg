'use strict'

/**
 * Source naming for non-screen live sources (WO-506).
 *
 * Screens are renamed through `/api/screens/label`, which renames the owning DESTINATION — a screen's
 * name is its destination's name (WO-385) and the owner's rule is that it outranks everything. This
 * endpoint covers what that does not reach: DeckLink inputs, NDI, v4l2, browser hosts.
 *
 * Two shapes this must not repeat, both from `routes-screens.js`'s own history:
 *   - routes receive the body as a RAW STRING, so it must be parsed, not property-accessed;
 *   - handlers must return `{ status, headers, body }`, not a bare `{ ok }`.
 * A WO-222-era test missed both by calling the handler with an already-parsed object; the tests for
 * this endpoint pass raw strings.
 */

const { JSON_HEADERS, jsonBody, parseBodyStrict } = require('./response')
const { setSourceLabelInConfig, sourceLabelsFromConfig } = require('../config/source-labels')

/**
 * @param {string} path
 * @param {string} body raw request body
 * @param {object} ctx
 * @returns {{ status: number, headers: object, body: string } | null}
 */
function handlePost(path, body, ctx) {
	if (path !== '/api/sources/label') return null
	return handleSourceLabel(body, ctx)
}

/**
 * POST /api/sources/label { sourceId, label }
 * An empty/whitespace label CLEARS the override — absence, not a blank name.
 * @param {string} body raw request body
 * @param {object} ctx
 */
function handleSourceLabel(body, ctx) {
	if (!ctx || !ctx.config || !ctx.configManager) {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'Config unavailable' }) }
	}
	const parsed = parseBodyStrict(body)
	if (!parsed.ok) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Invalid JSON body', detail: parsed.error }),
		}
	}
	const b = parsed.value && typeof parsed.value === 'object' ? parsed.value : {}
	const sourceId = String(b.sourceId ?? '').trim()
	if (!sourceId) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'sourceId required' }) }
	}

	const res = setSourceLabelInConfig(ctx.config, sourceId, b.label)
	if (!res.ok) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: res.error || 'Invalid label' }) }
	}

	ctx.config.sourceLabels = res.sourceLabels
	try {
		ctx.configManager.save({ ...ctx.configManager.get(), sourceLabels: res.sourceLabels })
	} catch (e) {
		return {
			status: 500,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Save failed', detail: e?.message || String(e) }),
		}
	}

	if (typeof ctx._wsBroadcast === 'function') {
		try {
			ctx._wsBroadcast('change', { path: 'sourceLabels', value: res.sourceLabels })
		} catch (_) {
			/* a broadcast failure must not fail the write */
		}
	}

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, sourceId, label: res.sourceLabels[sourceId] ?? '', sourceLabels: res.sourceLabels }),
	}
}

module.exports = { handlePost, handleSourceLabel, sourceLabelsFromConfig }

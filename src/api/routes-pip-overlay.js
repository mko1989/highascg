/**
 * PIP overlay routes — apply, update, remove HTML-template overlays on PIP layers.
 * @see 25_WO_PIP_OVERLAY_EFFECTS.md
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const {
	buildPipOverlayAmcpLines,
	buildPipOverlayUpdateLines,
	buildPipOverlayRemoveLines,
	sendPipOverlayLinesSerial,
	PIP_OVERLAY_TEMPLATE_FILES,
	TEMPLATE_MAP,
} = require('../engine/pip-overlay')

/**
 * GET /api/pip-overlay/templates — list PIP overlay templates and check deployment status.
 */
async function handleGetTemplates(ctx) {
	const templates = Object.entries(TEMPLATE_MAP).map(([type, tpl]) => ({ type, template: tpl }))
	let tlsList = []
	try {
		const tls = await ctx.amcp.raw('TLS')
		const data = Array.isArray(tls?.data) ? tls.data.join('\n') : String(tls?.data || '')
		tlsList = data.toLowerCase().split('\n')
	} catch (_) {}

	const status = templates.map((t) => {
		const found = tlsList.some((line) => line.includes(t.template.toLowerCase()))
		return { ...t, deployed: found }
	})

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ templates: status }),
	}
}

/**
 * POST /api/pip-overlay/apply — add overlay to a channel-layer.
 * Body: { channel, layer, overlay: { type, params }, fill, stackIndex?: number } — stackIndex 0 = first slot above PIP.
 */
async function handleApply(body, ctx) {
	const b = parseBody(body)
	const { channel = 1, layer, overlay, fill } = b
	const stackIndex = Number.isFinite(Number(b.stackIndex)) ? Math.max(0, Math.floor(Number(b.stackIndex))) : 0
	const nextL = b.nextContentLayer
	const nextContentLayer = nextL == null || nextL === '' ? undefined : Number(nextL)
	if (!overlay?.type || !fill) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'overlay and fill required' }) }
	}
	const lines = buildPipOverlayAmcpLines(overlay, channel, layer, fill, ctx, stackIndex, nextContentLayer)
	if (lines.length === 0) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Unknown overlay type' }) }
	}
	try {
		await sendPipOverlayLinesSerial(ctx.amcp, lines)
		await ctx.amcp.mixerCommit(channel)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
	} catch (e) {
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
	}
}

/**
 * POST /api/pip-overlay/update — update overlay params in-place (CG UPDATE).
 * Body: { channel, layer, params }
 */
async function handleUpdate(body, ctx) {
	const b = parseBody(body)
	const { channel = 1, layer, params, fill } = b
	const overlay =
		b.overlay && typeof b.overlay === 'object' && b.overlay.type
			? { ...b.overlay, params: b.overlay.params || {} }
			: params && (b.overlayType || b.type)
				? { type: String(b.overlayType || b.type), params }
				: null
	if (!overlay?.type) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'overlay { type, params } required' }) }
	}
	if (!fill || typeof fill !== 'object') {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'fill { x, y, scaleX, scaleY } required for inner math' }) }
	}
	const stackIndex = Number.isFinite(Number(b.stackIndex)) ? Math.max(0, Math.floor(Number(b.stackIndex))) : 0
	const nextL = b.nextContentLayer
	const nextContentLayer = nextL == null || nextL === '' ? undefined : Number(nextL)
	const lines = buildPipOverlayUpdateLines(channel, layer, overlay, fill, ctx, stackIndex, nextContentLayer)
	try {
		await sendPipOverlayLinesSerial(ctx.amcp, lines)
		await ctx.amcp.mixerCommit(channel)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
	} catch (e) {
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
	}
}

/**
 * POST /api/pip-overlay/remove — remove overlay from a channel-layer.
 * Body: { channel, layer }
 */
async function handleRemove(body, ctx) {
	const b = parseBody(body)
	const { channel = 1, layer } = b
	const nextL = b.nextContentLayer
	const nextContentLayer = nextL == null || nextL === '' ? undefined : Number(nextL)
	const lines = buildPipOverlayRemoveLines(channel, layer, nextContentLayer)
	try {
		await sendPipOverlayLinesSerial(ctx.amcp, lines)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
	} catch (e) {
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
	}
}

async function handleGet(path, ctx) {
	if (path === '/api/pip-overlay/templates') return handleGetTemplates(ctx)
	return null
}

async function handlePost(path, body, ctx) {
	if (!ctx.amcp) return null
	if (path === '/api/pip-overlay/apply') return handleApply(body, ctx)
	if (path === '/api/pip-overlay/update') return handleUpdate(body, ctx)
	if (path === '/api/pip-overlay/remove') return handleRemove(body, ctx)
	return null
}

module.exports = { handleGet, handlePost }

/**
 * routes-countdown.js — Companion-facing control API for countdown/timer CG template layers (WO-169).
 *
 * Endpoints (all under /api/countdown):
 *
 *   POST /api/countdown/start   — { cmd: 'start' } CG UPDATE
 *   POST /api/countdown/pause   — { cmd: 'pause' } CG UPDATE
 *   POST /api/countdown/reset   — { cmd: 'reset' } CG UPDATE
 *   POST /api/countdown/set     — full config CG UPDATE (no `cmd` — does not touch run state)
 *   POST /api/countdown/update  — alias of `set`
 *   GET  /api/countdown/list    — enumerate countdown template layers across live/current looks
 *
 * STATELESS by design — the anti-pattern to avoid is routes-lower-thirds.js's per-channel
 * singleton (`ensureState`), which is NOT multi-instance-safe (see WO-169 investigation notes).
 * Every request here resolves its own Caspar host layer from the explicit `{ channel, layer }` /
 * `{ mainIdx, layerNumber }` addressing and emits a CG UPDATE directly — no appCtx state is kept,
 * so N countdown layers across N channels/layers are independent by construction (see
 * resolveTemplateCgHostLayer, src/engine/cg-routing.js).
 *
 * CG sub-layer index: scene take (src/engine/scene-template-cg.js buildSceneTemplateCgAmcpLines)
 * always `CG ADD`s template layers at sub-layer index **0**. That is different from
 * routes-lower-thirds.js's own standalone flow, which defaults to sub-layer `1` — that flow never
 * goes through scene take. Countdown layers only ever reach air via scene take (they are look
 * layers), so these routes default `templateHostLayer` to 0 to address the SAME CG producer
 * scene take created; a request that supplies its own `templateHostLayer` is still honored.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { resolveCgRequestChannel, resolveTemplateCgHostLayer } = require('../engine/cg-routing')
const liveSceneState = require('../state/live-scene-state')

/** Caspar CG template path — see template/countdown/countdown.html. */
const COUNTDOWN_CG_NAME = 'countdown/countdown'

/** CG sub-layer index scene take always uses for template layers (buildSceneTemplateCgAmcpLines). */
const SCENE_TAKE_CG_SUBLAYER = 0

/** Body keys that are routing, not countdown config — stripped before building the `set` payload. */
const ROUTING_KEYS = new Set([
	'channel', 'layer', 'layerNumber', 'mainIdx', 'mainScreenIndex', 'screenIndex', 'templateHostLayer',
])

/**
 * @param {string} value
 * @returns {boolean}
 */
function isCountdownSourceValue(value) {
	const v = String(value || '').toLowerCase().replace(/\\/g, '/')
	return v.includes('countdown/countdown')
}

/**
 * @param {object} body
 * @param {object} ctx
 * @returns {{ channel: number, hostLayer: number, templateHostLayer: number, logicalLayer: number } | null}
 */
function resolveRouting(body, ctx) {
	const b = body && typeof body === 'object' ? body : {}
	const logicalRaw = b.layer ?? b.layerNumber
	const logicalLayer = parseInt(logicalRaw, 10)
	if (!Number.isFinite(logicalLayer)) return null
	const channel = resolveCgRequestChannel(b, ctx)
	const hostLayer = resolveTemplateCgHostLayer(logicalLayer, COUNTDOWN_CG_NAME)
	const templateHostLayer = b.templateHostLayer != null ? parseInt(b.templateHostLayer, 10) : SCENE_TAKE_CG_SUBLAYER
	return { channel, hostLayer, templateHostLayer, logicalLayer }
}

/**
 * @param {object} ctx
 * @param {{ channel: number, hostLayer: number, templateHostLayer: number }} routing
 * @param {object} payloadObj
 */
async function emitCgUpdate(ctx, routing, payloadObj) {
	if (!ctx?.amcp) return { ok: false, error: 'AMCP not connected' }
	try {
		await ctx.amcp.cg.cgUpdate(routing.channel, routing.hostLayer, routing.templateHostLayer, JSON.stringify(payloadObj))
		return { ok: true }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

/* ── GET handlers ──────────────────────────────────────────── */

/**
 * @param {string} p
 * @param {object} ctx
 * @param {object} [query]
 */
function handleGet(p, ctx, query = {}) {
	if (p !== '/api/countdown/list') return null

	const all = liveSceneState.getAll()
	const items = []
	for (const chKey of Object.keys(all)) {
		const entry = all[chKey]
		const layers = entry?.scene?.layers
		if (!Array.isArray(layers)) continue
		for (const layer of layers) {
			const src = layer?.source
			if (!isCountdownSourceValue(src?.value)) continue
			const logicalLayer = parseInt(layer.layerNumber, 10)
			if (!Number.isFinite(logicalLayer)) continue
			items.push({
				channel: parseInt(chKey, 10),
				layerNumber: logicalLayer,
				hostLayer: resolveTemplateCgHostLayer(logicalLayer, COUNTDOWN_CG_NAME),
				sceneId: entry.sceneId,
				label: src.label || null,
				config: src.countdownConfig || null,
			})
		}
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ items }) }
}

/* ── POST handlers ─────────────────────────────────────────── */

/**
 * @param {string} p
 * @param {string|object} body
 * @param {object} ctx
 */
async function handlePost(p, body, ctx) {
	const m = p.match(/^\/api\/countdown\/(start|pause|reset|set|update)$/)
	if (!m) return null

	const b = parseBody(body)
	const routing = resolveRouting(b, ctx)
	if (!routing) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'Missing layer (or layerNumber)' }) }
	}

	const cmd = m[1]
	let payload
	if (cmd === 'set' || cmd === 'update') {
		payload = {}
		for (const [k, v] of Object.entries(b)) {
			if (!ROUTING_KEYS.has(k)) payload[k] = v
		}
	} else {
		payload = { cmd }
	}

	const res = await emitCgUpdate(ctx, routing, payload)
	return {
		status: res.ok ? 200 : 502,
		headers: JSON_HEADERS,
		body: jsonBody({
			...res,
			channel: routing.channel,
			layer: routing.hostLayer,
			logicalLayer: routing.logicalLayer,
		}),
	}
}

module.exports = { handleGet, handlePost }

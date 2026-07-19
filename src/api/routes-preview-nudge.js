/**
 * POST /api/preview/mixer-nudge — low-latency cosmetic MIXER update for the look staged on PRV.
 *
 * While the looks editor drags geometry/opacity/crop, the client posts only the CHANGED layers
 * here (throttled ~100ms). We map look layer → staged PRV layer (PRV is bank-less, WO-199: the
 * logical layer number IS the physical layer) and emit MIXER FILL/ANCHOR/ROTATION/OPACITY (+CROP)
 * with DEFER + one channel COMMIT so the frame applies atomically.
 *
 * This path is cosmetic acceleration ONLY — the full preview push / scene-take pipeline stays
 * authoritative. To guarantee convergence (no fighting), fills are resolved with the SAME server
 * math the take pipeline uses ({@link getResolvedFillForSceneLayer} from scene-native-fill.js and
 * the rotation-anchor helpers): the client sends layer fill fractions, never MIXER numbers.
 *
 * Staleness guard: if the requested sceneId is not the look currently staged on the PRV channel
 * (server live map), nothing is emitted and `{ ok: false, staged: false }` is returned — a nudge
 * must never repaint an old/foreign staged look.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const liveSceneState = require('../state/live-scene-state')
const { getResolvedFillForSceneLayer } = require('../engine/scene-native-fill')
const {
	fillForSceneLayerRotationAnchor,
	sceneLayerRotationMixerLines,
} = require('../engine/scene-layer-rotation-amcp')
const { buildEffectAmcpLines } = require('../engine/scene-take-lbg-helpers')
const { LOOK_LAYER_MIN, LOOK_LAYER_MAX } = require('../engine/look-layer-ranges')
const {
	resolvePreviewChannel,
	getRouteMap,
	chainSceneTakeWork,
	takeChainKeyForPreviewChannel,
} = require('./routes-scene-shared')

/** A nudge is a per-drag-tick update — never a full-scene sweep. */
const NUDGE_MAX_LAYERS = 12

/**
 * Pure line builder for one nudged layer (exported for the offline smoke test).
 * `f` is the RESOLVED fill (output of {@link getResolvedFillForSceneLayer}) — same numbers the
 * take pipeline computes for this layer on this channel.
 * @param {number} previewCh
 * @param {{ layerNumber: number|string, rotation?: number, opacity?: number, effects?: { type?: string, params?: object }[] }} layer
 * @param {{ x: number, y: number, scaleX: number, scaleY: number }} f
 * @returns {string[]}
 */
function buildNudgeLinesForLayer(previewCh, layer, f) {
	const ln = parseInt(layer.layerNumber, 10)
	const cl = `${parseInt(previewCh, 10)}-${ln}`
	const rot = Number(layer.rotation) || 0
	/* Same center-pivot shift as scene-take-lbg-jobs / the client full push. */
	const casparFill = fillForSceneLayerRotationAnchor(f, rot)
	const lines = [
		`MIXER ${cl} FILL ${casparFill.x} ${casparFill.y} ${casparFill.scaleX} ${casparFill.scaleY} 0 DEFER`,
		...sceneLayerRotationMixerLines(cl, rot, { deferRotation: true }),
	]
	if (layer.opacity != null && Number.isFinite(Number(layer.opacity))) {
		lines.push(`MIXER ${cl} OPACITY ${Number(layer.opacity)} 0 DEFER`)
	}
	/* Crop drags ride the nudge too — same line the take pipeline emits for the crop effect. */
	if (Array.isArray(layer.effects)) {
		for (const fx of layer.effects) {
			if (!fx || fx.type !== 'crop') continue
			const fxLines = buildEffectAmcpLines(fx.type, fx.params || {}, cl)
			if (fxLines) lines.push(...fxLines)
		}
	}
	return lines
}

/**
 * Resolve the PRV channel for a nudge request (mainIndex preferred, explicit preview channel ok).
 * Exported for the offline smoke test.
 * @param {object} ctx
 * @param {{ mainIndex?: unknown, channel?: unknown }} b
 * @returns {number | null}
 */
function resolveNudgePreviewChannel(ctx, b) {
	const routeMap = getRouteMap(ctx)
	const mainIdx = b.mainIndex != null ? parseInt(b.mainIndex, 10) : -1
	if (Number.isInteger(mainIdx) && mainIdx >= 0) {
		const ch = resolvePreviewChannel(routeMap, mainIdx, null)
		if (ch != null) return Number(ch)
	}
	if (b.channel != null) {
		const ch = resolvePreviewChannel(routeMap, -1, b.channel)
		if (ch != null) return Number(ch)
	}
	return null
}

/**
 * @param {string} body
 * @param {object} ctx — app context
 */
async function handlePreviewMixerNudge(body, ctx) {
	if (!ctx.amcp) {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	}
	const b = parseBody(body)

	const previewCh = resolveNudgePreviewChannel(ctx, b)
	if (!previewCh) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Preview channel not found for mainIndex/channel (PGM-only destination?)' }),
		}
	}

	const layers = Array.isArray(b.layers) ? b.layers.slice(0, NUDGE_MAX_LAYERS) : []
	if (layers.length === 0) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'layers: non-empty array required' }) }
	}

	const sceneId = b.sceneId != null ? String(b.sceneId).trim() : ''
	const staged = liveSceneState.getChannel(previewCh)
	if (!sceneId || !staged?.sceneId || String(staged.sceneId) !== sceneId) {
		/* Not an error: the client falls back to the full (re)staging push. */
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, staged: false, previewChannel: previewCh, stagedSceneId: staged?.sceneId ?? null }),
		}
	}

	const cc = b.composeCanvas
	const incomingScene =
		cc && Number(cc.w) > 0 && Number(cc.h) > 0 ? { composeCanvas: { w: Number(cc.w), h: Number(cc.h) } } : null

	const lines = []
	for (const layer of layers) {
		if (!layer || typeof layer !== 'object') continue
		const ln = parseInt(layer.layerNumber, 10)
		/* WO-160 band guard: nudges may only touch the look layer range on PRV. */
		if (!Number.isInteger(ln) || ln < LOOK_LAYER_MIN || ln > LOOK_LAYER_MAX) continue
		const f = await getResolvedFillForSceneLayer(ctx, layer, previewCh, incomingScene)
		lines.push(...buildNudgeLinesForLayer(previewCh, layer, f))
	}

	if (lines.length === 0) {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, previewChannel: previewCh, lines: 0 }) }
	}

	/* Join the /api/scene/take per-channel chain so a nudge can never interleave into a
	 * mid-flight staging take on the same PRV (determinism before speed — todos19.07.26).
	 * DEFER lines + one channel COMMIT: atomic apply, no pre-flush COMMIT between chunks. */
	const mainIdx = b.mainIndex != null ? parseInt(b.mainIndex, 10) : -1
	const chainKey = takeChainKeyForPreviewChannel(getRouteMap(ctx), previewCh, mainIdx)
	let emitted = false
	await chainSceneTakeWork(ctx, chainKey, async () => {
		/* Re-check inside the chain: a take queued ahead of us may have restaged a different look. */
		const stagedNow = liveSceneState.getChannel(previewCh)
		if (!stagedNow?.sceneId || String(stagedNow.sceneId) !== sceneId) return
		await ctx.amcp.batchSendChunked(lines, { skipMixerPreCommit: true })
		await ctx.amcp.raw(`MIXER ${previewCh} COMMIT`)
		emitted = true
	})

	if (!emitted) {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, staged: false, previewChannel: previewCh }),
		}
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, previewChannel: previewCh, lines: lines.length }),
	}
}

module.exports = {
	handlePreviewMixerNudge,
	buildNudgeLinesForLayer,
	resolveNudgePreviewChannel,
	NUDGE_MAX_LAYERS,
}

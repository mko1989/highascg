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
 *
 * WO-272 (todos19.07.26): `target: 'pgm'` points the same machinery at the PGM channel for the
 * operator-GUI "edit live on PGM" mode. Unlike PRV, PGM is bank-mapped (WO-160/199: bank A
 * physical = logical, bank B = logical + 100) — the ACTIVE bank is re-read INSIDE the per-channel
 * take chain so a queued take that flips the bank can never race the nudge onto the wrong bank.
 * The staleness guard compares against what is LIVE on the PGM channel (same live map — takes key
 * it by the program channel), so a PGM nudge can never repaint a look that just left air.
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
const { deferMixerAmcpLine } = require('../caspar/amcp-utils')
const { LOOK_LAYER_MIN, LOOK_LAYER_MAX, PGM_BANK_B_OFFSET } = require('../engine/look-layer-ranges')
const { normalizeProgramLayerBank } = require('../engine/program-layer-bank')
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
 * @param {number|null} [physicalLayer] - WO-272: bank-mapped physical layer for PGM targets
 *   (logical + 100 on bank B); null/omitted = logical layer IS physical (bank-less PRV).
 * @returns {string[]}
 */
function buildNudgeLinesForLayer(previewCh, layer, f, physicalLayer = null) {
	const ln = physicalLayer != null ? parseInt(physicalLayer, 10) : parseInt(layer.layerNumber, 10)
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
	/* Crop drags ride the nudge too — same line the take pipeline emits for the crop effect.
	 * WO-390 §4: buildEffectAmcpLines returns a bare (non-DEFER) line; every other nudge line
	 * defers into the single COMMIT, so the bare crop landed one frame early during drags. */
	if (Array.isArray(layer.effects)) {
		for (const fx of layer.effects) {
			if (!fx || fx.type !== 'crop') continue
			const fxLines = buildEffectAmcpLines(fx.type, fx.params || {}, cl)
			if (fxLines) lines.push(...fxLines.map((l) => deferMixerAmcpLine(l)))
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
 * WO-272: resolve the PGM channel for a `target: 'pgm'` nudge (mainIndex preferred; an explicit
 * channel is accepted only when it IS a program channel). Program channels are where takes land
 * and live-scene-state is keyed — playbackChannels is the switcher-bus fallback.
 * Exported for the offline smoke test.
 * @param {object} ctx
 * @param {{ mainIndex?: unknown, channel?: unknown }} b
 * @returns {number | null}
 */
function resolveNudgePgmChannel(ctx, b) {
	const routeMap = getRouteMap(ctx)
	const mainIdx = b.mainIndex != null ? parseInt(b.mainIndex, 10) : -1
	if (Number.isInteger(mainIdx) && mainIdx >= 0) {
		const ch = Number(routeMap.programChannels?.[mainIdx] ?? routeMap.playbackChannels?.[mainIdx])
		if (Number.isFinite(ch) && ch > 0) return ch
	}
	if (b.channel != null) {
		const ch = parseInt(b.channel, 10)
		const programs = [...(routeMap.programChannels || []), ...(routeMap.playbackChannels || [])]
			.map((p) => Number(p))
			.filter((n) => Number.isFinite(n) && n > 0)
		if (programs.includes(ch)) return ch
	}
	return null
}

/** WO-272: `target: 'pgm'` routes the nudge at the on-air PGM channel (bank-aware). */
function isPgmNudgeTarget(b) {
	return String(b?.target || '').toLowerCase() === 'pgm'
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

	const pgmTarget = isPgmNudgeTarget(b)
	const targetCh = pgmTarget ? resolveNudgePgmChannel(ctx, b) : resolveNudgePreviewChannel(ctx, b)
	if (!targetCh) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: pgmTarget
					? 'Program channel not found for mainIndex/channel'
					: 'Preview channel not found for mainIndex/channel (PGM-only destination?)',
			}),
		}
	}

	const layers = Array.isArray(b.layers) ? b.layers.slice(0, NUDGE_MAX_LAYERS) : []
	if (layers.length === 0) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'layers: non-empty array required' }) }
	}

	const sceneId = b.sceneId != null ? String(b.sceneId).trim() : ''
	const staged = liveSceneState.getChannel(targetCh)
	if (!sceneId || !staged?.sceneId || String(staged.sceneId) !== sceneId) {
		/* Not an error: the client falls back to the full (re)staging push. */
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, staged: false, previewChannel: targetCh, stagedSceneId: staged?.sceneId ?? null }),
		}
	}

	const cc = b.composeCanvas
	const incomingScene =
		cc && Number(cc.w) > 0 && Number(cc.h) > 0 ? { composeCanvas: { w: Number(cc.w), h: Number(cc.h) } } : null

	/* Fill math is bank-independent — resolve outside the chain; layer→physical mapping happens
	 * inside it (WO-272: the active PGM bank may flip while we wait behind a queued take). */
	const resolved = []
	for (const layer of layers) {
		if (!layer || typeof layer !== 'object') continue
		const ln = parseInt(layer.layerNumber, 10)
		/* WO-160 band guard: nudges may only touch the LOGICAL look layer range. */
		if (!Number.isInteger(ln) || ln < LOOK_LAYER_MIN || ln > LOOK_LAYER_MAX) continue
		const f = await getResolvedFillForSceneLayer(ctx, layer, targetCh, incomingScene)
		resolved.push({ layer, f })
	}

	if (resolved.length === 0) {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, previewChannel: targetCh, lines: 0 }) }
	}

	/* Join the /api/scene/take per-channel chain so a nudge can never interleave into a
	 * mid-flight staging take on the same channel (determinism before speed — todos19.07.26).
	 * PGM targets chain on the PGM channel itself — the exact key /api/scene/take uses.
	 * DEFER lines + one channel COMMIT: atomic apply, no pre-flush COMMIT between chunks. */
	const mainIdx = b.mainIndex != null ? parseInt(b.mainIndex, 10) : -1
	const chainKey = pgmTarget ? targetCh : takeChainKeyForPreviewChannel(getRouteMap(ctx), targetCh, mainIdx)
	let emitted = false
	let lineCount = 0
	await chainSceneTakeWork(ctx, chainKey, async () => {
		/* Re-check inside the chain: a take queued ahead of us may have restaged a different look. */
		const stagedNow = liveSceneState.getChannel(targetCh)
		if (!stagedNow?.sceneId || String(stagedNow.sceneId) !== sceneId) return
		/* WO-272: read the ACTIVE bank here, after any queued take has settled — bank B is +100. */
		const bank = pgmTarget ? normalizeProgramLayerBank(ctx.programLayerBankByChannel?.[String(targetCh)]) : 'a'
		const lines = []
		for (const { layer, f } of resolved) {
			const ln = parseInt(layer.layerNumber, 10)
			const physLn = bank === 'b' ? ln + PGM_BANK_B_OFFSET : ln
			lines.push(...buildNudgeLinesForLayer(targetCh, layer, f, physLn))
		}
		await ctx.amcp.batchSendChunked(lines, { skipMixerPreCommit: true })
		await ctx.amcp.raw(`MIXER ${targetCh} COMMIT`)
		emitted = true
		lineCount = lines.length
	})

	if (!emitted) {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, staged: false, previewChannel: targetCh }),
		}
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, previewChannel: targetCh, target: pgmTarget ? 'pgm' : 'prv', lines: lineCount }),
	}
}

module.exports = {
	handlePreviewMixerNudge,
	buildNudgeLinesForLayer,
	resolveNudgePreviewChannel,
	resolveNudgePgmChannel,
	isPgmNudgeTarget,
	NUDGE_MAX_LAYERS,
}

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const liveSceneState = require('../state/live-scene-state')
const { clearSceneProgramLookStackLayers } = require('../engine/scene-exit-layers')
const { resolveSceneById } = require('../engine/project-scenes')
const {
	stripEphemeralTakeFields,
	resolvePreviewChannel,
	getRouteMap,
	chainSceneTakeWork,
	takeChainKeyForPreviewChannel,
} = require('./routes-scene-shared')

/**
 * POST /api/scene/live/preview — register PRV look on server live map (no AMCP).
 */
function handlePreviewLiveRegister(body, ctx) {
	const b = parseBody(body)
	const sceneIdRaw = b.sceneId ?? b.lookId ?? b.incomingSceneId
	if (sceneIdRaw == null || !String(sceneIdRaw).trim()) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'sceneId required' }) }
	}

	const routeMap = getRouteMap(ctx)
	let mainIdx = b.mainIndex != null ? parseInt(b.mainIndex, 10) : -1
	if (mainIdx < 0 && b.mainScreenIndex != null) {
		mainIdx = parseInt(b.mainScreenIndex, 10) - 1
	}

	let previewCh = null
	if (mainIdx >= 0) {
		previewCh = resolvePreviewChannel(routeMap, mainIdx, null)
	}
	if (!previewCh && b.channel != null) {
		const ch = parseInt(b.channel, 10)
		const previews = (routeMap.previewChannels || []).map((p) => Number(p)).filter((n) => Number.isFinite(n) && n > 0)
		if (previews.includes(ch)) previewCh = ch
	}
	if (!previewCh) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error:
					'Preview channel not found for mainIndex (PGM-only destination or invalid mainIndex). Pass mainIndex or preview channel.',
			}),
		}
	}

	let scene = b.incomingScene || b.scene
	if (!scene || typeof scene !== 'object') {
		scene = resolveSceneById(sceneIdRaw)
	}
	if (!scene || typeof scene !== 'object') {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'scene not found' }) }
	}

	const sceneId = String(scene.id || sceneIdRaw)
	liveSceneState.setChannel(previewCh, { sceneId, scene: stripEphemeralTakeFields(scene) })
	liveSceneState.broadcastSceneLive(ctx, { skipChannelMap: true })
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, previewChannel: previewCh, mainIndex: mainIdx, sceneLive: liveSceneState.getAll() }),
	}
}

/**
 * POST /api/scene/live/preview/clear — stop PRV look-stack layers and drop server live map entry.
 */
async function handlePreviewLiveClear(body, ctx) {
	const b = parseBody(body)
	const routeMap = getRouteMap(ctx)
	let mainIdx = b.mainIndex != null ? parseInt(b.mainIndex, 10) : -1
	if (mainIdx < 0 && b.mainScreenIndex != null) {
		mainIdx = parseInt(b.mainScreenIndex, 10) - 1
	}

	let previewCh = null
	if (mainIdx >= 0) {
		previewCh = resolvePreviewChannel(routeMap, mainIdx, null)
	}
	if (!previewCh && b.channel != null) {
		const ch = parseInt(b.channel, 10)
		const previews = (routeMap.previewChannels || []).map((p) => Number(p)).filter((n) => Number.isFinite(n) && n > 0)
		if (previews.includes(ch)) previewCh = ch
	}
	if (!previewCh) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error:
					'Preview channel not found for mainIndex (PGM-only destination or invalid mainIndex). Pass mainIndex or preview channel.',
			}),
		}
	}

	let clearedAmcp = false
	if (ctx.amcp) {
		try {
			/* Join the /api/scene/take per-channel chain: a clear interleaving into a mid-flight
			 * staging take strips layers the take just staged ("sometimes not all layers" race). */
			const chainKey = takeChainKeyForPreviewChannel(routeMap, previewCh, mainIdx)
			await chainSceneTakeWork(ctx, chainKey, () => clearSceneProgramLookStackLayers(ctx.amcp, previewCh, ctx))
			clearedAmcp = true
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', `[scene-preview-clear] AMCP clear failed ch=${previewCh}: ${e?.message || e}`)
			}
		}
	}

	const hadEntry = !!liveSceneState.getChannel(previewCh)
	if (hadEntry) {
		await liveSceneState.clearChannel(previewCh)
	}

	if (clearedAmcp || hadEntry) {
		liveSceneState.broadcastSceneLive(ctx, { skipChannelMap: true })
	}

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			cleared: clearedAmcp || hadEntry,
			clearedAmcp,
			clearedLive: hadEntry,
			previewChannel: previewCh,
			mainIndex: mainIdx,
			sceneLive: liveSceneState.getAll(),
		}),
	}
}

module.exports = {
	handlePreviewLiveRegister,
	handlePreviewLiveClear,
}

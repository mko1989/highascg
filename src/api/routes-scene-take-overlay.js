/**
 * WO-860 — take an overlay look (only template CG, src/engine/overlay-look.js). handleSceneTake branches here, like
 * the WO-572 audio-only looks, before the look pipeline: the on-air look, its bank and the screen's live look on PGM
 * are left alone. A preview take stages the overlay over whatever PRV shows and becomes PRV's look, so the next
 * staging diffs it away like any other look.
 */

'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const liveSceneState = require('../state/live-scene-state')
const { takeOverlayLook } = require('../engine/overlay-look')
const { shouldFollowerSkipLocalPgmAmcp } = require('../replication/amcp-fanout')
const { stripEphemeralTakeFields, resolvePreviewChannel, isPreviewTakeTarget, getRouteMap } = require('./routes-scene-shared')

function mainIdxOf(routeMap, channel) {
	const i = Array.isArray(routeMap.programChannels) ? routeMap.programChannels.indexOf(channel) : -1
	if (i >= 0 || !routeMap.programCh || !Number.isFinite(routeMap.screenCount)) return i
	for (let s = 0; s < routeMap.screenCount; s++) if (routeMap.programCh(s + 1) === channel) return s
	return -1
}

/**
 * @param {object} b — parsed take request body
 * @param {object} ctx
 * @param {number} channel — the main's PGM channel
 * @param {object} inc — the incoming overlay look
 */
async function handleOverlayLookTake(b, ctx, channel, inc) {
	const routeMap = getRouteMap(ctx)
	const bus1 = resolvePreviewChannel(routeMap, mainIdxOf(routeMap, channel), channel)
	const preview = isPreviewTakeTarget(b)
	if (preview && bus1 == null) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Preview take requested but this main has no preview bus (PGM-only destination).' }),
		}
	}
	const target = preview ? bus1 : channel
	if (!preview && shouldFollowerSkipLocalPgmAmcp(ctx, channel, { previewOnly: false })) {
		ctx.log?.('info', `[scene-take] follower amcp-fanout: skip local PGM AMCP ch=${channel} (overlay look)`)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, overlay: true }) }
	}
	// the channel's take chain (routes-scene-take.js): an overlay never interleaves with a look take there
	if (!ctx._sceneTakeChainByChannel) ctx._sceneTakeChainByChannel = {}
	const key = String(target)
	const run = (ctx._sceneTakeChainByChannel[key] || Promise.resolve()).then(() =>
		takeOverlayLook({ amcp: ctx.amcp, channel: target, scene: inc, self: ctx, preview, forceCut: !!b.forceCut }),
	)
	ctx._sceneTakeChainByChannel[key] = run.catch(() => {})
	try {
		await run
	} catch (e) {
		ctx.log?.('error', `Overlay look take failed: ${e?.message || e}`)
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || 'Overlay look take failed' }) }
	}
	if (preview && inc?.id != null) {
		await liveSceneState.setChannel(target, { sceneId: String(inc.id), scene: stripEphemeralTakeFields(inc) })
		liveSceneState.broadcastSceneLive(ctx)
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, overlay: true, channel: target, sceneLive: liveSceneState.getAll() }),
	}
}

module.exports = { handleOverlayLookTake }

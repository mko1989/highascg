/**
 * WO-572 Part C — take/stop for audio-only looks. Split out of routes-scene-take.js purely to
 * stay under the repo's 500-line file cap; handleSceneTake branches here before it ever runs the
 * normal look-diff/AMCP pipeline (see the isAudioOnlyLook() check near the top of that file).
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const liveAudioOnlyLookState = require('../state/live-audio-only-look-state')
const { takeAudioOnlyLook, stopAudioOnlyLook } = require('../engine/audio-only-look')
const { shouldFollowerSkipLocalPgmAmcp } = require('../replication/amcp-fanout')
const { resolvePreviewChannel, isPreviewTakeTarget, getRouteMap } = require('./routes-scene-shared')

function resolveMainIdxForChannel(routeMap, channel) {
	let mainIdx = Array.isArray(routeMap.programChannels) ? routeMap.programChannels.indexOf(channel) : -1
	if (mainIdx < 0 && routeMap.programCh && Number.isFinite(routeMap.screenCount)) {
		for (let i = 0; i < routeMap.screenCount; i++) {
			if (routeMap.programCh(i + 1) === channel) {
				mainIdx = i
				break
			}
		}
	}
	return mainIdx
}

/**
 * @param {object} b — parsed take request body
 * @param {object} ctx
 * @param {number} channel
 * @param {object} inc — the incoming audio-only scene
 */
async function handleAudioOnlyLookTake(b, ctx, channel, inc) {
	const routeMap = getRouteMap(ctx)
	const mainIdx = resolveMainIdxForChannel(routeMap, channel)
	const bus1 = resolvePreviewChannel(routeMap, mainIdx, channel)
	const previewOnly = isPreviewTakeTarget(b)

	if (previewOnly && bus1 == null) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error:
					'Preview take requested but this main has no preview bus (PGM-only destination). Use a normal program take or add a PGM/PRV screen destination.',
			}),
		}
	}
	const targetChannel = previewOnly ? bus1 : channel

	if (!previewOnly && shouldFollowerSkipLocalPgmAmcp(ctx, channel, { previewOnly: false })) {
		if (typeof ctx.log === 'function') {
			ctx.log('info', `[scene-take] follower amcp-fanout: skip local PGM AMCP ch=${channel} (audio-only look)`)
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
	}

	await takeAudioOnlyLook({ amcp: ctx.amcp, channel: targetChannel, scene: inc, self: ctx, preview: previewOnly })

	if (inc?.id) {
		await liveAudioOnlyLookState.setChannel(targetChannel, { sceneId: String(inc.id), scene: inc })
		liveAudioOnlyLookState.broadcastAudioOnlyLive(ctx)
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, audioOnlyLive: liveAudioOnlyLookState.getAll() }) }
}

/**
 * POST /api/scene/audio-only/stop — clear whichever audio-only look is live on a channel, leaving
 * that channel's normal video look completely untouched.
 * @param {unknown} body
 * @param {object} ctx
 */
async function handleAudioOnlyLookStop(body, ctx) {
	const b = parseBody(body)
	const channel = parseInt(b.channel, 10)
	if (!channel || channel < 1) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'channel required' }) }
	}
	await stopAudioOnlyLook({ amcp: ctx.amcp, channel })
	await liveAudioOnlyLookState.clearChannel(channel)
	liveAudioOnlyLookState.broadcastAudioOnlyLive(ctx)
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, audioOnlyLive: liveAudioOnlyLookState.getAll() }) }
}

module.exports = {
	handleAudioOnlyLookTake,
	handleAudioOnlyLookStop,
}

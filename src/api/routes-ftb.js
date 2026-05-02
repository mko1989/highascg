/**
 * POST /api/ftb — fade out all layers on every program + preview channel, then clear (FTB).
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getChannelMap } = require('../config/routing')
const liveSceneState = require('../state/live-scene-state')
const { runFadeToBlackAllLayers } = require('../engine/ftb-pgm-prv')

/**
 * @param {string} path
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(path, body, ctx) {
	if (path !== '/api/ftb') return null
	if (!ctx.amcp) {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	}
	const b = parseBody(body)
	const map = getChannelMap(ctx.config || {})
	const channels = []
	for (let i = 0; i < map.screenCount; i++) {
		channels.push(map.programCh(i + 1))
		const prv = map.previewCh(i + 1)
		if (prv != null) channels.push(prv)
	}

	try {
		// Stop timeline transport first so the ticker cannot PLAY layers again during the fade.
		if (ctx.timelineEngine) {
			const pb = ctx.timelineEngine.getPlayback()
			if (pb?.timelineId) {
				try {
					ctx.timelineEngine.stop(pb.timelineId, { skipAmcp: true })
				} catch (_) {}
			}
		}

		const result = await runFadeToBlackAllLayers(
			ctx.amcp,
			channels,
			{
				durationFrames: b.durationFrames,
				tween: b.tween,
				framerate: b.framerate,
			},
			ctx
		)

		for (const ch of map.programChannels) {
			liveSceneState.clearChannel(ch)
		}
		liveSceneState.broadcastSceneLive(ctx)

		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, ...result }) }
	} catch (e) {
		const msg = e?.message || String(e)
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}
}

module.exports = { handlePost }

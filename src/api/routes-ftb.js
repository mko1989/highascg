/**
 * POST /api/ftb — fade out program + preview layers, then clear (FTB).
 * Body: `{ screenIdx?: number }` — 0-based screen index; omit for all screens.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getChannelMap } = require('../config/routing')
const liveSceneState = require('../state/live-scene-state')
const { runFadeToBlackAllLayers } = require('../engine/ftb-pgm-prv')

/**
 * @param {object} map
 * @param {number|null} screenIdx 0-based, or null for all screens
 * @returns {number[]|null}
 */
function resolveFtbChannels(map, screenIdx) {
	if (screenIdx == null) {
		const channels = []
		for (let i = 0; i < map.screenCount; i++) {
			channels.push(map.programCh(i + 1))
			const prv = map.previewCh(i + 1)
			if (prv != null) channels.push(prv)
		}
		return channels
	}
	if (!Number.isFinite(screenIdx) || screenIdx < 0 || screenIdx >= map.screenCount) return null
	const channels = [map.programCh(screenIdx + 1)]
	const prv = map.previewCh(screenIdx + 1)
	if (prv != null) channels.push(prv)
	return channels
}

/**
 * @param {object} ctx
 * @param {number|null} screenIdx
 */
function shouldStopTimelineForFtb(ctx, screenIdx) {
	if (screenIdx == null) return true
	const eng = ctx.timelineEngine
	if (!eng || typeof eng.getPlayback !== 'function') return false
	const pb = eng.getPlayback()
	if (!pb?.timelineId) return false
	const st = pb.sendTo || {}
	if (st.screenIdx != null) return st.screenIdx === screenIdx
	return false
}

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
	const screenIdxRaw = b.screenIdx ?? b.screenIndex
	const screenIdx =
		screenIdxRaw != null && screenIdxRaw !== ''
			? parseInt(String(screenIdxRaw), 10)
			: null
	if (screenIdx != null && !Number.isFinite(screenIdx)) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'screenIdx must be a non-negative integer' }),
		}
	}
	const channels = resolveFtbChannels(map, screenIdx)
	if (!channels) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: `screenIdx out of range (0..${Math.max(0, map.screenCount - 1)})` }),
		}
	}

	try {
		// Stop timeline transport first so the ticker cannot PLAY layers again during the fade.
		if (shouldStopTimelineForFtb(ctx, screenIdx) && ctx.timelineEngine) {
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

		if (screenIdx != null) {
			liveSceneState.clearChannel(map.programCh(screenIdx + 1))
		} else {
			for (const ch of map.programChannels) {
				liveSceneState.clearChannel(ch)
			}
		}
		liveSceneState.broadcastSceneLive(ctx)

		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, screenIdx, ...result }),
		}
	} catch (e) {
		const msg = e?.message || String(e)
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}
}

module.exports = { handlePost, resolveFtbChannels, shouldStopTimelineForFtb }

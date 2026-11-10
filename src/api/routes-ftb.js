/**
 * POST /api/ftb — fade out program + preview layers, then clear (FTB).
 * Body: `{ screenIdx?: number }` — 0-based screen index; omit for all screens.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getChannelMap } = require('../config/routing')
const liveSceneState = require('../state/live-scene-state')
const { runFadeToBlackAllLayers } = require('../engine/ftb-pgm-prv')
const { airHeldBy } = require('../replication/amcp-fanout')
const { isAirHeld, airHeldReply } = require('../replication/air-held') // WO-1029 B2

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
	const asked = resolveFtbChannels(map, screenIdx)
	if (!asked) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: `screenIdx out of range (0..${Math.max(0, map.screenCount - 1)})` }),
		}
	}
	// WO-1029 B2: a screen another server drives right now is not blacked here (its PGM lines would be refused, and the
	// live store would claim black while the master's look stays up). One such screen → 409; "all screens" blacks the
	// screens this server drives and lists the others in `refused`.
	const { channels, refused } = splitHeldScreens(ctx, map, screenIdx, asked)
	if (!channels.length && refused.length) return airHeldReply(refused[0], { refused })

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

		// Forget every channel just blacked, PRV too: a kept PRV entry made the next preview-push of that look a mixer
		// nudge onto an empty Caspar channel, so PRV stayed black (found 07.11 during the WO-979 two-box run).
		for (const ch of channels) await liveSceneState.clearChannel(ch)
		liveSceneState.broadcastSceneLive(ctx)

		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, screenIdx, ...result, ...(refused.length ? { refused } : {}) }),
		}
	} catch (e) {
		if (isAirHeld(e)) return airHeldReply(e)
		const msg = e?.message || String(e)
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}
}

/**
 * WO-1029: drops every screen whose PGM another server drives (its PRV with it: the FTB is that screen's) →
 * `{ channels, refused: [{ channel, screen, drivenBy }] }`.
 */
function splitHeldScreens(ctx, map, screenIdx, asked) {
	const screens = screenIdx == null ? [...Array(map.screenCount).keys()] : [screenIdx]
	const drop = new Set()
	const refused = []
	for (const i of screens) {
		const held = airHeldBy(ctx, map.programCh(i + 1))
		if (!held) continue
		refused.push(held)
		drop.add(map.programCh(i + 1))
		const prv = map.previewCh(i + 1)
		if (prv != null) drop.add(prv)
	}
	return { channels: asked.filter((c) => !drop.has(c)), refused }
}

module.exports = { handlePost, resolveFtbChannels, shouldStopTimelineForFtb }

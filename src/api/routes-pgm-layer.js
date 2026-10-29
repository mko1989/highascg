'use strict'

/**
 * WO-803 — each program screen's main layer, for the Companion PGM readback button: GET /api/screens/pgm-layer.
 *
 * Read-only, from the OSC state HighAsCG already keeps (WO-252 fills duration gaps from AMCP INFO); no Caspar call.
 * The main layer is the WO-734 main-video pick (src/show-timers/main-video.js): the topmost playing, non-looped clip in
 * the live bank, kiosk PGM-timer layer rules (timer band, border layer, stale layers skipped). A screen with nothing
 * timed on PGM (cleared, taken out, only looped backgrounds) answers `active: false` so the button clears.
 *
 * Body: { ok, serverNowMs, screens: [{ screen (0-based), label, channel, active, layer, clip, remainingSec,
 *         durationSec, elapsedSec, progress (0..1), paused }] } — one entry per program screen, in screen order.
 */

const { JSON_HEADERS, jsonBody } = require('./response')
const { buildChannelMap } = require('../config/channel-map-from-ctx')
const { mainVideos } = require('../show-timers/main-video')

const r3 = (n) => Math.round(n * 1000) / 1000

/**
 * @param {object} snapshot  ctx.oscState.getSnapshot()
 * @param {{ programChannels?: number[], screenLabels?: string[] }} channelMap
 * @param {Record<string, unknown>} [banks]  ctx.programLayerBankByChannel
 * @param {number} [now]
 */
function pgmLayers(snapshot, channelMap, banks, now = Date.now()) {
	const pgm = Array.isArray(channelMap?.programChannels) ? channelMap.programChannels : []
	const videos = mainVideos(snapshot, channelMap, banks, now)
	return pgm.map((ch, i) => {
		const label = String(channelMap.screenLabels?.[i] || `Screen ${i + 1}`)
		const v = videos.find((x) => x.channel === ch)
		if (!v) {
			return { screen: i, label, channel: ch, active: false, layer: null, clip: '', remainingSec: null, durationSec: null, elapsedSec: null, progress: 0, paused: false }
		}
		const remaining = Math.max(0, Math.min(v.duration_s, v.remaining_s))
		return {
			screen: i,
			label,
			channel: ch,
			active: true,
			layer: v.layer,
			clip: v.label,
			remainingSec: r3(remaining),
			durationSec: r3(v.duration_s),
			elapsedSec: r3(v.elapsed_s),
			progress: r3(1 - remaining / v.duration_s),
			paused: v.paused,
		}
	})
}

function handleGet(ctx) {
	const snapshot = ctx.oscState && typeof ctx.oscState.getSnapshot === 'function' ? ctx.oscState.getSnapshot() : {}
	const screens = pgmLayers(snapshot, buildChannelMap(ctx), ctx.programLayerBankByChannel || {})
	return {
		status: 200,
		headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
		body: jsonBody({ ok: true, serverNowMs: Date.now(), screens }),
	}
}

/** Registered after POST /api/screens/label; no earlier GET wildcard covers /api/screens/* (curl it on the box). */
function register(routes) {
	routes.get('/api/screens/pgm-layer', ({ ctx }) => handleGet(ctx), { requireCaspar: false })
}

module.exports = { pgmLayers, handleGet, register }

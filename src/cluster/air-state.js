'use strict'

/**
 * WO-712 R3b/R4 — what this server has on program, for the "on air" rules (src/tracking/air-rules.js): here through
 * the zone service (`ctx.zoneService.onAir('self', …)`), and to the linked servers that run the rules (exchange topic
 * `air`, cluster-exchange.js). Called on every live change (live-scene-state.js broadcastSceneLive) and on every
 * cluster poll (the exchange's heartbeat, so a receiver can tell a quiet server from a gone one).
 */

const liveSceneState = require('../state/live-scene-state')
const { getChannelMap } = require('../config/routing')

/**
 * → [{ channel, sceneId, name }]: every channel in the live store except a preview bus (preview takes share the store).
 * Not "the program channels" only: a box without screens (screenCount 0) takes on the channel itself (the take's
 * direct-program path), and that is on air too. A channel that is both (a shared preview bus) counts as program.
 */
function programLooks(ctx) {
	const map = getChannelMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel)
	const programs = new Set((map.programChannels || []).map(Number))
	const previews = new Set([...(map.previewChannels || []), ...(map.switcherBus1Channels || [])].map(Number))
	const all = liveSceneState.getAll()
	return Object.keys(all)
		.map(Number)
		.filter((ch) => all[ch]?.sceneId && (programs.has(ch) || !previews.has(ch)))
		.sort((a, b) => a - b)
		.map((ch) => ({ channel: ch, sceneId: String(all[ch].sceneId), name: String(all[ch].scene?.name || '') }))
}

/** Never starts the cluster service: the offer goes out only while servers are linked (ctx._cluster). */
function airChanged(ctx) {
	const looks = programLooks(ctx)
	ctx?.zoneService?.onAir('self', looks)
	if (ctx?._cluster) require('../api/routes-cluster').exchangeOf(ctx).offer('air', { program: looks })
	return looks
}

module.exports = { programLooks, airChanged }

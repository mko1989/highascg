'use strict'

/**
 * WO-712 R3b/R4 — what this server has on program, for the "on air" rules (src/tracking/air-rules.js): here through
 * the zone service (`ctx.zoneService.onAir('self', …)`), and to the linked servers that run the rules (exchange topic
 * `air`, cluster-exchange.js). Called on every live change (live-scene-state.js broadcastSceneLive) and on every
 * cluster poll (the exchange's heartbeat, so a receiver can tell a quiet server from a gone one).
 */

const liveSceneState = require('../state/live-scene-state')
const { getChannelMap } = require('../config/routing')
const { localProgramChannels, screenChannels } = require('../config/screen-channels')

/**
 * → [{ channel, sceneId, name }]: every channel in the live store except a preview bus (preview takes share the store).
 * Not "the program channels" only: a box without screens (screenCount 0) takes on the channel itself (the take's
 * direct-program path), and that is on air too. A channel that is both (a shared preview bus) counts as program.
 */
function programLooks(ctx) {
	const map = getChannelMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel)
	const programs = new Set(localProgramChannels(map)) // WO-1029 C1b: holes (screens elsewhere) are no program here
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

/**
 * WO-1029 C8 — "is something on air on screen `idx`" (0-based) → { on, unknown, here, sceneId, name, server }.
 * A screen here: its PGM look in the live store, or the test card on it. A screen cabled on a linked server (a hole
 * here, `cluster.channelsWhereCabled`): that server's `dest.air` (dest-air.js, `scene.remoteLive`).
 * UNKNOWN (the owner silent ≥ 15 s, offline, or nobody reports the screen) → `on: true`, `unknown: true`: the safe
 * default. Callers ask before something that would disturb a show (restart, media copy at full rate, an automatic
 * take); a screen nobody can see is treated as live. It never FIRES an on-air rule: rules fire on a named look
 * appearing (air-rules.js), and an unknown screen carries no look. The rules' transition feed stays the `air` topic
 * (programLooks): feeding dest.air into it too would fire each rule twice (or on both servers when both run zones).
 */
function screenOnAir(ctx, idx) {
	const map = getChannelMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel)
	const s = screenChannels(map, idx)
	if (s.here) {
		const e = liveSceneState.getChannel(s.pgm)
		const tc = require('../engine/led-test-card-control')
		const card = ctx?._ledTestPatternActive === true && tc.planTargets(tc.getSettings(), map, true).includes(s.pgm)
		const look = e?.sceneId ? { sceneId: String(e.sceneId), name: String(e.scene?.name || '') } : null
		return { on: !!look || card, unknown: false, here: true, sceneId: look?.sceneId || null, name: look?.name || '', server: null }
	}
	const r = (require('./dest-air').remoteLive(ctx) || [])[idx] || null
	if (!r || r.unknown) return { on: true, unknown: true, here: false, sceneId: null, name: '', server: r?.server || null }
	const on = !!r.pgm || r.testcard === true || r.timeline?.state === 'playing' || r.clips.some((c) => c.bus === 'pgm')
	return { on, unknown: false, here: false, sceneId: r.pgm?.sceneId || null, name: r.pgm?.name || '', server: r.server }
}

module.exports = { programLooks, airChanged, screenOnAir }

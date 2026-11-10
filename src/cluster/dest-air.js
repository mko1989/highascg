'use strict'

/**
 * WO-1029 plan 07 C8 — remote air state. With `cluster.channelsWhereCabled` on, a box has Caspar channels only for the
 * screens cabled on it, so it knew nothing about what is on air on the other box's screens (deck, Live tab, header).
 *
 * PUBLISHER (the owner is the authority): for every destination cabled HERE (a local screen with a `screenHosts`
 * destId) it publishes what is on it, on the exchange topic `dest.air` (cluster-exchange.js), to every online linked
 * server advertising the `dest-air` cap:
 *   { v: 1, at, destinations: [{ destId, screen, pgm: {sceneId, name, at}|null, prv: …, testcard, ftb,
 *     timeline: {id, state, position_ms, at}|null, holder: {server, seq, at}|null,
 *     clips: [{ bus, layer, clip, position_s, length_s, paused, loop, at }], at }] }
 * After every live change (`changed(ctx)`: broadcastSceneLive, the test card's on-state, FTB, the timeline engine's
 * `playback` event, the playback tracker's matrix change), debounced DEBOUNCE_MS, and on the cluster poll (HEARTBEAT_MS)
 * so a receiver that restarted catches up. Never per frame: clip / timeline positions go as `position + at`; a
 * running clip is re-sent only when its origin (at − position) moved more than DRIFT_MS (a seek).
 *
 * RECEIVER: dest-air-view.js (newest per (source, destination), expiry → unknown, `scene.remoteLive`, WS).
 *
 * Every `at` is the SENDER's clock. The receiver never compares it with its own clock (dest-air-view.js turns it into
 * an age at receipt). Flag off / no links / no peer with the cap: nothing is built or sent.
 */

const liveSceneState = require('../state/live-scene-state')
const { getChannelMap } = require('../config/routing')
const sc = require('../config/screen-channels')
const view = require('./dest-air-view')

const DEBOUNCE_MS = 150
const HEARTBEAT_MS = 5000 // = the cluster poll (afterPoll calls tick); 3 heartbeats inside the receiver's 15 s expiry
const DRIFT_MS = 750
const NOT_A_CLIP_LAYER = (ln) => ln >= 980 // screen timers 980-989, global border 998, test card 999

const { nowOf } = view

/** Per-ctx state (publisher + receiver). */
function stateOf(ctx) {
	if (!ctx._destAir) {
		ctx._destAir = {
			timer: null, sig: '', origins: {}, sentAt: 0, hooked: false,
			ftbAt: new Map(), // pgm channel → when an FTB blacked it (sender-local clock, compared locally only)
			holders: new Map(), // destId → { server, seq, at }
			...view.initialState(),
		}
	}
	return ctx._destAir
}

const enabled = (ctx) => sc.channelsWhereCabledEnabled(ctx?.config)

/** The screens this server outputs that have a destination id → [{ idx, destId, pgm, prv }]. */
function ownedScreens(ctx, map) {
	const out = []
	for (const idx of sc.localScreens(map)) {
		const h = sc.screenHost(map, idx)
		if (!h.destId) continue
		const c = sc.screenChannels(map, idx)
		out.push({ idx, destId: String(h.destId), pgm: c.pgm, prv: c.prv })
	}
	return out
}

function lookOn(ch) {
	const e = ch != null ? liveSceneState.getChannel(ch) : null
	if (!e?.sceneId) return null
	return { sceneId: String(e.sceneId), name: String(e.scene?.name || ''), at: Number(e.updatedAt) || 0 }
}

function testcardOn(ctx, map, pgm) {
	if (ctx?._ledTestPatternActive !== true || pgm == null) return false
	try {
		const card = require('../engine/led-test-card-control')
		return card.planTargets(card.getSettings(), map, true).includes(pgm)
	} catch {
		return false
	}
}

/** The timeline on air on screen `idx` (same screen set as the engine's _channelsFor), or null. */
function timelineOn(ctx, idx, t) {
	const eng = ctx?.timelineEngine
	const pb = eng && typeof eng.getPlayback === 'function' ? eng.getPlayback() : null
	if (!pb?.timelineId) return null
	const st = pb.sendTo || {}
	if (st.screenIdx != null ? Number(st.screenIdx) !== idx : st.program === false && st.preview === false) return null
	const state = pb.playing ? 'playing' : pb.endHeld ? 'held' : 'paused'
	return { id: String(pb.timelineId), state, position_ms: Math.max(0, Math.round(Number(pb.position) || 0)), at: t }
}

/** The top clip (highest layer, playing first) on one bus channel, from the tracker (OSC when it runs). */
function topClip(matrix, ch, bus, t) {
	let best = null
	for (const c of Object.values(matrix || {})) {
		if (!c || Number(c.channel) !== ch || c.isRoute || !c.clip || NOT_A_CLIP_LAYER(Number(c.layer))) continue
		if (!best || (c.playing && !best.playing) || (c.playing === best.playing && c.layer > best.layer)) best = c
	}
	if (!best) return null
	const paused = best.playing === false
	const ms = Number.isFinite(best.elapsedSec)
		? best.elapsedSec * 1000
		: paused
			? Number(best.pausedElapsedMs) || 0
			: Math.max(0, Date.now() - (Number(best.startedAt) || Date.now())) // the tracker's own (wall) clock
	const len = Number(best.durationMs) > 0 ? Number(best.durationMs) / 1000 : null
	return { bus, layer: Number(best.layer), clip: String(best.clip), position_s: Math.round(ms) / 1000, length_s: len, paused, loop: !!best.loop, at: t }
}

/** What is on one owned screen now. */
function screenState(ctx, map, s, matrix, t) {
	const st = stateOf(ctx)
	const pgm = lookOn(s.pgm)
	const ftbAt = st.ftbAt.get(s.pgm)
	if (ftbAt != null && pgm && pgm.at > ftbAt) st.ftbAt.delete(s.pgm) // a take after the FTB ends it
	const clips = [topClip(matrix, s.pgm, 'pgm', t), s.prv != null ? topClip(matrix, s.prv, 'prv', t) : null].filter(Boolean)
	return {
		destId: s.destId,
		screen: s.idx,
		pgm,
		prv: lookOn(s.prv),
		testcard: testcardOn(ctx, map, s.pgm),
		ftb: st.ftbAt.has(s.pgm) && !pgm,
		timeline: timelineOn(ctx, s.idx, t),
		holder: st.holders.get(s.destId) || null,
		clips,
		at: t,
	}
}

/** The message (null with the flag off). */
function build(ctx) {
	if (!enabled(ctx)) return null
	const t = nowOf(ctx)
	const map = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
	let matrix = {}
	try {
		matrix = require('../state/playback-tracker').getMatrixForState(ctx) || {}
	} catch {
		matrix = {}
	}
	return { v: 1, at: t, destinations: ownedScreens(ctx, map).map((s) => screenState(ctx, map, s, matrix, t)) }
}

/** Content without times: a change here is a change. Running clips / timelines: their origin, checked with DRIFT_MS. */
function signature(msg) {
	const origins = {}
	const plain = msg.destinations.map((d) => {
		for (const c of d.clips) if (!c.paused) origins[`${d.destId}|${c.bus}`] = c.at - c.position_s * 1000
		if (d.timeline?.state === 'playing') origins[`${d.destId}|tl`] = d.timeline.at - d.timeline.position_ms
		return {
			...d, at: 0, pgm: d.pgm && { ...d.pgm }, prv: d.prv && { ...d.prv },
			timeline: d.timeline && { id: d.timeline.id, state: d.timeline.state, p: d.timeline.state === 'playing' ? 0 : d.timeline.position_ms },
			clips: d.clips.map((c) => ({ ...c, at: 0, position_s: c.paused ? c.position_s : 0 })),
		}
	})
	return { sig: JSON.stringify(plain), origins }
}

const drifted = (a, b) => Object.keys(b).some((k) => a[k] == null || Math.abs(a[k] - b[k]) > DRIFT_MS)

function exchange(ctx) {
	return ctx._clusterExchange || require('../api/routes-cluster').exchangeOf(ctx)
}

/**
 * Build and offer now. `force` (heartbeat) sends even when nothing changed. Never starts the cluster service: only
 * while servers are linked (ctx._cluster). → the message offered, or null.
 */
function publish(ctx, force = false) {
	const st = stateOf(ctx)
	if (st.timer) clearTimeout(st.timer)
	st.timer = null
	if (!ctx?._cluster || !enabled(ctx)) return null
	const msg = build(ctx)
	const { sig, origins } = signature(msg)
	if (!force && sig === st.sig && !drifted(st.origins, origins)) return null
	Object.assign(st, { sig, origins, sentAt: nowOf(ctx) })
	exchange(ctx).offer('dest.air', msg)
	return msg
}

/** A live change: publish after DEBOUNCE_MS (a take's burst of broadcasts is one message). Cheap with the flag off. */
function changed(ctx) {
	if (!ctx || !ctx._cluster || !enabled(ctx)) return
	const st = stateOf(ctx)
	hook(ctx, st)
	if (st.timer) return
	st.timer = setTimeout(() => publish(ctx), DEBOUNCE_MS)
	st.timer.unref?.()
}

/** Subscribe once to the timeline engine and the playback tracker (both live outside broadcastSceneLive). */
function hook(ctx, st) {
	if (st.hooked) return
	st.hooked = true
	try {
		ctx.timelineEngine?.on?.('playback', () => changed(ctx))
		ctx.state?.on?.('change', (path) => path === 'playback.matrix' && changed(ctx))
	} catch {
		/* optional sources */
	}
}

/** Cluster poll (afterPoll, every 5 s while linked): heartbeat + receiver housekeeping (offline peers → unknown). */
function tick(ctx) {
	const st = stateOf(ctx)
	view.peersPolled(ctx, st)
	if (!ctx?._cluster || !enabled(ctx)) return null
	hook(ctx, st)
	return publish(ctx, nowOf(ctx) - st.sentAt >= HEARTBEAT_MS - 500)
}

/** An FTB blacked these channels (engine/ftb-pgm-prv.js): their screens say `ftb: true` until the next take. */
function noteFtb(ctx, channels) {
	if (!ctx || !enabled(ctx)) return
	const st = stateOf(ctx)
	const t = nowOf(ctx)
	for (const ch of channels || []) st.ftbAt.set(Number(ch), t)
	changed(ctx)
}

/** The last press on an owned destination (for C5 `dest.*` receivers): `holder` in dest.air. */
function noteHolder(ctx, destId, holder) {
	if (!ctx || !destId) return
	const st = stateOf(ctx)
	if (!holder) st.holders.delete(String(destId))
	else st.holders.set(String(destId), { server: String(holder.server || ''), seq: Number(holder.seq) || 0, at: nowOf(ctx) })
	changed(ctx)
}

/** Exchange handler (routes-cluster.js `handlers`): a linked server's dest.air, or its expiry / unlink. */
function received(ctx, data, source, why) {
	return view.received(ctx, stateOf(ctx), data, source, why)
}

/** `scene.remoteLive` for GET /api/state: absent (undefined) with the flag off. */
function remoteLive(ctx) {
	if (!enabled(ctx)) return undefined
	return view.remoteLive(ctx, stateOf(ctx))
}

module.exports = {
	DEBOUNCE_MS, HEARTBEAT_MS, DRIFT_MS,
	build, publish, changed, tick, noteFtb, noteHolder, received, remoteLive,
}

'use strict'

/**
 * WO-1029 plan 07 C8 — remote air state (src/cluster/dest-air.js, dest-air-view.js, exchange topic `dest.air`).
 *
 * Fixtures: the two real boxes with `cluster.channelsWhereCabled` on (tools/smoke/lib/cwc-fixtures.js):
 * 5867 outputs screens 2/3 (PGM channels 2/4, PRV 3/5), 7579 outputs screen 0 (PGM 2, PRV 3); screen 1 is cabled nowhere.
 * Publisher = 5867 ("B"), receiver = 7579 ("A"). B's clock runs TWO YEARS ahead of A's: every age must still be right.
 */

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const { boxConfig } = require('./lib/cwc-fixtures')
const liveSceneState = require('../../src/state/live-scene-state')
const destAir = require('../../src/cluster/dest-air')
const view = require('../../src/cluster/dest-air-view')
const airState = require('../../src/cluster/air-state')
const { createExchange } = require('../../src/cluster/cluster-exchange')
const caps = require('../../src/cluster/cluster-caps')

const TWO_YEARS = 2 * 365 * 24 * 3600 * 1000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DEST = { s0: 'dst_mw7t9epz_1', s1: 'dst_mw96s6pd_1', s2: 'dst_mw989wyz_1', s3: 'dst_mw9orj4o_1' }

function cfg(box, on = true) {
	const c = boxConfig(box)
	if (on) c.cluster = { channelsWhereCabled: true }
	return c
}

/** A box ctx: fake clock, recorded exchange offers and WS events, linked (ctx._cluster) unless `linked: false`. */
function box(name, { on = true, linked = true, clock = 1_000_000, peers } = {}) {
	const b = { offers: [], ws: [], clock }
	b.ctx = {
		config: cfg(name, on),
		_destAirNow: () => b.clock,
		_wsBroadcast: (type, data) => b.ws.push([type, data]),
		_clusterExchange: { offer: (topic, data) => topic === 'dest.air' && b.offers.push([topic, data]) }, // `air` is WO-712's
		...(linked ? { _cluster: { snapshot: () => ({ peers: peers ? peers() : [{ id: 'B', online: true }] }) } } : {}),
	}
	return b
}

async function clearStore() {
	for (const ch of Object.keys(liveSceneState.getAll())) await liveSceneState.clearChannel(ch)
}

const look = (id, name, at) => ({ sceneId: id, scene: { name, layers: [] }, updatedAt: at })

describe('WO-1029 C8 publisher (5867 owns screens 2 and 3)', () => {
	beforeEach(clearStore)

	it('a take on an owned screen → ONE debounced message, right shape, nothing for screens 0/1', async () => {
		const B = box('5867', { clock: 1_000_000 + TWO_YEARS })
		await liveSceneState.setChannel(2, look('L1', 'Opener', B.clock - 3000))
		for (let i = 0; i < 4; i++) liveSceneState.broadcastSceneLive(B.ctx, { skipChannelMap: true }) // a take's burst
		assert.equal(B.offers.length, 0, 'debounced, not immediate')
		await sleep(destAir.DEBOUNCE_MS + 60)
		assert.equal(B.offers.length, 1)
		const [topic, msg] = B.offers[0]
		assert.equal(topic, 'dest.air')
		assert.equal(msg.v, 1)
		assert.equal(msg.at, B.clock)
		assert.deepEqual(msg.destinations.map((d) => [d.destId, d.screen]), [[DEST.s2, 2], [DEST.s3, 3]])
		const d2 = msg.destinations[0]
		assert.deepEqual(d2.pgm, { sceneId: 'L1', name: 'Opener', at: B.clock - 3000 })
		assert.equal(d2.prv, null)
		assert.equal(d2.testcard, false)
		assert.equal(d2.ftb, false)
		assert.equal(d2.timeline, null)
		assert.equal(d2.holder, null)
		assert.deepEqual(d2.clips, [])
		assert.equal(msg.destinations[1].pgm, null)
		assert.ok(JSON.stringify(msg).length < 1200, 'small payload')
		liveSceneState.broadcastSceneLive(B.ctx, { skipChannelMap: true })
		await sleep(destAir.DEBOUNCE_MS + 60)
		assert.equal(B.offers.length, 1, 'nothing changed → nothing sent before the heartbeat')
	})

	it('test card on → testcard: true on the owned screens; FTB → ftb: true until the next take', async () => {
		const B = box('5867')
		const card = require('../../src/engine/led-test-card-control')
		B.ctx._ledTestPatternActive = true
		card.persistOnState(B.ctx)
		await sleep(destAir.DEBOUNCE_MS + 60)
		assert.deepEqual(B.offers.at(-1)[1].destinations.map((d) => d.testcard), [true, true])
		B.ctx._ledTestPatternActive = false
		card.persistOnState(B.ctx)
		await sleep(destAir.DEBOUNCE_MS + 60)
		assert.deepEqual(B.offers.at(-1)[1].destinations.map((d) => d.testcard), [false, false])

		await liveSceneState.setChannel(4, look('L2', 'Two', B.clock))
		destAir.publish(B.ctx)
		B.clock += 1000
		destAir.noteFtb(B.ctx, [4, 5]) // what runFadeToBlackAllLayers reports for screen 3
		await liveSceneState.clearChannel(4)
		liveSceneState.broadcastSceneLive(B.ctx, { skipChannelMap: true })
		await sleep(destAir.DEBOUNCE_MS + 60)
		let m = B.offers.at(-1)[1]
		assert.deepEqual(m.destinations.map((d) => d.ftb), [false, true])
		B.clock += 1000
		await liveSceneState.setChannel(4, look('L3', 'Three', B.clock))
		liveSceneState.broadcastSceneLive(B.ctx, { skipChannelMap: true })
		await sleep(destAir.DEBOUNCE_MS + 60)
		m = B.offers.at(-1)[1]
		assert.equal(m.destinations[1].ftb, false)
		assert.equal(m.destinations[1].pgm.sceneId, 'L3')
	})

	it('timeline playback on screen 3 → timeline on screen 3 only; a clip goes as position + at', async () => {
		const B = box('5867')
		const eng = new EventEmitter()
		let pb = null
		eng.getPlayback = () => pb
		B.ctx.timelineEngine = eng
		B.ctx.state = new EventEmitter()
		B.ctx._playbackMatrix = { '4-10': { channel: 4, layer: 10, clip: 'AMB', startedAt: Date.now() - 10_000, durationMs: 60_000, playing: true, loop: false } }
		destAir.changed(B.ctx) // hooks the engine + tracker
		await sleep(destAir.DEBOUNCE_MS + 60)
		const n = B.offers.length
		pb = { timelineId: 'tl1', playing: true, position: 1234, sendTo: { screenIdx: 3 } }
		eng.emit('playback', pb)
		await sleep(destAir.DEBOUNCE_MS + 60)
		assert.equal(B.offers.length, n + 1)
		const [d2, d3] = B.offers.at(-1)[1].destinations
		assert.equal(d2.timeline, null)
		assert.deepEqual(d3.timeline, { id: 'tl1', state: 'playing', position_ms: 1234, at: B.clock })
		assert.equal(d3.clips.length, 1)
		const c = d3.clips[0]
		assert.equal(c.bus, 'pgm')
		assert.equal(c.clip, 'AMB')
		assert.equal(c.length_s, 60)
		assert.ok(Math.abs(c.position_s - 10) < 0.5, `position ${c.position_s}`)
		assert.equal(c.at, B.clock)
		B.ctx.state.emit('change', 'playback.matrix', {}) // tracker change, nothing new: no message
		await sleep(destAir.DEBOUNCE_MS + 60)
		assert.equal(B.offers.length, n + 1)
	})

	it('holder (noteHolder, for the C5 dest.* receiver) and a seek beyond DRIFT_MS are changes; clip drift within it is not', async () => {
		const B = box('5867')
		B.ctx._playbackMatrix = { '2-10': { channel: 2, layer: 10, clip: 'AMB', startedAt: Date.now() - 5000, durationMs: 60_000, playing: true } }
		destAir.publish(B.ctx, true)
		const n = B.offers.length
		destAir.noteHolder(B.ctx, DEST.s2, { server: 'A', seq: 7 })
		await sleep(destAir.DEBOUNCE_MS + 60)
		assert.equal(B.offers.length, n + 1)
		assert.deepEqual(B.offers.at(-1)[1].destinations[0].holder, { server: 'A', seq: 7, at: B.clock })
		B.ctx._playbackMatrix['2-10'].startedAt -= destAir.DRIFT_MS / 2
		assert.equal(destAir.publish(B.ctx), null, 'within DRIFT_MS: no message')
		B.ctx._playbackMatrix['2-10'].startedAt -= destAir.DRIFT_MS * 4 // a seek
		assert.ok(destAir.publish(B.ctx), 'a seek is re-sent')
	})

	it('heartbeat: the cluster poll re-sends after 5 s, not before', () => {
		const B = box('5867')
		destAir.publish(B.ctx, true)
		const n = B.offers.length
		B.clock += 1000
		destAir.tick(B.ctx)
		assert.equal(B.offers.length, n, 'unchanged, 1 s later: nothing')
		B.clock += destAir.HEARTBEAT_MS
		destAir.tick(B.ctx)
		assert.equal(B.offers.length, n + 1)
		assert.equal(B.offers.at(-1)[1].at, B.clock, 'the heartbeat carries the sender time')
	})

	it('flag off / not linked: nothing published, nothing exposed, no errors', async () => {
		for (const B of [box('5867', { on: false }), box('5867', { linked: false })]) {
			await liveSceneState.setChannel(2, look('L1', 'x', 1))
			liveSceneState.broadcastSceneLive(B.ctx, { skipChannelMap: true })
			destAir.noteFtb(B.ctx, [2])
			destAir.tick(B.ctx)
			await sleep(destAir.DEBOUNCE_MS + 60)
			assert.equal(B.offers.length, 0)
		}
		assert.equal(destAir.remoteLive(box('7579', { on: false }).ctx), undefined, 'flag off: scene.remoteLive absent')
	})
})

describe('WO-1029 C8 receiver (7579; the sender 5867 is two years ahead)', () => {
	beforeEach(clearStore)

	/** B's message at B's clock tB: screen 2 has look L1 (taken 3 s before), a clip 10 s in; screen 3 empty. */
	function msgFrom(tB, extra = {}) {
		return {
			v: 1,
			at: tB,
			destinations: [
				{ destId: DEST.s2, screen: 2, pgm: { sceneId: 'L1', name: 'Opener', at: tB - 3000 }, prv: null, testcard: false, ftb: false,
					timeline: null, holder: null, clips: [{ bus: 'pgm', layer: 10, clip: 'AMB', position_s: 10, length_s: 60, paused: false, loop: false, at: tB }], at: tB, ...extra },
				{ destId: DEST.s3, screen: 3, pgm: null, prv: null, testcard: false, ftb: false, timeline: null, holder: null, clips: [], at: tB },
			],
		}
	}
	const SRC = { id: 'B', name: 'highascg5867' }

	it('scene.remoteLive by screen index: here and unknown-to-everyone are null; ages from the sender’s own clock', () => {
		const A = box('7579')
		const tB = A.clock + TWO_YEARS
		destAir.received(A.ctx, msgFrom(tB), SRC, '')
		let rl = destAir.remoteLive(A.ctx)
		assert.equal(rl.length, 4)
		assert.equal(rl[0], null, 'screen 0 is here')
		assert.equal(rl[1], null, 'screen 1: nobody reports it')
		assert.deepEqual(rl[2].server, { id: 'B', name: 'highascg5867' })
		assert.equal(rl[2].unknown, false)
		assert.equal(rl[2].pgm.sceneId, 'L1')
		assert.equal(rl[2].pgm.age_ms, 3000)
		assert.equal(rl[2].pgm.at, A.clock - 3000, 'at is on the RECEIVER clock')
		assert.equal(rl[3].pgm, null)
		A.clock += 2000
		rl = destAir.remoteLive(A.ctx)
		assert.equal(rl[2].pgm.age_ms, 5000)
		const c = rl[2].clips[0]
		const now = c.position_s + (c.paused ? 0 : (A.clock - c.at) / 1000)
		assert.equal(now, 12, 'extrapolated clip position')
		assert.equal(c.age_ms, 2000)
	})

	it('newest wins; an older message overtaken in flight is dropped', () => {
		const A = box('7579')
		const tB = A.clock + TWO_YEARS
		destAir.received(A.ctx, msgFrom(tB + 1000, { pgm: { sceneId: 'NEW', name: 'n', at: tB + 1000 } }), SRC, '')
		destAir.received(A.ctx, msgFrom(tB), SRC, '')
		assert.equal(destAir.remoteLive(A.ctx)[2].pgm.sceneId, 'NEW')
		A.clock += 1000
		destAir.received(A.ctx, msgFrom(tB + 2000, { pgm: null }), SRC, '')
		assert.equal(destAir.remoteLive(A.ctx)[2].pgm, null)
	})

	it('expiry: 15 s without a message → unknown (no content); the exchange expiry too; back on the next message', () => {
		const A = box('7579')
		const tB = A.clock + TWO_YEARS
		destAir.received(A.ctx, msgFrom(tB), SRC, '')
		A.clock += view.EXPIRE_MS + 1
		let e = destAir.remoteLive(A.ctx)[2]
		assert.equal(e.unknown, true)
		assert.equal(e.pgm, null)
		assert.deepEqual(e.clips, [])
		destAir.received(A.ctx, msgFrom(tB + view.EXPIRE_MS + 1), SRC, '')
		assert.equal(destAir.remoteLive(A.ctx)[2].unknown, false)
		destAir.received(A.ctx, { destinations: [] }, SRC, 'expired')
		e = destAir.remoteLive(A.ctx)[2]
		assert.equal(e.unknown, true)
		assert.deepEqual(e.server, { id: 'B', name: 'highascg5867' })
	})

	it('server offline on the poll → unknown at once; unlinked → null', () => {
		let online = true
		const A = box('7579', { peers: () => [{ id: 'B', online }] })
		destAir.received(A.ctx, msgFrom(A.clock + TWO_YEARS), SRC, '')
		destAir.tick(A.ctx)
		assert.equal(destAir.remoteLive(A.ctx)[2].unknown, false)
		online = false
		destAir.tick(A.ctx)
		assert.equal(destAir.remoteLive(A.ctx)[2].unknown, true)
		destAir.received(A.ctx, { destinations: [] }, SRC, 'dropped')
		assert.deepEqual(destAir.remoteLive(A.ctx), [null, null, null, null])
	})

	it('WS cluster:dest-air is coalesced: two messages → one push; an age-only heartbeat → none', async () => {
		const A = box('7579')
		const tB = A.clock + TWO_YEARS
		destAir.received(A.ctx, msgFrom(tB), SRC, '')
		destAir.received(A.ctx, msgFrom(tB + 10, { testcard: true }), SRC, '')
		await sleep(view.WS_COALESCE_MS + 50)
		const pushes = A.ws.filter(([t]) => t === 'cluster:dest-air')
		assert.equal(pushes.length, 1)
		assert.equal(pushes[0][1].remoteLive[2].testcard, true)
		A.clock += 10
		destAir.received(A.ctx, msgFrom(tB + 20, { testcard: true }), SRC, '')
		await sleep(view.WS_COALESCE_MS + 50)
		assert.equal(A.ws.filter(([t]) => t === 'cluster:dest-air').length, 1)
	})

	it('air-state screenOnAir: remote on / off / unknown, and a local screen', async () => {
		const A = box('7579')
		const tB = A.clock + TWO_YEARS
		destAir.received(A.ctx, msgFrom(tB), SRC, '')
		assert.deepEqual(airState.screenOnAir(A.ctx, 2), { on: true, unknown: false, here: false, sceneId: 'L1', name: 'Opener', server: { id: 'B', name: 'highascg5867' } })
		assert.equal(airState.screenOnAir(A.ctx, 3).on, false, 'remote, nothing on it')
		assert.deepEqual(airState.screenOnAir(A.ctx, 1), { on: true, unknown: true, here: false, sceneId: null, name: '', server: null }, 'nobody reports screen 1: safe default')
		A.clock += view.EXPIRE_MS + 1
		const u = airState.screenOnAir(A.ctx, 2)
		assert.equal(u.unknown, true)
		assert.equal(u.on, true, 'unknown = treated as on air')
		assert.equal(airState.screenOnAir(A.ctx, 0).on, false)
		await liveSceneState.setChannel(2, look('LOC', 'Local', 1))
		assert.equal(airState.screenOnAir(A.ctx, 0).sceneId, 'LOC')
	})
})

describe('WO-1029 C8 exchange topic dest.air', () => {
	it('advertised cap; sent only to online peers with the cap (an old build gets nothing); expiry reaches the handler', async () => {
		assert.ok(caps.supported().includes('dest-air'))
		const calls = []
		const got = []
		let t = 0
		const ex = createExchange({
			peers: () => [
				{ id: 'old', name: 'old', online: true, duties: { zones: true }, caps: [] },
				{ id: 'off', name: 'off', online: false, duties: null, caps: ['dest-air'] },
				{ id: 'new', name: 'new', online: true, duties: null, caps: ['dest-air'] },
			],
			has: () => true,
			call: async (id, action) => (calls.push([id, action]), { ok: true }),
			broadcast: () => assert.fail('dest.air has no generic WS broadcast'),
			handlers: { 'dest.air': (data, source, why) => got.push([source.id, why, data.destinations.length]) },
			now: () => t,
		})
		assert.equal(ex.offer('dest.air', { at: 1, destinations: [] }), 1)
		await sleep(5)
		assert.deepEqual(calls, [['new', 'exchange.dest_air']])
		assert.equal((await ex.info['exchange.dest_air']({ data: { at: 1, destinations: [{ destId: 'x' }] } }, { id: 'P', name: 'P' })).status, 200)
		t = 20_000
		ex.expire()
		assert.deepEqual(got, [['P', '', 1], ['P', 'expired', 0]])
	})
})

describe('WO-1029 C8 wiring', () => {
	const fs = require('node:fs')
	const path = require('node:path')
	const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
	it('live change, FTB, test card, cluster poll, exchange handler and /api/state all reach dest-air', () => {
		assert.match(read('src/state/live-scene-state.js'), /require\('\.\.\/cluster\/dest-air'\)\.changed\(ctx\)/)
		assert.match(read('src/engine/ftb-pgm-prv.js'), /require\('\.\.\/cluster\/dest-air'\)\.noteFtb\(self, uniq\)/)
		assert.match(read('src/engine/led-test-card-control.js'), /require\('\.\.\/cluster\/dest-air'\)\.changed\(ctx\)/)
		const rc = read('src/api/routes-cluster.js')
		assert.match(rc, /require\('\.\.\/cluster\/dest-air'\)\.tick\(ctx\)/)
		assert.match(rc, /handlers: \{ 'dest\.air': \(data, source, why\) => require\('\.\.\/cluster\/dest-air'\)\.received\(ctx, data, source, why\) \}/)
		assert.match(read('src/api/get-state.js'), /\.\.\.remoteLiveOf\(ctx\)/)
	})
})

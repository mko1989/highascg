'use strict'

/**
 * WO-1029 P1c — the follower drive gate (review 1029_review/02 §1, bugs B1 B2 B4).
 * The incident (10.11): a server that SAW the master online blocked every program channel, while the master forwarded
 * nothing to it — nobody drove its screens, and every blocked press answered "ok" (the test card, PLAY, takes).
 *   B1  a channel is blocked only while the CURRENT master's fresh fan-out report lists it as forwarded + connected
 *   B2  a blocked action is refused: AirHeldError (code AIR_HELD) → HTTP 409 { error, drivenBy }; queries never blocked
 *   B4  a batch is decided per line
 * Everything runs on a fake Caspar socket (no port is opened) and the test-isolated persistence file.
 */

const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const amcpFanout = require('../../src/replication/amcp-fanout')
const { AmcpClient } = require('../../src/caspar/amcp-client')
const { createFanoutReport, STALE_MS } = require('../../src/cluster/cluster-fanout-report')
const { fingerprint } = require('../../src/cluster/cluster-media')
const { getChannelMap } = require('../../src/config/routing')
const routesCluster = require('../../src/api/routes-cluster')
const routesAmcp = require('../../src/api/routes-amcp')
const ledControl = require('../../src/api/routes-led-test-control')
const ledCard = require('../../src/api/routes-led-test-card')
const { handleSceneTake } = require('../../src/api/routes-scene-take')
const routesFtb = require('../../src/api/routes-ftb')
const playbackTracker = require('../../src/state/playback-tracker')

const KEY_M = 'device-key-of-srv-M'
const FP_M = fingerprint(KEY_M)
const PEER_M = { id: 'M', name: 'srv-M', device_key: KEY_M }
const PEER_X = { id: 'X', name: 'srv-X', device_key: 'device-key-of-srv-X' }
const CONFIG = { screen_count: 4 } // PGM 1 3 5 7, PRV 2 4 6 8

/** A Caspar that answers every line (`202 <VERB> OK`, a MIXER query with its value, batches with `202 COMMIT OK`). */
function fakeCaspar(config = CONFIG) {
	const sent = []
	const conn = {
		config,
		response_callback: {},
		_amcpSendQueue: Promise.resolve(),
		_amcpBatchDrain: null,
		log() {},
		socket: { isConnected: true, send: (payload) => (sent.push(payload), setImmediate(() => answer(payload))) },
	}
	function answer(payload) {
		if (payload.startsWith('BEGIN\r\n')) {
			for (const l of payload.split('\r\n').filter((x) => x && x !== 'BEGIN' && x !== 'COMMIT'))
				conn._amcpBatchDrain?.onLine(`202 ${l.split(' ')[0]} OK`)
			conn._amcpBatchDrain?.onLine('202 COMMIT OK')
			return
		}
		const key = payload.trim().split(/\s+/)[0].toUpperCase()
		const query = /^MIXER \S+ \S+$/i.test(payload.trim())
		conn.response_callback[key]?.shift()?.(null, query ? '201 MIXER OK|0.5' : `202 ${key} OK`)
	}
	const lines = () => sent.flatMap((p) => p.split('\r\n')).filter((l) => l && l !== 'BEGIN' && l !== 'COMMIT')
	return { sent, lines, conn, amcp: new AmcpClient(conn) }
}

/** A follower ctx with the REAL routes-cluster wiring (fanoutOf → reportOf → the drive check); the master is online. */
function followerCtx(extraView = {}) {
	const cas = fakeCaspar()
	const ctx = {
		config: CONFIG,
		log() {},
		amcp: cas.amcp,
		getState: () => ({ channelMap: getChannelMap(CONFIG) }),
		_clusterMaster: { view: () => ({ epoch: 3, master: FP_M, master_id: 'M', is_master: false, auto: true, succession: [], ...extraView }) },
		_cluster: { snapshot: () => ({ self: {}, peers: [{ id: 'M', name: 'srv-M', online: true }] }), saved: () => null, list: () => [] },
	}
	routesCluster.fanoutOf(ctx)
	return { ctx, cas, report: (data, peer = PEER_M) => ctx._clusterReport.receive(data, peer) }
}

const body = (r) => JSON.parse(r.body)
const tick = () => new Promise((r) => setImmediate(r))

afterEach(() => amcpFanout.setClusterAirCheck(null))

describe('WO-1029 B1 the incident: the master is online but forwards nothing here', () => {
	it('this server is a follower (G0), yet PLAY, a look take and the test card on its own PGM reach its Caspar', async () => {
		const { ctx, cas } = followerCtx()
		assert.equal(routesCluster.isClusterFollower(ctx), true, 'it sees the master online')
		const play = await routesAmcp.handlePost('/api/play', JSON.stringify({ channel: 1, layer: 10, clip: 'AMB' }), ctx)
		assert.equal(play.status, 200)
		assert.ok(cas.lines().some((l) => /^PLAY 1-10 /.test(l)), 'PLAY went to the local Caspar')

		const take = await handleSceneTake(JSON.stringify({ channel: 3, forceCut: true, incomingScene: { id: 'L1', name: 'L1', layers: [{ layerNumber: 10, source: { type: 'media', value: 'AMB' } }] } }), ctx)
		assert.equal(take.status, 200, take.body)
		assert.ok(cas.lines().some((l) => /^(PLAY|LOADBG) 3-/.test(l)), 'the take ran on the local PGM')

		const card = await ledControl.handlePost('channel', { channel: 5, enabled: true }, ctx)
		assert.equal(card.status, 200, card.body)
		assert.ok(cas.lines().some((l) => /^CG 5-999 ADD/.test(l)), 'the test card went on the local PGM')
		assert.equal(ctx._ledTestPatternActive, true)
		await ledControl.handlePost('channel', { channel: 5, enabled: false }, ctx) // leave the stored dialog clean
	})

	it('an old master (sends no report) and a master state not settled yet → local drive', async () => {
		const a = followerCtx()
		assert.equal(amcpFanout.airHeldBy(a.ctx, 7), null, 'no report at all')
		const b = followerCtx({ settled: false })
		assert.equal(b.report({ epoch: 3, master: FP_M, channels: [7], connected: true }).status, 200)
		assert.equal(amcpFanout.airHeldBy(b.ctx, 7), null, 'unsettled = no evidence')
	})
})

describe('WO-1029 B1 + B2 the master forwards ch 7 only', () => {
	function held() {
		const f = followerCtx()
		assert.equal(f.report({ epoch: 3, master: FP_M, channels: [7], connected: true }).status, 200)
		return f
	}

	it('7 is refused with 409 AIR_HELD; 1 and 3 drive locally; nothing is recorded for the refused PLAY', async () => {
		const { ctx, cas } = held()
		assert.deepEqual(amcpFanout.airHeldBy(ctx, 7), { channel: 7, screen: 4, drivenBy: 'srv-M' })
		const r = await routesAmcp.handlePost('/api/play', JSON.stringify({ channel: 7, layer: 10, clip: 'AMB' }), ctx)
		assert.equal(r.status, 409)
		assert.deepEqual(body(r), { error: 'Screen 4 is driven by srv-M (linked servers)', code: 'AIR_HELD', drivenBy: 'srv-M', channel: 7 })
		assert.equal(cas.lines().length, 0, 'nothing sent')
		assert.equal(playbackTracker.getOccupiedLayers(ctx, 7).size, 0, 'no clip recorded as playing')
		assert.equal((await routesAmcp.handlePost('/api/play', JSON.stringify({ channel: 1, layer: 10, clip: 'AMB' }), ctx)).status, 200)
		assert.equal((await routesAmcp.handlePost('/api/amcp/raw', JSON.stringify({ cmd: 'PLAY 7-11 "X"' }), ctx)).status, 409)
		assert.equal((await routesAmcp.handlePost('/api/clear', JSON.stringify({ channel: 7 }), ctx)).status, 409, 'a whole-channel clear')
		assert.ok(cas.lines().every((l) => !/^\S+ 7[ -]/.test(l)), 'no line for ch 7 went out')
	})

	it('a direct scene take, an overlay stop, an audio-only stop, FTB and timeline play on 7 → 409, not 200', async () => {
		const { ctx } = held()
		const take = await handleSceneTake(JSON.stringify({ channel: 7, incomingScene: { id: 'L1', layers: [{ layerNumber: 10, source: { type: 'media', value: 'AMB' } }] } }), ctx)
		assert.equal(take.status, 409)
		assert.equal(body(take).drivenBy, 'srv-M')
		const overlay = await require('../../src/api/routes-scene-take-overlay').handleOverlayLookStop(JSON.stringify({ channel: 7 }), ctx)
		assert.equal(overlay.status, 409)
		const audio = await require('../../src/api/routes-scene-take-audio-only').handleAudioOnlyLookStop(JSON.stringify({ channel: 7 }), ctx)
		assert.equal(audio.status, 409)
		const ftb = await routesFtb.handlePost('/api/ftb', JSON.stringify({ screenIdx: 3, durationFrames: 0 }), ctx)
		assert.equal(ftb.status, 409)
		const ftbAll = await routesFtb.handlePost('/api/ftb', JSON.stringify({ durationFrames: 0 }), ctx)
		assert.equal(ftbAll.status, 200, 'all screens: the ones this server drives are blacked')
		assert.deepEqual(body(ftbAll).channels, [1, 2, 3, 4, 5, 6])
		assert.deepEqual(body(ftbAll).refused.map((h) => h.channel), [7])
		const tl = await require('../../src/api/routes-timeline').handleTimelineRoutes('POST', '/api/timelines/t1/play', JSON.stringify({ sendTo: { program: true, preview: false, screenIdx: 3 } }), {
			...ctx,
			timelineEngine: { get: () => ({ id: 't1' }), setSendTo: () => assert.fail('not routed'), play: () => assert.fail('not played'), _sendToFor: () => ({}), _channelsFor: (st) => (st.program ? [7] : []) },
		})
		assert.equal(tl.status, 409)
	})

	it('the test card on 7 is refused and NOT flagged active (route pre-check and the transport refusal)', async () => {
		const { ctx } = held()
		const r = await ledControl.handlePost('channel', { channel: 7, enabled: true }, ctx)
		assert.equal(r.status, 409)
		assert.notEqual(ctx._ledTestPatternActive, true)
		const direct = await ledCard.handlePost('/api/led-test-card', JSON.stringify({ channel: 7, enabled: true }), ctx)
		assert.notEqual(direct.status, 200, 'its CG lines were refused')
		assert.notEqual(ctx._ledTestPatternActive, true)
	})

	it('a query on the held channel is answered by Caspar, not faked; ADD / REMOVE still pass', async () => {
		const { ctx, cas } = held()
		const q = await ctx.amcp.raw('MIXER 7-10 OPACITY')
		assert.equal(q.data, '201 MIXER OK|0.5', 'Caspar\'s answer')
		await ctx.amcp.raw('ADD 7-97 STREAM rtmp://host/live/key')
		await ctx.amcp.raw('REMOVE 7-97')
		assert.deepEqual(cas.lines(), ['MIXER 7-10 OPACITY', 'ADD 7-97 STREAM rtmp://host/live/key', 'REMOVE 7-97'])
		await assert.rejects(ctx.amcp.raw('MIXER 7-10 OPACITY 0'), (e) => e.code === 'AIR_HELD', 'a MIXER with a value is not a query')
		await assert.rejects(ctx.amcp.raw('MIXER 7 MASTERVOLUME 0'), (e) => e.code === 'AIR_HELD', 'channel-only form counts too')
	})
})

describe('WO-1029 B4 a batch is decided per line', () => {
	function held(config) {
		const f = followerCtx()
		f.report({ epoch: 3, master: FP_M, channels: [7], connected: true })
		return { ctx: f.ctx, cas: fakeCaspar(config), ctxCas: f.cas }
	}

	for (const [label, config, opts] of [
		['sequential', CONFIG, undefined],
		['BEGIN…COMMIT', CONFIG, { forceBatch: true, skipMixerPreCommit: true }],
	]) {
		it(`${label}: preview line then program line → the preview line and the ADD go out, the program line is refused`, async () => {
			const { cas } = held(config)
			const r = await cas.amcp.batch.batchSend(['PLAY 8-10 "A"', 'PLAY 7-10 "B"', 'ADD 7-97 STREAM rtmp://h/k'], opts)
			assert.deepEqual(cas.lines(), ['PLAY 8-10 "A"', 'ADD 7-97 STREAM rtmp://h/k'])
			assert.equal(r.okAll, false)
			assert.deepEqual(r.refused.map((x) => [x.line, x.drivenBy]), [['PLAY 7-10 "B"', 'srv-M']])
		})
	}

	it('program line first no longer drops the rest; an all-held batch rejects AIR_HELD', async () => {
		const { cas } = held(CONFIG)
		const r = await cas.amcp.batchSendChunked(['MIXER 7 MASTERVOLUME 0', 'PLAY 3-10 "C"'])
		assert.deepEqual(cas.lines(), ['PLAY 3-10 "C"'])
		assert.equal(r.refused.length, 1)
		await assert.rejects(cas.amcp.batchSendChunked(['PLAY 7-10 "B"', 'CLEAR 7']), (e) => e.code === 'AIR_HELD' && e.refused.length === 2)
	})

	it('/api/amcp/batch answers 409 with the refused lines; only the sent lines are recorded', async () => {
		const { ctx, ctxCas } = held(CONFIG)
		const r = await routesAmcp.handlePost('/api/amcp/batch', JSON.stringify({ commands: ['PLAY 5-10 "A"', 'PLAY 7-10 "B"'] }), ctx)
		assert.equal(r.status, 409)
		assert.equal(body(r).partial, true)
		assert.equal(body(r).sent, 1)
		assert.deepEqual(body(r).refused.map((x) => x.line), ['PLAY 7-10 "B"'])
		assert.deepEqual(ctxCas.lines(), ['PLAY 5-10 "A"'])
		assert.equal(playbackTracker.getOccupiedLayers(ctx, 7).size, 0)
	})
})

describe('WO-1029 B1 the report: only fresh evidence from the current master counts', () => {
	function rig(view) {
		let t = 1000
		const v = { epoch: 3, master: FP_M, master_id: 'M', is_master: false, ...view }
		const r = createFanoutReport({ master: () => v, fanout: () => null, peers: () => [], call: async () => ({ ok: true }), now: () => t })
		return { r, v, advance: (ms) => (t += ms) }
	}
	const data = (o = {}) => ({ epoch: 3, master: FP_M, channels: [7], connected: true, ...o })

	it('goes stale after about two polls → the channel unblocks (and the AMCP gate follows it)', async () => {
		const { r, advance } = rig()
		r.receive(data(), PEER_M)
		assert.equal(r.heldBy(7), 'srv-M')
		assert.equal(r.heldBy(1), '', 'not listed')
		amcpFanout.setClusterAirCheck((ch) => r.heldBy(ch))
		const cas = fakeCaspar()
		await assert.rejects(cas.amcp.raw('PLAY 7-10 "A"'), (e) => e.code === 'AIR_HELD')
		advance(STALE_MS + 1)
		assert.equal(r.heldBy(7), '')
		await cas.amcp.raw('PLAY 7-10 "A"')
		assert.deepEqual(cas.lines(), ['PLAY 7-10 "A"'])
	})

	it('a previous master / epoch, another server, a disconnected master: ignored', () => {
		const { r, v } = rig()
		r.receive(data({ epoch: 2 }), PEER_M)
		assert.equal(r.heldBy(7), '', 'older epoch')
		r.receive(data({ connected: false }), PEER_M)
		assert.equal(r.heldBy(7), '', 'its Caspar link is down')
		r.receive(data({ master: fingerprint(PEER_X.device_key) }), PEER_X)
		assert.equal(r.heldBy(7), '', 'not the master')
		assert.equal(r.receive(data(), PEER_X).status, 400, 'a server cannot speak for the master')
		r.receive(data(), PEER_M)
		assert.equal(r.heldBy(7), 'srv-M')
		v.epoch = 4 // a failover made a new claim: the old report no longer counts
		assert.equal(r.heldBy(7), '')
		v.epoch = 3
		v.is_master = true
		assert.equal(r.heldBy(7), '', 'the master itself never blocks')
	})

	it('master side: one report per ONLINE linked server, what its plan forwards there; nothing when not master', async () => {
		const calls = []
		const logs = []
		const view = { epoch: 5, master: 'f'.repeat(16), master_id: 'self', is_master: true }
		const st = { active: true, peers: { B: { connected: true, destinations: [{ pgm: [3, 9] }, { pgm: [1, 7] }] } } }
		const r = createFanoutReport({
			master: () => view,
			fanout: () => st,
			peers: () => [{ id: 'B', name: 'B', online: true }, { id: 'C', name: 'C', online: true }, { id: 'D', name: 'D', online: false }],
			call: async (id, action, args) => (calls.push([id, action, args.data]), id === 'C' ? { ok: false, status: 400, json: { error: 'unknown action "exchange.fanout"' } } : { ok: true }),
			log: (lvl, msg) => logs.push(`${lvl} ${msg}`),
		})
		assert.equal(r.publish(), 2)
		await tick()
		assert.deepEqual(calls, [
			['B', 'exchange.fanout', { epoch: 5, master: 'f'.repeat(16), channels: [7, 9], connected: true }],
			['C', 'exchange.fanout', { epoch: 5, master: 'f'.repeat(16), channels: [], connected: false }],
		])
		r.publish()
		await tick()
		assert.equal(logs.filter((l) => l.includes('→ C')).length, 1, 'an old build is logged once')
		view.is_master = false
		assert.equal(r.publish(), 0)
		view.is_master = true
		st.active = false
		assert.equal(r.publish(), 0, 'fan-out off (the pair is on, a sandbox)')
	})
})

describe('WO-1029 R1 the take-look relay follows the gate', () => {
	it('a held screen goes to the master; a screen the master does not drive is taken here', async () => {
		const { handleTakeLook } = require('../../src/api/routes-scene-take-look')
		const { ctx, report } = followerCtx()
		report({ epoch: 3, master: FP_M, channels: [7], connected: true })
		const seen = []
		const deps = {
			cluster: { isClusterFollower: () => true, callOf: () => ({ callMaster: async (a, args) => (seen.push(['master', args.mainIdx]), { ok: true, status: 200, json: { ok: true } }) }) },
			take: async (b) => (seen.push(['local', b.channel]), { status: 200, body: '{"ok":true}' }),
			resolveSceneById: (id) => ({ id, name: id, layers: [], mainScope: '0' }),
			withBorder: (s) => s,
		}
		await handleTakeLook({ sceneId: 's', mainIdx: 3 }, ctx, deps)
		await handleTakeLook({ sceneId: 's', mainIdx: 0 }, ctx, deps)
		assert.deepEqual(seen, [['master', 3], ['local', 1]])
	})
})

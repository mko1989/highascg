'use strict'

/**
 * WO-1029 plan 07 Wave B (C6a/b/c) — the sender: a press on a screen that is on another linked server is sent to its
 * owner(s) as a dest.* call (src/cluster/dest-route.js), and every converted route answers with the owner's result.
 * Fixture: highascg7579 with `cluster.channelsWhereCabled` on (screen 0 = ch 2/3 here; screens 2 and 3 cabled on
 * highascg5867 `p5867`; screen 1 cabled nowhere). The signed transport is a stub (`ctx._destCall`) recording each call;
 * the AMCP is a recorder — a relayed press must send NOTHING here.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { boxConfig, quiet, clone } = require('./lib/cwc-fixtures')
const { normalizeDeviceGraph } = require('../../src/config/device-graph')
const { normalizeScreenDestinations } = require('../../src/config/screen-destinations')
const { getChannelMap } = require('../../src/config/routing')
const dr = require('../../src/cluster/dest-route')

const D = { s0: 'dst_mw7t9epz_1', s1: 'dst_mw96s6pd_1', s2: 'dst_mw989wyz_1', s3: 'dst_mw9orj4o_1' }

function fakeAmcp(log) {
	const make = (path) =>
		new Proxy(() => {}, {
			get: (_t, k) => (k === 'then' ? undefined : make([...path, String(k)])),
			apply: (_t, _s, args) => {
				log.push(`${path.join('.')}(${args.join(',')})`)
				return Promise.resolve({ ok: true, data: [] })
			},
		})
	return make([])
}

const viewOf = (box) => {
	const c = boxConfig(box)
	return { graph: normalizeDeviceGraph(c.deviceGraph), screenDestinations: normalizeScreenDestinations(c.screenDestinations) }
}

/**
 * opts.peers: [{ id, online?, caps?, view? }] (default p5867 online with dest-actions); opts.answer(id, action, args)
 * → the call's result; opts.on: the flag; opts.master: this server is master; opts.box: '7579' | '5867'.
 */
function rig(opts = {}) {
	const box = opts.box || '7579'
	const cfg = clone(boxConfig(box))
	if (opts.on !== false) cfg.cluster = { channelsWhereCabled: true }
	const peers = (opts.peers || [{ id: box === '7579' ? 'p5867' : 'p7579' }]).map((p) => ({
		id: p.id,
		name: `srv-${p.id}`,
		online: p.online !== false,
		caps: p.caps || ['call-signed', 'dest-actions'],
		view: p.view || viewOf(box === '7579' ? '5867' : '7579'),
	}))
	const amcp = []
	const sent = []
	let n = 0
	const ctx = {
		config: cfg,
		amcp: fakeAmcp(amcp),
		log: () => {},
		_wsBroadcast: () => {},
		getState: () => ({ channelMap: getChannelMap(cfg) }),
		_cluster: { snapshot: () => ({ peers }), deviceView: async (id) => ({ status: 200, body: peers.find((p) => p.id === id).view }) },
		_clusterMaster: { view: () => (opts.master === false ? { is_master: false, master_id: opts.masterId || peers[0].id, epoch: 2 } : { is_master: true, epoch: 2 }) },
		_destCall: {
			nextSeq: () => ++n,
			call: async (id, action, args, o) => {
				sent.push({ id, action, args, opts: o })
				if (opts.answer) return opts.answer(id, action, args)
				return { ok: true, status: 200, json: { ok: true, on: id, action } }
			},
		},
	}
	return { ctx, amcp, sent, peers }
}

const json = (r) => JSON.parse(r.body)
const scenes = { L0: { id: 'L0', mainScope: 0, layers: [] }, L3: { id: 'L3', mainScope: 3, layers: [] } }
const lookDeps = (takes) => ({
	resolveSceneById: (id) => scenes[id] || null,
	airHeldBy: () => null,
	take: async (b) => (takes.push(b), { status: 200, body: JSON.stringify({ ok: true, channel: b.channel }) }),
	withBorder: (s) => s,
})

describe('WO-1029 Wave B routeFor / sendDest', () => {
	it('local / one owner / nobody; flag off → always local', async () => {
		const { ctx } = rig()
		assert.deepEqual(await dr.routeFor(ctx, { screenIdx: 0 }), { local: true, idx: 0, destId: D.s0, also: [] })
		const r3 = await dr.routeFor(ctx, { screenIdx: 3 })
		assert.deepEqual(r3.owners.map((o) => o.id), ['p5867'])
		assert.equal(r3.destId, D.s3)
		assert.equal((await dr.routeFor(ctx, { destId: D.s2 })).owners[0].id, 'p5867')
		assert.equal((await dr.routeFor(ctx, { screenIdx: 1 })).nobody, true)
		const off = rig({ on: false }).ctx
		assert.equal((await dr.routeFor(off, { screenIdx: 3 })).local, true)
	})

	it('two owners: both get the call (hot backup); one failing → 502 DEST_PARTIAL with both in `via`', async () => {
		await quiet(async () => {
			let { ctx, sent } = rig({ peers: [{ id: 'p5867' }, { id: 'pX' }] })
			let r = await dr.relayIfNotHere(ctx, { screenIdx: 3 }, 'dest.ftb', { body: {} })
			assert.equal(r.status, 200, r.body)
			assert.deepEqual(sent.map((s) => [s.id, s.action, s.args.destId]), [['p5867', 'dest.ftb', D.s3], ['pX', 'dest.ftb', D.s3]])
			assert.equal(sent[0].opts.seq, sent[1].opts.seq, 'one press, one seq')
			assert.deepEqual(json(r).via.map((v) => [v.id, v.ok]), [['p5867', true], ['pX', true]])
			;({ ctx, sent } = rig({ peers: [{ id: 'p5867' }, { id: 'pX' }], answer: (id) => (id === 'pX' ? { ok: false, status: 0, error: 'timeout' } : { ok: true, status: 200, json: { ok: true } }) }))
			r = await dr.relayIfNotHere(ctx, { screenIdx: 3 }, 'dest.ftb', { body: {} })
			assert.equal(r.status, 502)
			assert.equal(sent.length, 2)
			assert.equal(json(r).code, 'DEST_PARTIAL')
		})
	})

	it('owner answers an error → its status; nobody answers → 502; offline → 503; no capability → 409 NOT_HERE', async () => {
		await quiet(async () => {
			let { ctx } = rig({ answer: () => ({ ok: false, status: 404, json: { ok: false, error: 'look L3 not found in the stored project' } }) })
			let r = await dr.relayIfNotHere(ctx, { screenIdx: 3 }, 'dest.take', { sceneId: 'L3' })
			assert.equal(r.status, 404)
			assert.match(json(r).error, /srv-p5867.*not found/)
			;({ ctx } = rig({ answer: () => ({ ok: false, status: 0, error: 'timeout after 4000 ms' }) }))
			r = await dr.relayIfNotHere(ctx, { screenIdx: 3 }, 'dest.take', { sceneId: 'L3' })
			assert.deepEqual([r.status, json(r).code], [502, 'DEST_UNREACHABLE'])
			let sent
			let peers
			;({ ctx, sent, peers } = rig())
			await dr.routeFor(ctx, { screenIdx: 3 }) // its cables were learned while it was online
			peers[0].online = false
			r = await dr.relayIfNotHere(ctx, { screenIdx: 3 }, 'dest.take', { sceneId: 'L3' })
			assert.deepEqual([r.status, json(r).code, json(r).via[0].error], [503, 'DEST_UNREACHABLE', 'offline'])
			assert.equal(sent.length, 0)
			;({ ctx, sent } = rig({ peers: [{ id: 'p5867', caps: ['call-signed'] }] }))
			r = await dr.relayIfNotHere(ctx, { screenIdx: 3 }, 'dest.take', { sceneId: 'L3' })
			assert.deepEqual([r.status, json(r).code], [409, 'NOT_HERE'])
			assert.match(json(r).via[0].error, /older build/)
			assert.equal(sent.length, 0)
			;({ ctx, sent } = rig())
			r = await dr.relayIfNotHere(ctx, { screenIdx: 1 }, 'dest.take', { sceneId: 'L3' })
			assert.deepEqual([r.status, json(r).code, json(r).owners], [409, 'NOT_HERE', []], 'cabled nowhere')
			assert.equal(await dr.relayIfNotHere(ctx, { screenIdx: 0 }, 'dest.take', {}), null, 'here → null')
			assert.equal(sent.length, 0)
		})
	})

	it('inside a dest.* call nothing is relayed again (no loops)', async () => {
		await quiet(async () => {
			const { ctx, sent } = rig()
			const r = await dr.runAsRemote({ from: 'p5867' }, () => dr.relayIfNotHere(ctx, { screenIdx: 3 }, 'dest.ftb', {}))
			assert.equal(r.status, 409)
			assert.deepEqual(await dr.runAsRemote({ from: 'x' }, () => dr.relayAll(ctx, 'dest.ftb', {})), [])
			assert.equal(sent.length, 0)
		})
	})
})

describe('WO-1029 Wave B converted routes relay and answer with the owner\'s result', () => {
	const remoteOk = (r, sent, action, destId = D.s3) => {
		assert.equal(r.status, 200, r.body)
		assert.equal(json(r).via[0].id, 'p5867')
		assert.equal(sent.at(-1).action, action)
		assert.equal(sent.at(-1).args.destId, destId)
	}

	it('looks: take-look, preview-push, preview clear, preset (items on two servers), zone look', async () => {
		await quiet(async () => {
			const { ctx, amcp, sent } = rig()
			const takes = []
			const look = require('../../src/api/routes-scene-take-look')
			let r = await look.handleTakeLook({ sceneId: 'L3', forceCut: true }, ctx, lookDeps(takes))
			remoteOk(r, sent, 'dest.take')
			assert.deepEqual(sent.at(-1).args, { sceneId: 'L3', forceCut: true, bus: 'program', destId: D.s3, ttlMs: 4000 }, 'ttlMs: how long this sender waits')
			r = await look.handleTakeLook({ sceneId: 'L3', target: 'preview' }, ctx, lookDeps(takes))
			assert.equal(r.status, 200)
			assert.equal(sent.at(-1).args.bus, 'preview')
			assert.equal(takes.length, 0)
			const push = require('../../src/api/routes-scene-preview-push')
			r = await push.handlePreviewPush({ sceneId: 'L3' }, ctx, { resolveSceneById: (id) => scenes[id] })
			remoteOk(r, sent, 'dest.preview')
			assert.deepEqual(sent.at(-1).args.body, { sceneId: 'L3', mainIdx: 3 })
			r = await require('../../src/api/routes-scene-preview').handlePreviewLiveClear({ mainIndex: 2 }, ctx)
			remoteOk(r, sent, 'dest.clear', D.s2)
			const preset = require('../../src/api/routes-scene-look-preset')
			const project = { scenes: { lookPresets: [{ id: 'P', name: 'Two', items: [{ mainIdx: 0, sceneId: 'L0' }, { mainIdx: 3, sceneId: 'L3' }, { mainIdx: 2, empty: true }] }] } }
			r = await preset.handleLookPresetRecall({ id: 'P', target: 'program', forceCut: true }, ctx, {
				project: () => project,
				resolveSceneById: (id) => scenes[id],
				takeLook: (tb) => look.handleTakeLook(tb, ctx, lookDeps(takes)),
			})
			assert.equal(r.status, 200, r.body)
			assert.deepEqual(json(r).items.map((i) => [i.mainIdx, i.status]), [[0, 200], [3, 200], [2, 200]])
			assert.equal(takes.length, 1, 'screen 0 taken here')
			assert.equal(takes[0].channel, 2)
			assert.deepEqual(sent.slice(-2).map((s) => [s.action, s.args.destId]).sort(), [['dest.clear', D.s2], ['dest.take', D.s3]].sort())
			const zone = require('../../src/tracking/zone-actions')
			const z = await zone.runAction({ type: 'look', sceneId: 'L3', target: 'program' }, ctx, { takeLook: (b, c) => look.handleTakeLook(b, c, lookDeps(takes)) })
			assert.equal(z.ok, true, z.detail)
			assert.match(z.detail, /via srv-p5867/)
			assert.deepEqual(amcp, [], 'nothing sent to this Caspar for the remote screens')
		})
	})

	it('FTB / test card: one screen, and "all screens" = local + each owner (results per screen)', async () => {
		await quiet(async () => {
			let { ctx, amcp, sent } = rig()
			const ftb = require('../../src/api/routes-ftb')
			let r = await ftb.handlePost('/api/ftb', JSON.stringify({ screenIdx: 3, durationFrames: 0 }), ctx)
			remoteOk(r, sent, 'dest.ftb')
			assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1).args.body)), { durationFrames: 0 })
			assert.deepEqual(amcp, [])
			r = await ftb.handlePost('/api/ftb', JSON.stringify({ durationFrames: 0 }), ctx)
			assert.equal(r.status, 200, r.body)
			const b = json(r)
			assert.deepEqual(b.remote.map((x) => [x.screen, x.ok]), [[2, true], [3, true]])
			assert.deepEqual(b.notHere.map((x) => x.screen), [1], 'cabled nowhere: listed, not driven')
			assert.ok(amcp.length > 0, 'the local screen was blacked here')
			const ctl = require('../../src/api/routes-led-test-control')
			;({ ctx, amcp, sent } = rig())
			r = await ctl.handlePost('channel', { screenIdx: 2, enabled: true }, ctx)
			remoteOk(r, sent, 'dest.testcard', D.s2)
			assert.deepEqual(sent.at(-1).args, { on: true, destId: D.s2, ttlMs: 4000 })
			r = await require('../../src/api/routes-led-test-card').handlePost('/api/led-test-card', JSON.stringify({ screenIdx: 3, enabled: false }), ctx)
			remoteOk(r, sent, 'dest.testcard')
			assert.deepEqual(amcp, [])
			r = await ctl.handlePost('master', { enabled: true }, ctx)
			assert.deepEqual(json(r).remote.map((x) => x.screen), [2, 3], 'master pressed on the master: every server\'s screens')
			;({ ctx, sent } = rig({ master: false }))
			r = await ctl.handlePost('master', { enabled: false }, ctx)
			assert.equal(sent.length, 0, 'on a follower "master" stays this server\'s screens')
			assert.deepEqual(json(r).notHere.map((x) => x.screen), [1, 2, 3])
		})
	})

	it('media / layer tools / mixer nudge by screen', async () => {
		await quiet(async () => {
			const { ctx, amcp, sent } = rig()
			let r = await require('../../src/api/routes-scene-take').handleSceneTake(JSON.stringify({ screenIdx: 3, sceneId: 'X', takeGroup: { id: 'g', size: 2 } }), ctx)
			remoteOk(r, sent, 'dest.media')
			assert.equal(sent.at(-1).args.op, 'take')
			r = await require('../../src/api/routes-scene-take-audio-only').handleAudioOnlyLookStop(JSON.stringify({ screenIdx: 2 }), ctx)
			remoteOk(r, sent, 'dest.media', D.s2)
			const L = { id: 'L3', mainScope: 3, layers: [{ layerNumber: 10, source: { type: 'file', value: 'CLIP' } }] }
			r = await require('../../src/api/routes-scene-layer-tools').handleLayerReload({ sceneId: 'L3', layerNumber: 10 }, ctx, { resolveScene: () => L })
			remoteOk(r, sent, 'dest.layer')
			assert.equal(sent.at(-1).args.op, 'layer-reload')
			r = await require('../../src/api/routes-scene-layer-scrub').handleLayerScrub({ sceneId: 'L3', layerNumber: 10, ms: 100 }, ctx, { resolveScene: () => L, resolveSceneById: () => L })
			if (r.status === 200 && json(r).via) assert.equal(sent.at(-1).args.op, 'layer-scrub')
			r = await require('../../src/api/routes-preview-nudge').handlePreviewMixerNudge(JSON.stringify({ mainIndex: 3, sceneId: 'L3', layers: [{}] }), ctx)
			remoteOk(r, sent, 'dest.mixer')
			assert.deepEqual(amcp, [])
		})
	})

	it('timeline: one remote screen → its owner; every screen → here + one call per owner; transport follows', async () => {
		await quiet(async () => {
			const { ctx, sent } = rig()
			const played = []
			let sendTo = { program: true, screenIdx: 3 }
			ctx.timelineEngine = {
				get: () => ({ id: 't1' }),
				_sendToFor: () => sendTo,
				_channelsFor: () => [],
				setSendTo: (st) => (sendTo = st),
				play: (id) => played.push(['play', id]),
				pause: (id) => played.push(['pause', id]),
				getPlayback: () => null,
				stop: () => {},
			}
			const tl = require('../../src/api/routes-timeline')
			let r = await tl.handle('POST', '/api/timelines/t1/play', '{}', ctx)
			remoteOk(r, sent, 'dest.timeline')
			assert.deepEqual([sent.at(-1).args.op, sent.at(-1).args.timelineId], ['play', 't1'])
			assert.deepEqual(played, [], 'not played here')
			r = await tl.handle('POST', '/api/timelines/t1/play', JSON.stringify({ sendTo: { program: true, screenIdx: null } }), ctx)
			assert.equal(r.status, 200, r.body)
			assert.deepEqual(played, [['play', 't1']])
			assert.deepEqual(json(r).remote.map((x) => [x.server, x.ok]), [['p5867', true]], 'one call per owner, not per screen')
			assert.equal(sent.at(-1).args.all, true)
			r = await tl.handle('POST', '/api/timelines/t1/pause', '{}', ctx)
			assert.equal(r.status, 200)
			assert.equal(sent.at(-1).args.op, 'pause')
		})
	})

	it('flag off: nothing is relayed, every route behaves as before', async () => {
		await quiet(async () => {
			const { ctx, amcp, sent } = rig({ on: false })
			const r = await require('../../src/api/routes-ftb').handlePost('/api/ftb', JSON.stringify({ screenIdx: 3, durationFrames: 0 }), ctx)
			assert.equal(r.status, 200, r.body)
			assert.ok(amcp.length > 0)
			const takes = []
			await require('../../src/api/routes-scene-take-look').handleTakeLook({ sceneId: 'L3' }, ctx, lookDeps(takes))
			assert.equal(takes.length, 1)
			assert.equal(sent.length, 0)
		})
	})
})

describe('WO-1029 Wave B hot backup (a screen cabled here AND elsewhere)', () => {
	// box 5867's screen 2 and 3 are its own; the peer view below cables screen 3 too → backup
	const both = () => {
		const v = viewOf('5867')
		return v
	}

	it('master: runs here AND sends the same call to the other owner; `via` in the answer', async () => {
		await quiet(async () => {
			const { ctx, amcp, sent } = rig({ box: '5867', peers: [{ id: 'p7579', view: both() }] })
			const r = await require('../../src/api/routes-ftb').handlePost('/api/ftb', JSON.stringify({ screenIdx: 3, durationFrames: 0 }), ctx)
			assert.equal(r.status, 200, r.body)
			assert.ok(amcp.length > 0, 'blacked here')
			assert.deepEqual(sent.map((s) => [s.id, s.action, s.args.destId]), [['p7579', 'dest.ftb', D.s3]])
			assert.equal(json(r).via[0].ok, true)
			const takes = []
			const t = await require('../../src/api/routes-scene-take-look').handleTakeLook({ sceneId: 'L3' }, ctx, lookDeps(takes))
			assert.equal(takes.length, 1)
			assert.equal(sent.at(-1).action, 'dest.take')
			assert.equal(json(t).via[0].id, 'p7579')
		})
	})

	it('follower whose master owns it too: the press goes to the master (fanout); no answer in 1 s → here, diverged', async () => {
		await quiet(async () => {
			let { ctx, amcp, sent } = rig({ box: '5867', master: false, masterId: 'p7579', peers: [{ id: 'p7579', view: both() }] })
			let r = await require('../../src/api/routes-ftb').handlePost('/api/ftb', JSON.stringify({ screenIdx: 3, durationFrames: 0 }), ctx)
			assert.equal(r.status, 200, r.body)
			assert.deepEqual([sent[0].action, sent[0].args.fanout, sent[0].opts.timeoutMs], ['dest.ftb', true, dr.BACKUP_MS])
			assert.deepEqual(amcp, [], 'the master drives it (this box included)')
			;({ ctx, amcp, sent } = rig({ box: '5867', master: false, masterId: 'p7579', peers: [{ id: 'p7579', view: both() }], answer: () => ({ ok: false, status: 0, error: 'timeout' }) }))
			r = await require('../../src/api/routes-ftb').handlePost('/api/ftb', JSON.stringify({ screenIdx: 3, durationFrames: 0 }), ctx)
			assert.equal(r.status, 200, r.body)
			assert.equal(json(r).diverged, true)
			assert.equal(sent.length, 1, 'asked the master once')
			assert.ok(amcp.length > 0, 'run here')
			const takes = []
			const t = await require('../../src/api/routes-scene-take-look').handleTakeLook({ sceneId: 'L3' }, ctx, lookDeps(takes))
			assert.equal(takes.length, 1)
			assert.equal(json(t).diverged, true)
		})
	})
})

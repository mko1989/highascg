'use strict'

/**
 * WO-1106 C19 — one press lands once on a hot-backup screen (src/cluster/press-once.js).
 *
 * Follower F (highascg5867) presses FTB on screen 4, cabled on F AND on the master M: F hands the press to M (`fanout`)
 * and waits 1 s; M takes it and forwards the same press to every other owner, F included. When M answered later than
 * F's wait, F ran the press itself AND M's forwarded copy: two takes on F's screen. Each press now carries a pressId;
 * on F the first of { local fallback, M's copy } runs it, the other does not; M does not forward it back to F once F
 * said it ran it (`dest.ran`), and drops that take's AMCP lines to F's Caspar (cluster-fanout.js).
 * Fixture: tools/smoke/lib/cwc-fixtures.js (the two real boxes' configs); the signed transport is a stub.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { boxConfig, quiet, clone } = require('./lib/cwc-fixtures')
const { normalizeDeviceGraph } = require('../../src/config/device-graph')
const { normalizeScreenDestinations } = require('../../src/config/screen-destinations')
const { getChannelMap } = require('../../src/config/routing')
const { createDestActions } = require('../../src/cluster/dest-actions')
const dr = require('../../src/cluster/dest-route')
const once = require('../../src/cluster/press-once')
const { createClusterFanout } = require('../../src/cluster/cluster-fanout')

const S3 = 'dst_mw9orj4o_1' // screen 4: on 5867 (ch 4/5) — and, in this fixture, on the master too

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

/** One server on box 5867 with the screen also cabled on peer `other` (its view = this box's own cabling). */
function server({ master, other, answer }) {
	const cfg = clone(boxConfig('5867'))
	cfg.cluster = { channelsWhereCabled: true }
	const peers = [{ id: other, name: `srv-${other}`, online: true, caps: ['call-signed', 'dest-actions'], view: viewOf('5867') }]
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
		_clusterMaster: { view: () => (master ? { is_master: true, epoch: 2 } : { is_master: false, master_id: other, epoch: 2 }) },
		_destCall: {
			nextSeq: () => ++n,
			call: async (id, action, args, o) => {
				sent.push({ id, action, args, opts: o })
				if (answer) return answer(id, action, args)
				return { ok: true, status: 200, json: { ok: true, on: id, action } }
			},
		},
	}
	ctx._destActions = createDestActions(ctx)
	return { ctx, amcp, sent }
}

const press = (ctx) => require('../../src/api/routes-ftb').handlePost('/api/ftb', JSON.stringify({ screenIdx: 3, durationFrames: 0 }), ctx)
/** M's forwarded copy arriving at F (a signed dest.ftb from the master `p7579`). */
const forwarded = (ctx, pressId) => ctx._destActions.actions['dest.ftb']({ destId: S3, body: { durationFrames: 0 }, ...(pressId ? { pressId } : {}) }, { id: 'p7579', name: 'srv-p7579' }, {})
const TIMEOUT = { ok: false, status: 0, error: 'timeout' }

/** AMCP lines of ONE FTB of screen 4 on this box (the unit the cases count in). */
async function oneFtb() {
	const s = server({ master: false, other: 'p7579', answer: () => TIMEOUT })
	await quiet(() => press(s.ctx))
	assert.ok(s.amcp.length > 0)
	return s.amcp.length
}

describe('WO-1106 C19 follower: the press lands once', () => {
	it('master slower than the 1 s wait, its copy arrives AFTER the local fallback: one take here, the copy is a duplicate', async () => {
		const unit = await oneFtb()
		await quiet(async () => {
			const f = server({ master: false, other: 'p7579', answer: (id, action) => (action === 'dest.ftb' ? TIMEOUT : { ok: true, status: 200, json: { ok: true } }) })
			const r = await press(f.ctx)
			assert.equal(JSON.parse(r.body).diverged, true, 'taken here')
			const pressId = f.sent[0].args.pressId
			const copy = await forwarded(f.ctx, pressId)
			assert.equal(f.amcp.length, unit, 'exactly one FTB on this screen (was two: the fallback and the copy)')
			assert.equal(copy.status, 200)
			assert.equal(copy.body?.duplicate, true, 'the master hears it ran here already')
			await new Promise((r2) => setImmediate(r2))
			assert.deepEqual(f.sent.map((s) => s.action), ['dest.ftb', 'dest.ran'], 'the master is told it ran here')
			assert.equal(f.sent[1].args.pressId, pressId)
		})
	})

	it('master slower than the wait, its copy arrives DURING the wait: the copy runs, the fallback does not', async () => {
		const unit = await oneFtb()
		await quiet(async () => {
			let copy = null
			const f = server({
				master: false,
				other: 'p7579',
				answer: async (id, action, args) => {
					if (action !== 'dest.ftb') return { ok: true, status: 200, json: { ok: true } }
					copy = await forwarded(f.ctx, args.pressId) // the master's forward lands while this box still waits
					return TIMEOUT
				},
			})
			const r = await press(f.ctx)
			assert.equal(r.status, 200)
			assert.notEqual(JSON.parse(r.body).diverged, true, 'not diverged: the master did drive it')
			assert.equal(copy.status, 200)
			assert.notEqual(copy.body?.duplicate, true)
			assert.equal(f.amcp.length, unit, 'exactly one FTB on this screen')
			assert.ok(!f.sent.some((s) => s.action === 'dest.ran'), 'it did not run here on its own')
		})
	})

	it('fast path: the master answers in time, its copy runs here once', async () => {
		const unit = await oneFtb()
		await quiet(async () => {
			const f = server({ master: false, other: 'p7579' })
			const r = await press(f.ctx)
			assert.equal(r.status, 200)
			assert.equal(f.amcp.length, 0, 'the master drives it')
			await forwarded(f.ctx, f.sent[0].args.pressId)
			assert.equal(f.amcp.length, unit, 'exactly one FTB on this screen')
			const again = await forwarded(f.ctx, f.sent[0].args.pressId)
			assert.equal(again.body?.duplicate, true, 'a resent copy does not run twice')
			assert.equal(f.amcp.length, unit)
		})
	})

	it('a press without a pressId (an older master) runs as before', async () => {
		await quiet(async () => {
			const f = server({ master: false, other: 'p7579' })
			await forwarded(f.ctx, null)
			const n = f.amcp.length
			await forwarded(f.ctx, null)
			assert.equal(f.amcp.length, 2 * n)
		})
	})
})

describe('WO-1106 C19 master', () => {
	it('forwards the handed press with its pressId; not back to the origin once it said it ran the press', async () => {
		await quiet(async () => {
			const m = server({ master: true, other: 'p7579' })
			const run = (pressId) => m.ctx._destActions.actions['dest.ftb']({ destId: S3, body: { durationFrames: 0 }, fanout: true, pressId }, { id: 'p7579', name: 'srv-p7579' }, {})
			const a = once.newPressId()
			assert.equal((await run(a)).status, 200)
			assert.deepEqual(m.sent.map((s) => [s.id, s.action, s.args.pressId]), [['p7579', 'dest.ftb', a]], 'forwarded to the origin with its pressId')
			const b = once.newPressId()
			assert.deepEqual(await once.info(m.ctx)['dest.ran']({ pressId: b }, { id: 'p7579' }), { status: 200, body: { ok: true } })
			m.sent.length = 0
			const n = m.amcp.length
			assert.equal((await run(b)).status, 200)
			assert.deepEqual(m.sent, [], 'not forwarded back to the server that already took it')
			assert.ok(m.amcp.length > n, 'still taken on the master')
			assert.equal((await once.info(m.ctx)['dest.ran']({}, { id: 'p7579' })).status, 400)
		})
	})

	it('AMCP fan-out (channels-where-cabled off): the take of a press its origin already ran skips that server only', async () => {
		const own = {
			screenDestinations: { destinations: [{ id: 'dst_led', mode: 'pgm_prv', mainScreenIndex: 0 }] },
			live: { caspar: { channelMap: { programChannels: [1], previewChannels: [2] } } },
			graph: { connectors: [{ id: 'm_led', kind: 'destination_in', externalRef: 'dst_led' }], edges: [{ sourceId: 'm_led', sinkId: 'gpu' }] },
		}
		const peer = {
			graph: { connectors: [{ id: 'c_led', kind: 'destination_in', externalRef: 'dst_led' }], edges: [{ id: 'e0', sourceId: 'c_led', sinkId: 'gpu_0' }] },
			screenDestinations: { destinations: [{ id: 'dst_led', mode: 'pgm_prv', mainScreenIndex: 0 }] },
			live: { caspar: { host: '127.0.0.1', port: 5260, channelMap: { programChannels: [1], previewChannels: [2] } } },
		}
		const ctx = {}
		const conns = {}
		const f = createClusterFanout({
			isMaster: () => true,
			pairEnabled: () => false,
			members: () => [{ id: 'b', host: '10.0.0.2', name: 'B', online: true }, { id: 'c', host: '10.0.0.3', name: 'C', online: true }],
			peerView: async () => peer,
			ownView: async () => own,
			connect: (host) => (conns[host] = { isConnected: true, lines: [], batches: [], enqueueSend(l) { this.lines.push(l) }, enqueueBatchLines(b) { this.batches.push(b) }, stop() {} }),
			suppressed: () => once.suppressedTarget(ctx),
		})
		await f.refresh()
		const pressId = once.newPressId()
		await dr.runAsRemote({ from: 'b', fanout: true, pressId }, async () => f.send('PLAY 1-10 "A"'))
		assert.deepEqual([conns['10.0.0.2'].lines, conns['10.0.0.3'].lines], [['PLAY 1-10 "A"'], ['PLAY 1-10 "A"']], 'origin not done yet: both')
		once.noteRanAtOrigin(ctx, pressId, 'b')
		await dr.runAsRemote({ from: 'b', fanout: true, pressId }, async () => f.send('PLAY 1-10 "B"'))
		assert.deepEqual([conns['10.0.0.2'].lines, conns['10.0.0.3'].lines], [['PLAY 1-10 "A"'], ['PLAY 1-10 "A"', 'PLAY 1-10 "B"']], 'b ran it itself: c only')
		f.send('PLAY 1-10 "C"')
		assert.deepEqual(conns['10.0.0.2'].lines.at(-1), 'PLAY 1-10 "C"', 'outside that press: b again')
	})

	it('the ledger is bounded by count (no clock window)', () => {
		const ctx = {}
		const first = once.newPressId()
		assert.equal(once.claimHere(ctx, first), null)
		for (let i = 0; i < once.MAX + 5; i++) once.claimHere(ctx, once.newPressId())
		assert.equal(ctx._pressOnce.claims.size, once.MAX)
		assert.equal(ctx._pressOnce.claims.has(first), false, 'the oldest goes first')
		assert.equal(once.validId('../x'), '')
	})
})

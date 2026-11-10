'use strict'

/**
 * WO-1029 phase 2a — destination ownership (work/work-orders/1029_WO_linked_servers_review_and_link_kinds.md, "Found in
 * this run" 1 and 2). Seen live 10.11 on the two boxes:
 *   1. with the other box as master, this box's own LED wall (cabled only here) answered 409 AIR_HELD (the master
 *      forwards to it) → an OWN screen is driven here whatever the role; only a BACKUP screen (cabled on the master
 *      too: the report's `mirror`) is held, and its look take goes to the master (1 s, else here + `diverged`);
 *   2. after a takeover the new master replayed its own copy channel onto the other box's LED wall → the master keeps a
 *      holder per own screen (empty at promotion, `self` on its operator's press, the owner on its notice) and catches
 *      an own screen up only while it holds it, from what it sent since.
 * Plus rule 4 (a remote screen's look take → the master, else an owner, else 409) and rule 5 (anything else on a
 * remote screen → 409 REMOTE_SCREEN). No port is opened: fake Caspar sockets, stub signed calls.
 */

const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const amcpFanout = require('../../src/replication/amcp-fanout')
const { AmcpClient } = require('../../src/caspar/amcp-client')
const { createFanoutReport } = require('../../src/cluster/cluster-fanout-report')
const { createClusterFanout } = require('../../src/cluster/cluster-fanout')
const { createOwnership } = require('../../src/cluster/destination-ownership')
const { relayLook } = require('../../src/cluster/look-relay')
const { createCallActions } = require('../../src/cluster/cluster-call-actions')
const { fingerprint } = require('../../src/cluster/cluster-media')
const routesCluster = require('../../src/api/routes-cluster')
const routesAmcp = require('../../src/api/routes-amcp')
const ledControl = require('../../src/api/routes-led-test-control')
const routesFtb = require('../../src/api/routes-ftb')
const { handleSceneTake } = require('../../src/api/routes-scene-take')
const { handleTakeLook } = require('../../src/api/routes-scene-take-look')
const { runAction, parseAction } = require('../../src/tracking/zone-actions')

const KEY_M = 'device-key-of-srv-M'
const FP_M = fingerprint(KEY_M)
const PEER_M = { id: 'M', name: 'srv-M', device_key: KEY_M }
const body = (r) => JSON.parse(r.body)
const tick = () => new Promise((r) => setImmediate(r))
const cable = (ids) => ({
	connectors: ids.map((id) => ({ id: `c_${id}`, kind: 'destination_in', externalRef: id })),
	edges: ids.map((id) => ({ sourceId: `c_${id}`, sinkId: 'gpu' })),
})

/**
 * Follower F: screens a (PGM 1) own, b (PGM 3) remote (cabled on M only), c (PGM 5) nobody's, d (PGM 7) backup
 * (cabled here and on M). The REAL routes-cluster wiring (report → ownership → the AMCP check) on a fake Caspar.
 */
function follower() {
	const dests = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, label: `Screen ${id}`, mode: 'pgm_prv', mainScreenIndex: i }))
	const config = { screen_count: 4, screenDestinations: { version: 1, destinations: dests }, deviceGraph: cable(['a', 'd']) }
	const sent = []
	const conn = { config, response_callback: {}, _amcpSendQueue: Promise.resolve(), _amcpBatchDrain: null, log() {},
		socket: { isConnected: true, send: (p) => (sent.push(p), setImmediate(() => answer(p))) } }
	function answer(p) {
		if (p.startsWith('BEGIN\r\n')) {
			for (const l of p.split('\r\n').filter((x) => x && x !== 'BEGIN' && x !== 'COMMIT')) conn._amcpBatchDrain?.onLine(`202 ${l.split(' ')[0]} OK`)
			return conn._amcpBatchDrain?.onLine('202 COMMIT OK')
		}
		const key = p.trim().split(/\s+/)[0].toUpperCase()
		conn.response_callback[key]?.shift()?.(null, `202 ${key} OK`)
	}
	const calls = []
	const peers = [{ id: 'M', name: 'srv-M', online: true }]
	const ctx = {
		config,
		log() {},
		amcp: new AmcpClient(conn),
		getState: () => ({ channelMap: require('../../src/config/routing').getChannelMap(config) }),
		_clusterMaster: { view: () => ({ epoch: 3, master: FP_M, master_id: 'M', is_master: false, auto: true, succession: [] }) },
		_cluster: { snapshot: () => ({ self: { id: 'F' }, peers }), saved: () => null, list: () => [],
			deviceView: async () => ({ status: 200, body: { graph: cable(['b', 'd']) } }) },
		_clusterCall: { call: async (id, action, args) => (calls.push([id, action, args]), { ok: true, status: 200, json: { ok: true } }) },
	}
	routesCluster.fanoutOf(ctx)
	const lines = () => sent.flatMap((p) => p.split('\r\n')).filter((l) => l && l !== 'BEGIN' && l !== 'COMMIT')
	const report = (data) => ctx._clusterReport.receive({ epoch: 3, master: FP_M, connected: true, ...data }, PEER_M)
	return { ctx, lines, calls, report, ready: () => routesCluster.ownershipOf(ctx).refresh() }
}

afterEach(() => {
	amcpFanout.setClusterAirCheck(null)
	amcpFanout.setClusterLocalPress(null)
})

describe('WO-1029 2a rule 1: an OWN screen is driven here while the master forwards to it', () => {
	it('test card, raw PLAY, a take and FTB on screen a (forwarded, not mirrored) run locally; the master hears it once', async () => {
		const f = follower()
		await f.ready()
		assert.equal(f.report({ channels: [1, 7], mirror: [7] }).status, 200)
		assert.equal(amcpFanout.airHeldBy(f.ctx, 1), null, 'before: listed = held (409 on the LED wall)')
		const card = await ledControl.handlePost('channel', { channel: 1, enabled: true }, f.ctx)
		assert.equal(card.status, 200, card.body)
		assert.ok(f.lines().some((l) => /^CG 1-999 ADD/.test(l)))
		await ledControl.handlePost('channel', { channel: 1, enabled: false }, f.ctx)
		assert.equal((await routesAmcp.handlePost('/api/amcp/raw', JSON.stringify({ cmd: 'PLAY 1-11 "X"' }), f.ctx)).status, 200)
		const take = await handleSceneTake(JSON.stringify({ channel: 1, forceCut: true, incomingScene: { id: 'L1', name: 'L1', layers: [{ layerNumber: 10, source: { type: 'media', value: 'AMB' } }] } }), f.ctx)
		assert.equal(take.status, 200, take.body)
		const ftb = await routesFtb.handlePost('/api/ftb', JSON.stringify({ screenIdx: 0, durationFrames: 0 }), f.ctx)
		assert.equal(ftb.status, 200, ftb.body)
		assert.ok(f.lines().some((l) => /^PLAY 1-11 "X"/.test(l)))
		await tick()
		assert.deepEqual(f.calls.map((c) => [c[0], c[1], c[2].destId]), [['M', 'dest.pressed', 'a']], 'debounced: one notice for the burst')
		assert.ok(f.calls[0][2].seq > 0)
	})

	it('a BACKUP screen (mirror) is still held: 409 AIR_HELD; an old-build master (no `mirror`) holds nothing', async () => {
		const f = follower()
		await f.ready()
		f.report({ channels: [1, 7], mirror: [7] })
		const r = await routesAmcp.handlePost('/api/play', JSON.stringify({ channel: 7, layer: 10, clip: 'AMB' }), f.ctx)
		assert.equal(r.status, 409)
		assert.equal(body(r).code, 'AIR_HELD')
		f.report({ channels: [1, 7] }) // the previous build's report
		assert.equal((await routesAmcp.handlePost('/api/play', JSON.stringify({ channel: 7, layer: 10, clip: 'AMB' }), f.ctx)).status, 200)
		assert.deepEqual(f.calls.map((c) => c[2].destId), ['d'], 'with no `mirror` d is driven here like an own screen (the master hears it)')
	})
})

describe('WO-1029 2a rule 5: a REMOTE screen on a non-master → 409 REMOTE_SCREEN', () => {
	it('PLAY, test card, FTB on screen b (cabled on srv-M only) are refused; its PRV and a screen nobody owns are not', async () => {
		const f = follower()
		await f.ready()
		const r = await routesAmcp.handlePost('/api/play', JSON.stringify({ channel: 3, layer: 10, clip: 'AMB' }), f.ctx)
		assert.equal(r.status, 409)
		assert.deepEqual(body(r), { error: 'Screen 2 is on srv-M: drive it there or from the master', code: 'REMOTE_SCREEN', drivenBy: 'srv-M', channel: 3, owners: ['M'] })
		assert.equal((await ledControl.handlePost('channel', { channel: 3, enabled: true }, f.ctx)).status, 409)
		const ftb = await routesFtb.handlePost('/api/ftb', JSON.stringify({ screenIdx: 1, durationFrames: 0 }), f.ctx)
		assert.equal(body(ftb).code, 'REMOTE_SCREEN')
		assert.ok(f.lines().every((l) => !/^\S+ 3[ -]/.test(l)), 'nothing went to the copy channel')
		assert.equal((await routesAmcp.handlePost('/api/play', JSON.stringify({ channel: 4, layer: 10, clip: 'A' }), f.ctx)).status, 200, 'PRV')
		assert.equal((await routesAmcp.handlePost('/api/play', JSON.stringify({ channel: 5, layer: 10, clip: 'A' }), f.ctx)).status, 200, 'no owner known')
	})

	it('unknown owners (no device view yet) refuse nothing; the master itself is never refused', async () => {
		const f = follower()
		assert.equal(amcpFanout.airHeldBy(f.ctx, 3), null, 'not refreshed: nothing known')
		await f.ready()
		assert.equal(amcpFanout.airHeldBy(f.ctx, 3).code, 'REMOTE_SCREEN')
		f.ctx._clusterMaster = { view: () => ({ epoch: 3, master: 'x', master_id: 'self', is_master: true }) }
		assert.equal(amcpFanout.airHeldBy(f.ctx, 3), null)
	})
})

describe('WO-1029 2a rule 6: GET /api/cluster `destinations`', () => {
	it('own / remote / local / backup, owners and the master-reported holder', async () => {
		const f = follower()
		await f.ready()
		f.report({ channels: [1, 7], mirror: [7], holders: { 1: 'M' } })
		const v = routesCluster.ownershipOf(f.ctx).destinations()
		assert.deepEqual(v, [
			{ id: 'a', label: 'Screen a', main: 0, owners: ['F'], here: true, kind: 'own', holder: 'M' },
			{ id: 'b', label: 'Screen b', main: 1, owners: ['M'], here: false, kind: 'remote', holder: '' },
			{ id: 'c', label: 'Screen c', main: 2, owners: [], here: false, kind: 'local', holder: '' },
			{ id: 'd', label: 'Screen d', main: 3, owners: ['F', 'M'], here: true, kind: 'backup', holder: '' },
		])
	})
})

describe('WO-1029 2a the owner\'s press notice', () => {
	function rig(answer) {
		let t = 10000
		const calls = []
		const logs = []
		const report = { heldBy: () => '', forwardedBy: (ch) => (ch === 1 ? { id: 'M', name: 'srv-M' } : null), holderOf: () => '', view: () => null }
		const o = createOwnership({
			selfId: () => 'F',
			ownView: () => ({ graph: cable(['a']), screenDestinations: { destinations: [{ id: 'a', mainScreenIndex: 0 }] }, live: { caspar: { channelMap: { programChannels: [1], previewChannels: [2] } } } }),
			peers: () => [{ id: 'M', name: 'srv-M', online: true }],
			peerView: async () => null,
			master: () => ({ is_master: false, master_id: 'M', epoch: 3 }),
			report,
			call: async (...a) => (calls.push(a), answer),
			now: () => t,
			log: (lvl, msg) => logs.push(msg),
		})
		return { o, calls, logs, advance: (ms) => (t += ms) }
	}

	it('debounced per screen; PRV counts; a screen the master does not forward is not noticed', async () => {
		const r = rig({ ok: true, status: 200 })
		r.o.localPress(1)
		r.o.localPress(2)
		r.advance(1001)
		r.o.localPress(2)
		r.o.localPress(9)
		await tick()
		assert.equal(r.calls.length, 2)
		assert.ok(r.calls[1][2].seq > r.calls[0][2].seq)
	})

	it('an old-build master answers "unknown action": logged once, not asked again (no error loop)', async () => {
		const r = rig({ ok: false, status: 400, json: { error: 'unknown action "dest.pressed"' } })
		for (let i = 0; i < 5; i++) {
			r.o.localPress(1)
			await tick()
			r.advance(5000)
		}
		assert.equal(r.calls.length, 1)
		assert.equal(r.logs.filter((l) => /older build/.test(l)).length, 1)
	})
})

describe('WO-1029 2a rule 3: holders and catch-up on the master', () => {
	// master A cables dst_side only; peer B cables both: dst_led is B's OWN screen, dst_side a BACKUP
	const own = {
		graph: cable(['dst_side']),
		screenDestinations: { destinations: [{ id: 'dst_led', mode: 'pgm_prv', mainScreenIndex: 0 }, { id: 'dst_side', mode: 'pgm_prv', mainScreenIndex: 1 }] },
		live: { caspar: { channelMap: { programChannels: [1, 3], previewChannels: [2, 4] } } },
	}
	const peer = { ...own, graph: cable(['dst_led', 'dst_side']), live: { caspar: { port: 5260, channelMap: { programChannels: [11, 13], previewChannels: [12, 14] } } } }
	function rig() {
		const st = { master: false }
		const conns = []
		const f = createClusterFanout({
			isMaster: () => st.master,
			pairEnabled: () => false,
			members: () => [{ id: 'b', host: '10.0.0.2', name: 'B', online: true }],
			peerView: async () => peer,
			ownView: async () => own,
			selfId: () => 'A',
			connect: (host, port, onConnected) => {
				const c = { isConnected: true, out: [], onConnected, stop() {}, enqueueSend(l) { this.out.push([l]) }, enqueueBatchLines(b) { this.out.push(b) } }
				conns.push(c)
				return c
			},
		})
		const reconnect = () => {
			const c = conns.at(-1)
			c.out = []
			c.onConnected()
			return c.out.flat()
		}
		return { f, st, conns, reconnect }
	}

	it('a promotion writes nothing to the peer\'s own screen (only the backup is caught up)', async () => {
		const r = rig()
		r.f.send('PLAY 1-99 "PROBE"') // this server's copy of B's LED, before it was master
		r.f.send('PLAY 3-10 "SIDE"')
		r.st.master = true
		await r.f.refresh()
		assert.deepEqual(r.conns[0].out.flat(), ['PLAY 13-10 "SIDE"'], 'the backup is caught up; B\'s LED untouched')
		assert.deepEqual(r.reconnect(), ['PLAY 13-10 "SIDE"'], 'and again after a reconnect')
		const st = r.f.status().peers.b.destinations
		assert.deepEqual(st.map((d) => [d.id, d.backup, d.holder]), [['dst_led', false, ''], ['dst_side', true, undefined]])
	})

	it('the master\'s press: forwarded, holder self; a reconnect replays only what it sent since', async () => {
		const r = rig()
		r.f.send('PLAY 1-99 "PROBE"')
		r.st.master = true
		await r.f.refresh()
		r.f.send('PLAY 1-10 "LOOK"')
		assert.deepEqual(r.conns[0].out.at(-1), ['PLAY 11-10 "LOOK"'], 'last press wins: the master drives every screen')
		assert.equal(r.f.holder('dst_led'), 'A')
		assert.deepEqual(r.reconnect(), ['PLAY 11-10 "LOOK"'], 'never the pre-mastership probe (PLAY 1-99)')
	})

	it('the owner\'s notice: holder = owner, journal dropped, no catch-up; the master\'s next press takes it back', async () => {
		const r = rig()
		r.st.master = true
		await r.f.refresh()
		r.f.send('PLAY 1-10 "LOOK"')
		assert.deepEqual(r.f.ownerPressed('b', 'dst_led', 5), { status: 200, body: { ok: true, holder: 'b' } })
		assert.equal(r.f.ownerPressed('b', 'dst_led', 4).body.holder, 'b', 'an older notice changes nothing')
		assert.deepEqual(r.reconnect(), [], 'never after the owner pressed locally')
		r.f.send('PLAY 1-20 "NEXT"')
		assert.equal(r.f.holder('dst_led'), 'A')
		assert.deepEqual(r.reconnect(), ['PLAY 11-20 "NEXT"'], 'the dropped journal stays dropped')
		assert.equal(r.f.ownerPressed('b', 'dst_side', 6).status, 409, 'a backup screen follows the master')
		assert.equal(r.f.ownerPressed('x', 'dst_led', 6).status, 409, 'not forwarded to that server')
	})

	it('stepping down and up again: the holder map starts empty', async () => {
		const r = rig()
		r.st.master = true
		await r.f.refresh()
		r.f.send('PLAY 1-10 "LOOK"')
		r.st.master = false
		await r.f.refresh()
		r.st.master = true
		await r.f.refresh()
		assert.equal(r.f.holder('dst_led'), '')
		assert.deepEqual(r.reconnect(), [])
	})

	it('the report carries `mirror` and `holders`', async () => {
		const r = rig()
		r.st.master = true
		await r.f.refresh()
		r.f.send('PLAY 1-10 "LOOK"')
		const sent = []
		const rep = createFanoutReport({ master: () => ({ is_master: true, epoch: 2, master: 'fp' }), fanout: () => r.f.status(),
			peers: () => [{ id: 'b', online: true }], call: async (id, a, args) => (sent.push(args.data), { ok: true }) })
		rep.publish()
		assert.deepEqual(sent, [{ epoch: 2, master: 'fp', channels: [11, 13], connected: true, mirror: [13], holders: { 11: 'A' } }])
	})
})

describe('WO-1029 2a rule 4: where a look take pressed on a non-master goes', () => {
	const held = { channel: 7, screen: 4, drivenBy: 'srv-M' }
	const remote = { channel: 3, screen: 2, drivenBy: 'srv-O', code: 'REMOTE_SCREEN', owners: ['O'] }
	function deps({ follower = true, master = { ok: true, status: 200, json: { ok: true } }, owner = { ok: true, status: 200, json: { ok: true } }, online = true } = {}) {
		const seen = []
		return {
			seen,
			isFollower: () => follower,
			callMaster: async (a, args, o) => (seen.push(['master', o.timeoutMs]), master),
			call: async (id, a, args) => (seen.push([id, args.relayed]), owner),
			owners: (ids) => ids.map((id) => ({ id, name: `srv-${id}`, online })),
			diverge: (ch) => seen.push(['diverge', ch]),
		}
	}
	const args = { sceneId: 's', target: 'program', relayed: true }

	it('own / local screen: taken here', async () => assert.equal(await relayLook(args, null, deps()), null))

	it('backup: the master within 1 s; no answer → here, diverged (the hold lifts until the next report)', async () => {
		const d = deps()
		assert.deepEqual(await relayLook(args, held, d), { status: 200, body: { ok: true, viaMaster: true } })
		assert.deepEqual(d.seen, [['master', 1000]])
		const gone = deps({ master: { ok: false, status: 0, error: 'timeout' } })
		assert.deepEqual(await relayLook(args, held, gone), { local: true, diverged: true })
		assert.deepEqual(gone.seen, [['master', 1000], ['diverge', 7]])
		let t = 0
		const rep = createFanoutReport({ master: () => ({ epoch: 3, master: FP_M, master_id: 'M', is_master: false }), fanout: () => null, peers: () => [], call: async () => ({}), now: () => t })
		rep.receive({ epoch: 3, master: FP_M, channels: [7], mirror: [7], connected: true }, PEER_M)
		assert.equal(rep.heldBy(7), 'srv-M')
		t = 10
		rep.diverge(7)
		assert.equal(rep.heldBy(7), '', 'diverged: the local take is not refused')
		t = 20
		rep.receive({ epoch: 3, master: FP_M, channels: [7], mirror: [7], connected: true }, PEER_M)
		assert.equal(rep.heldBy(7), 'srv-M', 'the master\'s next report holds it again')
	})

	it('remote: → the master; no master → an online owner (relayed: taken there, never handed on); nobody → 409', async () => {
		const d = deps()
		assert.equal((await relayLook(args, remote, d)).body.viaMaster, true)
		const solo = deps({ follower: false })
		assert.deepEqual(await relayLook(args, remote, solo), { status: 200, body: { ok: true, via: 'srv-O' } })
		assert.deepEqual(solo.seen, [['O', true]])
		const down = deps({ master: { ok: false, status: 0 } })
		assert.equal((await relayLook(args, remote, down)).body.via, 'srv-O', 'master unreachable → the owner')
		const none = await relayLook(args, remote, deps({ follower: false, online: false }))
		assert.equal(none.status, 409)
		assert.equal(none.body.code, 'REMOTE_SCREEN')
		assert.deepEqual(none.body.owners, ['O'])
	})

	it('R1 take-look: a diverged backup take answers ok with `diverged: true`', async () => {
		const seen = []
		const r = await handleTakeLook({ sceneId: 's', mainIdx: 3 }, {}, {
			cluster: {}, relay: deps({ master: { ok: false, status: 0 } }), airHeldBy: () => held,
			take: async (b) => (seen.push(b.channel), { status: 200, body: '{"ok":true}' }),
			resolveSceneById: (id) => ({ id, layers: [] }), getChannelMap: () => ({ programChannels: [1, 3, 5, 7], previewChannels: [2, 4, 6, 8] }), withBorder: (s) => s,
		})
		assert.deepEqual(body(r), { ok: true, diverged: true })
		assert.deepEqual(seen, [7])
	})

	it('R2: an owner takes a relayed look.take LOCALLY, also for a screen it would relay; a remote one goes to the owner', async () => {
		const seen = []
		const base = { isFollower: () => false, callMaster: async () => assert.fail('no master'), takeLook: async (b) => (seen.push(['take', b.relayed === true]), { status: 200, body: '{"ok":true}' }) }
		const a = createCallActions({}, { ...base, heldFor: () => remote, call: async (id) => (seen.push(['call', id]), { ok: true, status: 200, json: { ok: true } }), owners: (ids) => ids.map((id) => ({ id, name: id, online: true })) })
		assert.equal((await a['look.take']({ sceneId: 's', relayed: true })).status, 200)
		assert.deepEqual((await a['look.take']({ sceneId: 's' })).body, { ok: true, via: 'O' })
		assert.deepEqual(seen, [['take', true], ['call', 'O']])
	})

	it('R3 zone look: remote → owner; cabled here → local; nobody known on a follower → the master (WO-712 R2)', async () => {
		const seen = []
		const cluster = { isClusterFollower: () => true, ownershipOf: () => ({ cabledHere: (ch) => ch === 1 }), callOf: () => ({ callMaster: async (a, b) => (seen.push(['master', b.sceneId]), { ok: true, status: 200 }) }) }
		const take = async (b) => (seen.push(['local', b.sceneId]), { status: 200 })
		const relay = deps({ follower: false })
		const map = { programChannels: [1, 3] }
		const ctx = { config: {} }
		const heldFor = (b) => (b.sceneId === 'r' ? remote : null)
		const look = require('../../src/api/routes-scene-take-look')
		const orig = look.lookProgramChannel
		look.lookProgramChannel = (b) => (b.sceneId === 'h' ? map.programChannels[0] : map.programChannels[1])
		try {
			assert.deepEqual(await runAction(parseAction('look:r'), ctx, { cluster, takeLook: take, heldFor, relay }), { ok: true, detail: 'look r → srv-O' })
			assert.deepEqual(await runAction(parseAction('look:h'), ctx, { cluster, takeLook: take, heldFor, relay }), { ok: true, detail: 'look h → program' })
			assert.deepEqual(await runAction(parseAction('look:u'), ctx, { cluster, takeLook: take, heldFor, relay }), { ok: true, detail: 'look u → master' })
		} finally {
			look.lookProgramChannel = orig
		}
		assert.deepEqual(relay.seen, [['O', true]], 'relayed: the owner takes it locally')
		assert.deepEqual(seen, [['local', 'h'], ['master', 'u']])
	})
})

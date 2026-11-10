'use strict'

/**
 * WO-1026 — what the two-server run found on a cluster follower (highascg5867, 09.11):
 *   - its own stream / record consumers (ADD n-97 STREAM, ADD n-96 FILE) were dropped by the follower PGM skip, while
 *     the API answered "started";
 *   - a program take pressed on it (its GUI: POST /api/scene/take-look) answered ok and nothing went on air;
 *   - with detection on in the shared show both servers ran the detector and held the `tracking` duty;
 *   - the master's air journal survived its own Caspar restart: a line for a channel that had since become a
 *     destination's PGM was replayed into the follower.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')

const fanout = require('../../src/replication/amcp-fanout')
const { handleTakeLook, relayArgs } = require('../../src/api/routes-scene-take-look')
const { createDetectService } = require('../../src/tracking/detect-service')

describe('WO-1026 follower: its own consumers are not air', () => {
	after(() => fanout.setClusterAirCheck(null))
	const ctx = { config: { screen_count: 1 } }

	it('ADD / REMOVE on a program channel pass on a follower; the look still does not', () => {
		fanout.setClusterAirCheck(() => 'srv-M') // WO-1029: the master's report forwards every channel here
		assert.equal(fanout.shouldBlockLocalPgmAmcpCommand(ctx, 'PLAY 1-10 "clip"'), true, 'air stays the master\'s')
		assert.equal(fanout.shouldBlockLocalPgmAmcpCommand(ctx, 'ADD 1-97 STREAM rtmp://host/live/key -codec:v libx264'), false)
		assert.equal(fanout.shouldBlockLocalPgmAmcpCommand(ctx, 'ADD 1-96 FILE Rec1.mp4 -codec:v libx264'), false)
		assert.equal(fanout.shouldBlockLocalPgmAmcpCommand(ctx, 'REMOVE 1-96'), false)
		assert.equal(fanout.shouldBlockLocalPgmAmcpCommand(ctx, 'ADD 1-701 SHM NAME pgm1'), false)
		assert.equal(fanout.shouldBlockLocalPgmAmcpCommand(ctx, 'CG 1-30 ADD 1 "lower" 1'), true, 'a template is content')
	})

	it('the master never sends consumers, so nobody else would have started them', () => {
		assert.equal(fanout.shouldFanOutCommand('ADD 1-97 STREAM rtmp://host/live/key'), false)
		assert.equal(fanout.shouldFanOutCommand('REMOVE 1-97'), false)
	})
})

describe('WO-1026 follower: a program take-look goes to the master', () => {
	// WO-1029 B1: a follower relays only a screen the master drives here (`held`: the master's fresh report lists its
	// program channel); 4 screens so mainIdx 3 has a program channel (7) to be held
	const stub = (follower, answer = { ok: true, status: 200, json: { ok: true, by: 'master' } }, held = follower) => {
		const seen = []
		const cluster = { isClusterFollower: () => follower, callOf: () => ({ callMaster: async (a, args) => (seen.push([a, args]), answer) }) }
		const take = async (b) => (seen.push(['local', b.sceneId, b.target || 'program']), { status: 200, body: '{"ok":true}' })
		const airHeldBy = (_ctx, ch) => (held ? { channel: ch, screen: 1, drivenBy: 'srv-M' } : null)
		const deps = { cluster, take, airHeldBy, resolveSceneById: (id) => ({ id, name: id, layers: [], mainScope: '0' }), getChannelMap: () => ({ programChannels: [1, 3, 5, 7], previewChannels: [2, 4, 6, 8] }), withBorder: (s) => s }
		return { seen, deps }
	}

	it('program on a follower → the master, with the take\'s own options; the answer is the master\'s', async () => {
		const { seen, deps } = stub(true)
		const r = await handleTakeLook(JSON.stringify({ sceneId: 's1', forceCut: true, mainIdx: 3, transitionOverride: { type: 'MIX', duration: 12 }, takeGroup: { id: 'g', size: 2 } }), {}, deps)
		assert.equal(r.status, 200)
		assert.deepEqual(JSON.parse(r.body), { ok: true, by: 'master', viaMaster: true })
		assert.deepEqual(seen, [['look.take', { sceneId: 's1', target: 'program', relayed: true, mainIdx: 3, forceCut: true, transitionOverride: { type: 'MIX', duration: 12 } }]])
	})

	it('preview, a relayed take, and a take on the master stay local', async () => {
		const f = stub(true)
		await handleTakeLook({ sceneId: 's2', target: 'preview' }, {}, f.deps)
		await handleTakeLook({ sceneId: 's3', relayed: true }, {}, f.deps)
		const m = stub(false)
		await handleTakeLook({ sceneId: 's4' }, {}, m.deps)
		assert.deepEqual(f.seen, [['local', 's2', 'preview'], ['local', 's3', 'program']])
		assert.deepEqual(m.seen, [['local', 's4', 'program']])
	})

	it('WO-1029: a follower whose screen the master does not drive takes it locally', async () => {
		const { seen, deps } = stub(true, undefined, false)
		const r = await handleTakeLook({ sceneId: 's5' }, {}, deps)
		assert.equal(r.status, 200)
		assert.deepEqual(seen, [['local', 's5', 'program']])
	})

	it('an unreachable master is an error, not a silent ok', async () => {
		const { seen, deps } = stub(true, { ok: false, status: 0, error: 'timeout' })
		const r = await handleTakeLook({ sceneId: 's1' }, {}, deps)
		assert.equal(r.status, 502)
		assert.equal(JSON.parse(r.body).error, 'timeout')
		assert.equal(seen.length, 1)
		assert.equal((await handleTakeLook({}, {}, deps)).status, 400)
	})

	it('relayArgs carries only what a take reads', () => {
		assert.deepEqual(relayArgs({ sceneId: ' a ', target: 'preview', junk: 1, mainIdx: null, timersVisibility: { t1: true } }), { sceneId: 'a', target: 'program', relayed: true, timersVisibility: { t1: true } })
	})
})

describe('WO-1026 tracking runs where a camera is', () => {
	const services = []
	after(() => services.forEach((s) => s.stop()))
	const project = { previs: { tracking: { cameras: [{ id: 'cam_1', role: 'in1', raster: [1920, 1080] }, { id: 'cam_2', role: 'in2', raster: [1920, 1080] }], detection: { enabled: true } } } }

	function make(inputs) {
		const spawned = []
		const duty = { check: null, refreshed: 0 }
		const spawn = () => {
			const p = new EventEmitter()
			p.pid = 7
			p.stdin = { writable: true, write() {}, end() {}, on() {} }
			p.stdout = new PassThrough()
			p.stderr = new PassThrough()
			p.kill = () => (p.killed = true)
			spawned.push(p)
			return p
		}
		const svc = createDetectService({ log: () => {} }, {
			spawn, exists: () => true, python: '/fake/python', modelsDir: '/fake/models', lease: () => Promise.resolve([]), autostart: false, project,
			hasSurface: (role) => inputs.has(role),
			duties: { provide: (d) => (duty.check = d.tracking), refresh: () => duty.refreshed++ },
		})
		services.push(svc)
		return { svc, spawned, duty }
	}

	it('no camera input on this server: no detector, no tracking duty', () => {
		const { spawned, duty, svc } = make(new Set())
		assert.equal(spawned.length, 0)
		assert.equal(duty.check(), false)
		assert.equal(svc.status().error, '')
	})

	it('one camera input here is enough', () => {
		const { spawned, duty } = make(new Set(['in2']))
		assert.equal(spawned.length, 1)
		assert.equal(duty.check(), true)
	})

	it('the layout changes without a project change: the next lease tick starts / stops it and refreshes the duty', () => {
		const inputs = new Set()
		const { svc, spawned, duty } = make(inputs)
		const before = duty.refreshed
		inputs.add('in1')
		svc._renewLease()
		assert.equal(spawned.length, 1, 'the inputs arrived → started')
		assert.equal(duty.check(), true)
		assert.ok(duty.refreshed > before)
		inputs.clear()
		svc._renewLease()
		assert.equal(spawned[0].killed, true, 'the inputs left → stopped')
		assert.equal(duty.check(), false)
	})

	it('real wiring: a role resolves through the surface manager\'s channel map (DeckLink inputs, Caspar channels)', () => {
		const { createVideoSurfaceManager } = require('../../src/system/video-surfaces')
		let map = { inputChannels: [] }
		const m = createVideoSurfaceManager({ getAmcp: () => null, getChannelMap: () => map })
		assert.equal(m.has('in1'), false)
		map = { inputChannels: [{ kind: 'decklink', slot: 1, channel: 9 }], channelResolutionsByChannel: { 5: { w: 1920, h: 1080 } } }
		assert.equal(m.has('in1'), true)
		assert.equal(m.has('in2'), false)
		assert.equal(m.has('ch5'), true, 'a chN camera counts once Caspar lists the channel')
		const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/tracking/detect-service.js'), 'utf8')
		assert.match(src, /getVideoSurfaceManager\(ctx\)\.has\(role\)/)
	})
})

describe('WO-1026 air journal: a restarted Caspar empties it', () => {
	const { createAirJournal, forgetOnCasparRestart } = require('../../src/cluster/cluster-air-journal')

	it('reset forgets every channel', () => {
		const j = createAirJournal()
		j.record('PLAY 7-23 SHM NAME zoom-gallery')
		j.record('MIXER 7-23 OPACITY 0')
		assert.equal(j.replay().length, 2)
		j.reset()
		assert.deepEqual(j.replay(), [])
	})

	it('a new Caspar pid empties it; the first connect, the same pid (TCP blip) and an unknown pid keep it', () => {
		const ctx = { _airJournal: createAirJournal() }
		ctx._airJournal.record('PLAY 7-10 "clip"')
		assert.equal(forgetOnCasparRestart(ctx, 100), false, 'first connect')
		assert.equal(forgetOnCasparRestart(ctx, 100), false, 'same Caspar')
		assert.equal(forgetOnCasparRestart(ctx, null), false, 'pid not found')
		assert.equal(ctx._airJournal.replay().length, 1)
		assert.equal(forgetOnCasparRestart(ctx, 200), true)
		assert.deepEqual(ctx._airJournal.replay(), [])
		assert.equal(forgetOnCasparRestart({}, 1), false, 'no journal yet: nothing to do')
	})

	it('routing setup asks on every Caspar (re)connect, before it re-sends anything', () => {
		const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/config/routing-setup.js'), 'utf8')
		const at = src.indexOf('forgetOnCasparRestart(self, pid)')
		assert.ok(at > 0)
		assert.ok(at < src.indexOf('reconcileQuarantinedTemplateHosts(self)'), 'first thing in setupAllRouting')
	})
})

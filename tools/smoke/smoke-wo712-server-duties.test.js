'use strict'

/**
 * WO-712 R1 — server duties: a device-local pick-list of what this server does, and each tracking / lighting
 * service gating its own tick on it. Defaults all on; set validates; the shared instance never touches the real
 * state file under node --test; lighting off → no packet leaves while the engine still aims; detection off →
 * wanted() false; zones off → no action; ptz not allowed → nothing sent; presenters off → intake refused;
 * ping and the cluster peer view carry the duties.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const duties = require('../../src/cluster/server-duties')
const { createCluster } = require('../../src/cluster/cluster-peers')
const { RouteRegistry } = require('../../src/api/route-registry')
const { emitProjectChanged } = require('../../src/engine/project-events')

const ALL = ['detection', 'zones', 'auto', 'lighting', 'ptz', 'presenters', 'accept_remote']
const memStore = (init) => {
	const m = new Map(init ? [['serverDuties', init]] : [])
	return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), m }
}
const mk = (init) => {
	const store = memStore(init)
	return { store, d: duties.createServerDuties({ persistence: store }) }
}
const tick = () => new Promise((r) => setImmediate(r))

describe('WO-712 R1 server-duties module', () => {
	it('defaults: every duty on, no playout', () => {
		const { d, store } = mk()
		assert.deepEqual(duties.NAMES, ALL)
		assert.deepEqual(d.get(), Object.fromEntries(ALL.map((n) => [n, true])))
		assert.ok(ALL.every((n) => d.has(n)))
		assert.equal(d.has('playout'), false, 'playout is not a duty in R1')
		assert.equal(store.m.has('serverDuties'), false, 'nothing is written until a change')
	})

	it('set validates names and booleans, saves, and notifies once per real change', () => {
		const { d, store } = mk({ lighting: false, junk: 1, zones: 'no' })
		assert.equal(d.has('lighting'), false, 'a stored false is kept')
		assert.equal(d.has('zones'), true, 'a non-boolean stored value falls back to true')
		const seen = []
		const off = d.onChange((next, prev) => seen.push([next.ptz, prev.ptz]))
		for (const bad of [null, [], 'x', {}, { nope: true }, { ptz: 'false' }, { ptz: 0 }, { ptz: false, nope: true }]) {
			assert.throws(
				() => d.set(bad),
				(e) => e.status === 400,
				JSON.stringify(bad)
			)
		}
		assert.equal(d.has('ptz'), true, 'a refused patch changes nothing (not even its valid keys)')
		assert.equal(seen.length, 0)
		const saved = d.set({ ptz: false })
		assert.equal(saved.ptz, false)
		assert.equal(saved.lighting, false)
		assert.deepEqual(store.m.get('serverDuties'), saved)
		d.set({ ptz: false })
		assert.deepEqual(seen, [[false, true]], 'a no-op patch does not notify')
		off()
		d.set({ ptz: true })
		assert.equal(seen.length, 1, 'unsubscribed')
	})

	it('the shared instance is test-isolated: the real state file is untouched', () => {
		assert.ok(process.env.NODE_TEST_CONTEXT, 'run with node --test')
		const real = path.join(__dirname, '..', '..', '.highascg-state.json')
		const before = fs.existsSync(real) ? fs.statSync(real).mtimeMs : null
		const persistence = require('../../src/utils/persistence')
		duties.set({ accept_remote: false })
		persistence.flushSync()
		const scratch = path.join(os.tmpdir(), `highascg-state-test-${process.pid}.json`)
		assert.equal(JSON.parse(fs.readFileSync(scratch, 'utf8')).serverDuties.accept_remote, false)
		assert.equal(fs.existsSync(real) ? fs.statSync(real).mtimeMs : null, before)
		duties.set({ accept_remote: true })
		persistence.flushSync()
		fs.rmSync(scratch, { force: true })
	})
})

describe('WO-712 R1 routes, ping and the cluster view', () => {
	it('GET / POST /api/server/duties; POST broadcasts server:duties; bad patch is 400', async () => {
		const routes = new RouteRegistry()
		require('../../src/api/routes-server-duties').register(routes)
		const sent = []
		const ctx = { _wsBroadcast: (type, body) => sent.push([type, body]) }
		const get = await routes.dispatch('GET', '/api/server/duties', '', ctx)
		assert.equal(get.status, 200)
		assert.deepEqual(JSON.parse(get.body), Object.fromEntries(ALL.map((n) => [n, true])))
		const post = await routes.dispatch(
			'POST',
			'/api/server/duties',
			JSON.stringify({ patch: { presenters: false } }),
			ctx
		)
		assert.equal(post.status, 200)
		assert.equal(JSON.parse(post.body).presenters, false)
		assert.deepEqual(sent, [['server:duties', JSON.parse(post.body)]])
		assert.equal(JSON.parse((await routes.dispatch('GET', '/api/server/duties', '', ctx)).body).presenters, false)
		for (const body of ['{}', JSON.stringify({ patch: { nope: true } }), JSON.stringify({ patch: { ptz: 'x' } })]) {
			const r = await routes.dispatch('POST', '/api/server/duties', body, ctx)
			assert.equal(r.status, 400, body)
			assert.ok(JSON.parse(r.body).error)
		}
		assert.equal(sent.length, 1, 'a refused patch broadcasts nothing')
		duties.set({ presenters: true })
		const router = fs.readFileSync(path.join(__dirname, '../../src/api/router.js'), 'utf8')
		assert.match(router, /require\('\.\/routes-server-duties'\)\.register\(routes\)/)
	})

	it('/api/replication/ping carries duties', async () => {
		const { handleGet } = require('../../src/api/routes-replication-get')
		duties.set({ zones: false })
		try {
			const r = await handleGet('/api/replication/ping', { config: {} }, null)
			const body = JSON.parse(r.body)
			assert.equal(body.duties.zones, false)
			assert.equal(body.duties.lighting, true)
		} finally {
			duties.set({ zones: true })
		}
	})

	it("a linked peer's duties reach the cluster snapshot (peers[].duties, self.duties)", async () => {
		const pd = { ...Object.fromEntries(ALL.map((n) => [n, true])), lighting: false }
		const ping = (o) => ({
			appId: 'highascg',
			selfId: 'boxB',
			hostname: 'boxB',
			instanceId: 'iB',
			appVersion: '1',
			role: 'standalone',
			duties: pd,
			...o,
		})
		const fetchJson = async (h, p, route) =>
			route === '/api/replication/ping' ? { ok: true, status: 200, json: ping() } : { ok: false, status: 0, json: null }
		const c = createCluster({
			persistence: { get: () => undefined, set: () => {} },
			selfPing: async () => ({ selfId: 'boxA', instanceId: 'iA', duties: pd }),
			fetchJson,
		})
		assert.equal((await c.add({ address: '10.0.0.6' })).status, 201)
		c.stop()
		assert.deepEqual(c.snapshot().peers[0].duties, pd)
		assert.deepEqual(c.snapshot().self.duties, pd)
		pd.lighting = true // an older server answers without duties: null, not a guess
		const c2 = createCluster({
			persistence: { get: () => undefined, set: () => {} },
			selfPing: async () => ({ selfId: 'boxA', instanceId: 'iA' }),
			fetchJson: async (h, p, route) =>
				route === '/api/replication/ping'
					? { ok: true, status: 200, json: ping({ duties: undefined }) }
					: { ok: false, status: 0, json: null },
		})
		await c2.add({ address: '10.0.0.6' })
		c2.stop()
		assert.equal(c2.snapshot().peers[0].duties, null)
	})
})

describe('WO-712 R1 gates', () => {
	it('lighting off: no packet leaves, the engine still aims; back on, output resumes', async () => {
		const { createFollowService } = require('../../src/fixtures/follow-service')
		const { d } = mk()
		const marks = [{ id: 1, x: 0, y: 6, z: 0, stale: false }]
		const hub = { now: () => Date.now(), list: () => marks }
		const svc = createFollowService({ log: () => {} }, hub, { duties: d })
		const wire = []
		svc.sender.send = async (to, packet) => void wire.push({ to, n: packet.length }) // never the real network
		const psnCalls = []
		svc.psn.configure = (cfg) => void psnCalls.push(cfg)
		try {
			const patch = [
				{
					id: 'a',
					name: 'Spot A',
					universe: 3,
					address: 11,
					dest: '10.0.0.9',
					pose: { x: 0, y: 0, z: 6, hang: 'truss', yaw: 0 },
					follow: 1,
					aim_z: 0,
				},
			]
			emitProjectChanged({ fixtures: { output: { enabled: true, protocol: 'artnet' }, patch } })
			svc.engine.tick()
			assert.ok(wire.length >= 1, 'duty on: the engine sends')
			assert.equal(svc.status().output_blocked, null)
			wire.length = 0
			d.set({ lighting: false })
			emitProjectChanged({
				fixtures: { output: { enabled: true, protocol: 'artnet' }, patch: [{ ...patch[0], address: 21 }] },
			}) // new bytes: would send at once
			svc.engine.tick()
			await tick()
			assert.equal(wire.length, 0, 'lighting off: nothing transmitted')
			const st = svc.status()
			assert.equal(st.output_blocked, 'server-duties')
			assert.ok(st.packets_blocked >= 1, 'the engine built the datagram, the duty held it back')
			assert.equal(svc.snapshot().output_blocked, 'server-duties')
			assert.notEqual(st.fixtures[0].state, 'not output', 'aims are still computed: ' + st.fixtures[0].state)
			assert.ok(svc.visual().fixtures.length === 0 || svc.visual().fixtures[0].id === 'a')
			d.set({ lighting: true })
			assert.equal(svc.status().output_blocked, null)
			emitProjectChanged({
				fixtures: { output: { enabled: true, protocol: 'artnet' }, patch: [{ ...patch[0], address: 31 }] },
			})
			svc.engine.tick()
			await tick()
			assert.ok(wire.length >= 1, 'duty back on: output resumes')
			// PSN: a duty change re-configures the sender (stubbed above, so no multicast socket opens)
			emitProjectChanged({ fixtures: { output: { enabled: true, protocol: 'psn' }, patch } })
			psnCalls.length = 0
			d.set({ lighting: false })
			assert.equal(psnCalls.at(-1).enabled, false, 'PSN stops with the lighting duty')
			d.set({ lighting: true })
			assert.equal(psnCalls.at(-1).enabled, true, 'PSN starts with it')
		} finally {
			svc.stop()
		}
	})

	it('detection off: wanted() is false (sidecar not spawned, stopped when ticked off), status says why', async () => {
		const { createDetectService } = require('../../src/tracking/detect-service')
		const CAM = { pos_x: 0, pos_y: -10, pos_z: 5, pitch: -20, yaw: 0, roll: 0, fov: 60, lens_k1: 0, lens_k2: 0 }
		const project = {
			previs: {
				tracking: {
					grid: { z_offset: 0 },
					detection: { enabled: true },
					cameras: [{ id: 'cam_1', role: 'ch1', raster: [1920, 1080], cam: CAM }],
				},
			},
		}
		const spawned = []
		const killed = []
		const fakeSpawn = () => {
			const { EventEmitter } = require('node:events')
			const p = new EventEmitter()
			p.pid = 4242
			p.stdout = Object.assign(new EventEmitter(), { setEncoding() {} })
			p.stderr = Object.assign(new EventEmitter(), { setEncoding() {} })
			p.stdin = Object.assign(new EventEmitter(), { writable: true, write() {}, end() {} })
			p.kill = (s) => void killed.push(s)
			spawned.push(p)
			return p
		}
		const mkSvc = (d) =>
			createDetectService(
				{ log: () => {} },
				{
					spawn: fakeSpawn,
					exists: () => true,
					python: '/fake/python',
					modelsDir: '/fake/models',
					lease: () => Promise.resolve([]),
					autostart: false,
					project,
					duties: d,
				}
			)
		const off = mk({ detection: false })
		const a = mkSvc(off.d)
		try {
			assert.equal(spawned.length, 0, 'duty off at boot: no sidecar')
			const st = a.status()
			assert.equal(st.off_by_duties, true)
			assert.match(st.error, /detection is off for this server/)
			assert.equal(a.snapshot().running, false)
			off.d.set({ detection: true })
			assert.equal(spawned.length, 1, 'ticked on: the sidecar starts')
			assert.equal(a.status().off_by_duties, false)
			off.d.set({ detection: false })
			assert.deepEqual(killed, ['SIGTERM'], 'ticked off: the sidecar stops')
		} finally {
			a.stop()
		}
		const on = mkSvc(mk().d)
		try {
			assert.equal(spawned.length, 2, 'control: the default duty starts the sidecar')
		} finally {
			on.stop()
		}
	})

	it('zones off: occupancy is still evaluated, no action fires', async () => {
		const { createZoneService } = require('../../src/tracking/zone-service')
		const SQUARE = [
			[0, 0],
			[4, 0],
			[4, 4],
			[0, 4],
		]
		const project = {
			previs: {
				tracking: {
					zones: {
						enabled: true,
						debounce_ms: 0,
						list: [{ id: 'z', name: 'Downstage', vertices: SQUARE, actions: { first_entry: 'look:s1' } }],
					},
				},
			},
		}
		const run = async (zonesOn) => {
			const { d } = mk({ zones: zonesOn })
			const taken = []
			const hub = { now: () => 1000, list: () => [{ id: 1, x: 2, y: 2, z: 0, stale: false }] }
			const svc = createZoneService({ log: () => {} }, hub, {
				project,
				autostart: false,
				duties: d,
				takeLook: async (b) => (taken.push(b.sceneId), { status: 200 }),
			})
			try {
				assert.equal(svc.tick(), 1, 'the transition is evaluated either way')
				await tick()
				return { taken, st: svc.status(), snap: svc.snapshot() }
			} finally {
				svc.stop()
			}
		}
		const on = await run(true)
		assert.deepEqual(on.taken, ['s1'])
		assert.equal(on.st.actions_off, false)
		assert.equal('actions_off' in on.snap, false, 'unchanged snapshot while on')
		const off = await run(false)
		assert.deepEqual(off.taken, [], 'no action fired')
		assert.equal(off.snap.zones[0].occupied, true, 'occupancy still shown')
		assert.equal(off.snap.actions_off, true)
		assert.equal(off.st.recent[0].kind, 'first_entry')
		assert.match(off.st.recent[0].detail, /zone actions are off for this server/)
	})

	it('ptz not allowed: step() sends nothing; allowed again, it sends', () => {
		const { createPtzService } = require('../../src/ptz/ptz-service')
		let ok = false
		const sent = []
		const svc = createPtzService({ send: (h, p, buf) => void sent.push([h, p, buf.length]), allowed: () => ok })
		svc.configure({
			previs: {
				tracking: {
					ptz: [
						{
							id: 'p1',
							name: 'PTZ',
							enabled: true,
							protocol: 'visca-udp',
							host: '10.0.0.50',
							port: 52381,
							address: 1,
							pos_x: 0,
							pos_y: -8,
							pos_z: 3,
						},
					],
				},
			},
		})
		const target = { x: 1, y: 2, z: 1 }
		svc.step(1000, () => target)
		svc.step(1200, () => 'home')
		assert.equal(sent.length, 0, 'not allowed: no VISCA')
		assert.equal(svc.status()[0].blocked_by_server, true)
		ok = true
		svc.step(1400, () => target)
		assert.ok(sent.length >= 1, 'allowed: the aim goes out')
		assert.equal('blocked_by_server' in svc.status()[0], false)
		const plain = createPtzService({ send: (h, p, buf) => void sent.push([h, p, buf.length]) })
		plain.configure({
			previs: {
				tracking: {
					ptz: [{ id: 'p1', name: 'PTZ', enabled: true, protocol: 'visca-udp', host: '10.0.0.50', port: 52381, address: 1 }],
				},
			},
		})
		const n = sent.length
		plain.step(1000, () => target)
		assert.ok(sent.length > n, 'no `allowed` dep = allowed')
	})

	it('presenters off: the phone page and new intake answer 409, the roster stays', async () => {
		const { handlePresenters } = require('../../src/tracking/presenter-routes')
		const created = []
		const presenters = {
			snapshot: () => ({ presenters: [], suggestions: [] }),
			create: async (b) => (created.push(b), { status: 201, body: { ok: true } }),
		}
		const call = (d, method, p, body) =>
			handlePresenters(presenters, { method, path: p, body: JSON.stringify(body || {}), req: null, duties: d })
		const off = mk({ presenters: false }).d
		const on = mk().d
		const refused = await call(off, 'POST', '/api/tracking/presenters', { name: 'A' })
		assert.equal(refused.status, 409)
		assert.match(JSON.parse(refused.body).error, /Presenter intake is off on this server/)
		assert.equal((await call(off, 'GET', '/api/tracking/presenters/intake')).status, 409)
		assert.equal(created.length, 0)
		const list = await call(off, 'GET', '/api/tracking/presenters')
		assert.equal(list.status, 200)
		assert.equal(JSON.parse(list.body).intake_enabled, false)
		assert.equal((await call(on, 'POST', '/api/tracking/presenters', { name: 'A' })).status, 201)
		assert.equal(created.length, 1)
		assert.equal(JSON.parse((await call(on, 'GET', '/api/tracking/presenters')).body).intake_enabled, true)
	})

	it('auto is exported as a flag only (the lead wires the director)', () => {
		const { d } = mk({ auto: false })
		assert.equal(d.has('auto'), false)
	})
})

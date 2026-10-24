'use strict'

/**
 * WO-712 R1 — each tracking / lighting service gates itself on `duties.has(name)`: lighting off → no packet leaves
 * while the engine still aims; zones off → no action; ptz not allowed → nothing sent; presenters off → intake refused;
 * ping and the cluster peer view carry the duties.
 * WO-723 replaced R1's stored ticks with a resolution (server-duties.js: config + the linked servers + the sender
 * choice; tested in smoke-wo723-duties-from-config). The gates are unchanged, so they are driven here by a fake whose
 * duties the test flips, and detection is no longer a gate at all (its config check IS what `tracking` resolves from).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const duties = require('../../src/cluster/server-duties')
const { createCluster } = require('../../src/cluster/cluster-peers')
const { emitProjectChanged } = require('../../src/engine/project-events')

const ALL = duties.NAMES
/** A resolved-duties stand-in (`init` = the duties resolved off); `d.set` flips them as a resolution change would. */
const mk = (init = {}) => {
	let state = { ...Object.fromEntries(ALL.map((n) => [n, true])), ...init }
	const subs = new Set()
	const d = {
		has: (n) => state[n] === true,
		get: () => ({ ...state }),
		onChange: (fn) => (subs.add(fn), () => subs.delete(fn)),
		set(patch) {
			const prev = state
			state = { ...state, ...patch }
			for (const fn of [...subs]) fn({ ...state }, prev)
			return { ...state }
		},
	}
	return { d }
}
const tick = () => new Promise((r) => setImmediate(r))

describe('WO-712 R1 routes, ping and the cluster view', () => {
	it('the duties routes stay registered ahead of Caspar\'s /api/server/* wildcard', () => {
		const router = fs.readFileSync(path.join(__dirname, '../../src/api/router.js'), 'utf8')
		assert.match(router, /require\('\.\/routes-server-duties'\)\.register\(routes\)/)
		// the router matches in registration order: Caspar's `/api/server/*` wildcard swallowed /api/server/duties (404 on the
		// box, 23.10) while the duties routes were registered after it
		const at = router.indexOf('requ' + "ire('./routes-server-duties').register(routes)") // concat: not a require to resolve
		assert.ok(at >= 0 && at < router.indexOf("routes.get('/api/server/*'"), 'duties registered ahead of /api/server/*')
	})

	it('/api/replication/ping carries duties', async () => {
		const { handleGet } = require('../../src/api/routes-replication-get')
		duties.set({ accept_remote: false })
		try {
			const r = await handleGet('/api/replication/ping', { config: {} }, null)
			const body = JSON.parse(r.body)
			assert.equal(body.duties.accept_remote, false)
			assert.equal(body.duties.lighting, true, 'a single box resolves everything on')
			assert.equal(typeof body.duties.tracking, 'boolean', 'WO-723: peers read `tracking`')
		} finally {
			duties.set({ accept_remote: true })
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

	it('WO-723: detection has no duty gate — it runs on its config and offers that check as `tracking`', async () => {
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
		const provided = []
		let refreshed = 0
		const d = { ...mk({ detection: false, tracking: false }).d, provide: (p) => void provided.push(p), refresh: () => void refreshed++ }
		const a = mkSvc(d)
		try {
			assert.equal(spawned.length, 1, 'a resolved-off `detection` no longer stops it: the config wants it')
			const st = a.status()
			assert.equal('off_by_duties' in a.snapshot(), false)
			assert.doesNotMatch(String(st.error), /off for this server/)
			assert.equal(provided.length, 1)
			assert.equal(provided[0].tracking(), true, '`tracking` = detection on + a camera')
			assert.ok(refreshed >= 1, 'a project change re-resolves the duties')
		} finally {
			a.stop()
		}
		assert.equal(provided[0].tracking(), false, 'a stopped service does no tracking')
		const none = mkSvc({ ...mk().d, provide: (p) => void provided.push(p) })
		try {
			none.stop()
			assert.equal(spawned.length, 2)
		} finally {
			none.stop()
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
		assert.match(off.st.recent[0].detail, /zone actions are off on this server \(a linked server does tracking\)/)
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

'use strict'

/**
 * WO-979 — detection.simulate: the imitated camera (src/tracking/detect-sim.js) lets a live server carry the tracking
 * duty without a camera, a venv or a model. Checked: the slice normalisation, the service spawning node + detect-sim
 * instead of Python (no venv / model check, no surface lease, sim_persons in the config, `simulated` in the snapshot),
 * a real ↔ imitated switch respawning the right process, and one end-to-end run with the real child process.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')

const { normalizeDetection } = require('../../src/tracking/detect-model')
const { createDetectService } = require('../../src/tracking/detect-service')

const RASTER = [1920, 1080]
const CAM = { pos_x: 0, pos_y: -10, pos_z: 5, pitch: -20, yaw: 0, roll: 0, fov: 60, lens_k1: 0, lens_k2: 0 }
const SIM = path.join(__dirname, '..', '..', 'src', 'tracking', 'detect-sim.js')
const tick = () => new Promise((r) => setImmediate(r))
const services = []
after(() => services.forEach((s) => s.stop()))

function fakeSpawn() {
	const spawns = []
	const procs = []
	const spawn = (cmd, args) => {
		spawns.push({ cmd, args })
		const proc = new EventEmitter()
		proc.pid = 4243
		proc.stdin = { writable: true, lines: [], write(s) { this.lines.push(s) }, end() { this.writable = false }, on() {} }
		proc.stdout = new PassThrough()
		proc.stderr = new PassThrough()
		proc.kill = (sig) => {
			proc.killed = sig
		}
		procs.push(proc)
		return proc
	}
	return { spawn, spawns, procs }
}

const projectWith = (detection) => ({
	previs: { tracking: { grid: { z_offset: 0 }, cameras: [{ id: 'cam_1', role: 'in1', raster: RASTER, cam: CAM }], detection } },
})

function makeService(deps) {
	const leases = []
	const svc = createDetectService({ log: () => {} }, { hasSurface: () => true,
		python: '/no/such/python', modelsDir: '/no/such/models', exists: () => false,
		lease: (roles) => {
			leases.push(roles)
			return Promise.resolve([])
		},
		autostart: false, duties: {}, ...deps,
	})
	services.push(svc)
	return { svc, leases }
}

describe('WO-979 detection.simulate (the imitated camera)', () => {
	it('model: simulate only on a real true, sim_persons clamped 0..4 and rounded', () => {
		assert.equal(normalizeDetection(null).simulate, false)
		assert.equal(normalizeDetection({ simulate: 'true' }).simulate, false)
		assert.equal(normalizeDetection({ simulate: true }).simulate, true)
		assert.equal(normalizeDetection({}).sim_persons, 1)
		assert.equal(normalizeDetection({ sim_persons: 9 }).sim_persons, 4)
		assert.equal(normalizeDetection({ sim_persons: 2.6 }).sim_persons, 3)
	})

	it('service: spawns node + detect-sim with no venv and no model, leases no surface, says simulated', async () => {
		const fake = fakeSpawn()
		const { svc, leases } = makeService({ spawn: fake.spawn, project: projectWith({ enabled: true, simulate: true, sim_persons: 2 }) })
		await tick()
		assert.equal(fake.spawns.length, 1)
		assert.equal(fake.spawns[0].cmd, process.execPath)
		assert.deepEqual(fake.spawns[0].args, [SIM])
		const cfg = JSON.parse(fake.procs[0].stdin.lines[0])
		assert.equal(cfg.sim_persons, 2)
		assert.ok(leases.every((r) => r.length === 0), `no camera surface leased: ${JSON.stringify(leases)}`)
		assert.equal(svc.snapshot().simulated, true)
		assert.equal(svc.status().error, '')
	})

	it('service: without simulate the same box still wants the venv (nothing spawned, setup hint)', () => {
		const fake = fakeSpawn()
		const { svc } = makeService({ spawn: fake.spawn, project: projectWith({ enabled: true }) })
		assert.equal(fake.spawns.length, 0)
		assert.ok(svc.status().error.includes('setup-venv.sh'))
		assert.equal(svc.snapshot().simulated, false)
	})

	it('service: switching imitated → real camera stops the sim and starts the Python sidecar', async () => {
		const fake = fakeSpawn()
		const { emitProjectChanged } = require('../../src/engine/project-events')
		const { svc } = makeService({ spawn: fake.spawn, exists: () => true, project: projectWith({ enabled: true, simulate: true }) })
		assert.equal(fake.spawns.length, 1)
		emitProjectChanged(projectWith({ enabled: true, simulate: false }))
		await tick()
		assert.equal(fake.procs[0].killed, 'SIGTERM')
		assert.equal(fake.spawns.length, 2)
		assert.equal(fake.spawns[1].args[0], '-u')
		assert.ok(fake.spawns[1].args[1].endsWith('sidecar.py'))
		assert.equal(svc.snapshot().simulated, false)
		svc.stop()
	})

	it('end to end: the real detect-sim child delivers walking persons to the service', async () => {
		const { svc } = makeService({ project: projectWith({ enabled: true, simulate: true, sim_persons: 2, interval_ms: 50 }) })
		const deadline = Date.now() + 5000
		let cam
		while (Date.now() < deadline) {
			cam = svc.snapshot().cameras[0]
			if (svc.available && cam && !cam.stale && cam.persons.length === 2) break
			await new Promise((r) => setTimeout(r, 50))
		}
		assert.equal(svc.available, true, `sim ready: ${JSON.stringify(svc.status().error)}`)
		assert.equal(cam.persons.length, 2)
		assert.ok(cam.persons.every((p) => Array.isArray(p.floor)), 'a solved camera puts the imitated persons on the floor')
		svc.stop()
	})
})

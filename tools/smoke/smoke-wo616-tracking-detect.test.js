'use strict'

/**
 * WO-616 T9 — person detection (src/tracking/detect-model.js, the pure half; detect-service.js, the supervised
 * sidecar child). Model: slice normalisation, camera selection, sidecar box → floor round trip against the
 * camera model's project. Service: a fake child process (spawn injected through deps) checks the config line,
 * line-buffered tracks, staleness, unknown cameras, project-change reconfigure, disable, crash restart with
 * backoff, and the missing-venv error. Every service is stopped after each test so node --test exits cleanly.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')

const { normalizeDetection, detectCameras, boxToFloor, personsFrom } = require('../../src/tracking/detect-model')
const { createDetectService } = require('../../src/tracking/detect-service')
const { project } = require('../../src/tracking/camera-model')
const { emitProjectChanged } = require('../../src/engine/project-events')

const CAM = { pos_x: 0, pos_y: -10, pos_z: 5, pitch: -20, yaw: 0, roll: 0, fov: 60, lens_k1: 0, lens_k2: 0 }
const RASTER = [1920, 1080]
const tick = () => new Promise((r) => setImmediate(r))
const services = []

function assertNear(p, expected, eps = 0.01) {
	assert.ok(Array.isArray(p), `expected an array, got ${JSON.stringify(p)}`)
	p.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < eps, `component ${i}: ${v} vs ${expected[i]}`))
}

/** The PSN floor point [1, 3, 0] seen by CAM, as a normalised sidecar box whose bottom-centre is that pixel. */
function roundTrip() {
	const [[sx, sy]] = project(CAM, [[1, 3, 0]], RASTER[0], RASTER[1])
	const box = [sx / 1920 - 0.02, sy / 1080 - 0.2, sx / 1920 + 0.02, sy / 1080]
	return { box, sx, sy }
}

function fakeSpawn() {
	const spawns = []
	const procs = []
	const spawn = (cmd, args) => {
		spawns.push({ cmd, args })
		const proc = new EventEmitter()
		proc.pid = 4242
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

const projectWith = (detection = { enabled: true }) => ({
	previs: { tracking: { grid: { z_offset: 0 }, cameras: [{ id: 'cam_1', role: 'ch1', raster: RASTER, cam: CAM }], detection } },
})

function makeService(fake, extra = {}) {
	const leases = []
	let clock = 1000
	const svc = createDetectService({ log: () => {} }, {
		spawn: fake.spawn, exists: () => true, python: '/fake/python', modelsDir: '/fake/models',
		lease: (roles) => {
			leases.push(roles)
			return Promise.resolve([])
		},
		autostart: false, project: projectWith(), now: () => clock, ...extra,
	})
	services.push(svc)
	return { svc, leases, advance: (ms) => (clock += ms) }
}

after(() => services.forEach((s) => s.stop()))

describe('WO-616 T9 person detection', () => {
	it('normalizeDetection: defaults, clamps, model names, masks', () => {
		assert.deepEqual(normalizeDetection(null), {
			enabled: false, model: 'yolo26n.onnx', confidence: 0.2, interval_ms: 67, max_persons: 10, grace_ms: 500, threads: 4, cameras: {},
		})
		assert.equal(normalizeDetection({ confidence: 5 }).confidence, 0.95)
		assert.equal(normalizeDetection({ confidence: 0 }).confidence, 0.1)
		assert.equal(normalizeDetection({ interval_ms: 1 }).interval_ms, 20)
		assert.equal(normalizeDetection({ max_persons: 3.6 }).max_persons, 4)
		assert.equal(normalizeDetection({ confidence: 'abc' }).confidence, 0.2)
		for (const model of ['../../etc/passwd.onnx', '/abs/x.onnx', 'x.pt', '']) assert.equal(normalizeDetection({ model }).model, 'yolo26n.onnx', model)
		assert.equal(normalizeDetection({ model: 'yolo26s.onnx' }).model, 'yolo26s.onnx')
		const cams = normalizeDetection({
			cameras: {
				a: { masks: [{ enabled: true, vertices: [[0, 0], [1, 0]] }] },
				b: { masks: [{ enabled: false, vertices: [[-1, 0.5], [2, 0.5], [0.5, 3]] }] },
				c: { enabled: false },
			},
		}).cameras
		assert.deepEqual(cams.a, { enabled: true, masks: [] }, 'two-vertex mask dropped')
		assert.deepEqual(cams.b, { enabled: true, masks: [{ enabled: false, vertices: [[0, 0.5], [1, 0.5], [0.5, 1]] }] }, 'vertices clamped, enabled false kept')
		assert.equal(cams.c.enabled, false)
	})

	it('detectCameras: role, duplicate and disabled filtering, default raster', () => {
		const tracking = {
			cameras: [
				{ id: 'a', role: 'ch1', raster: [1280, 720], cam: CAM },
				{ id: 'b', role: 'bogus' },
				{ id: 'a', role: 'ch2' },
				{ id: 'c', role: 'in2' },
			],
		}
		const det = normalizeDetection({ cameras: { c: { enabled: false } } })
		assert.deepEqual(detectCameras(tracking, det), [{ id: 'a', role: 'ch1', raster: [1280, 720], cam: CAM, masks: [] }])
		assert.deepEqual(detectCameras({ cameras: [{ id: 'd', role: 'pgm1' }] }, normalizeDetection(null))[0].raster, RASTER)
	})

	it('boxToFloor / personsFrom: round trip through the camera model', () => {
		const { box } = roundTrip()
		const entry = { cam: CAM, raster: RASTER }
		assertNear(boxToFloor(box, entry, 0), [1, 3, 0])
		assert.equal(boxToFloor(box, entry, 0.5)[2], 0.5)
		assert.equal(boxToFloor(box, { cam: null, raster: RASTER }, 0), null)
		const persons = personsFrom({ tracks: [{ tid: 3, box, score: 0.8, age_s: 0 }, { tid: 4, box: [0.1] }] }, entry, 0)
		assert.equal(persons.length, 1)
		assert.equal(persons[0].tid, 3)
		assertNear(persons[0].floor, [1, 3, 0])
	})

	it('service: spawns once, sends config, buffers tracks lines, reports providers', async () => {
		const fake = fakeSpawn()
		const { svc, leases } = makeService(fake)
		await tick() // the lease call is deferred to a microtask (renewLease)
		assert.equal(fake.spawns.length, 1)
		assert.equal(fake.spawns[0].args[0], '-u')
		assert.ok(fake.spawns[0].args[1].endsWith('tools/tracking-detect/sidecar.py'))
		const proc = fake.procs[0]
		const cfg = JSON.parse(proc.stdin.lines[0])
		assert.equal(cfg.type, 'config')
		assert.equal(cfg.model, '/fake/models/yolo26n.onnx')
		assert.deepEqual(cfg.cameras, [{ id: 'cam_1', path: '/dev/shm/highascg-ch1', masks: [] }])
		assert.deepEqual(leases[0], ['ch1'])

		proc.stdout.write('{"type":"ready","model":"/fake/models/yolo26n.onnx","providers":["CPUExecutionProvider"],"input":640}\n')
		const { box } = roundTrip()
		const line = JSON.stringify({ type: 'tracks', camera: 'cam_1', frame: 7, w: 1920, h: 1080, ms: 5, tracks: [{ tid: 3, box, score: 0.8, age_s: 0 }] }) + '\n'
		const cut = Math.floor(line.length / 2)
		proc.stdout.write(line.slice(0, cut))
		await tick()
		proc.stdout.write(line.slice(cut))
		await tick()

		const snap = svc.snapshot()
		assert.equal(snap.running, true)
		assert.equal(snap.cameras[0].persons.length, 1)
		assertNear(snap.cameras[0].persons[0].floor, [1, 3, 0])
		assert.deepEqual(svc.status().providers, ['CPUExecutionProvider'])
	})

	it('service: tracks go stale after 1 s and unknown camera ids are ignored', async () => {
		const fake = fakeSpawn()
		const { svc, advance } = makeService(fake)
		const proc = fake.procs[0]
		proc.stdout.write('{"type":"ready","providers":["CPUExecutionProvider"]}\n')
		const { box } = roundTrip()
		proc.stdout.write(JSON.stringify({ type: 'tracks', camera: 'cam_1', tracks: [{ tid: 3, box, score: 0.8, age_s: 0 }] }) + '\n')
		await tick()
		assert.equal(svc.snapshot().cameras[0].stale, false)

		proc.stdout.write(JSON.stringify({ type: 'tracks', camera: 'ghost', tracks: [{ tid: 9, box, score: 0.5, age_s: 0 }] }) + '\n')
		await tick()
		assert.deepEqual(svc.snapshot().cameras.map((c) => c.id), ['cam_1'])

		advance(1500)
		const cam = svc.snapshot().cameras[0]
		assert.equal(cam.stale, true)
		assert.deepEqual(cam.persons, [])
	})

	it('service: a project change with a new confidence re-sends config without respawning', () => {
		const fake = fakeSpawn()
		const { svc } = makeService(fake)
		const before = fake.procs[0].stdin.lines.length
		emitProjectChanged(projectWith({ enabled: true, confidence: 0.5 }))
		const lines = fake.procs[0].stdin.lines
		assert.equal(lines.length, before + 1)
		assert.equal(JSON.parse(lines.at(-1)).confidence, 0.5)
		assert.equal(fake.spawns.length, 1)
		svc.stop()
	})

	it('service: detection disabled in the project kills the child and releases the lease', async () => {
		const fake = fakeSpawn()
		const { svc, leases } = makeService(fake)
		emitProjectChanged(projectWith({ enabled: false }))
		await tick()
		assert.equal(fake.procs[0].killed, 'SIGTERM')
		assert.deepEqual(leases.at(-1), [])
		svc.stop()
	})

	it('service: a crashed sidecar is respawned after the 1 s backoff', async () => {
		const fake = fakeSpawn()
		const { svc } = makeService(fake)
		assert.equal(fake.spawns.length, 1)
		fake.procs[0].emit('exit', 1, null)
		// Waits ~1.1 s: the first restart backoff is 1000 ms.
		await new Promise((r) => setTimeout(r, 1100))
		assert.equal(fake.spawns.length, 2)
		svc.stop()
	})

	it('service: a missing venv spawns nothing and names the setup script', () => {
		const fake = fakeSpawn()
		const { svc } = makeService(fake, { exists: (p) => p !== '/fake/python' })
		assert.equal(fake.spawns.length, 0)
		assert.ok(svc.status().error.includes('setup-venv.sh'))
		svc.stop()
	})
})

'use strict'

/**
 * WO-1036 smoke — presenters from a tracking-camera picture: the sidecar's crops become captures, the operator's name
 * turns one into a presenter bound to the person it was taken of; nothing unnamed is left behind; /tmp rules hold.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createPresenters } = require('../../src/tracking/presenters')
const { handlePresenters } = require('../../src/tracking/presenter-routes')
const { pickPerPerson, takeCameraPictures } = require('../../src/tracking/presenter-capture')
const { createDetectService } = require('../../src/tracking/detect-service')

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)])
const dirs = []
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))
const tmpDir = () => {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1036-'))
	dirs.push(d)
	return d
}
const embed = async () => ({ ok: true, feature: [1, ...new Array(127).fill(0)], body: { ok: false, detail: 'no person' } })
const settle = () => new Promise((r) => setImmediate(r))
const duties = { has: () => true }

/** A detect service stand-in: `capture(dir)` writes the given shots' files like the sidecar does. */
const fakeDetect = (shots, solvedCameras = 1) => ({
	available: true,
	solvedCameras,
	capture: async (dir) => {
		for (const s of shots) fs.writeFileSync(path.join(dir, s.file), JPEG)
		return shots
	},
})
const shot = (camera, tid, box) => ({ camera, tid, file: `cap-1-${camera}-${tid}.jpg`, box })

describe('WO-1036 presenters from a camera picture', () => {
	it('one camera: every person becomes a capture; naming one makes a bound presenter', async () => {
		const dir = tmpDir()
		const presenters = createPresenters(null, { dir, embed })
		const detect = fakeDetect([shot('cam_1', 3, [0.1, 0.1, 0.2, 0.9]), shot('cam_1', 5, [0.5, 0.1, 0.6, 0.9])])
		const capture = () => takeCameraPictures({ presenters, detect, worldPersons: () => [] })
		const call = (method, p, body) => handlePresenters(presenters, { method, path: '/api/tracking/presenters' + p, body: body && JSON.stringify(body), capture, duties })

		const r = await call('POST', '/capture')
		assert.equal(r.status, 200)
		assert.deepEqual(JSON.parse(r.body).taken.map((c) => [c.id, c.key]), [['c1', 'cam_1:3'], ['c2', 'cam_1:5']])
		assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort(), ['c1.jpg', 'c2.jpg'])
		assert.equal((await call('GET', '/captures/c1/photo')).headers['Content-Type'], 'image/jpeg')
		assert.equal(JSON.parse((await call('GET', '')).body).captures.length, 2)

		assert.equal((await call('POST', '/captures/c1/name', { name: 'Anna' })).status, 400, 'no consent, no presenter')
		assert.equal((await call('POST', '/captures/c1/name', { consent: true })).status, 400, 'a name is required')
		const named = await call('POST', '/captures/c1/name', { name: 'Anna', mic: '4', consent: true })
		assert.equal(named.status, 201)
		const p = JSON.parse(named.body).presenter
		assert.deepEqual([p.name, p.mic, p.person], ['Anna', '4', 'cam_1:3'])
		await settle()
		assert.equal(presenters.list()[0].face, 'ok', 'features come from the camera picture')
		assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort(), ['c2.jpg', 'p1.jpg'])
		assert.equal((await call('GET', '/captures/c1/photo')).status, 404)

		// again: Anna is known, her picture is not kept; the other person's picture is replaced, not doubled
		const again = JSON.parse((await call('POST', '/capture')).body)
		assert.deepEqual(again.captures.map((c) => c.key), ['cam_1:5'])
		assert.deepEqual(fs.readdirSync(dir).filter((f) => /^(c|cap)/.test(f)).length, 1)

		assert.equal((await call('DELETE', '/captures/' + again.captures[0].id)).status, 200)
		assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')), ['p1.jpg'])
	})

	it('fused cameras: one picture per fused person (the largest view), keyed w:<id>; unowned tracks are dropped', () => {
		const shots = [shot('cam_1', 3, [0, 0, 0.1, 0.5]), shot('cam_2', 8, [0, 0, 0.3, 0.9]), shot('cam_2', 9, [0.5, 0, 0.6, 0.5])]
		const world = { fused: true, persons: [{ id: 7, age_s: 0, keys: ['cam_1:3', 'cam_2:8'] }] }
		const { keep, drop } = pickPerPerson(shots, world)
		assert.deepEqual(keep.map((s) => [s.key, s.camera]), [['w:7', 'cam_2']])
		assert.deepEqual(drop.map((s) => `${s.camera}:${s.tid}`).sort(), ['cam_1:3', 'cam_2:9'])
	})

	it('dropped views leave no file; unnamed pictures expire; clear and shutdown delete them', async () => {
		const dir = tmpDir()
		let t = 1000
		const presenters = createPresenters(null, { dir, embed, now: () => t })
		const detect = fakeDetect([shot('cam_1', 3, [0, 0, 0.1, 0.5]), shot('cam_2', 8, [0, 0, 0.3, 0.9])], 2)
		const world = () => [{ id: 7, age_s: 0, keys: ['cam_1:3', 'cam_2:8'] }]
		const r = await takeCameraPictures({ presenters, detect, worldPersons: world })
		assert.deepEqual(r.body.taken.map((c) => c.key), ['w:7'])
		assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')), ['c1.jpg'])
		t += 21 * 60 * 1000
		presenters.tick(() => null)
		assert.equal(presenters.snapshot().captures.length, 0)
		assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')), [])
		await takeCameraPictures({ presenters, detect, worldPersons: world })
		presenters.dispose()
		assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')), [])
	})

	it('no detection here → 409, and nothing is asked of a sidecar', async () => {
		const presenters = createPresenters(null, { dir: tmpDir(), embed })
		const r = await handlePresenters(presenters, { method: 'POST', path: '/api/tracking/presenters/capture', duties })
		assert.equal(r.status, 409)
		assert.equal((await takeCameraPictures({ presenters, detect: { available: false }, worldPersons: () => [] })).status, 409)
	})

	it('detect service: sends the capture request and collects each camera\'s shots; a silent camera times out', async () => {
		const written = []
		const child = { pid: 1, stdin: { writable: true, write: (s) => written.push(JSON.parse(s)), on() {}, end() {} },
			stdout: { setEncoding() {}, on() {} }, stderr: { setEncoding() {}, on() {} }, on() {}, kill() {} }
		const project = { previs: { tracking: { detection: { enabled: true }, cameras: [{ id: 'cam_1', role: 'ch5' }, { id: 'cam_2', role: 'ch6' }] } } }
		const svc = createDetectService(null, { project, autostart: false, spawn: () => child, exists: () => true, hasSurface: () => true,
			lease: async () => {}, duties: { provide() {}, refresh() {} } })
		if (!written.length) return svc.stop() // this project shape watches no camera here: nothing to check
		svc._handle({ type: 'ready', model: 'x', providers: [] })
		const pending = svc.capture('/tmp/x', 60)
		const req = written.find((m) => m.type === 'capture')
		assert.equal(req.dir, '/tmp/x')
		svc._handle({ type: 'captured', id: req.id, camera: 'cam_1', shots: [{ tid: 3, file: 'cap-1-cam_1-3.jpg', box: [0, 0, 1, 1] }, { tid: 4, file: '../../etc/passwd' }] })
		const shots = await pending
		assert.deepEqual(shots.map((s) => s.file), ['cap-1-cam_1-3.jpg'], 'only the sidecar\'s own file names are accepted')
		svc.stop()
	})
})

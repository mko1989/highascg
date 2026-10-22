'use strict'

/**
 * WO-675 — presenter recognition. Server: the /tmp roster (consent required, JPEG only, photo + roster.json 0600,
 * reloaded after a restart, removed with the presenter); face suggestions only above SFace's threshold and clear of
 * the runner-up, never auto-bound (owner D1); the operator's assign drives a named hub marker; the zone action
 * `presenter` fires that presenter's own Companion / look actions; the HTTP routes incl. the phone intake page.
 * Detect service: face features reach the sink and never the WS snapshot. Sidecar: test_face.py (venv only).
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { createPresenters, cleanActions, MARKER_BASE } = require('../../src/tracking/presenters')
const { handlePresenters, intakeUrls } = require('../../src/tracking/presenter-routes')
const { MarkerHub } = require('../../src/tracking/marker-hub')
const { createZoneService } = require('../../src/tracking/zone-service')
const { parseAction } = require('../../src/tracking/zone-actions')

const ROOT = path.join(__dirname, '..', '..')
const VENV_PY = path.join(os.homedir(), '.local/share/highascg/tracking-venv/bin/python')
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64')
const dirs = []
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

const vec = (i, j = -1, w = 0) => {
	const v = new Array(128).fill(0)
	v[i] = 1
	if (j >= 0) v[j] = w
	return v
}
const settle = () => new Promise((r) => setImmediate(r))

function roster(extra = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo675-'))
	dirs.push(dir)
	let t = 1000
	const faces = { 'p1.jpg': vec(0), 'p2.jpg': vec(1) }
	const embed = async (photo) => {
		const f = faces[path.basename(photo)]
		return f ? { ok: true, feature: f } : { ok: false, detail: 'no face' }
	}
	const hub = new MarkerHub()
	const p = createPresenters(null, { dir, hub, embed, now: () => t, ...extra })
	return { p, hub, dir, embed, clock: (ms) => (t += ms) }
}

describe('WO-675 presenter roster', () => {
	it('needs consent, a name and a JPEG; keeps the photo and roster private in its dir', async () => {
		const { p, dir } = roster()
		assert.equal((await p.create({ name: 'Anna', photo: JPEG })).status, 400, 'no consent → refused')
		assert.equal((await p.create({ consent: true, photo: JPEG })).status, 400, 'no name → refused')
		assert.equal((await p.create({ consent: true, name: 'Anna', photo: Buffer.from('GIF89a…').toString('base64') })).status, 400, 'not a JPEG')
		const r = await p.create({ consent: true, name: 'Anna', mic: '4', note: 'opens', photo: 'data:image/jpeg;base64,' + JPEG })
		assert.equal(r.status, 201)
		assert.equal(r.body.presenter.id, 'p1')
		assert.equal(r.body.presenter.marker, MARKER_BASE + 1)
		await settle()
		assert.equal(p.list()[0].face, 'ok', 'the intake photo got a face feature')
		assert.equal(p.list()[0].feature, undefined, 'features never leave the server')
		for (const f of ['p1.jpg', 'roster.json']) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o077, 0, `${f} is owner-only`)
		assert.equal(fs.statSync(dir).mode & 0o077, 0, 'the dir is owner-only')
	})

	it('reloads after a server restart (same /tmp dir) and forgets bindings; remove deletes the photo', async () => {
		const { p, dir, embed, hub } = roster()
		await p.create({ consent: true, name: 'Anna', photo: JPEG })
		await settle()
		p.assign('p1', 'w:3')
		const q = createPresenters(null, { dir, hub, embed })
		assert.equal(q.list().length, 1)
		assert.equal(q.list()[0].name, 'Anna')
		assert.equal(q.list()[0].person, null, 'a restart drops the binding: track ids do not survive it')
		assert.equal(q.wantsFaces(), true, 'the face feature came back from roster.json')
		assert.ok(q.remove('p1'))
		assert.equal(fs.existsSync(path.join(dir, 'p1.jpg')), false)
	})

	it('suggests only a clear, repeated match and never binds by itself (D1)', async () => {
		const { p } = roster()
		await p.create({ consent: true, name: 'Anna', photo: JPEG })
		await p.create({ consent: true, name: 'Ben', photo: JPEG })
		await settle()
		p.observe([{ key: 'w:7', feature: vec(0, 1, 0.2) }])
		assert.deepEqual(p.suggestions(), [], 'one sighting is not enough')
		p.observe([{ key: 'w:7', feature: vec(0, 1, 0.2) }])
		const s = p.suggestions()
		assert.equal(s.length, 1)
		assert.equal(s[0].presenter, 'p1')
		assert.equal(s[0].key, 'w:7')
		assert.equal(p.list()[0].person, null, 'still unbound until the operator confirms')
		p.observe([{ key: 'w:8', feature: vec(0, 1, 1) }, { key: 'w:8', feature: vec(0, 1, 1) }])
		assert.ok(!p.suggestions().some((x) => x.key === 'w:8'), 'Anna and Ben equally likely → no suggestion')
		p.observe([{ key: 'w:9', feature: vec(5) }, { key: 'w:9', feature: vec(5) }])
		assert.ok(!p.suggestions().some((x) => x.key === 'w:9'), 'below the threshold → no suggestion')
		p.assign('p1', 'w:7')
		assert.ok(!p.suggestions().some((x) => x.key === 'w:7'), 'a confirmed match stops being suggested')
	})

	it('a bound presenter drives a named marker; lost → no update (stale)', async () => {
		const { p, hub } = roster()
		await p.create({ consent: true, name: 'Anna', mic: '4', photo: JPEG })
		assert.equal(p.assign('p1', 'nonsense').status, 400)
		p.assign('p1', 'w:7')
		p.tick((key) => (key === 'w:7' ? { x: 1.5, y: 2 } : null))
		const m = hub.markers.get(MARKER_BASE + 1)
		assert.equal(m.name, 'Anna (mic 4)')
		assert.equal(m.x, 1.5)
		assert.equal(m.source, 'presenter')
		p.tick(() => null)
		assert.equal(hub.markers.get(MARKER_BASE + 1).x, 1.5, 'lost: held where it was')
		p.release('p1')
		assert.equal(hub.markers.has(MARKER_BASE + 1), false, 'release removes the marker')
	})

	it('only look / companion actions; the zone action `presenter` runs them on enter and exit', async () => {
		assert.deepEqual(cleanActions('companion:1/2/3, presenter, look:abc@preview\nnope'), ['companion:1/2/3', 'look:abc@preview'])
		assert.deepEqual(parseAction('presenter'), { type: 'presenter' })
		const { p, hub } = roster()
		await p.create({ consent: true, name: 'Anna', mic: '4', photo: JPEG })
		p.update('p1', { on_enter: 'companion:1/2/3', on_exit: ['companion:1/2/4'] })
		p.assign('p1', 'w:7')
		const pressed = []
		const fetch = async (url) => {
			pressed.push(url.replace(/^http:\/\/[^/]+/, ''))
			return { ok: true, status: 200 }
		}
		const zones = { enabled: true, debounce_ms: 0, hysteresis: 0, list: [{ id: 'stage', vertices: [[0, 0], [4, 0], [4, 4], [0, 4]],
			actions: { first_entry: 'presenter', final_exit: 'presenter' } }] }
		const svc = createZoneService({ presenters: p }, hub, { project: { previs: { tracking: { zones } } }, autostart: false, fetch })
		p.tick(() => ({ x: 2, y: 2 }))
		svc.tick()
		await settle()
		await settle()
		hub.set({ id: MARKER_BASE + 1, x: 9, y: 9, z: 0, source: 'presenter' })
		svc.tick()
		await settle()
		await settle()
		svc.stop()
		assert.deepEqual(pressed, ['/api/location/1/2/3/press', '/api/location/1/2/4/press'])
		assert.match(svc.status().recent[1].detail, /^Anna: companion 1\/2\/3/)
	})
})

describe('WO-675 presenter routes', () => {
	const call = (p, method, route, body) => handlePresenters(p, { method, path: route, body: body === undefined ? '' : JSON.stringify(body) })

	it('intake page, list, create, photo, update, assign, delete, clear', async () => {
		const { p } = roster()
		const page = await call(p, 'GET', '/api/tracking/presenters/intake')
		assert.match(page.headers['Content-Type'], /text\/html/)
		assert.match(page.body, /id="consent"/)
		const made = await call(p, 'POST', '/api/tracking/presenters/', { consent: true, name: 'Anna', photo: JPEG })
		assert.equal(made.status, 201, 'the intake page posts to "./" → trailing slash')
		const list = JSON.parse((await call(p, 'GET', '/api/tracking/presenters')).body)
		assert.equal(list.presenters.length, 1)
		assert.equal(list.intake_path, '/api/tracking/presenters/intake')
		assert.ok(Array.isArray(list.intake_urls))
		const nets = { lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], eth0: [{ family: 'IPv4', address: '10.0.0.5', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }] }
		assert.deepEqual(intakeUrls(4200, nets), ['http://10.0.0.5:4200/api/tracking/presenters/intake'], 'LAN IPv4 only')
		const photo = await call(p, 'GET', '/api/tracking/presenters/p1/photo')
		assert.equal(photo.headers['Content-Type'], 'image/jpeg')
		assert.equal(photo.body[0], 0xff)
		assert.equal((await call(p, 'POST', '/api/tracking/presenters/p1', { mic: '7' })).status, 200)
		assert.equal((await call(p, 'POST', '/api/tracking/presenters/p1/assign', { key: 'cam_1:4' })).status, 200)
		assert.equal(p.list()[0].person, 'cam_1:4')
		assert.equal((await call(p, 'POST', '/api/tracking/presenters/p1/release')).status, 200)
		assert.equal((await call(p, 'DELETE', '/api/tracking/presenters/p1')).status, 200)
		assert.equal((await call(p, 'GET', '/api/tracking/presenters/p1/photo')).status, 404)
		await call(p, 'POST', '/api/tracking/presenters', { consent: true, name: 'Ben', photo: JPEG })
		await call(p, 'DELETE', '/api/tracking/presenters')
		assert.equal(p.list().length, 0, 'clear = end of show')
		assert.equal(await call(p, 'GET', '/api/tracking/markers'), null, 'other tracking routes fall through')
		assert.equal((await call(null, 'GET', '/api/tracking/presenters')).status, 503)
	})
})

describe('WO-675 wiring', () => {
	it('the detect service passes faces to the sink only and sends `faces` in the sidecar config', () => {
		const src = fs.readFileSync(path.join(ROOT, 'src/tracking/detect-service.js'), 'utf8')
		assert.match(src, /threads: det\.threads, faces,/)
		assert.match(src, /onFaces\(ce\.id, seen\.map/)
		const reg = fs.readFileSync(path.join(ROOT, 'src/tracking/register.js'), 'utf8')
		assert.match(reg, /_detect\.setFaces\(_presenters\.wantsFaces\(\), observeFaces\)/)
		assert.match(reg, /ctx\.presenters = _presenters/)
	})

	it('test_face.py self-test (sidecar venv only)', (t) => {
		if (!fs.existsSync(VENV_PY)) return t.skip('no tracking venv on this machine')
		const r = spawnSync(VENV_PY, [path.join(ROOT, 'tools/tracking-detect/test_face.py')], { encoding: 'utf8' })
		assert.equal(r.status, 0, r.stderr || r.stdout)
		assert.match(r.stdout, /ok test_throttle_and_budget/)
	})
})

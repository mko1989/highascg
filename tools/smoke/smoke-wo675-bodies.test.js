'use strict'

/**
 * WO-675 P2 — body recognition for wide stage shots. presenter-match.js: a body-only suggestion needs its own
 * threshold, sightings and margin; face and body agreeing say `face+body`, disagreeing say nothing; a clearly seen
 * face vetoes a body match; one suggestion per presenter, face-backed first. presenters.js: the intake photo's body
 * feature (status, persisted, reloaded, wantsBodies). Wiring: the sidecar's `body` reaches the sink as kind 'body',
 * `bodies` goes in the sidecar config, the intake passes a YOLO to face_embed.py. Sidecar: test_body.py (venv only).
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { createMatcher, KINDS } = require('../../src/tracking/presenter-match')
const { createPresenters } = require('../../src/tracking/presenters')
const { MarkerHub } = require('../../src/tracking/marker-hub')

const ROOT = path.join(__dirname, '..', '..')
const VENV_PY = path.join(os.homedir(), '.local/share/highascg/tracking-venv/bin/python')
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const dirs = []
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

/** A unit-ish vector of length n: axis i, plus weight w on axis j (cosine with axis i = 1 / sqrt(1 + w²)). */
const vec = (n, i, j = -1, w = 0) => {
	const v = new Array(n).fill(0)
	v[i] = 1
	if (j >= 0) v[j] = w
	return v
}
const face = (i, j, w) => vec(128, i, j, w)
const body = (i, j, w) => vec(768, i, j, w)
const unitOf = (v) => {
	const n = Math.hypot(...v)
	return v.map((x) => x / n)
}

describe('WO-675 P2 face + body fusion', () => {
	const P = [
		{ id: 'p1', face: unitOf(face(0)), body: unitOf(body(0)) },
		{ id: 'p2', face: unitOf(face(1)), body: unitOf(body(1)) },
	]
	const has = () => true
	const free = () => false
	const times = (n, fn) => {
		for (let i = 0; i < n; i++) fn()
	}

	it('body alone: its own threshold, sightings and margin', () => {
		const m = createMatcher(() => 1000)
		times(2, () => m.observe('body', [{ key: 'w:1', feature: body(0, 5, 0.5) }], P))
		assert.deepEqual(m.suggestions(has, free), [], `${KINDS.body.seen} sightings needed`)
		m.observe('body', [{ key: 'w:1', feature: body(0, 5, 0.5) }], P)
		assert.deepEqual(m.suggestions(has, free), [{ presenter: 'p1', key: 'w:1', score: 0.894, via: 'body' }])
		times(3, () => m.observe('body', [{ key: 'w:2', feature: body(0, 5, 2) }], P))
		assert.ok(!m.suggestions(has, free).some((s) => s.key === 'w:2'), '0.447 is under the body threshold')
		times(3, () => m.observe('body', [{ key: 'w:3', feature: body(0, 1, 0.9) }], P))
		assert.ok(!m.suggestions(has, free).some((s) => s.key === 'w:3'), 'p1 and p2 too close')
		times(3, () => m.observe('body', [{ key: 'w:4', feature: face(0) }], P))
		assert.ok(!m.suggestions(has, free).some((s) => s.key === 'w:4'), 'a 128-d feature never meets a body')
	})

	it('agreeing → face+body; disagreeing → nothing; a clear face vetoes a body match', () => {
		const m = createMatcher(() => 1000)
		times(3, () => m.observe('body', [{ key: 'w:1', feature: body(0) }, { key: 'w:2', feature: body(0) }, { key: 'w:3', feature: body(0) }], P))
		times(2, () => m.observe('face', [{ key: 'w:1', feature: face(0) }, { key: 'w:2', feature: face(1) }, { key: 'w:3', feature: face(2) }], P))
		const s = m.suggestions(has, free)
		assert.deepEqual(s.map((x) => [x.key, x.via]), [['w:1', 'face+body']], 'w:2 disagrees, w:3 has a face that is neither')
	})

	it('one suggestion per presenter, a face-backed one first; confirmed and removed presenters drop out', () => {
		const m = createMatcher(() => 1000)
		times(3, () => m.observe('body', [{ key: 'w:1', feature: body(0) }, { key: 'w:2', feature: body(0, 9, 0.3) }], P))
		times(2, () => m.observe('face', [{ key: 'w:2', feature: face(0, 9, 0.2) }], P))
		assert.deepEqual(m.suggestions(has, free).map((x) => [x.key, x.via]), [['w:2', 'face+body']], 'the face beats the better body')
		assert.deepEqual(m.suggestions(has, (pid, key) => key === 'w:2').map((x) => x.key), ['w:1'])
		assert.deepEqual(m.suggestions((pid) => pid !== 'p1', free), [])
		m.forget('p1')
		assert.deepEqual(m.suggestions(has, free), [])
	})

	it('evidence goes stale after the TTL', () => {
		let t = 1000
		const m = createMatcher(() => t)
		times(3, () => m.observe('body', [{ key: 'w:1', feature: body(0) }], P))
		assert.equal(m.suggestions(has, free).length, 1)
		t += 10001
		assert.deepEqual(m.suggestions(has, free), [])
	})
})

describe('WO-675 P2 presenter body feature', () => {
	function roster(result) {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo675b-'))
		dirs.push(dir)
		const embed = async () => result
		return { dir, embed, p: createPresenters(null, { dir, hub: new MarkerHub(), embed, now: () => 1000 }) }
	}
	const settle = () => new Promise((r) => setImmediate(r))

	it('the intake photo gives a body feature; kept across a restart; drives wantsBodies and body suggestions', async () => {
		const { p, dir, embed } = roster({ ok: false, detail: 'no face', body: { ok: true, feature: body(3), via: 'detector' } })
		await p.create({ consent: true, name: 'Anna', photo: JPEG })
		await settle()
		assert.equal(p.list()[0].face, 'none')
		assert.equal(p.list()[0].body, 'ok')
		assert.equal(p.wantsFaces(), false)
		assert.equal(p.wantsBodies(), true)
		assert.ok(!JSON.stringify(p.snapshot()).includes('0,0,0'), 'no features in the public snapshot')
		for (let i = 0; i < 3; i++) p.observe([{ key: 'cam_1:4', feature: body(3) }], 'body')
		assert.deepEqual(p.suggestions(), [{ presenter: 'p1', key: 'cam_1:4', score: 1, via: 'body' }])
		const q = createPresenters(null, { dir, hub: new MarkerHub(), embed })
		assert.equal(q.wantsBodies(), true, 'the body feature came back from roster.json')
	})

	it('no person → none; no body result at all → unavailable', async () => {
		const a = roster({ ok: true, feature: face(0), body: { ok: false, detail: 'no person' } })
		await a.p.create({ consent: true, name: 'Anna', photo: JPEG })
		await settle()
		assert.equal(a.p.list()[0].body, 'none')
		const b = roster({ ok: true, feature: face(0) })
		await b.p.create({ consent: true, name: 'Ben', photo: JPEG })
		await settle()
		assert.equal(b.p.list()[0].body, 'unavailable')
		assert.equal(b.p.wantsBodies(), false)
	})
})

describe('WO-675 P2 wiring', () => {
	it('sidecar body features reach the sink as kind body; `bodies` in the config; the intake gets a YOLO', () => {
		const det = read('src/tracking/detect-service.js')
		assert.match(det, /threads: det\.threads, faces, bodies,/)
		assert.match(det, /onFaces\(ce\.id, shapes\.map\(\(t\) => \(\{ tid: Number\(t\.tid\), feature: t\.body \}\)\), 'body'\)/)
		assert.match(read('src/tracking/register.js'), /_presenters\.observe\(out, kind\)/)
		assert.match(read('src/tracking/presenters.js'), /\[script, photo, models, intakeDetector\(models\)\]/)
		const side = read('tools/tracking-detect/sidecar.py')
		assert.match(side, /attach_bodies\(bodies, cam, tracks, bgr, now\)/)
		assert.match(read('tools/tracking-detect/fetch-face-models.sh'), /person_reid_youtu_2021nov\.onnx 0579683334d4b944/)
	})

	it('the detect service forwards both kinds to the sink, nothing into its frames', () => {
		const { createDetectService } = require('../../src/tracking/detect-service')
		const project = { previs: { tracking: { cameras: [{ id: 'cam_1', role: 'ch1' }], detection: { enabled: true } } } }
		const svc = createDetectService({ log: () => {} }, { spawn: () => null, exists: () => false, python: '/fake/python',
			modelsDir: '/fake/models', lease: () => Promise.resolve([]), autostart: false, project })
		const got = []
		svc.setFaces(false, (cam, list, kind = 'face') => got.push([cam, kind, list.map((x) => x.tid)]), true)
		svc._handle({ type: 'tracks', camera: 'cam_1', frame: 1, w: 1920, h: 1080, ms: 5, tracks: [
			{ tid: 1, box: [0.1, 0.1, 0.2, 0.9], score: 0.9, age_s: 0, face: face(0), body: body(0) },
			{ tid: 2, box: [0.5, 0.1, 0.6, 0.9], score: 0.9, age_s: 0, body: body(1) },
		] })
		svc.stop()
		assert.deepEqual(got, [['cam_1', 'face', [1]], ['cam_1', 'body', [1, 2]]])
		assert.ok(!JSON.stringify(svc.status()).includes('"body"'), 'features never reach the status / WS')
	})

	it('test_body.py self-test (sidecar venv only)', (t) => {
		if (!fs.existsSync(VENV_PY)) return t.skip('no tracking venv on this machine')
		const r = spawnSync(VENV_PY, [path.join(ROOT, 'tools/tracking-detect/test_body.py')], { encoding: 'utf8' })
		assert.equal(r.status, 0, r.stderr || r.stdout)
		assert.match(r.stdout, /ok test_throttle_budget_one_batch/)
	})
})

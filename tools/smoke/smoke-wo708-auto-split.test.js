'use strict'
/**
 * WO-708 — Follow → Auto for several people (owner 23.10.26: "more than one presenter on auto it should split the
 * lights so they follow half front lights one presenter the other the second and so on"). auto-director.js drives
 * one marker per followed person (A1…A9 = 64999…, Pin k = 64980 + k) and splits the Auto pool across them: explicit
 * slot counts first, the rest shared evenly, nearest heads, sticky, re-split LOST_S after someone leaves.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { MarkerHub } = require('../../src/tracking/marker-hub')
const { normalizeDetection } = require('../../src/tracking/detect-model')
const { AUTO_MARKER_ID } = require('../../src/tracking/auto-follow')
const { createAutoDirector, PIN_BASE, LOST_S, JOIN_S } = require('../../src/tracking/auto-director')
const { splitHeads } = require('../../src/tracking/auto-split')
const { handleAuto, createAutoBroadcast } = require('../../src/tracking/auto-routes')
const { autoFile, loadSettings } = require('../../src/tracking/auto-store')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { project } = require('../../src/tracking/camera-model')

const ROOT = path.join(__dirname, '../..')
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wo708-')), 'tracking-auto.json')
const person = (x, y, id) => ({
	key: `w:${id}`,
	camera: 'world',
	tid: id,
	world: [x, y],
	score: 0.9,
	age_s: 0,
	area: 5000,
})
/** n Auto heads on a downstage truss, x = -3, -1, 1, 3 … (left to right). */
const truss = (n, xs = null) =>
	Array.from({ length: n }, (_, i) => ({
		id: `h${i + 1}`,
		follow: AUTO_MARKER_ID,
		pose: { x: xs ? xs[i] : -3 + 2 * i, y: 0, z: 6 },
	}))

const CAM = { pos_x: 0, pos_y: -10, pos_z: 5, pitch: -20, yaw: 0, roll: 0, fov: 60, lens_k1: 0, lens_k2: 0 }
/** A camera person (key cam_1:tid) whose box feet are the floor point [x, y] (smoke-wo616-tracking-pin boxAt). */
function camPerson(x, y, tid) {
	const [[sx, sy]] = project(CAM, [[x, y, 0]], 1920, 1080)
	const box = [sx / 1920 - 0.02, sy / 1080 - 0.2, sx / 1920 + 0.02, sy / 1080]
	return {
		key: `cam_1:${tid}`,
		camera: 'cam_1',
		tid,
		box,
		score: 0.8,
		age_s: 0,
		camEntry: { cam: CAM, raster: [1920, 1080] },
	}
}

function rig({ heads = 4, xs = null, file = tmpFile(), ptz = null, cfgOver = {} } = {}) {
	let t = 1000
	const hub = new MarkerHub({ now: () => t })
	const dir = createAutoDirector({ file, ptz })
	const cfg = normalizeDetection({ enabled: true, pin_mode: 'assist', smoothing: 1, prediction: 0, ...cfgOver })
	const fixtures = truss(heads, xs)
	const step = (persons, ms = 50) => {
		t += ms
		dir.step({ cfg, available: true, persons, hub, planeZ: 0, now: t, dt: ms / 1000, fixtures })
	}
	const hold = (persons, seconds) => {
		for (let s = 0; s < seconds * 20; s++) step(persons)
	}
	const marks = () => new Map(hub.list(t).map((m) => [m.id, m]))
	const target = (id) => dir.resolveAuto({ id }, marks())
	const heads_ = (key) => dir.snapshot().persons.find((p) => p.key === key)?.heads
	return { hub, dir, cfg, fixtures, step, hold, target, heads: heads_, marks }
}

describe('WO-708 Auto split', () => {
	it('one person: every pool head follows them on A1 (WO-707 behaviour)', () => {
		const r = rig()
		r.hold([person(0.5, 3, 1)], 1)
		const m = r.hub.markers.get(AUTO_MARKER_ID)
		assert.equal(m.name, 'Auto — tracked person')
		assert.ok(Math.hypot(m.x - 0.5, m.y - 3) < 0.05)
		for (const fx of r.fixtures) assert.equal(r.target(fx.id).id, AUTO_MARKER_ID)
		assert.deepEqual(r.heads('w:1'), ['h1', 'h2', 'h3', 'h4'])
	})

	it('two people: half / half, each the nearest heads', () => {
		const r = rig()
		r.hold([person(-2, 3, 1), person(2, 3, 2)], 1)
		assert.deepEqual(r.heads('w:1'), ['h1', 'h2'], 'stage right person gets the stage right heads')
		assert.deepEqual(r.heads('w:2'), ['h3', 'h4'])
		assert.equal(r.target('h1').id, AUTO_MARKER_ID)
		assert.equal(r.target('h4').id, AUTO_MARKER_ID - 1)
		assert.ok(Math.hypot(r.target('h4').x - 2, r.target('h4').y - 3) < 0.05)
	})

	it('camera persons (one camera, no fusion): floor-cast by their DetectPin, split the same way', () => {
		const r = rig({ cfgOver: { pin_point: 'bottom' } })
		r.hold([camPerson(-2, 3, 4), camPerson(2, 3, 8)], 1)
		const s = r.dir.snapshot()
		const left = s.persons.find((p) => p.key === 'cam_1:4')
		assert.deepEqual(left.heads, ['h1', 'h2'])
		assert.deepEqual(s.persons.find((p) => p.key === 'cam_1:8').heads, ['h3', 'h4'])
		assert.ok(Math.hypot(left.x + 2, left.y - 3) < 0.05, `on the floor point (${left.x}, ${left.y})`)
		assert.ok(Math.hypot(r.target('h4').x - 2, r.target('h4').y - 3) < 0.05)
	})

	it('an odd pool: the remainder head goes to the nearer person', () => {
		const r = rig({ heads: 3, xs: [-3, -1, 1] })
		r.hold([person(-2, 1, 1), person(3, 1, 2)], 1)
		assert.deepEqual(r.heads('w:1'), ['h1', 'h2'])
		assert.deepEqual(r.heads('w:2'), ['h3'])
	})

	it('a newcomer joins after JOIN_S, a one-frame false detection never re-splits', () => {
		const r = rig()
		r.hold([person(-2, 3, 1)], 1)
		r.step([person(-2, 3, 1), person(2, 3, 9)])
		r.hold([person(-2, 3, 1)], 0.5)
		assert.equal(r.heads('w:1').length, 4, 'flicker ignored')
		assert.equal(r.hub.markers.has(AUTO_MARKER_ID - 1), false, 'no phantom A2 marker')
		r.hold([person(-2, 3, 1), person(2, 3, 2)], JOIN_S + 0.2)
		assert.deepEqual(r.heads('w:2'), ['h3', 'h4'])
	})

	it('a pin with an explicit head count takes its n nearest heads first', () => {
		const r = rig()
		const both = [person(-2, 3, 1), person(2.5, 3, 2)]
		r.hold(both, 1)
		assert.equal(r.dir.pin({ key: 'w:2', slot: 1 }).status, 200)
		assert.equal(r.dir.slot({ slot: 1, heads: 1 }).status, 200)
		r.hold(both, 0.2)
		const p2 = r.dir.snapshot().persons.find((p) => p.key === 'w:2')
		assert.equal(p2.slot, 1)
		assert.equal(p2.marker, PIN_BASE + 1)
		assert.deepEqual(p2.heads, ['h4'], 'one head, the nearest')
		assert.deepEqual(r.heads('w:1'), ['h1', 'h2', 'h3'], 'the rest shared by the unpinned person')
		assert.equal(r.hub.markers.get(PIN_BASE + 1).name, 'Pin 1')
		assert.equal(r.hub.markers.has(AUTO_MARKER_ID - 1), false, 'A2 left the hub, A1 compacted')
		assert.equal(r.target('h4').id, PIN_BASE + 1)
	})

	it('share + explicit mix, counts capped in slot order by what is left', () => {
		const pool = truss(6).map((f, i) => ({ ...f, pose: { x: i, y: 0 } }))
		const lanes = [
			{ marker: 1, slot: 1, heads: 2, pos: [5, 2] },
			{ marker: 2, slot: 2, heads: 0, pos: [0, 2] },
			{ marker: 3, slot: 0, heads: 0, pos: [2.5, 2] },
		]
		const out = splitHeads({ pool, lanes })
		const of = (m) => [...out].filter(([, v]) => v === m).map(([k]) => k)
		assert.deepEqual(of(1), ['h5', 'h6'], 'explicit slot: its 2 nearest')
		assert.deepEqual(of(2), ['h1', 'h2'])
		assert.deepEqual(of(3), ['h3', 'h4'])
		const capped = splitHeads({ pool, lanes: [{ ...lanes[0], heads: 5 }, { ...lanes[1], heads: 4 }, lanes[2]] })
		const cnt = (m) => [...capped.values()].filter((v) => v === m).length
		assert.deepEqual([cnt(1), cnt(2), cnt(3)], [5, 1, 0], 'slot 1 first, slot 2 capped, nothing left to share')
		const none = splitHeads({ pool, lanes: [{ ...lanes[0], heads: 2 }] })
		assert.equal(none.size, 2, 'no share person: the leftover heads are unassigned (hold / home)')
	})

	it('sticky: position jitter (even crossing over) never re-splits', () => {
		const r = rig()
		r.hold([person(-2, 3, 1), person(2, 3, 2)], 1)
		for (let i = 0; i < 60; i++) r.step([person(2 + Math.sin(i) * 0.3, 3, 1), person(-2 + Math.cos(i) * 0.3, 3, 2)])
		assert.deepEqual(r.heads('w:1'), ['h1', 'h2'], 'they swapped sides: the heads stay with their person')
		assert.deepEqual(r.heads('w:2'), ['h3', 'h4'])
	})

	it('someone leaves: their heads hold for LOST_S, then the split recomputes without them', () => {
		const r = rig()
		r.hold([person(-2, 3, 1), person(2, 3, 2)], 1)
		r.hold([person(-2, 3, 1)], LOST_S - 0.5)
		const gone = r.dir.snapshot().persons.find((p) => p.key === 'w:2')
		assert.equal(gone.lost, true)
		assert.deepEqual(gone.heads, ['h3', 'h4'], 'still holding')
		assert.equal(r.target('h4').status, 0, 'held, flagged invalid')
		r.hold([person(-2, 3, 1)], 1)
		assert.deepEqual(r.heads('w:1'), ['h1', 'h2', 'h3', 'h4'])
		assert.equal(r.dir.snapshot().persons.length, 1)
		assert.equal(r.hub.markers.has(AUTO_MARKER_ID - 1), false, 'A2 removed')
	})

	it('a track id churn near where someone was lost inherits their lane and pin (no re-split)', () => {
		const r = rig()
		r.hold([person(-2, 3, 1), person(2, 3, 2)], 1)
		r.dir.pin({ key: 'w:2', slot: 3 })
		r.hold([person(-2, 3, 1), person(2, 3, 2)], 0.2)
		r.hold([person(-2, 3, 1)], 0.5)
		r.hold([person(-2, 3, 1), person(2.2, 3, 7)], 0.5)
		const s = r.dir.snapshot()
		assert.equal(s.slots[2].key, 'w:7')
		assert.deepEqual(s.persons.find((p) => p.key === 'w:7').heads, ['h3', 'h4'])
		assert.equal(s.persons.find((p) => p.key === 'w:7').marker, PIN_BASE + 3)
	})

	it('a pinned person who leaves frees the key after LOST_S; the slot keeps its settings', () => {
		const r = rig()
		r.hold([person(-2, 3, 1), person(2, 3, 2)], 1)
		r.dir.pin({ key: 'w:2', slot: 2 })
		r.dir.slot({ slot: 2, heads: 2 })
		r.hold([person(-2, 3, 1)], LOST_S + 0.5)
		const s = r.dir.snapshot().slots[1]
		assert.deepEqual([s.key, s.heads], [null, 2])
	})

	it('PTZ: a slot camera follows its person, an auto camera A1, home → "home", else null', () => {
		const cams = [
			{ id: 'ptz1', name: 'Cam L', enabled: true, auto: false },
			{ id: 'ptz2', name: 'Cam R', enabled: true, auto: true },
			{ id: 'ptz3', name: 'Spare', enabled: true, auto: false },
		]
		const ptz = { cameras: () => cams, status: () => cams.map((c) => ({ id: c.id, state: 'idle' })) }
		const r = rig({ ptz })
		r.hold([person(-2, 3, 1), person(2, 3, 2)], 1)
		r.dir.pin({ key: 'w:2', slot: 1 })
		assert.equal(r.dir.slot({ slot: 1, ptz: ['ptz1'] }).status, 200)
		assert.equal(r.dir.slot({ slot: 1, ptz: ['nope'] }).status, 400, 'unknown camera with a PTZ service')
		r.hold([person(-2, 3, 1), person(2, 3, 2)], 0.2)
		const p1 = r.dir.ptzTargetOf('ptz1')
		assert.ok(Math.hypot(p1.x - 2, p1.y - 3) < 0.05)
		const p2 = r.dir.ptzTargetOf('ptz2')
		assert.ok(Math.hypot(p2.x + 2, p2.y - 3) < 0.05, 'auto → A1')
		assert.equal(r.dir.ptzTargetOf('ptz3'), null)
		const s = r.dir.snapshot()
		assert.deepEqual(s.persons.find((p) => p.key === 'w:2').ptz, ['ptz1'])
		assert.deepEqual(s.persons.find((p) => p.key === 'w:1').ptz, ['ptz2'])
		assert.deepEqual(s.ptz[0], { id: 'ptz1', name: 'Cam L', enabled: true, state: 'idle' })
		r.dir.slot({ slot: 4, ptz: ['ptz1'] })
		assert.deepEqual(
			[r.dir.snapshot().slots[0].ptz, r.dir.snapshot().slots[3].ptz],
			[[], ['ptz1']],
			'one slot per camera'
		)
		r.dir.home({ now: true })
		r.hold([], 0.1)
		assert.equal(r.dir.ptzTargetOf('ptz2'), 'home')
		assert.equal(r.dir.ptzTargetOf('ptz3'), null)
	})

	it('API: GET shape and POST validation', () => {
		const r = rig()
		r.hold([person(-2, 3, 1)], 0.5)
		const call = (method, p, body) => {
			const out = handleAuto(r.dir, {
				method,
				path: p,
				body: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body),
			})
			return out && { status: out.status, body: JSON.parse(out.body) }
		}
		const g = call('GET', '/api/tracking/auto')
		assert.equal(g.status, 200)
		assert.deepEqual(Object.keys(g.body), ['pool', 'primary', 'persons', 'slots', 'home', 'ptz'])
		assert.deepEqual(g.body.pool, ['h1', 'h2', 'h3', 'h4'])
		assert.equal(g.body.primary, AUTO_MARKER_ID)
		assert.equal(g.body.slots.length, 9)
		assert.deepEqual(g.body.slots[0], { slot: 1, key: null, heads: 0, ptz: [] })
		assert.deepEqual(Object.keys(g.body.persons[0]), ['key', 'marker', 'slot', 'x', 'y', 'heads', 'ptz', 'lost'])
		assert.deepEqual(Object.keys(g.body.home), ['active', 'after_s', 'idle_s', 'forced'])
		assert.deepEqual(g.body.ptz, [])
		assert.equal(call('POST', '/api/tracking/auto/pin', { key: 'w:1', slot: 10 }).status, 400)
		assert.equal(call('POST', '/api/tracking/auto/pin', { key: 'w:1', slot: 1.5 }).status, 400)
		assert.equal(call('POST', '/api/tracking/auto/pin', { key: 'bad', slot: 1 }).status, 400)
		assert.equal(call('POST', '/api/tracking/auto/pin', { key: 'w:99', slot: 1 }).status, 404)
		assert.equal(call('POST', '/api/tracking/auto/pin', '{nope').status, 400)
		assert.equal(call('POST', '/api/tracking/auto/pin', '[1]').status, 400)
		assert.equal(call('POST', '/api/tracking/auto/pin', { key: 'w:1', slot: 2 }).body.slots[1].key, 'w:1')
		const moved = call('POST', '/api/tracking/auto/pin', { key: 'w:1', slot: 5 }).body.slots
		assert.deepEqual([moved[1].key, moved[4].key], [null, 'w:1'], 'a key is in one slot')
		assert.equal(call('POST', '/api/tracking/auto/pin', { key: 'w:1', slot: 0 }).body.slots[4].key, null, 'unpinned')
		assert.equal(call('POST', '/api/tracking/auto/slot', { slot: 0, heads: 1 }).status, 400)
		assert.equal(call('POST', '/api/tracking/auto/slot', { slot: 1, heads: 5 }).status, 400, 'more than the pool')
		assert.equal(call('POST', '/api/tracking/auto/slot', { slot: 1, heads: -1 }).status, 400)
		assert.equal(call('POST', '/api/tracking/auto/slot', { slot: 1, ptz: 'cam' }).status, 400)
		assert.equal(call('POST', '/api/tracking/auto/slot', { slot: 1, ptz: ['a b'] }).status, 400)
		assert.equal(call('POST', '/api/tracking/auto/slot', { slot: 1, heads: 4, ptz: ['camA'] }).body.slots[0].heads, 4)
		assert.equal(call('POST', '/api/tracking/auto/home', { after_s: 2 }).status, 400)
		assert.equal(call('POST', '/api/tracking/auto/home', { after_s: '20' }).status, 400)
		assert.equal(call('POST', '/api/tracking/auto/home', { now: 'yes' }).status, 400)
		assert.equal(call('POST', '/api/tracking/auto/home', { after_s: 30 }).body.home.after_s, 30)
		assert.equal(call('GET', '/api/tracking/auto/pin'), null, 'GET on a POST route: not ours')
		assert.equal(call('GET', '/api/tracking/markers'), null)
		assert.equal(handleAuto(null, { method: 'GET', path: '/api/tracking/auto' }).status, 503)
	})

	it('WS tracking:auto: ≤ 5 Hz and only on change', () => {
		const r = rig()
		const sent = []
		const ctx = { _wsBroadcast: (ev, d) => sent.push([ev, d]) }
		const ws = createAutoBroadcast()
		r.step([])
		let t = 0
		for (let i = 0; i < 30; i++) ws.tick(r.dir, ctx, (t += 33))
		assert.equal(sent.length, 1, 'idle: one send')
		assert.equal(sent[0][0], 'tracking:auto')
		assert.equal(r.dir.slot({ slot: 2, heads: 1 }).status, 200)
		ws.tick(r.dir, ctx, (t += 33))
		ws.tick(r.dir, ctx, t + 200)
		assert.equal(sent.length, 2)
		assert.equal(sent[1][1].slots[1].heads, 1)
	})

	it('persistence: slot settings + after_s survive a restart, pins do not; tests never touch ~/.highascg', () => {
		assert.ok(autoFile().startsWith(os.tmpdir()), `test runner file is a temp dir: ${autoFile()}`)
		assert.ok(!autoFile().startsWith(path.join(os.homedir(), '.highascg')))
		const prev = process.env.HIGHASCG_TRACKING_AUTO_FILE
		process.env.HIGHASCG_TRACKING_AUTO_FILE = '/tmp/x/auto.json'
		assert.equal(autoFile(), '/tmp/x/auto.json')
		if (prev === undefined) delete process.env.HIGHASCG_TRACKING_AUTO_FILE
		else process.env.HIGHASCG_TRACKING_AUTO_FILE = prev
		const file = tmpFile()
		const r = rig({ file })
		r.hold([person(0, 3, 1)], 0.2)
		r.dir.pin({ key: 'w:1', slot: 1 })
		r.dir.slot({ slot: 1, heads: 2, ptz: ['camA'] })
		r.dir.home({ after_s: 45 })
		const saved = loadSettings(file)
		assert.deepEqual(saved.slots[0], { heads: 2, ptz: ['camA'] })
		assert.equal(saved.after_s, 45)
		const again = createAutoDirector({ file }).snapshot()
		assert.deepEqual(again.slots[0], { slot: 1, key: null, heads: 2, ptz: ['camA'] })
		assert.equal(again.home.after_s, 45)
		fs.writeFileSync(file, '{ broken')
		assert.equal(createAutoDirector({ file }).snapshot().home.after_s, 10, 'a broken file falls back to defaults')
	})

	it('follow engine hook: unset = the plain marker 64999 (WO-707), set = the director target', () => {
		const marks = [{ id: AUTO_MARKER_ID, x: 2, y: 3, z: 0, status: 1, stale: false }]
		const make = () => {
			const eng = new FollowEngine({ hub: { now: () => 0, list: () => marks }, now: () => 0, send: () => {} })
			eng.configure({
				patch: [{ id: 'a', universe: 3, address: 1, dest: '10.0.0.9', pose: { x: 0, y: 0, z: 6 }, follow: AUTO_MARKER_ID }],
			})
			return eng
		}
		const plain = make()
		assert.equal(plain.resolveAuto, null)
		plain.tick()
		const ref = plain.status().fixtures[0]
		assert.equal(ref.state, 'following')
		const hooked = make()
		hooked.resolveAuto = (fx, m) => m.get(AUTO_MARKER_ID)
		hooked.tick()
		assert.deepEqual(hooked.status().fixtures[0], ref, 'same marker through the hook = the same aim')
		hooked.resolveAuto = () => null
		hooked.tick()
		assert.equal(hooked.status().fixtures[0].state, 'no marker', 'no target: hold')
		const other = new FollowEngine({
			hub: { now: () => 0, list: () => [{ ...marks[0], id: 1 }] },
			now: () => 0,
			send: () => {},
		})
		other.configure({
			patch: [{ id: 'b', universe: 3, address: 1, dest: '10.0.0.9', pose: { x: 0, y: 0, z: 6 }, follow: 1 }],
		})
		let called = 0
		other.resolveAuto = () => called++
		other.tick()
		assert.equal(called, 0, 'only heads on Auto ask the director')
		assert.equal(other.status().fixtures[0].state, 'following')
	})

	it('through the tracking module: GET /api/tracking/auto, and the moved /api/tracking/verify still answers', async () => {
		const registry = require('../../src/module-registry')
		const mod = require('../../src/tracking/register')
		registry.register(mod)
		const ctx = { _wsBroadcast: () => {}, log: () => {} }
		registry.bootOne('tracking', ctx)
		try {
			const g = await registry.handleApi('GET', '/api/tracking/auto', '', ctx)
			assert.equal(g.status, 200)
			const body = JSON.parse(g.body)
			assert.equal(body.primary, AUTO_MARKER_ID)
			assert.equal(body.slots.length, 9)
			const bad = await registry.handleApi('POST', '/api/tracking/auto/slot', JSON.stringify({ slot: 12 }), ctx)
			assert.equal(bad.status, 400)
			assert.equal((await registry.handleApi('GET', '/api/tracking/verify', '', ctx)).status, 200)
			const v = await registry.handleApi('POST', '/api/tracking/verify', JSON.stringify({ action: 'bogus' }), ctx)
			assert.deepEqual([v.status, JSON.parse(v.body).error], [400, 'action must be start | stop | reset'])
			assert.equal((await registry.handleApi('POST', '/api/tracking/verify', '{bad', ctx)).status, 400)
		} finally {
			await registry.shutdownOne('tracking')
			registry.unregister('tracking')
		}
	})

	it('wiring: register steps the director, merges its pins, routes and broadcasts it; the engine has the hook', () => {
		const reg = fs.readFileSync(path.join(ROOT, 'src/tracking/register.js'), 'utf8')
		assert.match(reg, /const auto = createAutoDirector\(\{ names: \(\) => _presenters\?\.list\(\) \|\| \[\] \}\)/)
		assert.match(reg, /const att = \{ \.\.\.auto\.attached\(\), \.\.\.pin\.attached\(\) \}/)
		assert.match(reg, /\|\| handleAuto\(auto, \{ method, path, body \}\)/)
		assert.match(reg, /autoWs\.tick\(auto, _ctx, hub\.now\(\)\)/)
		assert.match(reg, /_follow\.engine\.resolveAuto = auto\.resolveAuto/)
		assert.match(reg, /followProject\(auto, ctx\)/)
		const eng = fs.readFileSync(path.join(ROOT, 'src/fixtures/follow-engine.js'), 'utf8')
		assert.match(eng, /const auto = fx\.follow === AUTO_MARKER_ID && this\.resolveAuto/)
		assert.match(eng, /const m = auto \? this\.resolveAuto\(fx, marks\) : fx\.follow \? marks\.get\(fx\.follow\) : null/)
	})
})

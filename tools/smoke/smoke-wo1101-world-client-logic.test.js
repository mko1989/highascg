'use strict'

/**
 * WO-1101 — Game World client, pure logic (modules/game-world/client/visitor-logic.js, world-logic.js;
 * work/notes/game-world-contract.md §1–§3): what visitors.ingest() accepts (raw / decoded / garbage), interpolation
 * 100 ms behind, the vegetables' ballistic extrapolation ≤ 300 ms then hold, the 2 s fade (moving only — the hub never
 * repeats an unchanged entity), caps and tags per tier, the priority pick, the cut-away decision, slick patches, URL
 * acceptance, the spectator camera, the server clock and the ticker texts.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const DIR = path.join(__dirname, '..', '..', 'modules', 'game-world', 'client')
const load = (f) => import(pathToFileURL(path.join(DIR, f)).href)

let L, W, WW

before(async () => {
	L = await load('visitor-logic.js')
	W = await load('world-logic.js')
	WW = await load('world-wire.js')
})

const wv = (o) => ({ t: 'wv', v: 1, ts: 1000, ...o })

describe('WO-1101 visitors accept only clean world messages', () => {
	it('raw object, JSON text and already decoded messages all come out sanitised', () => {
		const raw = wv({ add: [[1, 'car', 'rc', '#FF0000', 'Ola', '']], e: [[1, 1, 0, 2, 0.5, 3]] })
		const a = L.toWorldMsg(raw)
		const b = L.toWorldMsg(JSON.stringify(raw))
		const c = L.toWorldMsg(WW.decodeWv(raw))
		assert.equal(a.t, 'wv')
		assert.deepEqual(a.d, b.d)
		assert.deepEqual(a.d, c.d)
		assert.equal(a.d.add[0][3], '#ff0000')
		const s = L.toWorldMsg({ t: 'wst', v: 1, on: true, models: { car: '/game/rc/car-model.js', veg: 'javascript:alert(1)' }, scale: 0.1 })
		assert.equal(s.t, 'wst')
		assert.deepEqual(s.d.models, { car: '/game/rc/car-model.js' })
		assert.deepEqual(L.toWorldMsg(WW.decodeWst({ t: 'wst', v: 1, on: false })), { t: 'wst', d: { on: false } })
	})

	it('a decoded-looking object is re-validated (no bypass of the codec)', () => {
		const r = L.toWorldMsg({ ts: 5, add: [[1, 'tank', 'rc', '#fff', 'x', '']], e: [[1, 1e9, 0, 0, 0, 0], [2, 1, 1, 1, 0, 0]] })
		assert.equal(r.t, 'wv')
		assert.deepEqual(r.d.add, [])
		assert.deepEqual(r.d.e, [[2, 1, 1, 1, 0, 0]])
		assert.equal(L.toWorldMsg({ on: 'yes' }), null)
	})

	it('garbage never throws and is never a world message', () => {
		for (const g of [null, undefined, 0, 'x', '{', '[]', [], {}, { t: 'w' }, { t: 'wv', v: 2 }, { t: 'wst' }, '{"t":"wv","v":1,"e":[[1,"a"]]}'.slice(0, 20), { t: 'wv', v: 1, add: 'x' }]) {
			const r = L.toWorldMsg(g)
			if (r) assert.deepEqual(r.d.add, [], JSON.stringify(g))
		}
		assert.equal(L.toWorldMsg('x'.repeat(70000)), null)
		const r = L.toWorldMsg({ t: 'wv', v: 1, ts: 1, add: 'x', e: [[1, NaN, 0, 0, 0, 0]], gone: [-1, 2.5, 3], fx: [[1, 'nuke', 100, '#fff']] })
		assert.deepEqual(r.d, { ts: 1, add: [], e: [], gone: [3], fx: [] })
	})
})

describe('WO-1101 interpolation, extrapolation, fade', () => {
	it('draws 100 ms behind the newest server time, lerping between snapshots', () => {
		const t = L.createTrack('car')
		L.pushSnap(t, 1000, [1, 0, 0, 0, 0, 0])
		L.pushSnap(t, 1100, [1, 1, 0, 2, 0.2, 1])
		const p = L.sampleTrack(t, 1150)
		assert.ok(Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.z - 1) < 1e-9)
		assert.ok(Math.abs(p.yaw - 0.1) < 1e-9)
		assert.equal(L.INTERP_MS, 100)
		assert.equal(L.sampleTrack(t, 1050).x, 0, 'before the oldest: the oldest')
		assert.equal(L.pushSnap(t, 900, [1, 9, 9, 9, 0, 0]), false, 'older than the newest: ignored')
	})

	it('a car extrapolates linearly ≤ 200 ms past its newest snapshot, then holds; a slingshot holds at once', () => {
		const t = L.createTrack('car')
		L.pushSnap(t, 1000, [1, 0, 0, 0, 0, 0])
		L.pushSnap(t, 1100, [1, 1, 0, 0, 0, 0])
		const a = L.sampleTrack(t, 1300) // rt 1200: 100 ms past
		assert.ok(Math.abs(a.x - 2) < 1e-9 && a.extrap && !a.held)
		const b = L.sampleTrack(t, 2000)
		assert.ok(Math.abs(b.x - 3) < 1e-9 && b.held, 'clamped at 200 ms')
		const s = L.createTrack('sling')
		L.pushSnap(s, 1000, [1, 0, 0, 0, 0, 0])
		L.pushSnap(s, 1100, [1, 1, 0, 0, 0, 0])
		assert.equal(L.sampleTrack(s, 1500).x, 1)
	})

	it('a vegetable flies on ballistically (g 9.81) ≤ 300 ms, then holds', () => {
		const t = L.createTrack('veg')
		L.pushSnap(t, 1000, [1, 0, 2, 0, 0, 0, 3, 4, 0])
		const p = L.sampleTrack(t, 1300) // 200 ms past
		assert.ok(Math.abs(p.x - 0.6) < 1e-9)
		assert.ok(Math.abs(p.y - (2 + 0.8 - 0.5 * 9.81 * 0.04)) < 1e-9)
		assert.ok(p.extrap)
		const q = L.sampleTrack(t, 5000)
		const r = L.sampleTrack(t, 1400) // exactly 300 ms
		assert.ok(q.held)
		assert.ok(Math.abs(q.x - r.x) < 1e-9 && Math.abs(q.y - r.y) < 1e-9, 'held at the 300 ms point')
	})

	it('between two vegetable updates the arc is ballistic with its error blended out (no jump at the next snapshot)', () => {
		const t = L.createTrack('veg')
		L.pushSnap(t, 1000, [1, 0, 2, 0, 0, 0, 3, 4, 0])
		L.pushSnap(t, 1100, [1, 0.31, 2.36, 0, 0, 0, 3, 3, 0])
		const end = L.sampleTrack(t, 1199.999)
		assert.ok(Math.abs(end.x - 0.31) < 1e-3 && Math.abs(end.y - 2.36) < 1e-3)
		const mid = L.sampleTrack(t, 1150)
		const bal = L.ballistic(t.snaps[0], 50)
		assert.ok(Math.abs(mid.y - bal[1]) < 0.01, 'close to the ballistic arc')
	})

	it('fades after 2 s without update — only while moving; a parked entity is held until gone', () => {
		const t = L.createTrack('car')
		L.pushSnap(t, 1000, [1, 0, 0, 0, 0, 0])
		L.pushSnap(t, 1100, [1, 1, 0, 0, 0, 0])
		assert.equal(L.fadeOf(t, 3000), 1)
		assert.equal(L.fadeOf(t, 3100), 1)
		assert.ok(L.fadeOf(t, 3350) > 0 && L.fadeOf(t, 3350) < 1)
		assert.equal(L.fadeOf(t, 3700), 0)
		const parked = L.createTrack('sling')
		L.pushSnap(parked, 1000, [1, 5, 0, 5, 0, 0])
		assert.equal(L.fadeOf(parked, 60000), 1)
		const splat = L.createTrack('splat')
		L.pushSnap(splat, 1000, [1, 5, 0, 5, 0, 1])
		assert.equal(L.fadeOf(splat, 9000), 1)
		const flying = L.createTrack('veg')
		L.pushSnap(flying, 1000, [1, 0, 2, 0, 0, 0, 1, 1, 0])
		assert.equal(L.fadeOf(flying, 3600), 0)
	})
})

describe('WO-1101 tiers, priority, cut-away, bounds, patches', () => {
	it('caps and tags per quality tier (Low 6 no tags, Medium 12, High 20, world page 80)', () => {
		assert.deepEqual(L.tierOf('low', 'rc'), { q: 'low', cap: 6, tags: false })
		assert.deepEqual(L.tierOf('medium', 'sk'), { q: 'medium', cap: 12, tags: true })
		assert.deepEqual(L.tierOf('high', 'salad'), { q: 'high', cap: 20, tags: true })
		assert.equal(L.tierOf('whatever', 'rc').cap, 12)
		assert.equal(L.tierOf('low', 'world').cap, 80)
		const hi = L.tierOf('high', 'rc')
		for (const k of ['car', 'soldier', 'sling']) assert.equal(L.tagsFor(k, hi, true, 'Ola'), true, k)
		for (const k of ['veg', 'av', 'splat']) assert.equal(L.tagsFor(k, hi, true, 'Ola'), false, k)
		assert.equal(L.tagsFor('car', L.tierOf('low', 'rc'), true, 'Ola'), false)
		assert.equal(L.tagsFor('car', hi, false, 'Ola'), false)
		assert.equal(L.tagsFor('car', hi, true, ''), false)
		assert.deepEqual(L.wqOf('low'), { t: 'wq', n: 6 })
		assert.deepEqual(L.wqOf('high'), { t: 'wq', n: 20 })
		assert.deepEqual(L.wqOf('medium'), { t: 'wq', n: 12 })
	})

	it('pickDrawn keeps the cap with the lowest dist / weight (the avatar always wins over far cars)', () => {
		const list = []
		for (let i = 1; i <= 30; i++) list.push({ w: i, kind: 'car', x: i, z: 0 })
		list.push({ w: 99, kind: 'av', x: 10, z: 0 })
		const s = L.pickDrawn(list, { x: 0, z: 0 }, 6)
		assert.equal(s.size, 6)
		assert.ok(s.has(99), 'av at 10 m / 6 beats a car at 6 m / 2')
		assert.ok(s.has(1) && s.has(5) && !s.has(6))
		assert.equal(L.pickDrawn(list, null, 0).size, 0)
		const sp = L.pickSplats([...Array(20)].map((_, i) => ({ w: i + 1, order: i + 1 })))
		assert.equal(sp.size, 12)
		assert.ok(sp.has(20) && !sp.has(8), 'the newest 12')
	})

	it('cut-away: above the cut → shadow, slingshot / avatar → clip, splat on a table → hide, no cut → draw', () => {
		assert.equal(L.cutMode('car', 0.5, 0.4), 'shadow')
		assert.equal(L.cutMode('veg', 0.41, 0.4), 'shadow')
		assert.equal(L.cutMode('soldier', 0.1, 0.4), 'draw')
		assert.equal(L.cutMode('veg', 0.4, 0.4), 'draw')
		assert.equal(L.cutMode('sling', 0, 0.4), 'clip')
		assert.equal(L.cutMode('av', 0, 0.4), 'clip')
		assert.equal(L.cutMode('splat', 0.75, 0.4), 'hide')
		assert.equal(L.cutMode('splat', 0, 0.4), 'draw')
		for (const k of ['car', 'veg', 'sling', 'av', 'splat']) assert.equal(L.cutMode(k, 5, null), 'draw')
		assert.equal(L.cutMode('car', 5, NaN), 'draw')
		assert.ok(L.shadowRadius(0, 0.1) > L.shadowRadius(1, 0.1), 'the shadow grows as it comes down')
		assert.ok(L.shadowRadius(1, 0.1) > L.shadowRadius(3, 0.1))
		assert.ok(L.shadowAlpha(0) > L.shadowAlpha(2))
	})

	it('bounds: toys at the scene scale, the rest life-size; the camera inside one is detected', () => {
		const car = L.boundsOf('car', '', 0.1)
		assert.ok(car.r > 0.03 && car.r < 0.06, String(car.r))
		assert.ok(L.boundsOf('soldier', 'pea', 0.1).r < 0.05)
		assert.ok(L.boundsOf('veg', 'cabbage').r > L.boundsOf('veg', 'tomato').r)
		assert.ok(L.boundsOf('veg', 'cabbage').r > car.r, 'a cabbage bigger than a car')
		assert.ok(L.boundsOf('sling', 50).r > 1)
		assert.ok(Math.abs(L.boundsOf('av', 182).cy - 0.91) < 1e-9)
		assert.equal(L.insideSphere({ x: 0, y: 0.1, z: 0 }, { x: 0, y: 0, z: 0 }, 0.2), true)
		assert.equal(L.insideSphere({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0.2), false)
	})

	it('patches: only slick splats (flag 1), r from s in mm, until = first seen + 8 s', () => {
		assert.deepEqual(L.patchOf({ p: { x: 1, y: 0, z: 2 }, s: 250, f: 1, firstTs: 1000 }), { x: 1, y: 0, z: 2, r: 0.25, until: 9000 })
		assert.equal(L.patchOf({ p: { x: 1, y: 0, z: 2 }, s: 250, f: 0, firstTs: 1000 }), null)
		assert.equal(L.splatRadius(60), 0.06)
		assert.equal(L.splatRadius('x'), 0.15)
		assert.equal(L.avHeight(175), 1.75)
		assert.equal(L.avHeight(20), 1.75)
		assert.equal(L.slingPull(150), 1)
		assert.deepEqual(L.rgb255('#ff8000'), [255, 128, 0])
		assert.equal(L.rgb255('red'), null)
	})
})

describe('WO-1101 URLs, world pages', () => {
	it('model / kit URLs: same-origin /game/ paths only; scene paths same-origin only', () => {
		for (const u of ['/game/rc/car-model.js', '/game/salad/kit/world.js', '/game/sk/soldier-model.js?v=2']) assert.ok(WW.okModelUrl(u), u)
		const bad = ['/game/../src/x.js', '//evil.example/game/x.js', '/api/game/rc/x.js', 'javascript:x', '/game//x.js', 'game/x.js', 7, null, '/game/' + 'x'.repeat(200)]
		for (const u of bad) assert.ok(!WW.okModelUrl(u), String(u))
		for (const u of ['/api/game/rc/scene', '/api/game/salad/scene.glb?rev=abc']) assert.ok(W.okPath(u), u)
		for (const u of ['//x/scene', '/a/../b', 'javascript:x', '/a b', '/a\\b', 'scene', '/x:y']) assert.ok(!W.okPath(u), u)
	})

	it('games are normalised: unsafe paths dropped, players counted, top 3 cleaned', () => {
		const g = W.gamesOf({
			games: [
				{ id: 'rc', title: 'RC', enabled: true, phase: 'race', players: [{}, {}], bots: 2, paths: { play: '/game/rc/', host: '//x', kit: '/game/rc/' }, joinUrl: ['addr'], top: [{ name: 'Ola‮', color: 'red', score: 3 }, null, 1, {}] },
				{ id: 'BAD id' },
				null,
			],
		})
		assert.equal(g.length, 1)
		assert.deepEqual(g[0].paths, { play: '/game/rc/', kit: '/game/rc/' })
		assert.equal(g[0].players, 2)
		assert.equal(g[0].joinUrl, 'addr')
		assert.equal(g[0].top[0].name, 'Ola')
		assert.equal(g[0].top[0].color, '#cccccc')
		assert.equal(W.kitOf(g), '/game/rc/')
		assert.equal(W.kitOf([]), null)
	})

	it('the spectator camera stays inside the hall, looks at it, drifts slowly', () => {
		const sc = { floors: [{ id: 'hall', y: 0, rect: [-10, -8, 10, 8] }, { id: 'stage', y: 1, rect: [-4, -8, 4, -5] }] }
		const a = W.roomCam(sc, 0)
		assert.ok(a.eye[2] > a.target[2], 'from the hall side opposite the stage')
		assert.ok(a.eye[1] >= 2.5 && a.eye[1] <= 7, '2.5 m up at least (the stage-framing camera)')
		const b = W.roomCam(sc, 20)
		assert.ok(Math.hypot(a.eye[0] - b.eye[0], a.eye[2] - b.eye[2]) > 0.1, 'drifts')
		for (const k of [0, 10, 31, 63]) {
			const q = W.roomCam(sc, k)
			assert.ok(q.eye[0] > -10 && q.eye[0] < 10 && q.eye[2] > -8 && q.eye[2] < 8, `inside the hall at t ${k}`)
		}
		const ball = { bounds: { min: [-15, 0, -28], max: [15, 7, 35] }, floors: [{ id: 'hall', y: 0.24, rect: [-15.3, -27.7, 15, 34.5] }, { id: 'stage', y: 0.64, rect: [9.55, -4, 12.55, 11] }] }
		const v = W.roomCam(ball, 0)
		assert.ok(v.eye[1] <= 6, 'a metre under the ceiling (the box ballroom: 7 m) — not in it')
		assert.ok(Math.hypot(v.eye[0] - v.target[0], v.eye[2] - v.target[2]) <= 14, 'frames the stage, not the far wall')
		assert.ok(v.eye[0] < 9.55 && v.eye[0] > -15.3, 'from the hall in front of the stage')
		const none = W.roomCam(null, 0)
		assert.ok(none.eye.every(Number.isFinite))
		const fl = W.floorFn(sc)
		assert.equal(fl(0, -6), 1)
		assert.equal(fl(0, 5), 0)
	})

	it('server clock: the least delayed message wins', () => {
		const c = W.createClock()
		assert.equal(c.now(5), null)
		c.sync(10000, 100) // off 9900
		c.sync(10120, 200) // off 9920 (less delay)
		assert.equal(c.now(300), 10220)
		c.sync(10200, 400) // off 9800 (late message): only drifts a little
		assert.ok(c.now(400) > 10300)
	})

	it('ticker texts read as sentences and never carry markup intent', () => {
		assert.equal(W.eventText({ k: 'R1', by: { g: 'salad', name: 'Ola' }, to: { g: 'rc', name: 'Kuba' }, veg: 'tomato' }), "Ola's tomato splatted Kuba's car")
		assert.equal(W.eventText({ k: 'R3', by: { g: 'rc', name: 'Kuba' }, to: { g: 'sk', name: 'Ann' } }), "Kuba's car bowled over Ann's soldier")
		assert.equal(W.eventText({ k: 'R8', by: { g: 'world', name: '' }, to: { g: 'rc', name: 'Bo' } }), "The sky rained on Bo's car")
		assert.equal(W.eventText(null), '')
		assert.equal(W.fmtClock(61000), '1:01')
		const line = W.boardLine(W.normGame({ id: 'rc', title: 'RC', enabled: true, phase: 'race', endsAt: 70000, top: [{ name: 'Ola', score: 3 }] }), 10000)
		assert.equal(line, 'RC · Racing · 1:00 — Ola 3')
	})
})

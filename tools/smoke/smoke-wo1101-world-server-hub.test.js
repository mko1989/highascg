'use strict'

/**
 * WO-1101 / WO-1102 — the Game World hub (modules/game-world/server/world-hub.js) with fake games that follow the
 * room adapter of work/notes/game-world-contract.md §0.2 exactly:
 *   - idle costs nothing: no timer with 0 or 1 room; a timer with 2 rooms or a world page; stopped again after
 *   - `wst` once a foreign entity appears (client, merged models, scale, safe, affect, games), then `wv` that decodes
 *     with the clients' sanitiser to the same tuples (encode → decode round trip through the hub's own output)
 *   - the viewer's own game never; game ids never on the wire (world ids); gone; a viewer that leaves is forgotten;
 *     `wst off` when the world stops; wq caps; a throwing game breaks nothing
 *   - safe pause fan-out on attach, colliders / contact / landed / shot delivering effects and bonuses, R3 in the tick,
 *     xev and the 2 Hz board to world pages, rain entities reaching viewers
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHub, MAX_WORLD } = require('../../modules/game-world/server/world-hub')
const wire = require('../../modules/game-world/client/world-wire.js')

function fakeTimers() {
	const live = new Map()
	let n = 0
	return {
		live,
		setInterval: (fn, ms) => (live.set(++n, { fn, ms }), n),
		clearInterval: (id) => live.delete(id),
	}
}
function fakeRoom(id, o = {}) {
	const a = {
		id,
		ents: o.ents || [],
		vs: o.viewers || [],
		phase: o.phase || 'lobby',
		sent: [],
		applied: [],
		bonuses: [],
		paused: [],
		areaV: o.area || null,
		poolsV: o.pools || [],
		entities: () => a.ents,
		viewers: () => a.vs,
		send: (key, msg) => a.sent.push([key, JSON.parse(JSON.stringify(msg))]),
		toAll() {},
		board: () => ({ phase: a.phase, endsAt: null, top: [{ name: 'x', color: '#ff0000', score: 3, label: '3' }], players: a.vs.length, bots: 0 }),
		apply: (e) => (a.applied.push(e), true),
		bonus: (pid, kind) => (a.bonuses.push([pid, kind]), true),
		pools: () => a.poolsV,
		area: () => a.areaV,
		pause: (on) => a.paused.push(on),
	}
	return a
}
function setup(opts = {}) {
	const clock = { t: 1_000_000 }
	const timers = fakeTimers()
	const reg = { v: 1, games: new Map(), hub: null }
	for (const [id, models, scale] of [['rc', { car: '/game/rc/car-model.js' }, 0.1], ['sk', { soldier: '/game/sk/soldier-model.js' }, 0.1], ['salad', { veg: '/game/salad/veg-models.js', av: '/game/salad/avatar-model.js', sling: 'https://evil.example/x.js' }]]) {
		reg.games.set(id, { id, title: id.toUpperCase(), order: 1, models, scale, room: () => null, host: () => ({ status: 200, body: { ok: true } }), state: () => ({}) })
	}
	const hub = createHub({ now: () => clock.t, timers, registry: reg, seed: 5, defer: (fn) => fn(), ...opts })
	const step = (n = 1) => {
		for (let i = 0; i < n; i++) {
			clock.t += 100
			hub.tick()
		}
	}
	return { hub, clock, timers, reg, step }
}
const car = (id, x, z, o = {}) => ({ k: 'car', id, p: [x, 0, z], yaw: 0, c: '#ff0000', n: `driver-${id}`, f: 0, ...o })
const soldier = (id, x, z, o = {}) => ({ k: 'soldier', id, p: [x, 0, z], yaw: 0, c: '#00ff00', n: `soldier-${id}`, f: 0, s: 'rifle', ...o })
const msgs = (room, key, t) => room.sent.filter(([k, m]) => k === key && (!t || m.t === t)).map(([, m]) => m)

test('idle: no timer with 0 or 1 room; a timer with 2 rooms or a world page; none again after', () => {
	const { hub, timers } = setup()
	assert.equal(timers.live.size, 0)
	const rc = fakeRoom('rc')
	hub.attach(rc)
	assert.equal(timers.live.size, 0, 'one room: no world tick')
	assert.equal(hub.wantsFrame('rc'), false)
	const sk = fakeRoom('sk')
	hub.attach(sk)
	assert.equal(timers.live.size, 1)
	assert.equal([...timers.live.values()][0].ms, 100, '10 Hz')
	assert.equal(hub.wantsFrame('rc'), true)
	hub.detach('sk')
	assert.equal(timers.live.size, 0)
	hub.detach('rc')
	const w = hub.openWorld(() => {})
	assert.equal(timers.live.size, 1, 'a world page alone runs the tick')
	w.close()
	assert.equal(timers.live.size, 0)
	assert.equal(hub.attach({ id: 'x' }), false, 'not an adapter')
	hub.dispose()
})

test('one room with the hub but no foreign entity → no message at all', () => {
	const { hub, step } = setup()
	const rc = fakeRoom('rc', { ents: [car(1, 0, 0)], viewers: [{ key: 'p1', kind: 'player', p: [0, 0, 0] }] })
	const sk = fakeRoom('sk', { viewers: [{ key: 's1', kind: 'player', p: [0, 0, 0] }] })
	hub.attach(rc)
	hub.attach(sk)
	step(10)
	assert.deepEqual(rc.sent, [], 'rc has nothing foreign to see')
	assert.ok(sk.sent.length > 0, 'sk sees the car')
	hub.dispose()
})

test('wst then wv: fields, own game excluded, world ids only, round trip through the clients\' sanitiser', () => {
	const { hub, step } = setup()
	const rc = fakeRoom('rc', { ents: [car('car-secret-7', 1, 0)], viewers: [{ key: 'p1', kind: 'player', p: [0, 0, 0] }] })
	const sk = fakeRoom('sk', { phase: 'match', ents: [soldier('sold-secret-3', 0.5, 0)], viewers: [{ key: 's1', kind: 'player', p: [0, 0, 0] }] })
	hub.attach(rc)
	hub.attach(sk)
	hub.setAffect('rc', 'soft')
	step(1)
	const [wst, wv] = msgs(rc, 'p1')
	assert.equal(wst.t, 'wst')
	assert.deepEqual(wire.decodeWst(wst), { on: true, client: '/game/world/visitors.js', models: { car: '/game/rc/car-model.js', soldier: '/game/sk/soldier-model.js', veg: '/game/salad/veg-models.js', av: '/game/salad/avatar-model.js' }, scale: 0.1, safe: false, affect: 'soft', games: [{ id: 'rc', title: 'RC', phase: 'lobby' }, { id: 'sk', title: 'SK', phase: 'match' }] })
	assert.equal(wst.models.sling, undefined, 'a foreign model URL is never passed on')
	assert.equal(wv.t, 'wv')
	assert.deepEqual(wire.encodeWv(wire.decodeWv(wv)), wv, 'round trip')
	assert.equal(wv.add.length, 1)
	assert.deepEqual(wv.add[0].slice(1), ['soldier', 'sk', '#00ff00', 'soldier-sold-secret-3'.slice(0, 16), 'rifle'])
	assert.ok(!JSON.stringify(rc.sent).includes('sold-secret-3"') && !JSON.stringify(sk.sent).includes('car-secret-7"'), 'game ids never on the wire')
	assert.ok(msgs(sk, 's1', 'wv').every((m) => (m.add || []).every((a) => a[2] !== 'sk')), 'own game never')
	// moving → only e; standing → nothing more; a field change (sk phase) → a new wst
	for (let i = 0; i < 5; i++) {
		sk.ents[0].p[0] += 0.01
		step(1)
	}
	const later = msgs(rc, 'p1').slice(2)
	assert.ok(later.every((m) => m.t === 'wv' && !m.add && m.e.length === 1))
	for (const m of later) assert.deepEqual(wire.encodeWv(wire.decodeWv(m)), m)
	const n = rc.sent.length
	step(5)
	assert.equal(rc.sent.length, n, 'nothing changed → nothing sent')
	sk.phase = 'results'
	step(1)
	assert.equal(msgs(rc, 'p1', 'wst').length, 2)
	hub.dispose()
})

test('gone, viewer forgotten, world ids kept 30 s, wst off when the world stops', () => {
	const { hub, step, clock } = setup()
	const rc = fakeRoom('rc', { ents: [car(1, 1, 0)], viewers: [{ key: 'p1', kind: 'player', p: [0, 0, 0] }] })
	const sk = fakeRoom('sk', { ents: [soldier(9, 0.5, 0)], viewers: [{ key: 's1', kind: 'player', p: [0, 0, 0] }] })
	hub.attach(rc)
	hub.attach(sk)
	step(1)
	const w1 = msgs(rc, 'p1', 'wv')[0].add[0][0]
	sk.ents = []
	step(1)
	assert.deepEqual(msgs(rc, 'p1', 'wv').at(-1).gone, [w1])
	clock.t += 10_000
	sk.ents = [soldier(9, 0.5, 0)]
	step(1)
	assert.equal(msgs(rc, 'p1', 'wv').at(-1).add[0][0], w1, 'same (g, k, id) within 30 s → same w')
	sk.ents = []
	step(1)
	clock.t += 31_000
	step(1)
	sk.ents = [soldier(9, 0.5, 0)]
	step(1)
	assert.notEqual(msgs(rc, 'p1', 'wv').at(-1).add[0][0], w1, 'freed after 30 s')
	// viewer leaves → forgotten; back → gets everything again (a fresh add)
	rc.vs = []
	step(1)
	rc.vs = [{ key: 'p1', kind: 'player', p: [0, 0, 0] }]
	const before = rc.sent.length
	step(1)
	const again = rc.sent.slice(before).map(([, m]) => m)
	assert.deepEqual(again.map((m) => m.t), ['wst', 'wv'])
	assert.equal(again[1].add.length, 1)
	hub.detach('sk')
	assert.deepEqual(rc.sent.at(-1), ['p1', { t: 'wst', v: 1, on: false }], 'the world went away')
	hub.dispose()
})

test('wq quality caps the visitors (Low 6, no tags); default 12; a spectator uses the room centre', () => {
	const { hub, step } = setup()
	const sk = fakeRoom('sk', { ents: Array.from({ length: 10 }, (_, i) => soldier(i, i * 0.1, 0)), viewers: [] })
	const rc = fakeRoom('rc', { area: { rect: [-1, -1, 1, 1], y: 0 }, viewers: [{ key: 'lo', kind: 'player', p: [0, 0, 0] }, { key: 'def', kind: 'player', p: [0, 0, 0] }, { key: 'spec', kind: 'spectator', p: null }] })
	const salad = fakeRoom('salad', { ents: Array.from({ length: 10 }, (_, i) => ({ k: 'sling', id: i, p: [i * 0.2, 0, 1], yaw: 0, c: '#0000ff', n: `s${i}`, f: 0, s: 0 })) })
	for (const r of [sk, rc, salad]) hub.attach(r)
	hub.quality('rc', 'lo', 6)
	step(1)
	const lo = msgs(rc, 'lo', 'wv')[0]
	assert.equal(lo.add.length, 6)
	assert.ok(lo.add.every((a) => a[4] === ''), 'Low: no tags')
	assert.equal(msgs(rc, 'def', 'wv')[0].add.length, 12)
	assert.equal(msgs(rc, 'spec', 'wv')[0].add.length, 12)
	hub.quality('rc', 'lo', 99)
	step(1)
	const up = msgs(rc, 'lo', 'wv').at(-1)
	assert.equal(up.add.length, 12, 'unknown wq → 12 (6 new + the first 6 re-added with their tags)')
	assert.ok(up.add.every((a) => a[4] !== ''))
	hub.dispose()
})

test('a throwing game breaks nothing: the other games are still served, errors counted', () => {
	const { hub, step } = setup()
	const bad = fakeRoom('salad')
	bad.entities = () => {
		throw new Error('boom')
	}
	bad.viewers = () => {
		throw new Error('boom')
	}
	const rc = fakeRoom('rc', { ents: [car(1, 0, 0)] })
	const sk = fakeRoom('sk', { viewers: [{ key: 's1', kind: 'player', p: [0, 0, 0] }] })
	sk.send = () => {
		throw new Error('socket gone')
	}
	const rc2 = fakeRoom('salad2', { viewers: [{ key: 'x', kind: 'player', p: [0, 0, 0] }] })
	for (const r of [bad, rc, sk, rc2]) hub.attach(r)
	step(3)
	assert.ok(msgs(rc2, 'x', 'wv').length >= 1)
	assert.ok(hub.stats().errors >= 6)
	hub.dispose()
})

test('safe: attach while safe pauses the game at once; unsafe resumes every attached game; colliders empty while safe', () => {
	const { hub, step } = setup()
	const rc = fakeRoom('rc', { ents: [car(1, 0, 0)] })
	const sk = fakeRoom('sk', { ents: [soldier(1, 1, 0)] })
	hub.attach(rc)
	hub.setSafe(true)
	hub.attach(sk)
	assert.deepEqual(sk.paused, [true])
	assert.deepEqual(rc.paused, [])
	step(1)
	assert.deepEqual(hub.colliders('salad'), [])
	hub.setSafe(false)
	assert.deepEqual(sk.paused, [true, false])
	assert.deepEqual(rc.paused, [false])
	assert.equal(hub.isSafe(), false)
	hub.dispose()
})

test('sync attaches every registered game whose session already runs', () => {
	const { hub, reg, timers } = setup()
	const rc = fakeRoom('rc')
	const sk = fakeRoom('sk')
	reg.games.get('rc').room = () => rc
	reg.games.get('sk').room = () => sk
	hub.sync()
	assert.equal(hub.adapters().size, 2)
	assert.equal(timers.live.size, 1)
	hub.dispose()
})

test('contact queries: colliders of the other games, contact → hop on the car + bonus to the thrower + xev + fx to visitors', () => {
	const { hub, step } = setup()
	const rc = fakeRoom('rc', { phase: 'race', ents: [car(1, 0, 0)] })
	const sk = fakeRoom('sk', { phase: 'match', ents: [soldier(1, 1, 0), soldier(2, 2, 0, { f: 4 }), soldier(3, 3, 0, { f: 2 })], viewers: [{ key: 's1', kind: 'player', p: [0, 0, 0] }] })
	const salad = fakeRoom('salad', { phase: 'round', ents: [{ k: 'sling', id: 7, p: [5, 0, 5], yaw: 0, c: '#0000ff', n: 'Ola', f: 0, s: 0 }] })
	for (const r of [rc, sk, salad]) hub.attach(r)
	const world = []
	hub.openWorld((m) => world.push(m))
	step(1)
	const cols = hub.colliders('salad')
	assert.deepEqual(cols.map((c) => [c.tag, c.r]), [['car', 0.04], ['soldier', 0.025]], 'car + the live unprotected soldier')
	assert.deepEqual(cols[0].c, [0, 0.025, 0])
	hub.setAffect('sk', 'off')
	assert.equal(hub.colliders('salad').length, 1, 'off → not a collider')
	hub.setAffect('sk', 'on')
	const r = hub.contact({ g: 'salad', pid: 7, veg: 'tomato', p: [0, 0.03, 0], v: [1, -1, 0], tag: 'car', w: cols[0].w })
	assert.deepEqual(r, { end: true })
	assert.equal(rc.applied.length, 1)
	assert.deepEqual([rc.applied[0].k, rc.applied[0].id, rc.applied[0].dur, rc.applied[0].soft, rc.applied[0].by.name], ['hop', 1, 0.6, false, 'Ola'])
	assert.deepEqual(salad.bonuses, [[7, 'hop']])
	const xev = world.find((m) => m.t === 'xev')
	assert.deepEqual([xev.k, xev.by.g, xev.to.g, xev.to.name], ['R1', 'salad', 'rc', 'driver-1'])
	step(1)
	const fxMsg = msgs(sk, 's1', 'wv').find((m) => m.fx)
	assert.deepEqual(fxMsg.fx.map((f) => [f[0], f[1]]), [[cols[0].w, 'splat'], [cols[0].w, 'hop']])
	assert.deepEqual(hub.contact({ g: 'salad', pid: 7, veg: 'onion', p: [0, 0, 0], v: [0, 0, 0], tag: 'car', w: 999999 }), { end: false }, 'unknown w → no effect')
	// shot (R4) and landed (R2 → a world splat every other game's viewers see)
	rc.ents[0].p = [0, 0, 0]
	const s = hub.shot({ g: 'sk', pid: 1, o: [0, 0.03, 1], yaw: 0, range: 3, los: () => true })
	assert.equal(s.hit, true)
	assert.equal(rc.applied.at(-1).k, 'wobble')
	assert.equal(rc.applied.at(-1).soft, true, 'within the 3 s car immunity → visual only')
	hub.landed({ g: 'salad', pid: 7, veg: 'tomato', p: [0.5, 0, 0], tag: 'floor' })
	step(1)
	assert.ok(msgs(sk, 's1', 'wv').some((m) => (m.add || []).some((a) => a[1] === 'splat' && a[2] === 'world')))
	step(5)
	assert.ok(world.some((m) => m.t === 'board'), 'board 2 Hz')
	assert.equal(hub.stats().events.R1, 1)
	hub.dispose()
})

test('R3 in the world tick: a fast car through a soldier → stun (sk), bump (rc), boost bonus (rc)', () => {
	const { hub, step } = setup()
	const rc = fakeRoom('rc', { phase: 'race', ents: [car(1, 0, 0.1, { spd: 1 })] })
	const sk = fakeRoom('sk', { phase: 'match', ents: [soldier(4, 0, -0.02)] })
	hub.attach(rc)
	hub.attach(sk)
	step(1)
	rc.ents[0].p = [0, 0, 0]
	step(1)
	assert.deepEqual(sk.applied.map((e) => [e.k, e.id, e.dur]), [['stun', 4, 0.8]])
	assert.deepEqual(rc.applied.map((e) => [e.k, e.id]), [['bump', 1]])
	assert.deepEqual(rc.bonuses, [[1, 'bowl']])
	hub.dispose()
})

test('world pages: ≤ 20, cap 80, all games (no exclusion), board every 5th tick; rain reaches everyone as world vegetables', () => {
	const { hub, step } = setup()
	const pages = []
	for (let i = 0; i < MAX_WORLD; i++) assert.ok(hub.openWorld((m) => pages.push([i, m])))
	assert.equal(hub.openWorld(() => {}), null, 'the 21st')
	const rc = fakeRoom('rc', { phase: 'race', ents: Array.from({ length: 10 }, (_, i) => car(i, i * 0.1, 0)), area: { rect: [-1, -1, 1, 1], y: 0 }, viewers: [{ key: 'p', kind: 'player', p: [0, 0, 0] }] })
	const sk = fakeRoom('sk', { phase: 'match', ents: Array.from({ length: 10 }, (_, i) => soldier(i, i * 0.1, 1)), area: { rect: [-1, 0, 1, 2], y: 0 } })
	hub.attach(rc)
	hub.attach(sk)
	step(10)
	const p0 = pages.filter(([i]) => i === 0).map(([, m]) => m)
	assert.equal(p0.filter((m) => m.t === 'board').length, 2)
	const adds = p0.filter((m) => m.t === 'wv').flatMap((m) => m.add || [])
	assert.equal(adds.length, 20, 'both games, cars included')
	assert.equal(hub.startEvent('rain', 10), true)
	step(20)
	assert.ok(msgs(rc, 'p', 'wv').some((m) => (m.add || []).some((a) => a[1] === 'veg' && a[2] === 'world')), 'rain over the rc viewer')
	assert.ok(hub.stats().bytes.world > 0 && hub.stats().bytes.rc > 0)
	hub.dispose()
	assert.equal(hub.running(), false)
})

test('viewer keys are the games\' own socket objects: fed, wq honoured, forgotten when gone (box finding)', () => {
	const { hub, step } = setup()
	const wsA = { name: 'socket A' } // the games pass their ws objects as viewer keys
	const rc = fakeRoom('rc', { ents: [car(1, 0, 0)], viewers: [{ key: wsA, kind: 'player', p: [0, 0, 0.5], cap: 12 }] })
	const sk = fakeRoom('sk', { ents: [soldier(1, 0.5, 0)] })
	hub.attach(rc)
	hub.attach(sk)
	assert.equal(hub.quality('rc', wsA, 6), true)
	step(2)
	const got = msgs(rc, wsA)
	assert.ok(got.some((m) => m.t === 'wst' && m.on === true), 'the object-keyed viewer gets wst')
	const wv = got.filter((m) => m.t === 'wv')
	assert.ok(wv.length >= 1 && wv[0].add.some((a) => a[1] === 'soldier'), 'and the soldier')
	assert.equal(wv[0].add[0][4], '', 'the wq 6 cap (Low: no name tags) reached the object key')
	rc.vs = []
	step(1)
	rc.vs = [{ key: { name: 'socket B' }, kind: 'player', p: [0, 0, 0.5], cap: 12 }]
	step(1)
	assert.equal(msgs(rc, wsA, 'wst').length, 1, 'the gone socket is forgotten (no second wst)')
	hub.dispose()
})

test('wst.scale is the toy scale whatever the registry order (Salad, life size, registered first: box finding)', () => {
	const { hub, reg, step } = setup()
	const salad = reg.games.get('salad')
	reg.games.delete('salad')
	const rest = [...reg.games]
	reg.games.clear()
	reg.games.set('salad', { ...salad, scale: 1 })
	for (const [k, v] of rest) reg.games.set(k, v)
	const rc = fakeRoom('rc', { ents: [car(1, 0, 0)], viewers: [{ key: 'v1', kind: 'player', p: [0, 0, 0.5], cap: 12 }] })
	const sk = fakeRoom('sk', { ents: [soldier(1, 0.5, 0)] })
	hub.attach(rc)
	hub.attach(sk)
	step(1)
	const w = msgs(rc, 'v1', 'wst')[0]
	assert.equal(w.scale, 0.1)
	hub.dispose()
})

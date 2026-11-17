'use strict'

/**
 * WO-1101 / WO-1102 — Stage Salad in the Game World (work/notes/game-world-contract.md §0, §4, §5, §6.1 R1 / R6 / R2,
 * §6.2, §6.3): modules/stage-salad/server/salad-world.js (registry descriptor, room adapter, the flight hooks), the
 * world colliders in salad-shots.js and `makeWay` in salad-presenters.js. Proves: alone = unchanged (no hub, or a hub
 * with no other room → the very same messages, JSON text in order, over a round with shots; the state keys stay; no
 * world message; `wq` is a known type that does nothing without a hub); the hub's sphere collider tagged `car` on a
 * flight's path: an onion bounces off it — one hub.contact per contact and one `xb` re-anchor each — a tomato ends on
 * it (`end` tag car, contact end: true, no `xb`); hub.landed on every land; the adapter (veg / sling / av entities in
 * metres, viewers + caps, board, pause = the presenter-safe, only `step` with a dir → a `dodge` of kind step, the
 * bonus +15 / +5 / +10 in a round only, xbonus + me). A FAKE hub in the process registry, removed after each test.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const F = require('./lib/salad-fixtures')
const SW = F.server('salad-world.js')
const SAN = F.server('salad-sanitize.js')
const { createSaladRoom } = F.server('salad-room.js')

const S = F.shared()
const DEG = Math.PI / 180
const KEY = Symbol.for('highascg.game-world/1')
const reg = () => globalThis[KEY] || (globalThis[KEY] = { v: 1, games: new Map(), hub: null })
const WORLD_T = new Set(['wst', 'wv', 'xfx', 'xbonus', 'xb', 'xev'])
const KEYS = ['maxPlayers', 'phase', 'startAt', 'endsAt', 'secs', 'teams', 'teamScores', 'safe', 'bots', 'botLevel', 'target', 'targets', 'venueRev', 'players', 'spectators']

test.after(() => {
	reg().hub = null
	reg().games.delete('salad')
})

/** A recording hub; `cols` = the sphere colliders it hands to Salad's flights. */
function fakeHub(t, o = {}) {
	const calls = []
	const hub = { calls, cols: [] }
	for (const name of ['attach', 'detach', 'quality', 'shot', 'landed']) hub[name] = (...a) => void calls.push([name, ...a])
	hub.colliders = (g) => (calls.push(['colliders', g]), hub.cols)
	hub.contact = (q) => (calls.push(['contact', q]), o.contact ? o.contact(q) : { end: false })
	hub.of = (name) => calls.filter((c) => c[0] === name).map((c) => c.slice(1))
	reg().hub = hub
	t.after(() => {
		reg().hub = null
	})
	return hub
}

/** A room on the manual clock with the synthetic venue; `world` builds the adapter and wires `xw` as salad-game.js does. */
function makeRoom(t, { world = false, lights = null } = {}) {
	const clk = F.createClock()
	const sent = new Map()
	const all = []
	const send = (c, m) => {
		if (!sent.has(c)) sent.set(c, [])
		sent.get(c).push(m)
		all.push(m)
	}
	let w = null
	const room = createSaladRoom({ now: clk.now, timers: clk.timers, rng: F.dice(7), send, ...(world ? { xw: () => w.hooks() } : {}) })
	if (world) w = SW.createSaladWorld({ room: () => room, send, now: clk.now, lights })
	room.setVenue(F.venue())
	const pingers = []
	const join = (name, extra = {}) => {
		const c = { name }
		room.connect(c)
		room.handle(c, { t: 'join', name, ...extra })
		pingers.push(clk.timers.setInterval(() => room.handle(c, { t: 'ping', c: 0 }), 2000))
		return c
	}
	const of = (c, type) => (sent.get(c) || []).filter((m) => !type || m.t === type)
	const idOf = (c) => of(c, 'welcome')[0].id
	const slotOf = (c) => room.ctx.venue().slots[of(c, 'welcome')[0].you.slot]
	t.after(() => {
		for (const id of pingers) clk.timers.clearInterval(id)
		room.dispose()
		assert.equal(clk.pending(), 0, 'no timer survives dispose')
	})
	return { clk, room, join, of, idOf, slotOf, all, world: w }
}

let N = 0
/** A shot from c's slot (yaw off the slot by +0.3 rad: into the hall, away from the stand-in); lands on the hall floor. */
const fire = (R, c, veg, pitchDeg = 20, power = 0.5) => R.room.handle(c, { t: 'fire', n: ++N, veg, a: [R.slotOf(c).yaw + 0.3, pitchDeg * DEG], p: power })

/** A round: two guests, practice shots, start, scored shots, results, lobby. */
function script(R, hooks = {}) {
	N = 0
	const a = R.join('Ann'), b = R.join('Ben'), sp = R.join('Eye', { spectator: true })
	hooks.joined?.(a)
	R.room.handle(a, { t: 'wq', n: 20 }) // the service intercepts it; reaching the room it is ignored
	fire(R, a, 'tomato')
	R.clk.advance(1000)
	fire(R, b, 'onion', 30, 0.4)
	R.clk.advance(4500)
	R.room.host('round', { secs: 30 })
	R.room.host('start')
	R.clk.advance(3000)
	for (let k = 0; k < 4; k++) fire(R, a, ['peas', 'potato', 'cabbage', 'carrot'][k], 15 + k * 5), fire(R, b, 'onion', 25), R.clk.advance(1500)
	hooks.round?.()
	R.clk.advance(30000 + 12000)
	assert.equal(R.room.snapshot().phase, 'lobby')
	return { a, b, sp, text: R.all.map((m) => JSON.stringify(m).replace(/"resume":"[^"]+"/g, '"resume":"<token>"')).join('\n') } // WO-1106 B34: tokens are random
}

test('alone = unchanged: no hub (or a hub with no other room) → byte-identical messages, the state keys, no world message', (t) => {
	assert.equal(reg().hub, null)
	const base = script(makeRoom(t))
	assert.ok(['"t":"shot"', '"t":"end"', '"t":"results"', '"t":"w"'].every((s) => base.text.includes(s)), 'a real round with flights')
	for (const line of base.text.split('\n')) {
		const m = JSON.parse(line)
		assert.ok(!WORLD_T.has(m.t), `no world message (${m.t})`)
		if (m.state) assert.deepEqual(Object.keys(m.state), KEYS)
	}
	const R = makeRoom(t, { world: true })
	const poke = () => {
		const A = R.world.adapter
		A.entities(), A.viewers(), A.board(), A.area(), A.pools()
	}
	const run = script(R, { joined: (a) => (R.world.attach(), R.world.quality(a, { n: 6 }), poke()), round: poke })
	assert.equal(run.text, base.text, 'world built, no hub')
	assert.equal(R.world.hooks(), null, 'no hub → no flight hooks')
	const hub = fakeHub(t)
	const H = makeRoom(t, { world: true })
	const withHub = script(H, { joined: (a) => (H.world.attach(), H.world.quality(a, { n: 20 })) })
	assert.equal(withHub.text, base.text, 'a hub with no colliders')
	assert.equal(hub.of('attach')[0][0], H.world.adapter)
	assert.deepEqual(hub.of('quality'), [['salad', withHub.a, 20]])
	assert.ok(hub.of('colliders').length > 10 && hub.of('colliders').every((c) => c[0] === 'salad'), 'asked every tick with flights')
	assert.equal(hub.of('contact').length, 0)
	const ends = H.of(withHub.a, 'end').filter((m) => m.k === 'land')
	assert.equal(hub.of('landed').length, ends.length, 'hub.landed on every land')
	assert.ok(ends.length >= 6)
	const [q] = hub.of('landed')[0]
	assert.deepEqual(q, { g: 'salad', pid: ends[0].id, veg: 'tomato', p: ends[0].p, tag: ends[0].tag, i: ends[0].i })
})

test('`wq`: a known message type (≤ 2 KB); the cap without a hub; a throwing hub never breaks a flight', (t) => {
	assert.deepEqual(SAN.parseMessage(JSON.stringify({ t: 'wq', n: 6 })), { t: 'wq', n: 6 })
	assert.equal(SAN.parseMessage(JSON.stringify({ t: 'wq', pad: 'x'.repeat(3000) })), null)
	const R = makeRoom(t, { world: true })
	const a = R.join('Ann')
	for (const [n, want] of [[6, 6], [20, 20], [12, 12], [3, 12], ['6', 12]]) {
		R.world.quality(a, { t: 'wq', n })
		assert.equal(R.world.adapter.viewers()[0].cap, want)
	}
	const hub = fakeHub(t)
	hub.quality = hub.attach = hub.detach = hub.landed = () => {
		throw new Error('world down')
	}
	assert.doesNotThrow(() => (R.world.quality(a, { n: 6 }), R.world.attach(), R.world.detach()))
	fire(R, a, 'tomato')
	assert.doesNotThrow(() => R.clk.advance(4500))
	assert.equal(R.of(a, 'end').length, 1, 'the flight ended normally')
})

/** Fire `veg`, then put the hub's car sphere on its path (the shot's own launch, simulated against the venue). */
function shotAtCar(t, veg, frac = 0.3) {
	const hub = fakeHub(t)
	const R = makeRoom(t, { world: true })
	const a = R.join('Ann')
	fire(R, a, veg)
	const shot = R.of(a, 'shot').at(-1)
	const V = S.veggies.vegOf(veg)
	const L = S.flight.launches(V, shot.o, shot.a[0], shot.a[1], shot.p, shot.seed)
	const sim = S.flight.simulate(V, L[0], R.room.ctx.venue(), { record: 1 })
	assert.equal(sim.tag, 'floor', 'without the car it lands on the hall floor')
	const c = sim.path[Math.round(sim.path.length * frac)]
	hub.cols = [{ k: 'sph', c, r: 0.04, tag: 'car', w: 77 }]
	R.clk.advance(4500)
	return { hub, R, a, c }
}

test('an onion meeting a car bounces: one hub.contact per contact, one `xb` each, then it lands on and hub.landed hears it', (t) => {
	const { hub, R, a, c } = shotAtCar(t, 'onion')
	const contacts = hub.of('contact').map((x) => x[0])
	const xbs = R.of(a, 'xb')
	assert.ok(contacts.length >= 1, 'it met the car')
	assert.equal(xbs.length, contacts.filter((q) => !q.end).length, 'one xb per bounce contact')
	assert.equal(contacts.filter((q) => q.end).length, 0, 'an onion does not stop at a car')
	const q = contacts[0]
	assert.deepEqual([q.g, q.pid, q.veg, q.tag, q.end], ['salad', R.idOf(a), 'onion', 'car', false])
	assert.ok(Math.hypot(q.p[0] - c[0], q.p[1] - c[1], q.p[2] - c[2]) < 0.04 + 0.045 + 0.02, 'at the car')
	const shot = R.of(a, 'shot').at(-1)
	const xb = xbs[0]
	assert.deepEqual([xb.id, xb.n, xb.i], [shot.id, shot.n, 0])
	assert.deepEqual(xb.p, q.p.map((v) => Math.round(v * 1000) / 1000 + 0))
	assert.deepEqual(xb.v, q.v.map((v) => Math.round(v * 1000) / 1000 + 0))
	assert.ok(xb.at > shot.ts && xb.at < shot.ts + 2000)
	const vIn = q.v
	assert.ok(vIn.every(Number.isFinite))
	const end = R.of(a, 'end').at(-1)
	assert.equal(end.k, 'land')
	assert.notEqual(end.tag, 'car')
	const landed = hub.of('landed').map((x) => x[0])
	assert.equal(landed.length, 1)
	assert.deepEqual(landed[0], { g: 'salad', pid: R.idOf(a), veg: 'onion', p: end.p, tag: end.tag, i: 0 })
})

test('a tomato meeting a car ends on it: tag car, one contact with end: true, no `xb`', (t) => {
	const { hub, R, a } = shotAtCar(t, 'tomato')
	const contacts = hub.of('contact').map((x) => x[0])
	assert.equal(contacts.length, 1)
	assert.equal(contacts[0].end, true)
	assert.equal(contacts[0].tag, 'car')
	assert.equal(R.of(a, 'xb').length, 0)
	const end = R.of(a, 'end').at(-1)
	assert.deepEqual([end.k, end.tag], ['land', 'car'])
	assert.deepEqual(hub.of('landed').map((x) => x[0].tag), ['car'])
	assert.equal(R.of(a, 'end').length, 1)
})

test('a contact the hub throws on still bounces the flight (the game never breaks)', (t) => {
	const hub = fakeHub(t, { contact: () => {
		throw new Error('referee down')
	} })
	const R = makeRoom(t, { world: true })
	const a = R.join('Ann')
	fire(R, a, 'onion')
	const shot = R.of(a, 'shot').at(-1)
	const V = S.veggies.vegOf('onion')
	const sim = S.flight.simulate(V, S.flight.launches(V, shot.o, shot.a[0], shot.a[1], shot.p, shot.seed)[0], R.room.ctx.venue(), { record: 1 })
	hub.cols = [{ k: 'sph', c: sim.path[Math.round(sim.path.length * 0.3)], r: 0.04, tag: 'car', w: 1 }]
	assert.doesNotThrow(() => R.clk.advance(4500))
	assert.ok(R.of(a, 'xb').length >= 1)
	assert.equal(R.of(a, 'end').length, 1)
})

test('adapter: veg in flight, slings and the presenter avatar as entities in metres; viewers; board; area; pools', (t) => {
	const asked = []
	const R = makeRoom(t, { world: true, lights: { pools: (y) => (asked.push(y), [{ x: 1, z: 2, y, r: 0.5 }]) } })
	const A = R.world.adapter
	assert.equal(A.id, 'salad')
	const a = R.join('Ann'), sp = R.join('Eye', { spectator: true })
	R.room.handle(a, { t: 'aim', a: [R.slotOf(a).yaw + 0.1, 0.3], p: 0.42 })
	fire(R, a, 'peas')
	R.clk.advance(100)
	const ents = A.entities()
	const veg = ents.filter((e) => e.k === 'veg')
	assert.equal(veg.length, S.veggies.vegOf('peas').n, 'the whole pea burst in flight')
	assert.ok(veg.every((e) => e.s === 'peas' && e.n === 'Ann' && e.p.length === 3 && e.v.length === 3 && e.bot === false))
	assert.equal(new Set(veg.map((e) => e.id)).size, veg.length, 'one id per pea')
	const sling = ents.find((e) => e.k === 'sling')
	assert.deepEqual(sling.p, R.slotOf(a).p)
	assert.deepEqual([sling.id, sling.s, sling.n], [R.idOf(a), 42, 'Ann'])
	assert.ok(Math.abs(sling.yaw - (R.slotOf(a).yaw + 0.1)) < 1e-4, 'the aim yaw')
	const av = ents.find((e) => e.k === 'av')
	assert.deepEqual([av.id, av.n, av.s, av.f & 4, av.c], [0, 'Stand-in', 175, 4, '#c9b9a6'])
	assert.ok(av.p[1] > 0.6 && av.p[1] < 0.7, 'feet on the stage (metres)')
	R.clk.advance(4500)
	assert.equal(A.entities().filter((e) => e.k === 'veg').length, 0, 'landed: gone')
	const vs = A.viewers()
	assert.deepEqual(vs, [{ key: a, kind: 'player', p: R.slotOf(a).p, cap: 12 }, { key: sp, kind: 'spectator', p: null, cap: 12 }])
	const v = R.room.ctx.venue()
	assert.deepEqual(A.area(), { rect: v.stage.rect, y: v.stage.y })
	assert.deepEqual(A.pools(), [{ x: 1, z: 2, y: v.hall.y, r: 0.5 }])
	assert.deepEqual(asked, [v.hall.y])
	R.room.ctx.players.get(R.idOf(a)).score = 30
	assert.deepEqual(A.board(), { phase: 'lobby', endsAt: null, top: [{ name: 'Ann', color: R.room.ctx.players.get(R.idOf(a)).color, score: 30, label: '30' }], players: 1, bots: 0 })
})

test('adapter.pause = the presenter-safe: nothing flies, board "paused"; apply / bonus refused while safe', (t) => {
	const R = makeRoom(t, { world: true })
	const A = R.world.adapter
	const a = R.join('Ann')
	A.pause(true)
	assert.equal(R.room.snapshot().safe, true)
	assert.deepEqual(Object.keys(R.room.snapshot()), KEYS, 'no new state field')
	assert.equal(A.board().phase, 'paused')
	fire(R, a, 'tomato')
	assert.equal(R.of(a, 'shot').length, 0, 'safe: no fire')
	assert.equal(A.apply({ k: 'step', id: 0, dir: [0, 1], dur: 0.7 }), false)
	assert.equal(A.bonus(R.idOf(a), 'R1'), false)
	A.pause('yes')
	assert.equal(R.room.snapshot().safe, false, 'anything but true lifts it')
	fire(R, a, 'tomato')
	assert.equal(R.of(a, 'shot').length, 1)
})

test('adapter.apply: only `step` with a dir → a `dodge` (kind step, 0.4 m along the stage, 0.7 s); refused otherwise', (t) => {
	const R = makeRoom(t, { world: true })
	const A = R.world.adapter
	const a = R.join('Ann')
	const e = { k: 'step', g: 'salad', id: 0, dur: 0.7, dir: [0.2, 1], soft: false, by: { g: 'rc', name: 'Ola' } }
	for (const bad of [{ k: 'hop' }, { k: 'stun' }, { soft: true }, { dir: null }, { dir: [1] }, { id: 42 }]) assert.equal(A.apply({ ...e, ...bad }), false, JSON.stringify(bad))
	assert.equal(R.of(a, 'dodge').length, 0)
	const t0 = R.clk.now()
	assert.equal(A.apply(e), true)
	const d = R.of(a, 'dodge').at(-1)
	assert.deepEqual(d, { t: 'dodge', tid: 0, kind: 'step', from: t0, until: t0 + 700, dx: [0, 0.4] })
	assert.deepEqual(R.room.presenters.dodgeOf(0), { kind: 'step', from: t0, until: t0 + 700, dx: [0, 0.4] })
	const av = A.entities().find((x) => x.k === 'av')
	assert.equal(av.f & 32, 32, 'the step flag while it lasts')
	assert.deepEqual(av.dx, [0, 0.4])
	assert.equal(A.apply(e), false, 'already stepping')
	R.clk.advance(3000)
	assert.equal(A.entities().find((x) => x.k === 'av').f & 32, 0)
	assert.equal(R.room.presenters.dodgeOf(0), null, 'the step is over')
	assert.equal(A.apply({ ...e, dir: [0, -1] }), true)
	assert.deepEqual(R.of(a, 'dodge').at(-1).dx, [0, -0.4], 'the other side')
})

test('adapter.bonus: +15 hit / bounce, +5 scatter, +10 spot in a round only; xbonus + me to the causer', (t) => {
	const R = makeRoom(t, { world: true })
	const A = R.world.adapter
	const a = R.join('Ann'), b = R.join('Ben')
	const pa = R.room.ctx.players.get(R.idOf(a))
	assert.equal(A.bonus(pa.id, 'R1'), true, 'lobby: shown')
	assert.deepEqual(R.of(a, 'xbonus'), [{ t: 'xbonus', kind: 'R1', pts: 0 }])
	assert.deepEqual(R.of(a, 'me').at(-1), { t: 'me', ready: pa.readyAt, streak: pa.streak, score: 0 })
	assert.equal(R.of(b, 'xbonus').length, 0, 'only the causer')
	R.room.host('start')
	assert.equal(A.bonus(pa.id, 'R1'), true)
	assert.equal(pa.score, 0, 'countdown: not counted')
	R.clk.advance(3000)
	const kinds = ['R1', 'R6', 'bounce', 'hit', 'R5', 'scatter', 'R9', 'spot', '']
	for (const k of kinds) A.bonus(pa.id, k)
	assert.deepEqual(R.of(a, 'xbonus').slice(-kinds.length).map((m) => [m.kind, m.pts]), kinds.map((k, i) => [k, [15, 15, 15, 15, 5, 5, 10, 10, 15][i]]))
	assert.equal(pa.score, 105)
	assert.equal(R.of(a, 'me').at(-1).score, 105)
	R.clk.advance(300)
	assert.equal(R.of(b, 'state').at(-1).state.players.find((p) => p.id === pa.id).score, 105, 'the score reaches everyone')
	assert.equal(A.bonus(999, 'R1'), false)
})

test('register / unregister; hooks only while a hub is there; a disabled world is harmless', (t) => {
	const game = { host: (b) => ({ status: 200, body: b }), state: () => ({ on: 1 }), worldAdapter: () => null }
	SW.register(() => game)
	const d = reg().games.get('salad')
	assert.deepEqual([d.id, d.order, d.room()], ['salad', 3, null])
	assert.deepEqual(Object.keys(d.models), ['veg', 'sling', 'av'])
	SW.unregister()
	assert.equal(reg().games.has('salad'), false)
	const off = SW.createSaladWorld({ room: () => null, send: () => {} })
	assert.equal(off.hooks(), null)
	const A = off.adapter
	assert.deepEqual([A.entities(), A.viewers(), A.area(), A.pools()], [[], [], null, []])
	assert.deepEqual(A.board(), { phase: 'off', endsAt: null, top: [], players: 0, bots: 0 })
	assert.equal(A.apply({ k: 'step', id: 0, dir: [0, 1] }), false)
	assert.equal(A.bonus(1, 'R1'), false)
	assert.doesNotThrow(() => A.pause(true))
	const hub = fakeHub(t)
	const h = off.hooks()
	assert.ok(h)
	assert.deepEqual(h.colliders(), [])
	h.landed({ g: 'salad' })
	assert.deepEqual(hub.of('landed'), [[{ g: 'salad' }]])
})

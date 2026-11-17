'use strict'

/**
 * WO-1106 (salad slice) — Stage Salad in the Game World, through the REAL hub (modules/game-world/server/world-hub.js):
 *   A2: a vegetable meeting another game's car reaches hub.contact WITH the collider id `w` (flight.js keeps it as
 *       `f.lastW`), so the referee finds the car and R1 / R6 fire (the car hops, the thrower gets the bonus).
 *   A5: the adapter's send(key, msg) says whether the game socket took the message (false = skipped for backpressure or
 *       a closed socket), so the hub can commit `sent` / `wst` only on a real send.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const F = require('./lib/salad-fixtures')
const SW = F.server('salad-world.js')
const { createSaladRoom } = F.server('salad-room.js')
const { createHub } = require('../../modules/game-world/server/world-hub')

const S = F.shared()
const DEG = Math.PI / 180
const KEY = Symbol.for('highascg.game-world/1')
const reg = () => globalThis[KEY] || (globalThis[KEY] = { v: 1, games: new Map(), hub: null })

test.after(() => {
	reg().hub = null
})

/** An RC room with one car at `p` (world metres) — just the adapter surface the hub reads. */
function rcRoom(p) {
	const a = { id: 'rc', applied: [], ents: [{ k: 'car', id: 1, p, yaw: 0, c: '#ff0000', n: 'driver-1', f: 0 }] }
	Object.assign(a, {
		entities: () => a.ents,
		viewers: () => [],
		send: () => true,
		toAll() {},
		board: () => ({ phase: 'race', endsAt: null, top: [], players: 1, bots: 0 }),
		apply: (e) => (a.applied.push(e), true),
		bonus: () => true,
	})
	return a
}

function setup(t, veg) {
	const clk = F.createClock()
	const sent = new Map()
	const send = (c, m) => {
		if (!sent.has(c)) sent.set(c, [])
		sent.get(c).push(m)
	}
	let w = null
	const room = createSaladRoom({ now: clk.now, timers: clk.timers, rng: F.dice(7), send, xw: () => w.hooks() })
	w = SW.createSaladWorld({ room: () => room, send, now: clk.now })
	room.setVenue(F.venue())
	const hub = createHub({ now: clk.now, timers: clk.timers, registry: reg(), seed: 5, defer: (fn) => fn() })
	reg().hub = hub
	const a = { name: 'Ann' }
	room.connect(a)
	room.handle(a, { t: 'join', name: 'Ann' })
	const ping = clk.timers.setInterval(() => room.handle(a, { t: 'ping', c: 0 }), 2000)
	const of = (type) => (sent.get(a) || []).filter((m) => m.t === type)
	const slot = room.ctx.venue().slots[of('welcome')[0].you.slot]
	room.handle(a, { t: 'fire', n: 1, veg, a: [slot.yaw + 0.3, 20 * DEG], p: 0.5 })
	const shot = of('shot').at(-1)
	const V = S.veggies.vegOf(veg)
	const sim = S.flight.simulate(V, S.flight.launches(V, shot.o, shot.a[0], shot.a[1], shot.p, shot.seed)[0], room.ctx.venue(), { record: 1 })
	const c = sim.path[Math.round(sim.path.length * 0.3)]
	const rc = rcRoom([c[0], c[1] - 0.025, c[2]]) // the hub's car sphere sits 0.025 m above the car's p
	hub.attach(rc)
	w.attach()
	t.after(() => {
		clk.timers.clearInterval(ping)
		hub.dispose()
		reg().hub = null
		room.dispose()
	})
	return { clk, hub, rc, of, room, w }
}

test('A2: a tomato thrown into a car through the real hub → R1: the car hops, the thrower hears xbonus', (t) => {
	const { clk, rc, of } = setup(t, 'tomato')
	clk.advance(4500)
	const hops = rc.applied.filter((e) => e.k === 'hop')
	assert.equal(hops.length, 1, 'the referee found the car by its collider id w')
	assert.equal(hops[0].id, 1)
	assert.deepEqual(of('xbonus').map((m) => m.kind), ['hop'])
	assert.deepEqual([of('end').at(-1).k, of('end').at(-1).tag], ['land', 'car'])
})

test('A2: an onion bouncing off a car → R6 (hop without the splat), contact carries w', (t) => {
	const { clk, rc, hub } = setup(t, 'onion')
	const seen = []
	const real = hub.contact
	reg().hub = { ...hub, contact: (q) => (seen.push(q), real(q)) }
	clk.advance(4500)
	assert.ok(seen.length >= 1, 'it met the car')
	assert.ok(seen.every((q) => Number.isInteger(q.w)), 'every contact names the collider')
	assert.ok(rc.applied.some((e) => e.k === 'hop'), 'R6 hop')
})

test('A2: flight.js keeps the touched collider id (lastW) next to its tag', () => {
	const V = S.veggies.vegOf('tomato')
	const v = { colliders: [], play: { min: [-50, -5, -50], max: [50, 50, 50] } }
	const f = S.flight.createFlight(V, { i: 0, p: [0, 1, 0], v: [0, 0, 0] })
	assert.equal(f.lastW, null)
	const extra = [{ k: 'sph', c: [0, 0.95, 0], r: 0.04, tag: 'car', w: 42 }]
	for (let k = 0; k < 120 && !f.end; k++) S.flight.stepFlight(f, v, { extra })
	assert.deepEqual([f.lastTag, f.lastW], ['car', 42])
})

/** A socket stand-in: open, records every JSON message the game sends. */
function fakeSocket() {
	const { EventEmitter } = require('events')
	const ws = new EventEmitter()
	ws.readyState = 1
	ws.bufferedAmount = 0
	ws.sent = []
	ws.send = (s) => ws.sent.push(JSON.parse(s))
	ws.close = (code) => {
		if (ws.readyState === 3) return
		ws.readyState = 3
		ws.code = code
		ws.emit('close')
	}
	return ws
}
const TMP = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'wo1106-salad-'))
test.after(() => require('fs').rmSync(TMP, { recursive: true, force: true }))
function makeGame(t) {
	const { createSaladGame } = F.server('salad-game.js')
	const g = createSaladGame({ lanIps: () => ['192.0.2.1'], readTracking: async () => null,
		bakerDeps: { loadProject: () => ({ name: 'Smoke hall', previs: {} }), mvrStore: { get: () => null, mesh: async () => null }, cacheDir: TMP } })
	assert.equal(g.host({ action: 'enable' }).status, 200)
	t.after(() => g.disable())
	return g
}

test('A5: the adapter send says whether the socket took it — true sent, false over 256 KB buffered or closed', (t) => {
	const g = makeGame(t)
	const ws = fakeSocket()
	g.attach(ws)
	const A = g.worldAdapter()
	const msg = { t: 'wst', v: 1, on: false }
	assert.equal(A.send(ws, msg), true)
	assert.deepEqual(ws.sent.at(-1), msg)
	ws.bufferedAmount = 300 * 1024
	const n = ws.sent.length
	assert.equal(A.send(ws, { t: 'wv' }), false, 'backpressure: skipped')
	ws.bufferedAmount = 0
	ws.readyState = 2
	assert.equal(A.send(ws, { t: 'wv' }), false, 'closing: skipped')
	ws.readyState = 1
	ws.send = () => {
		throw new Error('gone')
	}
	assert.equal(A.send(ws, { t: 'wv' }), false, 'a throwing socket: not sent')
	assert.equal(ws.sent.length, n)
})

test('A32: `wq` re: true → the hub forgets that socket\'s view for one tick and serves it afresh (wst + every add again); the cap stays', (t) => {
	const { clk, of, w } = setup(t, 'potato')
	const a = [...w.adapter.viewers()].map((v) => v.key)[0]
	w.quality(a, { n: 20 })
	clk.advance(1000)
	const wst0 = of('wst').length
	assert.ok(wst0 >= 1, 'the world is on for this socket')
	const adds = () => of('wv').filter((m) => Array.isArray(m.add) && m.add.some((x) => x[1] === 'car')).length
	clk.advance(1000)
	assert.equal(of('wst').length, wst0, 'no wst while nothing changes')
	const before = of('wv').length
	const adds0 = adds()
	assert.equal(adds0, 1, 'the car was added once')
	w.quality(a, { re: true })
	assert.equal(w.adapter.viewers().length, 0, 'left out of one viewers() call')
	assert.equal(w.adapter.viewers()[0].cap, 20, 'then back, keeping its cap')
	w.quality(a, { re: true })
	clk.advance(400)
	assert.equal(of('wst').length, wst0 + 1, 'a fresh wst')
	assert.ok(of('wv').length > before, 'the view again')
	assert.equal(adds(), 2, 'the car added again')
})

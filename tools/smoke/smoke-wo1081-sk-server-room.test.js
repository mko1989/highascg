'use strict'

/**
 * WO-1081 — Stage Skirmish referee (work/notes/skirmish-game-contract.md §3 / §5): every accept / reject rule of `fire`,
 * `hit`, `boom` and `pick`, the damage table, armour, surge, friendly fire, kills / suicides / scores and respawns —
 * on the pure room (sk-room.js + sk-combat.js) with an injected clock and timers, a hand-made arena (toy scale 0.1:
 * 1 u = 0.1 m) and fake connections. No sockets, no real timers.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
require('../../modules/toy-skirmish/register')({ requireCore, coreRoot: ROOT, log: () => {} })
const { createSkRoom } = require('../../modules/toy-skirmish/server/sk-room')
const R = require('../../modules/toy-skirmish/server/sk-rules')

/* A 40 × 40 u arena on a 60 × 60 u hall; one block (6 × 1.2 u) across x = 0 at z = 1.0 m. */
const ARENA = {
	id: 'box', name: 'Box', floor: 'hall', y: 0, rect: [-2, -2, 2, 2],
	blocks: [{ x: 0, z: 1, w: 0.6, d: 0.12, h: 0.1, yaw: 0, c: 0 }],
	spawns: [[-1.5, -1.5], [0, -1.5], [1.5, -1.5], [-1.5, -0.6], [1.5, -0.6], [-1.5, 0.6], [1.5, 0.6], [-1.5, 1.5], [0, 1.6], [1.5, 1.5]]
		.map(([x, z]) => ({ x, z, yaw: 0, team: z < 0 ? 0 : 1 })),
	pickups: [['rattler', -0.5, -0.5], ['health', 0.5, -0.5], ['armour', -0.5, 0.5], ['surge', 0.5, 0.5], ['thumper', -1, -1], ['scatter', 1, -1], ['longshot', 1, 0]]
		.map(([kind, x, z], id) => ({ id, kind, x, z })),
}
const SCENE = { rev: 'smoke', scale: 0.1, floors: [{ id: 'hall', y: 0, rect: [-3, -3, 3, 3] }], occ: [], arenas: [ARENA] }
const U = 0.1

function makeClock() {
	let t0 = 5_000_000
	let seq = 0
	const timers = new Map()
	return {
		now: () => t0,
		timers: {
			setTimeout: (fn, ms) => (timers.set(++seq, { fn, at: t0 + ms, every: 0 }), seq),
			setInterval: (fn, ms) => (timers.set(++seq, { fn, at: t0 + ms, every: ms }), seq),
			clearTimeout: (id) => timers.delete(id),
			clearInterval: (id) => timers.delete(id),
		},
		pending: () => timers.size,
		advance(ms) {
			const end = t0 + ms
			for (;;) {
				let next = null
				for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x]
				if (!next) break
				t0 = next[1].at
				if (next[1].every) next[1].at += next[1].every
				else timers.delete(next[0])
				next[1].fn()
			}
			t0 = end
		},
	}
}

function setup(t) {
	const clock = makeClock()
	const closed = []
	const room = createSkRoom({ now: clock.now, timers: clock.timers, rng: R.mulberry32(7), send: (c, m) => c.out.push(m), close: (c, code) => closed.push([c.name, code]) })
	room.setScene(SCENE)
	const X = room.ctx
	const conns = []
	// the clock the tests see: everyone joined keeps talking (a socket silent for 10 s is dropped — tested elsewhere)
	const tick = clock.advance
	clock.advance = (ms) => {
		for (let left = ms; left > 0; left -= 1000) {
			for (const c of conns) room.handle(c, { t: 'ping', c: 0 })
			tick(Math.min(1000, left))
		}
	}
	const join = (name, extra = {}) => {
		const c = { name, out: [] }
		conns.push(c)
		room.connect(c)
		room.handle(c, { t: 'join', name, color: '#ff5533', ...extra })
		c.id = c.out.find((m) => m.t === 'welcome')?.id
		c.p = X.players.get(c.id)
		return c
	}
	/** Put a soldier somewhere (unprotected). */
	const place = (c, x, z) => Object.assign(c.p, { pos: [x, z], protectUntil: 0, alive: true })
	const say = (c, m) => room.handle(c, m)
	const last = (c, type) => c.out.filter((m) => m.t === type).at(-1)
	const count = (c, type) => c.out.filter((m) => m.t === type).length
	const match = () => {
		assert.deepEqual(room.host('start', {}), { ok: true })
		clock.advance(R.RULES.countdownMs + R.RULES.protectMs)
		assert.equal(room.snapshot().phase, 'match')
	}
	t.after(() => {
		room.dispose()
		assert.equal(clock.pending(), 0, 'no timer survives dispose')
	})
	return { clock, room, X, join, place, say, last, count, closed, match }
}

test('fire: alive, holds the weapon, has ammo, interval (10 % tolerance), new n; shot to everyone with a seed', (t) => {
	const { clock, join, place, say, last, count } = setup(t)
	const a = join('A'), b = join('B')
	place(a, -1, 0), place(b, -0.5, 0)
	say(a, { t: 'fire', w: 'pea', n: 1, p: [-1, 0], yaw: 0 })
	const shot = last(b, 'shot')
	assert.deepEqual({ ...shot, seed: 0 }, { t: 'shot', id: a.id, w: 'pea', n: 1, p: [-1, 0], yaw: 0, ts: clock.now(), seed: 0 })
	assert.ok(Number.isInteger(shot.seed) && shot.seed >= 0)
	assert.equal(count(a, 'shot'), 1, 'the shooter gets its own shot too')
	say(a, { t: 'fire', w: 'pea', n: 2, p: [-1, 0], yaw: 0 })
	assert.equal(count(b, 'shot'), 1, 'interval not passed → dropped')
	clock.advance(270) // 0.9 × 300 ms
	say(a, { t: 'fire', w: 'pea', n: 1, p: [-1, 0], yaw: 0 })
	assert.equal(count(b, 'shot'), 1, 'a used n → dropped')
	say(a, { t: 'fire', w: 'pea', n: 3, p: [-1, 0], yaw: 0 })
	assert.equal(count(b, 'shot'), 2, '10 % tolerance on the interval')
	clock.advance(300)
	say(a, { t: 'fire', w: 'rattler', n: 4, p: [-1, 0], yaw: 0 })
	assert.equal(count(b, 'shot'), 2, 'a weapon not held → dropped')
	a.p.w.rattler = 1
	say(a, { t: 'fire', w: 'rattler', n: 5, p: [-1, 0], yaw: 0 })
	assert.equal(count(b, 'shot'), 3)
	assert.deepEqual(last(a, 'me').w, { pea: -1, rattler: 0 }, 'ammo counted down, `me` to the owner')
	clock.advance(200)
	say(a, { t: 'fire', w: 'rattler', n: 6, p: [-1, 0], yaw: 0 })
	assert.equal(count(b, 'shot'), 3, 'no ammo → dropped')
	clock.advance(400)
	say(a, { t: 'fire', w: 'pea', n: 7, p: [9, 9], yaw: 0 })
	assert.deepEqual(last(b, 'shot').p, [-1, 0], 'a fire position outside the arena (+ 2 u) → the server position')
	for (const bad of [{ w: 'laser' }, { n: -1 }, { n: 1.5 }, { p: [0] }, { yaw: 'x' }]) say(a, { t: 'fire', w: 'pea', n: 8, p: [-1, 0], yaw: 0, ...bad })
	assert.equal(count(b, 'shot'), 4, 'malformed fires dropped')
	a.p.alive = false
	clock.advance(400)
	say(a, { t: 'fire', w: 'pea', n: 9, p: [-1, 0], yaw: 0 })
	assert.equal(count(b, 'shot'), 4, 'dead → dropped')
})

test('hit: the damage table, hits left, window, range, line of sight, protection, self', (t) => {
	const { clock, join, place, say, last, count, X } = setup(t)
	const a = join('A'), b = join('B')
	const fire = (w, n, extra = {}) => {
		clock.advance(1500)
		a.p.w[w] ??= 10
		say(a, { t: 'fire', w, n, p: a.p.pos, yaw: 0, ...extra })
	}
	place(a, 0.5, 0.5), place(b, 0.5, 1.5)
	fire('pea', 1)
	say(a, { t: 'hit', n: 1, id: b.id })
	assert.deepEqual(last(a, 'dmg'), { t: 'dmg', id: b.id, by: a.id, w: 'pea', hp: 86, ar: 0 })
	assert.deepEqual(last(b, 'me'), { t: 'me', hp: 86, ar: 0, w: { pea: -1 }, surge: 0 }, 'the victim gets its `me`')
	say(a, { t: 'hit', n: 1, id: b.id })
	assert.equal(b.p.hp, 86, 'one bullet hits once')
	say(a, { t: 'hit', n: 77, id: b.id })
	assert.equal(b.p.hp, 86, 'no such fire')
	fire('pea', 2)
	clock.advance(1501)
	say(a, { t: 'hit', n: 2, id: b.id })
	assert.equal(b.p.hp, 86, 'a fire older than 1.5 s')
	for (const [w, dmg] of [['rattler', 9], ['longshot', 85]]) {
		b.p.hp = 100
		fire(w, 10 + dmg)
		say(a, { t: 'hit', n: 10 + dmg, id: b.id })
		assert.equal(b.p.hp, 100 - dmg, `${w} does ${dmg}`)
	}
	b.p.hp = 100
	fire('scatter', 30)
	say(a, { t: 'hit', n: 30, id: b.id, k: 5 })
	say(a, { t: 'hit', n: 30, id: b.id, k: 5 })
	assert.equal(b.p.hp, 100 - 8 * 7, 'scatter: 8 pellets × 7, k clamped to the pellets left')
	b.p.hp = 100
	fire('thumper', 31)
	say(a, { t: 'hit', n: 31, id: b.id })
	assert.equal(b.p.hp, 100, 'a rocket is never a hitscan hit')
	place(a, 0, 0.5), place(b, 0, 1.5)
	fire('pea', 40)
	say(a, { t: 'hit', n: 40, id: b.id })
	assert.equal(b.p.hp, 100, 'a block between them')
	place(a, -1.5, -1.5), place(b, 1.5, 1.5) // 42.4 u ≤ 40 + 3
	fire('pea', 41)
	say(a, { t: 'hit', n: 41, id: b.id })
	assert.equal(b.p.hp, 86, 'range + 3 u slack')
	place(a, -1.9, -1.9), place(b, 1.9, 1.9) // 53.7 u
	fire('pea', 42)
	say(a, { t: 'hit', n: 42, id: b.id })
	assert.equal(b.p.hp, 86, 'out of range')
	place(a, 0.5, 0.5), place(b, 0.5, 1.5)
	fire('pea', 43)
	b.p.protectUntil = clock.now() + 1000
	say(a, { t: 'hit', n: 43, id: b.id })
	assert.equal(b.p.hp, 86, 'spawn protection')
	b.p.protectUntil = 0
	say(a, { t: 'hit', n: 43, id: a.id })
	assert.equal(a.p.hp, 100, 'not the shooter')
	for (const bad of [{ id: 0 }, { k: 9 }, { k: 0 }, { n: 'x' }]) say(a, { t: 'hit', n: 43, id: b.id, ...bad })
	assert.equal(b.p.hp, 86, 'malformed hits dropped')
	b.p.alive = false
	say(a, { t: 'hit', n: 43, id: b.id })
	assert.equal(count(a, 'dmg'), 6, 'a dead victim')
	assert.equal(X.players.get(b.id).hp, 86)
})

test('armour takes 60 % while it lasts; surge doubles; kills, suicides and score in a match; respawn after 3 s', (t) => {
	const { clock, join, place, say, last, room, match } = setup(t)
	const a = join('A'), b = join('B')
	const shoot = (n, w = 'pea') => {
		clock.advance(1500)
		a.p.w[w] ??= 10
		say(a, { t: 'fire', w, n, p: a.p.pos, yaw: 0 })
		say(a, { t: 'hit', n, id: b.id })
	}
	place(a, 0.5, 0.5), place(b, 0.5, 1.5)
	b.p.ar = 50
	shoot(1)
	assert.deepEqual([b.p.hp, b.p.ar], [94, 42], '14 → 8 absorbed, 6 to health')
	b.p.ar = 5
	shoot(2)
	assert.deepEqual([b.p.hp, b.p.ar], [85, 0], 'armour runs out')
	a.p.surgeUntil = clock.now() + 60000
	shoot(3)
	assert.equal(b.p.hp, 57, 'surge × 2')
	assert.equal(room.combat.meOf(a.p).surge, a.p.surgeUntil)
	a.p.surgeUntil = 0
	b.p.hp = 10
	shoot(4)
	assert.equal(last(a, 'kill').id, b.id, 'lobby kill')
	assert.equal(a.p.kills, 0, 'nothing scored in the lobby')
	assert.ok(b.p.alive && b.p.hp === 100, 'lobby deaths respawn at once')

	match()
	place(a, 0.5, 0.5), place(b, 0.5, 1.5)
	b.p.hp = 10
	shoot(5)
	assert.deepEqual(last(b, 'kill'), { t: 'kill', id: b.id, by: a.id, w: 'pea', at: clock.now() })
	assert.deepEqual([a.p.kills, a.p.score, b.p.deaths, b.p.alive], [1, 1, 1, false])
	assert.equal(room.snapshot().players.find((p) => p.id === a.id).score, 1, 'the state shows it')
	clock.advance(R.RULES.respawnMs - 1)
	assert.equal(b.p.alive, false)
	clock.advance(1)
	const sp = last(a, 'spawn')
	assert.equal(sp.id, b.id)
	assert.equal(sp.until, clock.now() + R.RULES.protectMs, '1.5 s protection')
	assert.ok(b.p.alive && b.p.hp === 100 && b.p.ar === 0)
	assert.deepEqual(b.p.w, { pea: -1 }, 'a respawn starts with the Peashooter only')
	// suicide with a rocket
	place(a, 0.5, 0.5)
	a.p.hp = 10
	clock.advance(1500)
	a.p.w.thumper = 4
	say(a, { t: 'fire', w: 'thumper', n: 6, p: [0.5, 0.5], yaw: 0 })
	clock.advance(50)
	say(a, { t: 'boom', n: 6, p: [0.5, 0.5] })
	assert.equal(last(b, 'kill').by, a.id)
	assert.equal(last(b, 'kill').id, a.id, 'by = id for a suicide')
	assert.deepEqual([a.p.kills, a.p.score, a.p.deaths], [1, 0, 1], 'score = kills − suicides')
})

test('boom: on the fire ray, not farther than the rocket flew, once, ≤ 4.5 s; linear splash, owner × 0.5, tdm team-mates spared', (t) => {
	const { clock, join, place, say, count, room } = setup(t)
	const a = join('A'), b = join('B'), c = join('C')
	const rocket = (n) => {
		clock.advance(1500)
		a.p.w.thumper = 10
		say(a, { t: 'fire', w: 'thumper', n, p: a.p.pos, yaw: 0 }) // yaw 0 → −Z
	}
	place(a, -1, 1.5), place(b, -1, 0.5), place(c, 1.5, 1.5)
	rocket(1)
	clock.advance(100) // flew 2.2 u
	say(a, { t: 'boom', n: 1, p: [-1, 0.9] }) // 6 u along
	assert.equal(count(b, 'boom'), 0, 'farther than 22 u/s × 0.1 s + 1 u')
	clock.advance(300)
	say(a, { t: 'boom', n: 1, p: [-0.8, 0.9] }) // 2 u off the ray
	assert.equal(count(b, 'boom'), 0, 'off the fire ray')
	say(a, { t: 'boom', n: 1, p: [-1, 2.0] })
	assert.equal(count(b, 'boom'), 0, 'behind the shooter')
	say(a, { t: 'boom', n: 1, p: [-1, 0.7] }) // 2 u from b
	assert.equal(count(b, 'boom'), 1)
	assert.equal(b.p.hp, 55, '90 × (1 − 2/4)')
	assert.equal(a.p.hp, 100, 'the owner is 8 u away')
	say(a, { t: 'boom', n: 1, p: [-1, 0.7] })
	assert.equal(count(b, 'boom'), 1, 'once per rocket')
	rocket(2)
	clock.advance(4501)
	say(a, { t: 'boom', n: 2, p: [-1, 1.4] })
	assert.equal(count(b, 'boom'), 1, 'expired')
	clock.advance(1500)
	say(a, { t: 'fire', w: 'pea', n: 3, p: a.p.pos, yaw: 0 })
	say(a, { t: 'boom', n: 3, p: a.p.pos })
	assert.equal(count(b, 'boom'), 1, 'a pea is no rocket')
	b.p.hp = 100
	a.p.surgeUntil = clock.now() + 60000
	rocket(4)
	clock.advance(100)
	say(a, { t: 'boom', n: 4, p: [-1, 1.4] }) // 1 u from a, 9 u from b
	assert.equal(a.p.hp, 100 - Math.round(90 * 0.75 * 0.5), 'owner × 0.5, no surge on himself')
	assert.equal(b.p.hp, 100)
	a.p.surgeUntil = 0
	assert.deepEqual(room.host('mode', { mode: 'tdm' }), { ok: true })
	for (const p of [a, b, c]) p.p.hp = 100
	a.p.team = b.p.team = 0
	c.p.team = 1
	place(a, -1, 1.5), place(b, -1, 0.6), place(c, -0.8, 0.6)
	rocket(5)
	clock.advance(500)
	say(a, { t: 'boom', n: 5, p: [-1, 0.6] })
	assert.equal(b.p.hp, 100, 'a team-mate is spared')
	assert.equal(c.p.hp, 100 - Math.round(90 * 0.5), 'the enemy 2 u away is not')
})

test('pick: within 0.5 u (+ 0.5 u slack), first claim wins, respawn times, refusals at full, surge', (t) => {
	const { clock, join, place, say, last, count, room } = setup(t)
	const a = join('A'), b = join('B')
	const it = (id) => ARENA.pickups[id]
	place(a, it(0).x + 1.1 * U, it(0).z)
	say(a, { t: 'pick', id: 0 })
	assert.equal(count(a, 'pk'), 0, '1.1 u away')
	place(a, it(0).x + 0.9 * U, it(0).z)
	say(a, { t: 'pick', id: 0 })
	assert.deepEqual(last(b, 'pk'), { t: 'pk', id: 0, by: a.id, until: clock.now() + 15000 })
	assert.equal(a.p.w.rattler, 60)
	assert.deepEqual(last(a, 'me').w, { pea: -1, rattler: 60 })
	assert.deepEqual(room.snapshot().pk, [[0, clock.now() + 15000]], 'state.pk')
	place(b, it(0).x, it(0).z)
	say(b, { t: 'pick', id: 0 })
	assert.equal(count(b, 'pk'), 1, 'gone until it respawns')
	clock.advance(15000)
	assert.deepEqual(room.snapshot().pk, [])
	a.p.w.rattler = 180
	place(a, it(0).x, it(0).z)
	say(a, { t: 'pick', id: 0 })
	assert.equal(count(b, 'pk'), 1, 'a weapon held at its maximum is refused')
	a.p.w.rattler = 150
	say(a, { t: 'pick', id: 0 })
	assert.equal(a.p.w.rattler, 180, 'ammo capped')
	place(a, it(1).x, it(1).z)
	say(a, { t: 'pick', id: 1 })
	assert.equal(count(b, 'pk'), 2, 'health at 100 is refused')
	a.p.hp = 80
	say(a, { t: 'pick', id: 1 })
	assert.equal(a.p.hp, 100, '+35 capped at 100')
	assert.equal(last(b, 'pk').until, clock.now() + 20000)
	place(a, it(2).x, it(2).z)
	say(a, { t: 'pick', id: 2 })
	assert.equal(a.p.ar, 50)
	assert.equal(last(b, 'pk').until, clock.now() + 30000)
	place(a, it(3).x, it(3).z)
	say(a, { t: 'pick', id: 3 })
	assert.equal(a.p.surgeUntil, clock.now() + 20000)
	assert.equal(last(a, 'me').surge, clock.now() + 20000)
	assert.equal(last(b, 'pk').until, clock.now() + 90000)
	clock.advance(60)
	assert.equal(last(b, 'w').a.find((e) => e[0] === a.id)[4] & 8, 8, 'surge flag in `w`')
	say(a, { t: 'pick', id: 63 })
	say(a, { t: 'pick', id: 64 })
	a.p.alive = false
	place(b, it(4).x, it(4).z)
	b.p.alive = false
	say(b, { t: 'pick', id: 4 })
	assert.equal(count(b, 'pk'), 5, 'unknown ids and the dead pick nothing')
})

test('spawn choice: the spawn farthest from enemies; tdm uses the own team\'s half', (t) => {
	const { join, place, room, X } = setup(t)
	const a = join('A'), b = join('B')
	place(a, -1.5, -1.5)
	room.combat.spawn(b.p)
	assert.deepEqual(b.p.pos, [1.5, 1.5], 'opposite corner')
	room.host('mode', { mode: 'tdm' })
	for (let n = 0; n < 6; n++) {
		room.combat.spawn(a.p)
		const s = ARENA.spawns.find((q) => q.x === a.p.pos[0] && q.z === a.p.pos[1])
		assert.equal(s.team, a.p.team, 'own half')
	}
	assert.equal(X.mode(), 'tdm')
})

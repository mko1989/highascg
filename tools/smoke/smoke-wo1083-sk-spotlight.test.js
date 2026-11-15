'use strict'

/**
 * WO-1083 — Stage Skirmish mode `spot` ("Spotlight", server/sk-spot.js): on the pure room with an injected clock and a
 * hand-made arena (toy scale 0.1): the pool appears on a pickup pad in the lobby and in the match, nothing is scored in
 * the warm-up, a soldier alone in it scores a point per second, two inside = contested (nobody scores), frags do not
 * score, the pool moves after 40 s to a pad ≥ 12 u away, the points limit ends the match (results carry the mode),
 * bots walk to the pool and score, the client's HUD line (client/spot-status.js), and no timer survives dispose.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
require('../../modules/toy-skirmish/register')({ requireCore, coreRoot: ROOT, log: () => {} })
const { createSkRoom } = require('../../modules/toy-skirmish/server/sk-room')
const R = require('../../modules/toy-skirmish/server/sk-rules')
const { SPOT } = require('../../modules/toy-skirmish/server/sk-spot')

const U = 0.1
/* A 40 × 40 u arena; seven pickup pads (the spot's places), ten spawns on the rim. */
const ARENA = {
	id: 'box', name: 'Box', floor: 'hall', y: 0, rect: [-2, -2, 2, 2], blocks: [],
	spawns: [[-1.8, -1.8], [0, -1.8], [1.8, -1.8], [-1.8, 0], [1.8, 0], [-1.8, 1.8], [0, 1.8], [1.8, 1.8], [-0.9, 1.8], [0.9, -1.8]]
		.map(([x, z]) => ({ x, z, yaw: 0, team: z < 0 ? 0 : 1 })),
	pickups: [['rattler', -1, -1], ['health', 1, -1], ['armour', -1, 1], ['scatter', 1, 1], ['thumper', 0, 0], ['longshot', -1.3, 0], ['health', 1.3, 0]]
		.map(([kind, x, z], id) => ({ id, kind, x, z })),
}
const SCENE = { rev: 'spot', scale: U, floors: [{ id: 'hall', y: 0, rect: [-3, -3, 3, 3] }], occ: [], arenas: [ARENA] }

function makeClock() {
	let t0 = 3_000_000
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
	const room = createSkRoom({ now: clock.now, timers: clock.timers, rng: R.mulberry32(5), send: (c, m) => c.out.push(m) })
	room.setScene(SCENE)
	const X = room.ctx
	const talking = new Set()
	const step = clock.advance
	/** advance in 250 ms steps, every player keeping its place (and its socket alive) */
	const run = (ms) => {
		for (let left = ms; left > 0; left -= 250) {
			for (const c of talking) {
				room.handle(c, { t: 'ping', c: 0 })
				if (c.at && c.p.alive) c.p.pos = c.at.slice()
			}
			step(Math.min(250, left))
		}
	}
	const join = (name) => {
		const c = { name, out: [] }
		talking.add(c)
		room.connect(c)
		room.handle(c, { t: 'join', name })
		c.id = c.out.find((m) => m.t === 'welcome').id
		c.p = X.players.get(c.id)
		return c
	}
	/** Keep c at [x, z] (metres), unprotected. */
	const hold = (c, x, z) => {
		c.at = [x, z]
		Object.assign(c.p, { pos: [x, z], protectUntil: 0, alive: true })
	}
	const spot = () => room.snapshot().spot
	t.after(() => {
		room.dispose()
		assert.equal(clock.pending(), 0, 'no timer survives dispose')
	})
	return { clock, room, X, join, hold, run, spot }
}

test('mode spot: the pool on a pad, warm-up scores nothing, alone = a point a second, contested = nothing', (t) => {
	const { room, join, hold, run, spot } = setup(t)
	assert.equal(room.snapshot().spot, null, 'no pool in dm')
	assert.deepEqual(room.host('mode', { mode: 'spot' }), { ok: true })
	const st = room.snapshot()
	assert.equal(st.mode, 'spot')
	assert.equal(st.limits.frags, R.RULES.frags.spot, 'the points limit')
	const a = join('A'), b = join('B')
	run(500)
	const s0 = spot()
	assert.ok(s0, 'a pool in the lobby')
	assert.ok(ARENA.pickups.some((p) => p.x === s0.x && p.z === s0.z), 'on a pickup pad')
	assert.equal(s0.r, SPOT.radiusU * U)
	hold(a, s0.x, s0.z)
	hold(b, -1.8, -1.8)
	run(3000)
	assert.equal(spot().holder, a.id, 'A holds it')
	assert.equal(a.p.score, 0, 'warm-up: nothing scored')
	room.host('start')
	run(R.RULES.countdownMs + 250)
	assert.equal(room.snapshot().phase, 'match')
	const s1 = spot()
	hold(a, s1.x, s1.z)
	hold(b, -1.8, -1.8)
	run(250)
	const before = a.p.score
	run(3000)
	assert.equal(a.p.score - before, 3, 'three seconds alone = 3 points')
	assert.equal(spot().holder, a.id)
	hold(b, s1.x + 0.1, s1.z)
	run(2000)
	assert.equal(spot().contested, true)
	assert.equal(spot().holder, null)
	assert.equal(a.p.score - before, 3, 'contested: nobody scores')
	assert.equal(b.p.score, 0)
	const st2 = a.out.filter((m) => m.t === 'state').at(-1).state
	assert.equal(st2.spot.contested, true, 'the state tells everyone')
})

test('frags do not score; the pool moves after 40 s, ≥ 12 u away; the points limit ends the match', (t) => {
	const { room, X, join, hold, run, spot } = setup(t)
	room.host('mode', { mode: 'spot' })
	room.host('limits', { frags: 5, minutes: 5 })
	const a = join('A'), b = join('B')
	room.host('start')
	run(R.RULES.countdownMs + 250)
	const s1 = spot()
	hold(a, -1.8, -1.8)
	hold(b, -1.8, -1.1)
	b.p.hp = 1
	a.p.lastFire = {}
	room.handle(a, { t: 'fire', w: 'pea', n: 7, p: a.p.pos, yaw: R.yawTo(-1.8, -1.8, -1.8, -1.1) })
	room.handle(a, { t: 'hit', n: 7, id: b.id, k: 1 })
	assert.equal(b.p.alive, false)
	assert.equal(a.p.kills, 1)
	assert.equal(a.p.score, 0, 'a frag is no point in Spotlight')
	b.at = null
	run(SPOT.moveMs - 1000)
	const s2 = spot()
	assert.ok(s2.x !== s1.x || s2.z !== s1.z, 'moved')
	assert.ok(Math.hypot(s2.x - s1.x, s2.z - s1.z) >= SPOT.minMoveU * U - 1e-9, 'far enough')
	hold(a, s2.x, s2.z)
	hold(b, -1.8, 1.8)
	run(6000)
	assert.equal(room.snapshot().phase, 'results', 'the points limit')
	const res = a.out.find((m) => m.t === 'results')
	assert.equal(res.mode, 'spot')
	assert.equal(res.order[0].id, a.id)
	assert.equal(X.players.get(a.id).score, 5)
})

test('bots go to the pool and score there', (t) => {
	const { room, X, run, spot } = setup(t)
	room.host('mode', { mode: 'spot' })
	room.host('bots', { n: 2 })
	room.host('limits', { frags: 100, minutes: 5 })
	room.host('start')
	let inside = 0
	for (let k = 0; k < 240; k++) {
		run(250)
		const sp = spot()
		if (!sp) continue
		for (const p of X.players.values()) if (p.alive && p.pos && Math.hypot(p.pos[0] - sp.x, p.pos[1] - sp.z) <= sp.r) inside++
	}
	const pts = [...X.players.values()].reduce((n, p) => n + p.score, 0)
	t.diagnostic(`bot ticks inside the pool ${inside}, points ${pts}`)
	assert.ok(inside > 40, 'they stand in the light')
	assert.ok(pts > 5, 'and score')
})

test('the HUD line (client/spot-status.js)', async () => {
	const S = await import(path.join(ROOT, 'modules/toy-skirmish/client/spot-status.js'))
	const base = { meId: 1, phase: 'match', sNow: 0, me: null, nameOf: (id) => `P${id}`, s: U, warnS: 5 }
	const spot = { x: 0, z: 0, r: 0.25, movesAt: 30000, holder: null, contested: false }
	assert.deepEqual(S.spotStatus(null, base), null)
	assert.equal(S.spotStatus(spot, base).kind, 'free')
	assert.deepEqual(S.spotStatus({ ...spot, holder: 1 }, base), { text: 'You hold the light · +1 a second', kind: 'mine' })
	assert.equal(S.spotStatus({ ...spot, holder: 1 }, { ...base, phase: 'lobby' }).text, 'You hold the light (warm-up)')
	assert.equal(S.spotStatus({ ...spot, holder: 2 }, base).text, 'P2 holds the light')
	assert.equal(S.spotStatus({ ...spot, contested: true }, base).kind, 'fight')
	assert.match(S.spotStatus(spot, { ...base, sNow: 27500 }).text, /moves in 3$/)
	assert.equal(S.spotStatus(spot, { ...base, me: { x: 0, z: -1.2 } }).text, '↓ The light is free · 12 u', 'out of view: an arrow (screen-down = +Z)')
	assert.equal(S.spotStatus(spot, { ...base, me: { x: 0, z: -0.3 } }).text, 'The light is free', 'in view: no arrow')
	assert.equal(S.arrowFor(1, 0), '→')
	assert.equal(S.arrowFor(0, -1), '↑')
})

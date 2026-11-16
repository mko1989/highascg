'use strict'

/**
 * WO-1101 / WO-1102 — Stage Skirmish in the Game World (work/notes/game-world-contract.md §0, §4, §5, §6.1 R4, §6.2,
 * §6.3): modules/toy-skirmish/server/sk-world.js (registry descriptor + room adapter + the accepted-shot tap) and the
 * world pause in sk-room.js. Proves: alone = unchanged (no hub, or a hub with no other room → the very same messages over
 * a full match cycle, no `paused` key, no world message; `wq` is a known message type that does nothing without a hub);
 * the pause (moves / fires dropped, X.phase() 'paused', the phase step held and resumed after the REMAINING time,
 * startAt / endsAt shifted, start refused 409, stop while paused not resurrected, dispose leaves no timer); the adapter
 * (soldiers in metres ≤ 10, viewers + `wq` caps, board, stun → that soldier's fire dropped for the stun, soft stun
 * not, bonus every 3rd +1 ≤ 2 per match in 'match' only, tdm team score too); an accepted hitscan shot → hub.shot once
 * (origin in metres at arena y + 0.035, range × u, a line-of-sight function), a rocket never. FAKE hub, removed after.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
require('../../modules/toy-skirmish/register')({ requireCore, coreRoot: ROOT, log: () => {} })
const { createSkRoom, WORLD_MS } = require('../../modules/toy-skirmish/server/sk-room')
const SW = require('../../modules/toy-skirmish/server/sk-world')
const SS = require('../../modules/toy-skirmish/server/sk-sanitize')
const R = require('../../modules/toy-skirmish/server/sk-rules')

const KEY = Symbol.for('highascg.game-world/1')
const reg = () => globalThis[KEY] || (globalThis[KEY] = { v: 1, games: new Map(), hub: null })
const WORLD_T = new Set(['wst', 'wv', 'xfx', 'xbonus', 'xb', 'xev'])
const KEYS = ['maxPlayers', 'phase', 'mode', 'arenaId', 'limits', 'startAt', 'endsAt', 'bots', 'botLevel', 'players', 'teams', 'pk', 'spectators', 'spot']
const Y = 0.4 // the arena floor (room metres)

test.after(() => {
	reg().hub = null
	reg().games.delete('sk')
})

function fakeHub(t) {
	const calls = []
	const rec = (name) => (...a) => void calls.push([name, ...a])
	const hub = { calls, attach: rec('attach'), detach: rec('detach'), quality: rec('quality'), shot: rec('shot'), colliders: () => [],
		contact: rec('contact'), landed: rec('landed') }
	hub.of = (name) => calls.filter((c) => c[0] === name)
	reg().hub = hub
	t.after(() => {
		reg().hub = null
	})
	return hub
}

/* The arena of the WO-1081 smokes, raised to y 0.4: 40 × 40 u (toy scale 0.1), one block across x = 0 at z = 1.0 m. */
const ARENA = {
	id: 'box', name: 'Box', floor: 'hall', y: Y, rect: [-2, -2, 2, 2],
	blocks: [{ x: 0, z: 1, w: 0.6, d: 0.12, h: 0.1, yaw: 0, c: 0 }],
	spawns: [[-1.5, -1.5], [0, -1.5], [1.5, -1.5], [-1.5, -0.6], [1.5, -0.6], [-1.5, 0.6], [1.5, 0.6], [-1.5, 1.5], [0, 1.6], [1.5, 1.5]]
		.map(([x, z]) => ({ x, z, yaw: 0, team: z < 0 ? 0 : 1 })),
	pickups: [['rattler', -0.5, -0.5], ['health', 0.5, -0.5]].map(([kind, x, z], id) => ({ id, kind, x, z })),
}
const SCENE = { rev: 'smoke', scale: 0.1, floors: [{ id: 'hall', y: Y, rect: [-3, -3, 3, 3] }], occ: [], arenas: [ARENA] }

function makeClock() {
	let t0 = 7_000_000
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

function setup(t, o = {}) {
	const clock = makeClock()
	const send = (c, m) => c.out.push(m)
	let world = null
	const room = createSkRoom({ now: clock.now, timers: clock.timers, rng: R.mulberry32(11), send, maxPlayers: o.maxPlayers,
		...(o.world ? { tap: (m) => world.onShot(m) } : {}) })
	if (o.world) world = SW.createSkWorld({ room: () => room, send, now: clock.now })
	room.setScene(SCENE)
	const X = room.ctx
	const talking = new Set()
	const tick = clock.advance
	clock.advance = (ms) => {
		for (let left = ms; left > 0; left -= 1000) {
			for (const c of talking) room.handle(c, { t: 'ping', c: 0 })
			tick(Math.min(1000, left))
		}
	}
	const join = (name, extra = {}) => {
		const c = { name, out: [] }
		room.connect(c)
		room.handle(c, { t: 'join', name, color: '#ff5533', ...extra })
		talking.add(c)
		c.id = c.out.find((m) => m.t === 'welcome')?.id
		c.p = X.players.get(c.id)
		return c
	}
	const place = (c, x, z) => Object.assign(c.p, { pos: [x, z], protectUntil: 0, alive: true })
	const last = (c, type) => c.out.filter((m) => m.t === type).at(-1)
	let n = 1000
	const fire = (c, w = 'pea', yaw = 0) => {
		c.p.lastFire = {}
		room.handle(c, { t: 'fire', w, n: ++n, p: c.p.pos, yaw })
		return n
	}
	const frag = (a, b) => {
		place(a, -1.5, -0.6), place(b, -1.5, 0.4)
		b.p.hp = 1
		room.handle(a, { t: 'hit', n: fire(a), id: b.id })
		assert.equal(b.p.alive, false, 'fragged')
	}
	if (t) {
		t.after(() => {
			room.dispose()
			assert.equal(clock.pending(), 0, 'no timer survives dispose')
		})
	}
	return { clock, room, X, join, place, last, fire, frag, world: () => world }
}

/** One full match cycle: two players + a spectator, warm-up shots, start, frags, the time limit, results, lobby. */
function cycle(S, hooks = {}) {
	const a = S.join('Ann'), b = S.join('Ben'), sp = S.join('Eye', { spectator: true })
	hooks.joined?.(a, b)
	S.room.handle(a, { t: 'wq', n: 20 }) // the service intercepts it; reaching the room it is ignored
	S.clock.advance(R.RULES.protectMs)
	S.fire(a), S.fire(b, 'pea', 1)
	S.room.host('limits', { frags: 5, minutes: 1 })
	S.room.host('start')
	S.clock.advance(R.RULES.countdownMs + R.RULES.protectMs)
	S.frag(a, b)
	S.room.handle(a, { t: 's', p: [-1.4, -0.6], yaw: 0.3, mv: 1 })
	hooks.match?.()
	S.clock.advance(60000)
	S.clock.advance(R.RULES.resultsMs + WORLD_MS)
	assert.equal(S.room.snapshot().phase, 'lobby')
	return [a, b, sp].map((c) => JSON.stringify(c.out)).join('\n')
}

test('alone = unchanged: no hub → the same messages over a full match cycle, no world message, no `paused` key', (t) => {
	assert.equal(reg().hub, null)
	const base = cycle(setup(t))
	assert.ok(['"t":"results"', '"t":"shot"', '"t":"countdown"'].every((s) => base.includes(s)), 'a real match happened')
	for (const line of base.split('\n')) {
		for (const m of JSON.parse(line)) {
			assert.ok(!WORLD_T.has(m.t), `no world message (${m.t})`)
			if (m.state) assert.deepEqual(Object.keys(m.state), KEYS)
		}
	}
	const S = setup(t, { world: true })
	const poke = () => {
		const A = S.world().adapter
		A.entities(), A.viewers(), A.board(), A.area(), A.pools()
	}
	const run = cycle(S, { joined: (a) => (S.world().attach(), S.world().quality(a, { n: 6 }), poke()), match: poke })
	S.world().detach()
	assert.equal(run, base)
})

test('alone = unchanged with a hub that has no other room: the same messages; attach / quality / shot / detach reach the hub', (t) => {
	const base = cycle(setup(t))
	const hub = fakeHub(t)
	const S = setup(t, { world: true })
	let A = null
	const run = cycle(S, { joined: (a) => (S.world().attach(), S.world().quality(a, { n: 20 }), (A = a)) })
	S.world().detach()
	assert.equal(run, base)
	assert.equal(hub.of('attach')[0][1], S.world().adapter)
	assert.deepEqual(hub.of('quality'), [['quality', 'sk', A, 20]])
	assert.equal(hub.of('shot').length, 3, 'every accepted hitscan fire')
	assert.deepEqual(hub.of('detach'), [['detach', 'sk']])
})

test('`wq`: a known message type (≤ 2 KB); without a hub only the cap; a throwing hub never breaks the game', (t) => {
	assert.deepEqual(SS.parseMessage(JSON.stringify({ t: 'wq', n: 12 })), { t: 'wq', n: 12 })
	assert.equal(SS.parseMessage(JSON.stringify({ t: 'wq', pad: 'x'.repeat(3000) })), null)
	const S = setup(t, { world: true })
	const a = S.join('Ann')
	for (const [n, want] of [[6, 6], [20, 20], [12, 12], [5, 12], [null, 12]]) {
		S.world().quality(a, { t: 'wq', n })
		assert.equal(S.world().adapter.viewers()[0].cap, want)
	}
	const hub = fakeHub(t)
	hub.quality = hub.attach = hub.detach = hub.shot = () => {
		throw new Error('world down')
	}
	assert.doesNotThrow(() => (S.world().quality(a, { n: 6 }), S.world().attach(), S.world().detach()))
	S.clock.advance(R.RULES.protectMs)
	assert.doesNotThrow(() => S.fire(a))
	assert.ok(S.last(a, 'shot'), 'the shot still went out')
})

test('pause in the match: actions dropped, phase "paused" to the referee, the time limit held, endsAt shifted on resume', (t) => {
	const S = setup(t)
	const a = S.join('Ann'), b = S.join('Ben')
	S.room.host('limits', { minutes: 1 })
	S.room.host('start')
	S.clock.advance(R.RULES.countdownMs + R.RULES.protectMs)
	const ends0 = S.room.snapshot().endsAt
	S.place(a, -1.5, -0.6)
	a.p.mv = 1
	S.clock.advance(10000 - R.RULES.protectMs)
	const at = S.clock.now()
	assert.deepEqual(S.room.host('pause', { on: 1 }).status, 400)
	assert.deepEqual(S.room.host('pause', { on: true }), { ok: true })
	assert.equal(S.last(b, 'state').state.paused, true)
	assert.deepEqual(Object.keys(S.room.snapshot()), [...KEYS, 'paused'])
	assert.equal(S.X.phase(), 'paused')
	assert.equal(a.p.mv, 0, 'everyone stands still')
	assert.equal(S.room.world().paused, true)
	const shots = b.out.filter((m) => m.t === 'shot').length
	S.fire(a)
	S.room.handle(a, { t: 's', p: [-1.45, -0.6], yaw: 1, mv: 1 })
	S.room.handle(a, { t: 'pick', id: 0 })
	assert.equal(b.out.filter((m) => m.t === 'shot').length, shots, 'no fire relayed')
	assert.deepEqual(a.p.pos, [-1.5, -0.6], 'no move')
	assert.equal(S.room.timers().phase, false)
	S.clock.advance(5 * 60000)
	assert.equal(S.room.snapshot().phase, 'match', 'five minutes over a 1-minute match: held')
	S.room.host('pause', { on: false })
	const d = S.clock.now() - at
	assert.ok(!('paused' in S.room.snapshot()))
	assert.ok(!('paused' in S.last(b, 'state').state))
	assert.equal(S.X.phase(), 'match')
	assert.equal(S.room.snapshot().endsAt, ends0 + d, 'endsAt shifted by the paused time')
	const left = ends0 - at
	S.clock.advance(left - 1000)
	assert.equal(S.room.snapshot().phase, 'match')
	S.clock.advance(1000)
	assert.equal(S.room.snapshot().phase, 'results', 'the remaining time after the resume')
})

test('pause in the countdown: startAt / endsAt shifted, a new countdown message, the match after the remaining time', (t) => {
	const S = setup(t)
	const a = S.join('Ann')
	S.room.host('start')
	const st0 = S.room.snapshot()
	S.clock.advance(1000)
	const at = S.clock.now()
	S.room.host('pause', { on: true })
	S.clock.advance(30000)
	assert.equal(S.room.snapshot().phase, 'countdown')
	S.room.host('pause', { on: false })
	const d = S.clock.now() - at
	const st = S.room.snapshot()
	assert.deepEqual([st.startAt, st.endsAt], [st0.startAt + d, st0.endsAt + d])
	assert.equal(S.room.world().startAt, st0.startAt + d)
	assert.equal(S.last(a, 'countdown').startAt, st0.startAt + d)
	S.clock.advance(R.RULES.countdownMs - 1000 - 1)
	assert.equal(S.room.snapshot().phase, 'countdown')
	S.clock.advance(1)
	assert.equal(S.room.snapshot().phase, 'match')
	assert.equal(S.room.snapshot().endsAt, S.clock.now() + 5 * 60000, 'the match runs its full time from the shifted start')
})

test('pause: start refused 409, stop while paused is not resurrected, dispose leaves no timer', () => {
	const S = setup(null)
	S.join('Ann')
	S.room.host('pause', { on: true })
	assert.deepEqual(S.room.host('start'), { ok: false, status: 409, error: 'paused' })
	S.room.host('pause', { on: false })
	assert.equal(S.room.host('start').ok, true)
	S.room.host('pause', { on: true })
	assert.equal(S.room.host('stop').ok, true)
	assert.equal(S.room.snapshot().phase, 'lobby')
	S.room.host('pause', { on: false })
	S.clock.advance(20000)
	assert.equal(S.room.snapshot().phase, 'lobby', 'the countdown step never comes back')
	assert.equal(S.room.timers().phase, false)
	S.room.host('start')
	S.clock.advance(R.RULES.countdownMs)
	S.room.host('pause', { on: true })
	S.room.dispose()
	assert.equal(S.clock.pending(), 0, 'dispose while paused: no timer')
	assert.ok(!('paused' in S.room.snapshot()))
})

test('adapter: soldiers in metres on the arena floor (≤ 10), viewers, board with top ≤ 3 and "paused"', (t) => {
	const S = setup(t, { world: true, maxPlayers: 12 })
	const A = S.world().adapter
	assert.equal(A.id, 'sk')
	const all = Array.from({ length: 12 }, (_, i) => S.join(`S${i}`))
	const sp = S.join('Eye', { spectator: true })
	S.place(all[0], 0.5, -1.2)
	all[0].p.yaw = 0.7
	all[0].p.mv = 1
	all[0].p.protectUntil = S.clock.now() + 1000
	const ents = A.entities()
	assert.ok(ents.length <= 10)
	assert.equal(ents.length, 10, 'twelve alive, ten published')
	assert.deepEqual(ents[0], { k: 'soldier', id: all[0].id, p: [0.5, Y, -1.2], yaw: 0.7, c: '#ff5533', n: 'S0', f: 1 | 4, s: 'pea', bot: false, prot: true })
	all[1].p.alive = false
	assert.ok(!A.entities().some((e) => e.id === all[1].id), 'the dead are not entities')
	const vs = A.viewers()
	assert.equal(vs.length, 13)
	assert.deepEqual(vs[0], { key: all[0], kind: 'player', p: [0.5, Y, -1.2], cap: 12 })
	assert.deepEqual(vs.at(-1), { key: sp, kind: 'spectator', p: null, cap: 12 })
	assert.deepEqual(A.area(), { rect: [-2, -2, 2, 2], y: Y })
	all[2].p.score = 5, all[3].p.score = 3, all[4].p.score = 4
	const bd = A.board()
	assert.deepEqual(bd.top.map((x) => [x.name, x.score, x.label]), [['S2', 5, '5'], ['S4', 4, '4'], ['S3', 3, '3']])
	assert.deepEqual([bd.phase, bd.players, bd.bots, bd.endsAt], ['lobby', 12, 0, null])
	A.pause(true)
	assert.equal(S.room.snapshot().paused, true, 'adapter.pause → host pause')
	assert.equal(A.board().phase, 'paused')
	A.pause(false)
	assert.equal(A.board().phase, 'lobby')
})

test('adapter.apply: stun → xfx to all + that soldier\'s fire dropped for the stun; soft stun only shows; refused when it cannot act', (t) => {
	const S = setup(t, { world: true })
	const A = S.world().adapter
	const a = S.join('Ann'), b = S.join('Ben'), sp = S.join('Eye', { spectator: true })
	S.clock.advance(R.RULES.protectMs)
	S.place(a, -1.5, -0.6)
	const e = { k: 'stun', g: 'sk', id: a.id, dur: 0.8, dir: [1, 0], soft: false, by: { g: 'rc', name: 'Ola' } }
	assert.equal(A.apply(e), true)
	assert.equal(a.p.stunUntil, S.clock.now() + 800)
	for (const c of [a, b, sp]) assert.deepEqual(S.last(c, 'xfx'), { t: 'xfx', k: 'stun', id: a.id, dur: 0.8, dir: [1, 0], by: { g: 'rc', n: 'Ola' } })
	assert.equal(A.entities().find((x) => x.id === a.id).f & 32, 32, 'stunned flag')
	const shots = () => b.out.filter((m) => m.t === 'shot').length
	const n0 = shots()
	S.fire(a)
	S.clock.advance(500)
	S.fire(a)
	assert.equal(shots(), n0, 'no fire while stunned')
	S.room.handle(a, { t: 's', p: [-1.45, -0.6], yaw: 0, mv: 1 })
	assert.deepEqual(a.p.pos, [-1.45, -0.6], 'moves are not frozen (the client holds its own input)')
	S.clock.advance(300)
	S.fire(a)
	assert.equal(shots(), n0 + 1, 'after 0.8 s it fires again')
	assert.equal(A.apply({ ...e, soft: true }), true)
	assert.ok(a.p.stunUntil <= S.clock.now(), 'soft: no stun')
	assert.equal(S.last(b, 'xfx').soft, true)
	S.clock.advance(400)
	S.fire(a)
	assert.equal(shots(), n0 + 2, 'soft stun: fires')
	assert.equal(A.apply({ ...e, k: 'scatter', dur: 0.5 }), true)
	assert.ok(a.p.stunUntil <= S.clock.now(), 'only stun stops the fire')
	assert.equal(A.apply({ ...e, id: 999 }), false)
	assert.equal(A.apply({ ...e, id: sp.id }), false, 'a spectator is no soldier')
	b.p.alive = false
	assert.equal(A.apply({ ...e, id: b.id }), false, 'dead')
	S.room.host('pause', { on: true })
	assert.equal(A.apply(e), false, 'paused')
	S.room.host('pause', { on: false })
	S.room.host('start')
	assert.equal(A.apply(e), false, 'countdown')
})

test('accepted hitscan shot → hub.shot once (metres, range × u, line of sight); a rocket or a dropped fire never', (t) => {
	const hub = fakeHub(t)
	const S = setup(t, { world: true })
	const a = S.join('Ann'), b = S.join('Ben')
	S.clock.advance(R.RULES.protectMs)
	S.place(a, -1.5, -0.6)
	S.place(b, 1.5, 1.5)
	const dup = S.fire(a, 'pea', 0.25)
	const shots = hub.of('shot')
	assert.equal(shots.length, 1)
	const q = shots[0][1]
	assert.deepEqual([q.g, q.pid, q.yaw], ['sk', a.id, 0.25])
	assert.equal(q.o[0], -1.5)
	assert.equal(q.o[2], -0.6)
	assert.ok(Math.abs(q.o[1] - (Y + 0.035)) < 1e-12, `muzzle ${q.o[1]}`)
	assert.ok(Math.abs(q.range - R.WEAPONS.pea.range * 0.1) < 1e-12)
	assert.equal(typeof q.los, 'function')
	assert.equal(q.los([-1.5, Y, -1.5], [1.5, Y, -1.5]), true, 'open floor')
	assert.equal(q.los([0, Y, 0.5], [0, Y, 1.5]), false, 'through the block')
	a.p.w.longshot = 5
	S.fire(a, 'longshot')
	assert.ok(Math.abs(hub.of('shot')[1][1].range - 120 * 0.1) < 1e-12)
	a.p.w.thumper = 4
	S.fire(a, 'thumper')
	assert.ok(S.last(b, 'shot').w === 'thumper', 'the rocket went out')
	assert.equal(hub.of('shot').length, 2, 'a rocket is no hitscan')
	a.p.lastFire = {}
	S.room.handle(a, { t: 'fire', w: 'pea', n: dup, p: a.p.pos, yaw: 0 }) // a reused shot counter: dropped by the referee
	a.p.stunUntil = S.clock.now() + 1000
	S.fire(a)
	assert.equal(hub.of('shot').length, 2, 'dropped fires never reach the world')
})

test('adapter.bonus: xbonus to the causer; every 3rd +1 score, ≤ 2 per match, only in a match; tdm team score too', (t) => {
	const S = setup(t, { world: true })
	const A = S.world().adapter
	const a = S.join('Ann'), b = S.join('Ben')
	assert.equal(A.bonus(a.id, 'R4'), true, 'warm-up: shown')
	assert.deepEqual(S.last(a, 'xbonus'), { t: 'xbonus', kind: 'R4', pts: 0 })
	assert.equal(S.last(b, 'xbonus'), undefined, 'only the causer')
	for (let i = 0; i < 5; i++) A.bonus(a.id, 'R4')
	assert.equal(a.p.score, 0, 'nothing counted in the warm-up')
	S.room.host('mode', { mode: 'tdm' })
	S.room.host('start')
	assert.equal(A.bonus(a.id, 'R4'), false, 'countdown')
	S.clock.advance(R.RULES.countdownMs)
	const pts = []
	for (let i = 0; i < 9; i++) A.bonus(a.id, 'R3'), pts.push(S.last(a, 'xbonus').pts)
	assert.deepEqual(pts, [0, 0, 1, 0, 0, 1, 0, 0, 0])
	assert.equal(a.p.score, 2, '+2 per match at most')
	assert.equal(a.p.kills, 0, 'frags untouched')
	assert.equal(S.room.snapshot().teams[a.p.team], 2, 'the team score too')
	assert.equal(S.last(b, 'state').state.players.find((p) => p.id === a.id).score, 2, 'everyone hears the score')
	S.room.host('pause', { on: true })
	assert.equal(A.bonus(a.id, 'R4'), false, 'paused')
	S.room.host('pause', { on: false })
	assert.equal(A.bonus(999, 'R4'), false)
})

test('adapter.bonus after a pause in the same match: still at most +2', (t) => {
	const S = setup(t, { world: true })
	const A = S.world().adapter
	const a = S.join('Ann')
	S.join('Ben')
	S.room.host('start')
	S.clock.advance(R.RULES.countdownMs)
	for (let i = 0; i < 6; i++) A.bonus(a.id, 'R3')
	S.room.host('pause', { on: true })
	S.clock.advance(1000)
	S.room.host('pause', { on: false })
	for (let i = 0; i < 6; i++) A.bonus(a.id, 'R3')
	assert.equal(a.p.score, 2)
})

test('register / unregister; a detached or disabled world is harmless', () => {
	const game = { host: (b) => ({ status: 200, body: b }), state: () => ({ on: 1 }), worldAdapter: () => null }
	SW.register(() => game)
	const d = reg().games.get('sk')
	assert.deepEqual([d.id, d.title, d.models.soldier, d.room()], ['sk', 'Stage Skirmish', '/game/sk/soldier-model.js', null])
	assert.deepEqual(d.host({ action: 'start' }), { status: 200, body: { action: 'start' } })
	SW.unregister()
	assert.equal(reg().games.has('sk'), false)
	const off = SW.createSkWorld({ room: () => null, send: () => {} })
	const A = off.adapter
	assert.deepEqual([A.entities(), A.viewers(), A.area(), A.pools()], [[], [], null, []])
	assert.deepEqual(A.board(), { phase: 'off', endsAt: null, top: [], players: 0, bots: 0 })
	assert.equal(A.apply({ k: 'stun', id: 1, dur: 1 }), false)
	assert.equal(A.bonus(1, 'R4'), false)
	assert.doesNotThrow(() => (A.pause(true), off.onShot({ t: 'shot', w: 'pea', p: [0, 0] })))
})

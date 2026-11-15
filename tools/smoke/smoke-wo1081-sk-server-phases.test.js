'use strict'

/**
 * WO-1081 — Stage Skirmish room (work/notes/skirmish-game-contract.md §6 / §7): join / welcome / full / spectators,
 * positions (rect + 2 u, 6 u/s clamp, 20 / s cap, frozen outside lobby / match), the `w` relay and its flags, the phase
 * machine lobby → countdown → match → results → lobby with frag and time limits and the results order, `tdm` teams,
 * host actions and their refusals, disconnects, silent / unjoined sockets, a new scene. Pure room, injected clock and
 * timers, fake connections; no timer may survive dispose.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
require('../../modules/toy-skirmish/register')({ requireCore, coreRoot: ROOT, log: () => {} })
const { createSkRoom, WORLD_MS } = require('../../modules/toy-skirmish/server/sk-room')
const R = require('../../modules/toy-skirmish/server/sk-rules')

/* The arena of smoke-wo1081-sk-server-room: 40 × 40 u (toy scale 0.1), one block across x = 0 at z = 1.0 m. */
const ARENA = {
	id: 'box', name: 'Box', floor: 'hall', y: 0, rect: [-2, -2, 2, 2],
	blocks: [{ x: 0, z: 1, w: 0.6, d: 0.12, h: 0.1, yaw: 0, c: 0 }],
	spawns: [[-1.5, -1.5], [0, -1.5], [1.5, -1.5], [-1.5, -0.6], [1.5, -0.6], [-1.5, 0.6], [1.5, 0.6], [-1.5, 1.5], [0, 1.6], [1.5, 1.5]]
		.map(([x, z]) => ({ x, z, yaw: 0, team: z < 0 ? 0 : 1 })),
	pickups: [['rattler', -0.5, -0.5], ['health', 0.5, -0.5]].map(([kind, x, z], id) => ({ id, kind, x, z })),
}
const SCENE = { rev: 'smoke', scale: 0.1, floors: [{ id: 'hall', y: 0, rect: [-3, -3, 3, 3] }], occ: [], arenas: [ARENA, { ...ARENA, id: 'box2', name: 'Box 2' }] }

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

function setup(t, opts = {}) {
	const clock = makeClock()
	const closed = []
	const room = createSkRoom({ now: clock.now, timers: clock.timers, rng: R.mulberry32(11), send: (c, m) => c.out.push(m),
		close: (c, code) => closed.push([c.name, code]), maxPlayers: opts.maxPlayers, maxSpectators: opts.maxSpectators })
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
		talking.add(c)
		room.connect(c)
		room.handle(c, { t: 'join', name, color: '#ff5533', ...extra })
		c.id = c.out.find((m) => m.t === 'welcome')?.id
		c.p = X.players.get(c.id)
		return c
	}
	const place = (c, x, z) => Object.assign(c.p, { pos: [x, z], protectUntil: 0, alive: true })
	const last = (c, type) => c.out.filter((m) => m.t === type).at(-1)
	/** a kills b (a one-hit Peashooter shot at an unprotected b 1 m away). */
	let n = 1000
	const frag = (a, b) => {
		place(a, -1.5, -0.6), place(b, -1.5, 0.4)
		b.p.hp = 1
		a.p.lastFire = {}
		room.handle(a, { t: 'fire', w: 'pea', n: ++n, p: a.p.pos, yaw: 0 })
		room.handle(a, { t: 'hit', n, id: b.id })
		assert.equal(b.p.alive, false, 'fragged')
	}
	t.after(() => {
		room.dispose()
		assert.equal(clock.pending(), 0, 'no timer survives dispose')
	})
	return { clock, room, X, join, place, last, frag, closed, talking }
}

test('join → welcome + spawn + state; names cleaned; spectators; full', (t) => {
	const { room, join, last } = setup(t, { maxPlayers: 3, maxSpectators: 1 })
	const a = join('  Ola <b>  ')
	const w = a.out.find((m) => m.t === 'welcome')
	assert.deepEqual(w.you, { id: a.id, name: 'Ola b', color: '#ff5533', team: null, spectator: false })
	assert.equal(w.state.arenaId, 'box')
	assert.equal(w.state.phase, 'lobby')
	assert.deepEqual(Object.keys(w.state), ['maxPlayers', 'phase', 'mode', 'arenaId', 'limits', 'startAt', 'endsAt', 'bots', 'botLevel', 'players', 'teams', 'pk', 'spectators'])
	assert.equal(last(a, 'spawn').id, a.id)
	assert.equal(last(a, 'me').hp, 100)
	const b = join(42, { color: 'red' })
	assert.equal(b.p.name, `Player ${b.id}`)
	assert.match(b.p.color, /^#[0-9a-f]{6}$/)
	assert.equal(last(a, 'state').state.players.length, 2, 'everyone hears the roster')
	join('C')
	const d = join('D')
	assert.deepEqual(d.out, [{ t: 'full' }], 'max players')
	const s = join('Watcher', { spectator: true })
	assert.equal(s.out[0].you.spectator, true)
	assert.equal(room.snapshot().spectators, 1)
	assert.equal(room.snapshot().players.length, 3, 'a spectator is no player')
	room.handle(s, { t: 'fire', w: 'pea', n: 1, p: [0, 0], yaw: 0 })
	room.handle(s, { t: 's', p: [0, 0], yaw: 0, mv: 1 })
	assert.equal(last(a, 'shot'), undefined, 'spectators do not play')
	assert.deepEqual(join('W2', { spectator: true }).out, [{ t: 'full' }], 'max spectators')
	room.handle(a, { t: 'join', name: 'again' })
	assert.equal(last(a, 'welcome').id, a.id, 'a second join re-sends the welcome')
})

test('positions: rect + 2 u, 6 u/s clamp, 20 per second, frozen while dead; `w` carries flags and only changes', (t) => {
	const { clock, room, join, place, last } = setup(t)
	const a = join('A'), b = join('B')
	clock.advance(R.RULES.protectMs)
	place(a, 0, 0)
	a.p.moveAt = clock.now()
	clock.advance(100)
	room.handle(a, { t: 's', p: [1, 0], yaw: 1, mv: 1, w: 'pea' })
	assert.deepEqual(a.p.pos, [0.12, 0], '6 u/s × (0.1 s + 0.1 s slack)')
	assert.equal(a.p.yaw, 1)
	clock.advance(1000)
	room.handle(a, { t: 's', p: [2.3, 0], yaw: 0, mv: 1 })
	assert.deepEqual(a.p.pos, [0.12, 0], 'outside the rect + 2 u: ignored')
	room.handle(a, { t: 's', p: [0.5, 0], yaw: 0, mv: 1 })
	assert.deepEqual(a.p.pos, [0.5, 0], 'within the speed limit')
	clock.advance(WORLD_MS)
	const w = last(b, 'w')
	assert.deepEqual(w.a.find((e) => e[0] === a.id), [a.id, 0.5, 0, 0, 1, 'pea'], 'moving, with the weapon shown')
	const sent = b.out.filter((m) => m.t === 'w').length
	clock.advance(WORLD_MS * 4)
	assert.equal(b.out.filter((m) => m.t === 'w').length, sent, 'nothing changed → no `w`')
	clock.advance(1000)
	for (let n = 0; n < 25; n++) room.handle(a, { t: 's', p: [0.5, 0.01 * n], yaw: 0, mv: 0 })
	assert.deepEqual(a.p.pos, [0.5, 0.19], 'over 20 per second: dropped')
	a.p.alive = false
	clock.advance(1000)
	room.handle(a, { t: 's', p: [0.6, 0.2], yaw: 0, mv: 0 })
	assert.deepEqual(a.p.pos, [0.5, 0.19], 'dead: frozen')
	clock.advance(WORLD_MS)
	assert.equal(last(b, 'w').a.find((e) => e[0] === a.id)[4] & 2, 2, 'dead flag')
	room.combat.spawn(a.p)
	clock.advance(WORLD_MS)
	assert.equal(last(b, 'w').a.find((e) => e[0] === a.id)[4] & 4, 4, 'protected flag')
})

test('phases: start → countdown (frozen) → match → frag limit → results (order) → lobby after 15 s', (t) => {
	const { clock, room, join, last, frag } = setup(t)
	const a = join('A'), b = join('B'), c = join('C')
	assert.deepEqual(room.host('limits', { frags: 5 }), { ok: true })
	a.p.kills = 3
	assert.deepEqual(room.host('start'), { ok: true })
	const cd = last(b, 'countdown')
	assert.equal(cd.startAt, clock.now() + 3000)
	let st = room.snapshot()
	assert.equal(st.phase, 'countdown')
	assert.equal(st.startAt, cd.startAt)
	assert.equal(st.endsAt, cd.startAt + 5 * 60000)
	assert.equal(a.p.kills, 0, 'a full reset')
	const pos = a.p.pos.slice()
	room.handle(a, { t: 's', p: [pos[0] + 0.05, pos[1]], yaw: 0, mv: 1 })
	assert.deepEqual(a.p.pos, pos, 'frozen at the spawn')
	room.handle(a, { t: 'fire', w: 'pea', n: 1, p: pos, yaw: 0 })
	assert.equal(last(b, 'shot'), undefined, 'no fire in the countdown')
	assert.equal(room.host('mode', { mode: 'tdm' }).status, 409, 'busy')
	assert.equal(room.host('arena', { id: 'box2' }).status, 409)
	assert.equal(room.host('limits', { frags: 9 }).status, 409)
	assert.equal(room.host('start').status, 409)
	clock.advance(3000)
	assert.equal(room.snapshot().phase, 'match')
	assert.equal(last(a, 'state').state.phase, 'match')
	clock.advance(R.RULES.protectMs)
	for (let n = 0; n < 2; n++) frag(b, c)
	frag(c, a)
	frag(c, b)
	for (let n = 0; n < 4; n++) frag(a, c)
	assert.equal(room.snapshot().phase, 'match', '4 frags < 5')
	frag(a, b)
	st = room.snapshot()
	assert.equal(st.phase, 'results')
	const res = last(b, 'results')
	assert.deepEqual(res.order.map((p) => [p.name, p.kills, p.deaths, p.score]), [['A', 5, 1, 5], ['B', 2, 2, 2], ['C', 2, 6, 2]])
	assert.deepEqual(Object.keys(res.order[0]), ['id', 'name', 'team', 'kills', 'deaths', 'score'])
	assert.equal(res.final, true)
	assert.equal(res.mode, 'dm')
	assert.equal(st.endsAt, clock.now() + 15000)
	room.handle(a, { t: 'fire', w: 'pea', n: 99, p: a.p.pos, yaw: 0 })
	assert.notEqual(last(b, 'shot').n, 99, 'frozen in the results')
	clock.advance(14999)
	assert.equal(room.snapshot().phase, 'results')
	clock.advance(1)
	st = room.snapshot()
	assert.equal(st.phase, 'lobby')
	assert.equal(st.endsAt, null)
	assert.ok([a, b, c].every((x) => x.p.alive), 'everyone respawned in the lobby')
	assert.equal(st.players.find((p) => p.id === a.id).score, 5, 'the last scores stay until the next start')
})

test('time limit ends the match; stop → lobby; host refusals', (t) => {
	const { clock, room, join, last } = setup(t)
	assert.equal(room.host('start').status, 409, 'no players')
	const a = join('A')
	assert.equal(room.host('limits', { frags: 4 }).status, 400)
	assert.equal(room.host('limits', { frags: 101 }).status, 400)
	assert.equal(room.host('limits', { minutes: 0 }).status, 400)
	assert.equal(room.host('limits', { minutes: 31 }).status, 400)
	assert.equal(room.host('limits', { minutes: 1.5 }).status, 400)
	assert.equal(room.host('bots', { n: 7 }).status, 400)
	assert.equal(room.host('bots', { n: -1 }).status, 400)
	assert.equal(room.host('mode', { mode: 'ctf' }).status, 400)
	assert.equal(room.host('arena', { id: 'nope' }).status, 400)
	assert.equal(room.host('team', { id: a.id, team: 1 }).status, 409, 'teams in tdm only')
	assert.equal(room.host('kick', { id: 99 }).status, 404)
	assert.equal(room.host('fly').status, 400)
	assert.deepEqual(room.host('limits', { minutes: 1 }), { ok: true })
	room.host('start')
	clock.advance(3000 + 60000 - 1)
	assert.equal(room.snapshot().phase, 'match')
	clock.advance(1)
	assert.equal(room.snapshot().phase, 'results', 'time limit')
	assert.ok(last(a, 'results'))
	clock.advance(15000)
	room.host('start')
	clock.advance(5000)
	assert.deepEqual(room.host('stop'), { ok: true })
	assert.equal(room.snapshot().phase, 'lobby')
	assert.deepEqual(room.host('arena', { id: 'box2' }), { ok: true })
	assert.equal(room.snapshot().arenaId, 'box2')
	assert.equal(last(a, 'state').state.arenaId, 'box2')
})

test('tdm: teams alternate, joiners to the smaller team, host moves players, team totals, no friendly fire', (t) => {
	const { clock, room, join, place, last, frag } = setup(t)
	const a = join('A'), b = join('B'), c = join('C')
	assert.deepEqual(room.host('mode', { mode: 'tdm' }), { ok: true })
	assert.deepEqual([a.p.team, b.p.team, c.p.team], [0, 1, 0])
	assert.equal(room.snapshot().limits.frags, 40, 'the default frag limit follows the mode')
	const d = join('D')
	assert.equal(d.p.team, 1, 'to the smaller team')
	assert.equal(d.out.find((m) => m.t === 'welcome').you.team, 1)
	assert.deepEqual(room.host('team', { id: d.id, team: 0 }), { ok: true })
	assert.equal(d.p.team, 0)
	assert.equal(room.host('team', { id: d.id, team: 2 }).status, 400)
	room.host('team', { id: d.id, team: 1 })
	room.host('limits', { frags: 5 })
	room.host('start')
	clock.advance(3000 + R.RULES.protectMs)
	place(a, -1.5, -0.6), place(c, -1.5, 0.4)
	a.p.lastFire = {}
	room.handle(a, { t: 'fire', w: 'pea', n: 1, p: a.p.pos, yaw: 0 })
	room.handle(a, { t: 'hit', n: 1, id: c.id })
	assert.equal(c.p.hp, 100, 'no friendly fire')
	frag(a, b)
	frag(c, d)
	frag(b, a)
	assert.deepEqual(room.snapshot().teams, [2, 1])
	for (let n = 0; n < 3; n++) frag(c, b)
	assert.equal(room.snapshot().phase, 'results', 'the team total reached 5')
	const res = last(a, 'results')
	assert.deepEqual(res.teams, [5, 1])
	assert.equal(res.mode, 'tdm')
	assert.equal(res.order[0].team, 0)
	clock.advance(15000)
	room.host('mode', { mode: 'dm' })
	assert.equal(room.snapshot().limits.frags, 5, 'a frag limit the host set stays')
	assert.ok(room.snapshot().players.every((p) => p.team === null), 'no teams in dm')
})

test('disconnects, silent and unjoined sockets, kicks', (t) => {
	const { clock, room, join, closed, talking } = setup(t)
	const a = join('A'), b = join('B'), c = join('C')
	room.disconnect(c)
	assert.equal(room.snapshot().players.length, 2, 'lobby: a leaver is removed')
	room.host('start')
	clock.advance(3500)
	room.disconnect(b)
	const listed = room.snapshot().players.find((p) => p.id === b.id)
	assert.equal(listed.connected, false, 'match: listed (disconnected) until the lobby')
	room.host('stop')
	assert.equal(room.snapshot().players.some((p) => p.id === b.id), false)
	talking.delete(a)
	const lurker = { name: 'lurker', out: [] }
	room.connect(lurker)
	clock.advance(11000)
	assert.deepEqual(closed.find((x) => x[0] === 'A'), ['A', 4408], 'silent for 10 s')
	assert.equal(room.snapshot().players.length, 0)
	clock.advance(5000)
	assert.deepEqual(closed.find((x) => x[0] === 'lurker'), ['lurker', 4408], 'no join within 15 s')
	assert.equal(room.connections(), 0)
	clock.advance(1000)
	assert.equal(room.timers().house, false, 'no sockets → no housekeeping timer')
	const k = join('K')
	assert.deepEqual(room.host('kick', { id: k.id }), { ok: true })
	assert.deepEqual(closed.at(-1), ['K', 4409])
	assert.equal(room.snapshot().players.length, 0)
})

test('a new scene: the lobby picks the arena up again (or the first); a match keeps its arena', (t) => {
	const { clock, room, join } = setup(t)
	join('A')
	room.host('arena', { id: 'box2' })
	room.setScene({ ...SCENE, rev: 'two' })
	assert.equal(room.snapshot().arenaId, 'box2', 'the same id in the new scene')
	room.setScene({ ...SCENE, rev: 'three', arenas: [{ ...ARENA, id: 'other' }] })
	assert.equal(room.snapshot().arenaId, 'other', 'gone → the first arena')
	room.host('start')
	clock.advance(3000)
	room.setScene({ ...SCENE, rev: 'four' })
	assert.equal(room.snapshot().arenaId, 'other', 'the match keeps its arena')
	room.host('stop')
	assert.equal(room.snapshot().arenaId, 'box', 'the lobby takes the new scene')
	room.setScene({ ...SCENE, rev: 'five', arenas: [] })
	assert.equal(room.snapshot().arenaId, null)
	assert.equal(room.host('start').status, 409, 'no arena')
})

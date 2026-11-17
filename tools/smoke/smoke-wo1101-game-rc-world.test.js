'use strict'

/**
 * WO-1101 / WO-1102 — Stage Sprint RC in the Game World (work/notes/game-world-contract.md §0, §4, §5, §6.2, §6.3), the
 * server side: modules/rc-game/server/rc-world.js (registry descriptor + room adapter) and the world pause in
 * rc-room.js. Proves: alone = unchanged (no hub → the very same messages over a full race cycle, no `paused` key, no
 * world message; the `wq` message is a known type that does nothing without a hub); the pause (actions dropped, the
 * phase step held and resumed after the REMAINING time, startAt / lap clocks / the finish grace shifted by the paused
 * time, start refused 409, stop while paused not resurrected, dispose leaves no timer); the adapter (cars in metres
 * ≤ 10, viewers without bot sockets and the `wq` cap, the board, effects → `xfx` only while driving and not paused,
 * the mini-boost bonus ≤ 1 per 3 s, light pools, attach / detach). A FAKE hub in the process registry, removed after.
 * Client side (world-fx.js, physics.js wslick, bot-brain.js): smoke-wo1101-game-rc-world-2.test.js.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createRcRoom, COUNTDOWN_MS, GRACE_MS, WORLD_MS } = require('../../modules/rc-game/server/rc-room')
const RW = require('../../modules/rc-game/server/rc-world')
const S = require('../../modules/rc-game/server/rc-sanitize')

const KEY = Symbol.for('highascg.game-world/1')
const reg = () => globalThis[KEY] || (globalThis[KEY] = { v: 1, games: new Map(), hub: null })
const WORLD_T = new Set(['wst', 'wv', 'xfx', 'xbonus', 'xb', 'xev'])
const KEYS = ['maxPlayers', 'phase', 'trackId', 'laps', 'startAt', 'players', 'spectators', 'boxes', 'hazards'] // pre-world state

test.after(() => {
	reg().hub = null
	reg().games.delete('rc')
})

/** A recording hub in the registry (removed after the test). */
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

function fakeClock() {
	let t = 1000000
	let seq = 0
	const timers = new Map()
	const add = (fn, ms, every) => (timers.set(++seq, { fn, at: t + ms, every }), seq)
	return {
		now: () => t,
		timers: {
			setTimeout: (fn, ms) => add(fn, ms, 0),
			setInterval: (fn, ms) => add(fn, ms, ms),
			clearTimeout: (id) => timers.delete(id),
			clearInterval: (id) => timers.delete(id),
		},
		count: () => timers.size,
		step(ms) {
			const end = t + ms
			for (;;) {
				let next = null
				for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x]
				if (!next) break
				t = next[1].at
				if (next[1].every) next[1].at += next[1].every
				else timers.delete(next[0])
				next[1].fn()
			}
			t = end
		},
	}
}

const BOXES = Array.from({ length: 4 }, (_, i) => ({ id: i, x: i, y: 0.5, z: 0 }))
const TRACK = { id: 'stage-oval', length: 40, checkpoints: [0, 15, 30, 45], points: [[-2, 0.25, -3], [4, 0.25, -3], [4, 0.25, 5], [-2, 0.25, 5]], y: 0.25, boxes: BOXES }
const BOUNDS = { min: [-20, -1, -30], max: [20, 10, 20] }
const MIN_LAP = (TRACK.length / S.MAX_SPEED) * 1000

/** A room on the fake clock; `advance` pings every joined guest each second (no silent drops in long pauses). */
function setup(t, o = {}) {
	const clock = fakeClock()
	const out = new Map()
	const room = createRcRoom({ now: clock.now, timers: clock.timers, maxPlayers: o.maxPlayers, rng: () => 0.5,
		send: (c, m) => (c.botSink ? c.botSink(m) : out.get(c).push(m)) })
	room.setScene({ tracks: [TRACK], bounds: BOUNDS })
	const talking = new Set()
	let n = 0
	const open = (name, extra = {}) => {
		const c = { name: `c${++n}` } // an object, like a socket (the adapter keeps caps in a WeakMap)
		out.set(c, [])
		room.connect(c)
		room.handle(c, { t: 'join', name, ...extra })
		talking.add(c)
		return c
	}
	const idOf = (c) => out.get(c).find((m) => m.t === 'welcome').id
	const advance = (ms) => {
		for (let left = ms; left > 0; left -= 1000) {
			for (const c of talking) room.handle(c, { t: 'ping', c: 0 })
			clock.step(Math.min(1000, left))
		}
	}
	const s = (c, cp, lap, x = 1) => room.handle(c, { t: 's', p: [x, 0.25, 1], yaw: 0, v: 3, st: 0, cp, lap })
	const of = (c, type) => out.get(c).filter((m) => !type || m.t === type)
	const world = o.world ? RW.createRcWorld({ room: () => room, send: (c, m) => (c.botSink ? c.botSink(m) : out.get(c).push(m)), now: clock.now, lights: o.lights }) : null
	if (t) t.after(() => room.dispose())
	return { clock, room, out, open, idOf, advance, s, of, world, talking }
}

/** One full race cycle: two guests and a spectator join, ready, start, a 1-lap race, results, stop. */
function cycle(R, hooks = {}) {
	const a = R.open('Ann'), b = R.open('Ben'), sp = R.open('Eye', { spectator: true })
	hooks.joined?.(a, b, sp)
	R.room.handle(a, { t: 'ready', ready: true })
	R.room.handle(a, { t: 'wq', n: 20 }) // the service intercepts it; reaching the room it is ignored
	R.room.host('laps', { laps: 1 })
	R.room.host('start')
	R.advance(COUNTDOWN_MS)
	for (const c of [a, b]) {
		for (const cp of [1, 2, 3]) R.advance(1000), R.s(c, cp, 0, cp)
		R.advance(MIN_LAP), R.s(c, 0, 1)
		hooks.racing?.()
	}
	R.advance(WORLD_MS * 20)
	R.room.host('stop')
	R.advance(3000)
	return [a, b, sp].map((c) => JSON.stringify(R.of(c)).replace(/"resume":"[^"]+"/g, '"resume":"<token>"')).join('\n') // WO-1106 B34: tokens are random
}

test('alone = unchanged: no hub → the same messages over a full race cycle, no world message, no `paused` key', () => {
	assert.equal(reg().hub, null)
	const plain = setup(null)
	const base = cycle(plain)
	assert.ok(base.includes('"t":"results"') && base.includes('"t":"lap"') && base.includes('"t":"w"'), 'a real race happened')
	for (const line of base.split('\n')) {
		for (const m of JSON.parse(line)) {
			assert.ok(!WORLD_T.has(m.t), `no world message (${m.t})`)
			if (m.state) assert.deepEqual(Object.keys(m.state), KEYS)
		}
	}
	// the same script with the adapter built and poked (attach, quality, every read-only call): byte-identical
	const R = setup(null, { world: true })
	const poke = () => {
		const A = R.world.adapter
		A.entities(), A.viewers(), A.board(), A.area(), A.pools()
	}
	const run = cycle(R, {
		joined: (a) => {
			R.world.attach()
			R.world.quality(a, { t: 'wq', n: 6 })
			poke()
		},
		racing: poke,
	})
	R.world.detach()
	assert.equal(run, base)
	plain.room.dispose(), R.room.dispose()
	assert.equal(plain.clock.count() + R.clock.count(), 0, 'no timer survives dispose')
})

test('alone = unchanged with a hub that has no other room: the same messages; attach / quality / detach reach the hub', (t) => {
	const base = cycle(setup(t))
	const hub = fakeHub(t)
	const R = setup(t, { world: true })
	let A = null
	const run = cycle(R, { joined: (a) => (R.world.attach(), R.world.quality(a, { t: 'wq', n: 20 }), (A = a)) })
	R.world.detach()
	assert.equal(run, base)
	assert.equal(hub.of('attach').length, 1)
	assert.equal(hub.of('attach')[0][1], R.world.adapter)
	assert.deepEqual(hub.of('quality'), [['quality', 'rc', A, 20]])
	assert.deepEqual(hub.of('detach'), [['detach', 'rc']])
})

test('`wq`: a known message type (≤ 2 KB) — without a hub it only sets the cap, a throwing hub never breaks the game', (t) => {
	assert.deepEqual(S.parseMessage(JSON.stringify({ t: 'wq', n: 6 })), { t: 'wq', n: 6 })
	assert.equal(S.parseMessage(JSON.stringify({ t: 'wq', n: 6, pad: 'x'.repeat(3000) })), null)
	const R = setup(t, { world: true })
	const a = R.open('Ann')
	R.world.quality(a, { t: 'wq', n: 20 })
	assert.equal(R.world.adapter.viewers()[0].cap, 20)
	const hub = fakeHub(t)
	hub.quality = hub.attach = hub.detach = () => {
		throw new Error('world down')
	}
	assert.doesNotThrow(() => (R.world.quality(a, { n: 6 }), R.world.attach(), R.world.detach()))
	assert.equal(R.world.adapter.viewers()[0].cap, 6)
})

test('pause in the countdown: paused:true only while paused, actions dropped, the step held, resumed after the remaining time', (t) => {
	const R = setup(t)
	const a = R.open('Ann'), b = R.open('Ben')
	const ida = R.idOf(a)
	R.room.host('start')
	const startAt0 = R.room.snapshot().startAt
	R.advance(2000)
	const pausedAt = R.clock.now()
	assert.deepEqual(R.room.host('pause', { on: 'yes' }), { ok: false, status: 400, error: '`on` must be true or false' })
	assert.deepEqual(R.room.host('pause', { on: true }), { ok: true })
	const st = R.of(b, 'state').at(-1).state
	assert.equal(st.paused, true)
	assert.deepEqual(Object.keys(st), [...KEYS, 'paused'])
	assert.equal(R.room.timers().phase, false, 'the phase timer is held')
	const n = R.of(b).length
	R.s(a, 1, 0)
	R.room.handle(a, { t: 'ready', ready: true })
	R.room.handle(a, { t: 'box', id: 0 })
	R.room.handle(a, { t: 'use' })
	R.clock.step(WORLD_MS * 3)
	assert.equal(R.of(b).length, n, 'nothing relayed while paused')
	assert.equal(R.room.world().players.get(ida).car, null, 'the car state was dropped')
	R.advance(60000)
	assert.equal(R.room.snapshot().phase, 'countdown', 'well past the countdown: still held')
	assert.equal(R.room.host('pause', { on: true }).ok, true, 'a second pause is a no-op')
	R.room.host('pause', { on: false })
	const d = R.clock.now() - pausedAt
	assert.equal(R.room.snapshot().paused, undefined, '`paused` gone again')
	assert.ok(!('paused' in R.of(b, 'state').at(-1).state))
	assert.equal(R.room.snapshot().startAt, startAt0 + d, 'startAt shifted by the paused time')
	assert.equal(R.of(b, 'countdown').at(-1).startAt, startAt0 + d, 'clients hear the new start')
	assert.equal(R.room.world().players.get(ida).race.lapStart, startAt0 + d, 'lap clock shifted')
	R.advance(COUNTDOWN_MS - 2000 - 1)
	assert.equal(R.room.snapshot().phase, 'countdown')
	R.clock.step(1)
	assert.equal(R.room.snapshot().phase, 'race', 'the remaining 3 s after resume')
})

test('pause mid-race: the lap time excludes the pause; the finish grace resumes with its remaining time', (t) => {
	const R = setup(t)
	const a = R.open('Ann'), b = R.open('Ben')
	R.room.host('laps', { laps: 1 })
	R.room.host('start')
	R.advance(COUNTDOWN_MS)
	for (const cp of [1, 2, 3]) R.advance(1000), R.s(a, cp, 0, cp)
	R.room.host('pause', { on: true })
	R.advance(60000)
	R.room.host('pause', { on: false })
	R.advance(1000)
	R.s(a, 0, 1)
	const lap = R.of(b, 'lap').at(-1)
	assert.equal(lap.ms, 4000, 'driving time only')
	assert.equal(R.room.timers().phase, true, 'the 20 s grace runs')
	R.advance(5000)
	R.room.host('pause', { on: true })
	R.advance(GRACE_MS * 5)
	assert.equal(R.room.snapshot().phase, 'race', 'the grace is held')
	R.room.host('pause', { on: false })
	R.advance(GRACE_MS - 5000 - 1000)
	assert.equal(R.room.snapshot().phase, 'race')
	R.advance(1000)
	assert.equal(R.room.snapshot().phase, 'results', '20 s of unpaused grace in all')
	const res = R.of(b, 'results').at(-1)
	assert.equal(res.order[0].totalMs, 4000, 'race total without the pause')
})

test('pause: start refused 409, stop while paused is not resurrected, dispose leaves no timer', (t) => {
	const R = setup(null)
	const a = R.open('Ann')
	R.room.host('pause', { on: true })
	assert.deepEqual(R.room.host('start'), { ok: false, status: 409, error: 'paused' })
	R.room.host('pause', { on: false })
	assert.equal(R.room.host('start').ok, true)
	R.advance(1000)
	R.room.host('pause', { on: true })
	assert.equal(R.room.host('start').status, 409)
	assert.equal(R.room.host('stop').ok, true)
	assert.equal(R.room.snapshot().phase, 'lobby')
	assert.equal(R.room.snapshot().paused, true, 'still paused in the lobby')
	R.room.host('pause', { on: false })
	R.advance(30000)
	assert.equal(R.room.snapshot().phase, 'lobby', 'the old countdown step never comes back')
	assert.equal(R.room.timers().phase, false)
	R.s(a, 0, 0)
	R.room.host('start')
	R.room.host('pause', { on: true })
	R.room.dispose()
	assert.equal(R.clock.count(), 0, 'dispose while paused: no timer')
	assert.ok(!('paused' in R.room.snapshot()))
})

test('adapter: cars as entities in metres (≤ 10), viewers without bot sockets, the `wq` cap, board top ≤ 3', (t) => {
	const R = setup(t, { world: true, maxPlayers: 13 })
	const A = R.world.adapter
	assert.equal(A.id, 'rc')
	const guests = Array.from({ length: 12 }, (_, i) => R.open(`G${i}`))
	const bot = { botSink: () => {} }
	R.room.connect(bot)
	R.room.handle(bot, { t: 'join', name: 'Bot 1' })
	const sp = R.open('Eye', { spectator: true })
	assert.equal(A.entities().length, 0, 'no car reported yet')
	guests.forEach((c, i) => R.room.handle(c, { t: 's', p: [i * 0.5, 0.25, -1.5], yaw: 0.5, v: -3, st: 0, fx: 1 }))
	R.room.handle(bot, { t: 's', p: [9, 0.25, 9], yaw: 0, v: 1, st: 0 })
	const ents = A.entities()
	assert.equal(ents.length, 10, 'at most 10 cars')
	assert.deepEqual(ents[1], { k: 'car', id: R.idOf(guests[1]), p: [0.5, 0.25, -1.5], yaw: 0.5, c: ents[1].c, n: 'G1', f: 1, s: '', bot: false, spd: 3 })
	assert.match(ents[1].c, /^#[0-9a-f]{6}$/)
	const vs = A.viewers()
	assert.equal(vs.length, 13, '12 guests + the spectator, never the bot socket')
	assert.ok(!vs.some((v) => v.key === bot))
	assert.deepEqual(vs.at(-1), { key: sp, kind: 'spectator', p: null, cap: 12 })
	assert.deepEqual(vs[2], { key: guests[2], kind: 'player', p: [1, 0.25, -1.5], cap: 12 })
	for (const [n, want] of [[6, 6], [20, 20], [12, 12], [7, 12], ['20', 12], [undefined, 12]]) {
		R.world.quality(guests[0], { t: 'wq', n })
		assert.equal(A.viewers()[0].cap, want, `wq ${n}`)
	}
	const hub = fakeHub(t)
	R.world.quality(guests[0], { t: 'wq', n: 6 })
	assert.deepEqual(hub.of('quality').at(-1), ['quality', 'rc', guests[0], 6])
	const bd = A.board()
	assert.deepEqual(bd, { phase: 'lobby', endsAt: null, top: [], players: 12, bots: 1 })
	R.room.host('laps', { laps: 2 })
	R.room.host('start')
	R.advance(COUNTDOWN_MS)
	for (const cp of [1, 2, 3]) R.advance(1000), R.s(guests[3], cp, 0)
	R.advance(MIN_LAP), R.s(guests[3], 0, 1)
	const top = A.board().top
	assert.equal(top.length, 3)
	assert.equal(top[0].name, 'G3')
	assert.deepEqual([top[0].score, top[0].label], [1, 'lap 1'])
	R.room.host('pause', { on: true })
	assert.equal(A.board().phase, 'paused')
	A.pause(false)
	assert.equal(A.board().phase, 'race')
	A.pause(true)
	assert.equal(R.room.snapshot().paused, true, 'adapter.pause → host pause')
	A.pause('yes')
	assert.equal(R.room.snapshot().paused, undefined, 'anything but true resumes')
})

test('adapter.apply: `xfx` to every socket only while cars drive and the game is not paused', (t) => {
	const R = setup(t, { world: true })
	const A = R.world.adapter
	const a = R.open('Ann'), b = R.open('Ben'), sp = R.open('Eye', { spectator: true })
	const ida = R.idOf(a)
	const e = { k: 'hop', g: 'rc', id: ida, dur: 0.6, c: '#ff0000', soft: false, by: { g: 'salad', name: 'Ola' } }
	assert.equal(A.apply(e), false, 'no car yet')
	R.s(a, 0, 0)
	assert.equal(A.apply(e), true, 'the lobby free roam drives')
	const want = { t: 'xfx', k: 'hop', id: ida, dur: 0.6, c: '#ff0000', by: { g: 'salad', n: 'Ola' } }
	for (const c of [a, b, sp]) assert.deepEqual(R.of(c, 'xfx').at(-1), want)
	assert.deepEqual(RW.xfxMsg({ k: 'wobble', id: 3, dur: 0.25, dir: [1, 0], soft: true, by: { g: 'sk' } }), { t: 'xfx', k: 'wobble', id: 3, dur: 0.25, dir: [1, 0], soft: true, by: { g: 'sk', n: '' } })
	assert.equal(A.apply({ ...e, id: 999 }), false, 'unknown car')
	assert.equal(A.apply({ ...e, id: R.idOf(sp) }), false, 'a spectator has no car')
	R.room.host('pause', { on: true })
	const n = R.of(b, 'xfx').length
	assert.equal(A.apply(e), false, 'paused')
	R.room.host('pause', { on: false })
	R.room.host('start')
	assert.equal(A.apply(e), false, 'the countdown freezes the cars')
	R.advance(COUNTDOWN_MS)
	assert.equal(A.apply(e), true, 'race')
	R.room.host('stop')
	assert.equal(R.of(b, 'xfx').length, n + 1)
	R.room.disconnect(a)
	assert.equal(A.apply(e), false, 'gone')
})

test('adapter.bonus: a 0.4 s mini-boost xfx + xbonus to the causer, ≤ 1 per 3 s, only while driving and not paused', (t) => {
	const R = setup(t, { world: true })
	const A = R.world.adapter
	const a = R.open('Ann'), b = R.open('Ben')
	const ida = R.idOf(a)
	assert.equal(A.bonus(ida, 'R3'), true)
	assert.deepEqual(R.of(b, 'xfx').at(-1), { t: 'xfx', k: 'boost', id: ida, dur: 0.4 })
	assert.deepEqual(R.of(a, 'xbonus'), [{ t: 'xbonus', kind: 'R3', pts: 0 }])
	assert.equal(R.of(b, 'xbonus').length, 0, 'only the causer hears its bonus')
	R.advance(2000)
	assert.equal(A.bonus(ida, 'R9'), false, '< 3 s since the last')
	assert.equal(A.bonus(R.idOf(b), 'R9'), true, 'per car')
	R.advance(1000)
	R.room.host('pause', { on: true })
	assert.equal(A.bonus(ida, 'R9'), false, 'paused')
	R.room.host('pause', { on: false })
	assert.equal(A.bonus(ida, 'R9'), true, '3 s later')
	R.advance(3000)
	R.room.host('start')
	assert.equal(A.bonus(ida, 'R9'), false, 'countdown')
	assert.equal(A.bonus(999, 'R9'), false, 'unknown')
	assert.equal(R.of(a, 'xbonus').length, 2)
	R.world.detach()
	R.advance(COUNTDOWN_MS)
	assert.equal(A.bonus(ida, 'R9'), true, 'detach forgets the 3 s gaps')
})

test('adapter: area from the track, light pools at its height, nothing after a disable; register / unregister', (t) => {
	const asked = []
	const lights = { pools: (y) => (asked.push(y), [{ x: 1, z: 1, y, r: 0.4 }]) }
	const R = setup(t, { world: true, lights })
	const A = R.world.adapter
	assert.deepEqual(A.area(), { rect: [-2.5, -3.5, 4.5, 5.5], y: 0.25 })
	assert.deepEqual(A.pools(), [{ x: 1, z: 1, y: 0.25, r: 0.4 }])
	assert.deepEqual(asked, [0.25])
	const off = RW.createRcWorld({ room: () => null, send: () => {} })
	assert.deepEqual([off.adapter.entities(), off.adapter.viewers(), off.adapter.area(), off.adapter.pools()], [[], [], null, []])
	assert.deepEqual(off.adapter.board(), { phase: 'off', endsAt: null, top: [], players: 0, bots: 0 })
	assert.equal(off.adapter.apply({ k: 'hop', id: 1 }), false)
	assert.equal(off.adapter.bonus(1, 'R3'), false)
	assert.doesNotThrow(() => off.adapter.pause(true))
	const game = { host: (b) => ({ status: 200, body: b }), state: () => ({ on: 1 }), worldAdapter: () => A }
	RW.register(() => game)
	const d = reg().games.get('rc')
	assert.equal(d.id, 'rc')
	assert.deepEqual(d.models, { car: '/game/rc/car-model.js' })
	assert.equal(d.room(), A)
	assert.deepEqual(d.host({ action: 'x' }), { status: 200, body: { action: 'x' } })
	assert.deepEqual(d.state(), { on: 1 })
	RW.unregister()
	assert.equal(reg().games.has('rc'), false)
})

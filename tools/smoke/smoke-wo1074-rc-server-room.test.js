'use strict'

/**
 * WO-1074 — the RC game room (src/game/rc-room.js) on a fake clock: join / full / spectators, sanitised names and
 * colours, slots, ready, the phase machine (start → countdown 5 s → race → laps → results, stop → lobby), lap
 * refereeing (checkpoints in order, never faster than length / 24 m/s), the 20 Hz input cap, the 15 Hz world snapshot
 * only while something moves (v2: cars carry fx flags, speed capped at 24), the silent-player drop, kick, no timers at
 * all when idle; v2 items (contract §2.3 / §2.4): the roll by race position, a box race between two claimers, the hazard
 * lifecycle (expiry, hit, 40 cap, stale hit), the rate limits, and boxes / hazards cleared on race start and end.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createRcRoom, COUNTDOWN_MS, GRACE_MS, WORLD_MS } = require('../../src/game/rc-room')
const S = require('../../src/game/rc-sanitize')
const I = require('../../src/game/rc-room-items')

function fakeClock() {
	let t = 1000000
	let seq = 0
	const timers = new Map()
	const add = (fn, ms, every) => {
		const id = ++seq
		timers.set(id, { fn, at: t + ms, every })
		return id
	}
	return {
		now: () => t,
		timers: {
			setTimeout: (fn, ms) => add(fn, ms, 0),
			setInterval: (fn, ms) => add(fn, ms, ms),
			clearTimeout: (id) => timers.delete(id),
			clearInterval: (id) => timers.delete(id),
		},
		count: () => timers.size,
		advance(ms) {
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
const TRACK = { id: 'stage-oval', length: 40, checkpoints: [0, 15, 30, 45], points: [], boxes: BOXES }
const TRACK2 = { id: 'hall-loop', length: 100, checkpoints: [0, 50, 100, 150], points: [] }
const BOUNDS = { min: [-20, -1, -30], max: [20, 10, 20] }

function setup(opts = {}) {
	const clock = fakeClock()
	const out = new Map() // conn → messages
	const closed = new Map()
	const room = createRcRoom({ now: clock.now, timers: clock.timers, send: (c, m) => out.get(c).push(m), close: (c, code) => closed.set(c, code), ...opts })
	room.setScene({ tracks: [TRACK, TRACK2], bounds: BOUNDS })
	let n = 0
	const open = () => {
		const c = `c${++n}`
		out.set(c, [])
		room.connect(c)
		return c
	}
	const last = (c, t) => [...out.get(c)].reverse().find((m) => m.t === t)
	const all = (c, t) => out.get(c).filter((m) => m.t === t)
	return { clock, room, out, closed, open, last, all }
}

test('join: welcome with a slot, names and colours sanitised, 11th player full, spectators uncounted', () => {
	const { room, open, last } = setup()
	const a = open()
	room.handle(a, { t: 'join', name: '  Ola\u0007‮<b>evil</b> with a very long name ', color: '#FF5533' })
	const w = last(a, 'welcome')
	assert.equal(w.you.slot, 0)
	assert.equal(w.you.color, '#ff5533')
	assert.ok(!['<', '>', '\u0007', '\u202e'].some((ch) => w.you.name.includes(ch)), w.you.name)
	assert.ok(Array.from(w.you.name).length <= 16)
	assert.equal(w.state.players.length, 1)
	const b = open()
	room.handle(b, { t: 'join', name: 42, color: 'red' })
	assert.equal(last(b, 'welcome').you.name, 'Player 2')
	assert.match(last(b, 'welcome').you.color, /^#[0-9a-f]{6}$/)
	assert.equal(last(b, 'welcome').you.slot, 1)
	for (let i = 0; i < 8; i++) room.handle(open(), { t: 'join', name: `p${i}` })
	assert.equal(room.snapshot().players.length, 10)
	const eleventh = open()
	room.handle(eleventh, { t: 'join', name: 'late' })
	assert.ok(last(eleventh, 'full'))
	assert.equal(room.snapshot().players.length, 10)
	const spec = open()
	room.handle(spec, { t: 'join', spectator: true })
	assert.equal(last(spec, 'welcome').you.spectator, true)
	assert.equal(room.snapshot().spectators, 1)
	assert.equal(room.snapshot().players.length, 10)
	// a freed slot is reused
	room.disconnect(b)
	const again = open()
	room.handle(again, { t: 'join', name: 'again' })
	assert.equal(last(again, 'welcome').you.slot, 1)
})

test('ready, host track / laps validation, ping', () => {
	const { room, open, last } = setup()
	const a = open()
	room.handle(a, { t: 'join', name: 'A' })
	room.handle(a, { t: 'ready', ready: true })
	assert.equal(last(a, 'state').state.players[0].ready, true)
	assert.equal(room.host('track', { trackId: 'nope' }).ok, false)
	assert.equal(room.host('track', { trackId: 'hall-loop' }).ok, true)
	assert.equal(room.snapshot().trackId, 'hall-loop')
	assert.equal(room.host('laps', { laps: 0 }).ok, false)
	assert.equal(room.host('laps', { laps: 2.5 }).ok, false)
	assert.equal(room.host('laps', { laps: 5 }).ok, true)
	assert.equal(room.host('bogus').ok, false)
	room.handle(a, { t: 'ping', c: 123 })
	assert.equal(last(a, 'pong').c, 123)
	assert.equal(typeof last(a, 'pong').s, 'number')
})

test('race: countdown 5 s, laps refereed in order with a speed floor, results after everyone finished', () => {
	const { room, clock, open, last, all } = setup()
	const a = open(), b = open()
	room.handle(a, { t: 'join', name: 'A' })
	room.handle(b, { t: 'join', name: 'B' })
	assert.equal(room.host('laps', { laps: 2 }).ok, true)
	assert.equal(room.host('start').ok, true)
	const cd = last(a, 'countdown')
	assert.equal(cd.startAt, clock.now() + COUNTDOWN_MS)
	assert.equal(room.snapshot().phase, 'countdown')
	assert.equal(room.host('track', { trackId: 'hall-loop' }).ok, false, 'no track change during a race')
	const s = (c, cp, lap) => {
		room.handle(c, { t: 's', p: [0, 1.42, 0], yaw: 0, v: 3, st: 0, cp, lap })
		for (const o of [a, b]) room.handle(o, { t: 'ping' }) // nobody falls silent (10 s) in this test
	}
	s(a, 1, 0) // during the countdown: not refereed
	clock.advance(COUNTDOWN_MS)
	assert.equal(room.snapshot().phase, 'race')
	// A: out of order (skips cp 1) → ignored; then in order
	s(a, 2, 0)
	s(a, 0, 1)
	assert.equal(all(a, 'lap').length, 0)
	const minLap = (TRACK.length / 24) * 1000
	for (const cp of [1, 2, 3]) {
		clock.advance(100)
		s(a, cp, 0)
	}
	s(a, 0, 1) // only ~300 ms after the start: faster than 24 m/s → not a lap
	assert.equal(all(a, 'lap').length, 0)
	clock.advance(minLap)
	s(a, 0, 1)
	const lap1 = last(b, 'lap')
	assert.equal(lap1.id, last(a, 'welcome').id)
	assert.equal(lap1.lap, 1)
	assert.equal(lap1.ms, lap1.best)
	for (const cp of [1, 2, 3]) {
		clock.advance(1000)
		s(a, cp, 1)
	}
	clock.advance(minLap)
	s(a, 0, 2) // A finished: grace starts
	assert.equal(room.snapshot().phase, 'race')
	for (const cp of [1, 2, 3]) {
		clock.advance(1000)
		s(b, cp, 0)
	}
	clock.advance(minLap)
	s(b, 0, 1)
	for (const cp of [1, 2, 3]) {
		clock.advance(500)
		s(b, cp, 1)
	}
	clock.advance(minLap)
	s(b, 0, 2) // everyone finished → results now
	const res = last(a, 'results')
	assert.ok(res && res.final === true)
	assert.equal(res.order.length, 2)
	assert.equal(res.order[0].name, 'A')
	assert.ok(res.order[0].totalMs < res.order[1].totalMs)
	assert.equal(res.order[0].laps, 2)
	assert.ok(res.order[0].bestMs > 0)
	assert.equal(room.snapshot().phase, 'results')
	assert.equal(room.host('stop').ok, true)
	assert.equal(room.snapshot().phase, 'lobby')
})

test('results 20 s after the first finisher when others are still racing; stop mid-race → lobby', () => {
	const { room, clock, open, last } = setup()
	const a = open(), b = open()
	room.handle(a, { t: 'join', name: 'A' })
	room.handle(b, { t: 'join', name: 'B' })
	room.host('laps', { laps: 1 })
	room.host('start')
	clock.advance(COUNTDOWN_MS)
	const s = (c, cp, lap) => room.handle(c, { t: 's', p: [1, 1, 1], yaw: 0, v: 3, st: 0, cp, lap })
	for (const cp of [1, 2, 3]) {
		clock.advance(1000)
		s(a, cp, 0)
		room.handle(b, { t: 'ping' })
	}
	clock.advance(1000)
	s(a, 0, 1)
	assert.equal(room.snapshot().phase, 'race')
	for (let i = 0; i < 4; i++) {
		clock.advance(5000)
		room.handle(b, { t: 'ping' })
		room.handle(a, { t: 'ping' })
	}
	for (let i = 0; i < GRACE_MS / 5000; i++) {
		clock.advance(5000)
		for (const o of [a, b]) room.handle(o, { t: 'ping' })
	}
	assert.equal(room.snapshot().phase, 'results')
	const r = last(a, 'results')
	assert.equal(r.order[1].totalMs, null)
	room.host('start')
	clock.advance(COUNTDOWN_MS)
	assert.equal(room.snapshot().phase, 'race')
	room.host('stop')
	assert.equal(room.snapshot().phase, 'lobby')
	assert.equal(room.timers().phase, false)
})

test('car states: ≤ 20 per second relayed, absurd positions ignored, world snapshot 15 Hz only while moving', () => {
	const { room, clock, open, all } = setup()
	const a = open(), b = open()
	room.handle(a, { t: 'join', name: 'A' })
	room.handle(b, { t: 'join', name: 'B' })
	assert.equal(room.timers().world, false)
	for (let i = 0; i < 40; i++) room.handle(a, { t: 's', p: [i * 0.01, 0, 0], yaw: 0, v: 99, st: 9, fx: i === 19 ? 19 : 99 })
	clock.advance(WORLD_MS)
	const w = all(b, 'w')
	assert.equal(w.length, 1)
	assert.equal(w[0].cars[0][1], 0.19, 'the 21st state in the same second was dropped')
	assert.equal(w[0].cars[0][5], 24, 'speed clamped to the 24 m/s hard cap')
	assert.equal(w[0].cars[0][6], 1, 'steering clamped')
	assert.equal(w[0].cars[0].length, 8, 'w cars are [id, x, y, z, yaw, v, st, fx]')
	assert.equal(w[0].cars[0][7], 19, 'fx bit flags relayed')
	assert.equal(S.cleanCar({ p: [0, 0, 0], yaw: 0, fx: 32 }, null, 4, 3).fx, 0, 'fx outside 0…31 → 0')
	assert.equal(S.cleanCar({ p: [0, 0, 0], yaw: 0, fx: 2.5 }, null, 4, 3).fx, 0)
	clock.advance(1000)
	room.handle(a, { t: 's', p: [500, 0, 0], yaw: 0, v: 1, st: 0 }) // outside bounds + 5 m
	room.handle(a, { t: 's', p: [1, 0, Infinity], yaw: 0 })
	room.handle(a, { t: 's', p: ['1', 0, 0], yaw: 0 })
	clock.advance(WORLD_MS * 3)
	assert.equal(all(b, 'w').length, 1, 'nothing moved → no snapshot')
	clock.advance(2000)
	assert.equal(room.timers().world, false, 'world timer stops when nothing moves')
	room.handle(a, { t: 's', p: [2, 0, 0], yaw: 1, v: 1, st: 0 })
	assert.equal(room.timers().world, true)
	clock.advance(WORLD_MS)
	assert.equal(all(b, 'w').length, 2)
})

test('silent player dropped after 10 s, kick closes 4409, idle room holds no timers', () => {
	const { room, clock, open, closed } = setup()
	const a = open(), b = open()
	room.handle(a, { t: 'join', name: 'A' })
	room.handle(b, { t: 'join', name: 'B' })
	for (let i = 0; i < 6; i++) {
		clock.advance(2000)
		room.handle(b, { t: 'ping' })
	}
	assert.equal(closed.get(a), 4408)
	assert.equal(room.snapshot().players.length, 1)
	const id = room.snapshot().players[0].id
	assert.equal(room.host('kick', { id }).ok, true)
	assert.equal(closed.get(b), 4409)
	assert.equal(room.snapshot().players.length, 0)
	assert.equal(room.host('kick', { id: 999 }).ok, false)
	clock.advance(2000)
	assert.deepEqual(room.timers(), { phase: false, house: false, world: false })
	assert.equal(clock.count(), 0)
})

test('sanitize: names, colours, messages ≤ 2 KB JSON with a known type', () => {
	assert.equal(S.cleanName('\u0000\u001b[31mHi‏ there', 'x'), '[31mHi there')
	assert.equal(S.cleanName('    ', 'fallback'), 'fallback')
	assert.equal(S.cleanColor('#ABCDEF'), '#abcdef')
	assert.equal(S.cleanColor('javascript:alert(1)', 3), S.PALETTE[3])
	assert.equal(S.parseMessage('{"t":"ping","c":1}', false).c, 1)
	assert.equal(S.parseMessage('{"t":"evil"}', false), null)
	assert.equal(S.parseMessage('[1,2]', false), null)
	assert.equal(S.parseMessage('nope', false), null)
	assert.equal(S.parseMessage(Buffer.from('{"t":"ping"}'), true), null, 'binary frames refused')
	assert.equal(S.parseMessage(JSON.stringify({ t: 'ping', pad: 'x'.repeat(2100) }), false), null)
	assert.equal(S.cleanCar({ p: [0, 0, 0], yaw: 7 }, null, 4, 3).yaw, Math.round((7 - 2 * Math.PI) * 1000) / 1000)
	assert.equal(S.cleanCar({ p: [0, 0, 0], yaw: 0, cp: 9, lap: 1 }, null, 4, 3).cp, null)
})

/** A seeded RNG (LCG) — the room takes it through deps.rng. */
const seeded = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const drive = (room, c, x = 0, extra = {}) => room.handle(c, { t: 's', p: [x, 0, 0], yaw: 0, v: 3, st: 0, ...extra })
/** The items module alone: every car at the origin, `n` boxes there, a fixed roll (slick outside a race). */
function bareItems(n) {
	const clk = fakeClock()
	const sent = []
	const items = I.createRoomItems({ now: clk.now, timers: clk.timers, rng: () => 0.3, toAll: (m) => sent.push(m), toPlayer: () => {},
		position: () => null, carOf: () => [0, 0, 0], isPlayer: () => true })
	items.setTrack({ boxes: Array.from({ length: n }, (_, i) => ({ id: i, x: 0, z: 0 })) }, BOUNDS)
	return { clk, sent, items }
}
/** Advance `ms` with a ping from every conn each 5 s (players silent for 10 s are dropped). */
const wait = (room, clock, conns, ms) => {
	for (let left = ms; left > 0; left -= 5000) {
		clock.advance(Math.min(5000, left))
		for (const c of conns) room.handle(c, { t: 'ping' })
	}
}

test('item roll: leaders mostly slick / shield, the back mostly turbo / rocket / pulse; deterministic per RNG', () => {
	const share = (f, kinds) => {
		const rng = seeded(11)
		let k = 0
		for (let i = 0; i < 20000; i++) if (kinds.includes(I.rollItem(f, rng))) k++
		return k / 20000
	}
	assert.ok(share(0, ['slick', 'shield']) > 0.7, 'leader')
	assert.ok(share(1, ['turbo', 'rocket', 'pulse']) > 0.85, 'last place')
	assert.ok(share(1, ['slick', 'shield']) < 0.15 && share(0, ['rocket', 'pulse']) < 0.15)
	const seq = (rng) => Array.from({ length: 50 }, () => I.rollItem(0.3, rng))
	const seqA = seq(seeded(5))
	assert.deepEqual(seqA, seq(seeded(5)))
	assert.ok(new Set(seqA).size >= 4, 'a mid-field roll gives a mix')
	// in a race the room rolls by position: same RNG draw, leader → slick, last → rocket
	const { room, clock, open, last } = setup({ rng: () => 0.5 })
	const [x, y, z] = [open(), open(), open()]
	for (const c of [x, y, z]) room.handle(c, { t: 'join', name: c })
	room.host('start')
	clock.advance(COUNTDOWN_MS)
	for (const [c, x0, cp] of [[x, 0, 1], [y, 1, 0], [z, 2, 0]]) drive(room, c, x0, { cp, lap: 0 })
	room.handle(x, { t: 'box', id: 0 })
	room.handle(z, { t: 'box', id: 2 })
	assert.deepEqual([last(x, 'item').item, last(z, 'item').item], ['slick', 'rocket'])
	assert.equal(I.weights(0.5).turbo, (0.15 + 0.35) / 2)
})

test('box race: the first claim wins, back after 6 s; far, unknown and spectator claims ignored; late joiner sees it', () => {
	const { room, clock, open, last, all } = setup({ rng: () => 0.1 })
	const a = open(), b = open(), spec = open()
	room.handle(a, { t: 'join', name: 'A' })
	room.handle(b, { t: 'join', name: 'B' })
	room.handle(spec, { t: 'join', spectator: true })
	drive(room, a, 1)
	drive(room, b, 1.2)
	const idA = last(a, 'welcome').id, idB = last(b, 'welcome').id
	room.handle(a, { t: 'box', id: 1 })
	room.handle(b, { t: 'box', id: 1 }) // same instant, second
	assert.equal(all(b, 'box').length, 1)
	assert.deepEqual(last(b, 'box'), { t: 'box', id: 1, by: idA, until: clock.now() + I.BOX_RESPAWN_MS })
	assert.equal(last(a, 'item').item, 'turbo')
	assert.equal(all(b, 'item').length, 0, 'the loser gets nothing')
	const late = open()
	room.handle(late, { t: 'join', name: 'L' })
	assert.deepEqual(last(late, 'welcome').state.boxes, [[1, clock.now() + I.BOX_RESPAWN_MS]])
	for (const bad of [{ id: 9 }, { id: '1' }, { id: 1.5 }, {}]) room.handle(b, { t: 'box', ...bad })
	room.handle(spec, { t: 'box', id: 2 })
	clock.advance(100)
	drive(room, b, 18)
	room.handle(b, { t: 'box', id: 3 }) // 15 m away from box 3
	assert.equal(all(a, 'box').length, 1, 'no other claim went through')
	clock.advance(I.BOX_RESPAWN_MS)
	drive(room, b, 1)
	room.handle(b, { t: 'box', id: 1 })
	assert.equal(last(a, 'box').by, idB, 'back after 6 s')
	assert.equal(last(b, 'item').item, 'turbo')
	room.handle(b, { t: 'box', id: 0 })
	assert.equal(last(a, 'box').id, 0, 'holding an item: the box is still taken …')
	assert.equal(all(b, 'item').length, 1, '… but no second item')
})

test('hazards: use → haz / fx, expiry on the clock, hit → hazgone + spin, a stale hit ignored, at most 40 alive', () => {
	let pick = 0.3 // lobby (f 0.5): 0.3 → slick
	const { room, clock, open, last, all } = setup({ rng: () => pick })
	const a = open(), b = open()
	room.handle(a, { t: 'join', name: 'A' })
	room.handle(b, { t: 'join', name: 'B' })
	const idA = last(a, 'welcome').id, idB = last(b, 'welcome').id
	drive(room, a, 0)
	drive(room, b, 2)
	room.handle(a, { t: 'box', id: 0 })
	room.handle(a, { t: 'use', item: 'rocket', p: [0, 0, 0], yaw: 0 }) // not the held item
	room.handle(a, { t: 'use', item: 'slick', p: [12, 0, 0], yaw: 0 }) // 12 m from A's own car (> 4 m)
	assert.equal(all(b, 'haz').length, 0)
	room.handle(a, { t: 'use', item: 'slick', p: [0, 0, 0], yaw: 1.2 })
	const h = last(b, 'haz')
	assert.deepEqual(h, { t: 'haz', hid: h.hid, kind: 'slick', by: idA, p: [0, 0, 0], yaw: 1.2, ts: clock.now(), until: clock.now() + I.HAZARD_MS.slick })
	assert.equal(room.snapshot().hazards.length, 1)
	room.handle(a, { t: 'use', item: 'slick', p: [0, 0, 0], yaw: 1.2 }) // used up
	assert.equal(all(b, 'haz').length, 1)
	wait(room, clock, [a, b], I.HAZARD_MS.slick - 1)
	assert.equal(all(b, 'hazgone').length, 0)
	clock.advance(1)
	assert.deepEqual(last(b, 'hazgone'), { t: 'hazgone', hid: h.hid, hit: null })
	assert.equal(room.snapshot().hazards.length, 0)
	// a rocket, hit by B
	pick = 0.6 // f 0.5: 0.6 → rocket
	clock.advance(I.BOX_RESPAWN_MS)
	room.handle(a, { t: 'box', id: 0 })
	room.handle(a, { t: 'use', item: 'rocket', p: [0, 0, 0], yaw: 0 })
	const r = last(b, 'haz')
	assert.equal(r.until - r.ts, I.HAZARD_MS.rocket)
	room.handle(b, { t: 'hit', hid: r.hid })
	assert.deepEqual(last(a, 'hazgone'), { t: 'hazgone', hid: r.hid, hit: idB })
	assert.deepEqual(last(a, 'fx'), { t: 'fx', id: idB, k: 'spin', p: [2, 0, 0], ts: clock.now() })
	room.handle(a, { t: 'hit', hid: r.hid }) // gone: ignored
	assert.equal(all(b, 'hazgone').length, 2)
	assert.equal(all(b, 'fx').length, 1)
	// a pulse: an effect for everyone; B's report of being hit by it spins B; a bogus "by" is ignored
	pick = 0.75 // → pulse
	clock.advance(I.BOX_RESPAWN_MS)
	for (const c of [a, b]) room.handle(c, { t: 'ping' })
	room.handle(a, { t: 'box', id: 0 })
	room.handle(a, { t: 'use', item: 'pulse', p: [0, 0, 0], yaw: 0 })
	assert.equal(last(b, 'fx').k, 'pulse')
	room.handle(b, { t: 'hit', by: idB, item: 'pulse' })
	room.handle(b, { t: 'hit', by: 999, item: 'pulse' })
	assert.equal(all(a, 'fx').length, 2)
	room.handle(b, { t: 'hit', by: idA, item: 'pulse' })
	assert.equal(last(a, 'fx').k, 'spin')
	// the cap, on the items module itself: 41 slicks → the oldest is dropped
	const { clk, sent, items } = bareItems(45)
	for (let i = 0; i < 41; i++) {
		if (i % 5 === 0) clk.advance(1000)
		items.handle(7, { t: 'box', id: i })
		items.handle(7, { t: 'use', item: 'slick', p: [0, 0, 0], yaw: 0 })
	}
	assert.equal(items.snapshot().hazards.length, I.MAX_HAZARDS)
	const gone = sent.filter((m) => m.t === 'hazgone')
	assert.deepEqual(gone, [{ t: 'hazgone', hid: 1, hit: null }])
	assert.equal(items.snapshot().hazards[0].hid, 2)
	items.clear()
	assert.equal(items.timerRunning(), false)
	assert.equal(clk.count(), 0)
})

test('rate limits: ≤ 10 box, ≤ 5 use, ≤ 5 hit per player per second', () => {
	const { clk, sent, items } = bareItems(30)
	for (let i = 0; i < 12; i++) items.handle(1, { t: 'box', id: i }) // player 1 holds after the first
	assert.equal(sent.filter((m) => m.t === 'box').length, I.RATE.box)
	clk.advance(1000)
	let used = 0
	for (let i = 0; i < 7; i++) {
		items.handle(2, { t: 'box', id: 12 + i })
		const before = sent.length
		items.handle(2, { t: 'use', item: 'slick', p: [0, 0, 0], yaw: 0 })
		if (sent.length > before) used++
	}
	assert.equal(used, I.RATE.use)
	const hids = items.snapshot().hazards.map((h) => h.hid)
	for (const hid of hids) items.handle(3, { t: 'hit', hid })
	items.handle(3, { t: 'hit', hid: hids[0] })
	assert.equal(sent.filter((m) => m.t === 'hazgone').length, I.RATE.hit)
	clk.advance(1000)
	items.handle(2, { t: 'use', item: 'slick', p: [0, 0, 0], yaw: 0 }) // the 6th item was kept: usable a second later
	assert.equal(sent.filter((m) => m.t === 'haz').length, I.RATE.use + 1)
	assert.equal(I.cleanPoint([0, 0, Infinity], null), null)
})

test('boxes and hazards: cleared when a race starts and when it ends; nothing during the countdown', () => {
	const { room, clock, open, last, all } = setup({ rng: () => 0.3 })
	const a = open()
	room.handle(a, { t: 'join', name: 'A' })
	drive(room, a, 0)
	room.handle(a, { t: 'box', id: 0 })
	room.handle(a, { t: 'use', item: 'slick', p: [0, 0, 0], yaw: 0 })
	room.handle(a, { t: 'box', id: 1 }) // held slick for the race
	assert.equal(room.snapshot().boxes.length, 2)
	assert.equal(room.snapshot().hazards.length, 1)
	room.host('laps', { laps: 1 })
	room.host('start')
	assert.deepEqual([last(a, 'state').state.boxes, last(a, 'state').state.hazards], [[], []])
	assert.equal(clock.count() > 0, true)
	room.handle(a, { t: 'box', id: 2 })
	room.handle(a, { t: 'use', item: 'slick', p: [0, 0, 0], yaw: 0 })
	assert.equal(all(a, 'box').length, 2, 'countdown: no claims')
	clock.advance(COUNTDOWN_MS)
	room.handle(a, { t: 'use', item: 'slick', p: [0, 0, 0], yaw: 0 })
	assert.equal(all(a, 'haz').length, 1, 'the lobby item did not carry into the race')
	drive(room, a, 2)
	room.handle(a, { t: 'box', id: 2 })
	room.handle(a, { t: 'use', item: 'slick', p: [0, 0, 0], yaw: 0 })
	assert.equal(room.snapshot().hazards.length, 1)
	for (const cp of [1, 2, 3]) {
		clock.advance(1000)
		drive(room, a, 2, { cp, lap: 0 })
	}
	clock.advance(2000)
	drive(room, a, 2, { cp: 0, lap: 1 })
	assert.equal(room.snapshot().phase, 'results')
	assert.deepEqual([room.snapshot().boxes, room.snapshot().hazards], [[], []])
	room.handle(a, { t: 'box', id: 3 })
	assert.equal(all(a, 'box').length, 3, 'results: no claims')
})

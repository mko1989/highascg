'use strict'

/**
 * WO-1074 — the RC game room (src/game/rc-room.js) on a fake clock: join / full / spectators, sanitised names and
 * colours, slots, ready, the phase machine (start → countdown 5 s → race → laps → results, stop → lobby), lap
 * refereeing (checkpoints in order, never faster than length / 20 m/s), the 20 Hz input cap, the 15 Hz world snapshot
 * only while something moves, the silent-player drop, kick, and no timers at all when idle.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createRcRoom, COUNTDOWN_MS, GRACE_MS, WORLD_MS } = require('../../src/game/rc-room')
const S = require('../../src/game/rc-sanitize')

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

const TRACK = { id: 'stage-oval', length: 40, checkpoints: [0, 15, 30, 45], points: [] }
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
	const minLap = (TRACK.length / 20) * 1000
	for (const cp of [1, 2, 3]) {
		clock.advance(100)
		s(a, cp, 0)
	}
	s(a, 0, 1) // only ~300 ms after the start: faster than 20 m/s → not a lap
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
	for (let i = 0; i < 40; i++) room.handle(a, { t: 's', p: [i * 0.01, 0, 0], yaw: 0, v: 99, st: 9 })
	clock.advance(WORLD_MS)
	const w = all(b, 'w')
	assert.equal(w.length, 1)
	assert.equal(w[0].cars[0][1], 0.19, 'the 21st state in the same second was dropped')
	assert.equal(w[0].cars[0][5], 12, 'speed clamped to 12 m/s')
	assert.equal(w[0].cars[0][6], 1, 'steering clamped')
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

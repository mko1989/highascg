'use strict'

/**
 * WO-1074 §3 — the referee at toy scale (src/game/rc-room.js, rc-sanitize.js, rc-room-items.js): the scene's `scale`
 * scales the speed cap (24 m/s × scale), the lap minimum (length / (24 × scale)) and the item reach (box 8 m, use 4 m,
 * × scale); a scene without `scale` keeps the v2 limits; the host's lap count follows a picked track's `laps` (on a host
 * 'track' and on the scene's auto-pick), a track without `laps` leaves it alone.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createRcRoom, COUNTDOWN_MS } = require('../../src/game/rc-room')
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

const BOUNDS = { min: [-2, -0.1, -3], max: [2, 1, 2] }
const TOY = { id: 'stage-oval', length: 4, laps: 3, checkpoints: [0, 15, 30, 45], points: [], boxes: [{ id: 0, x: 0, y: 0.05, z: 0 }] }
const LONG = { id: 'room-long-tour', length: 120, laps: 1, checkpoints: [0, 15, 30, 45], points: [] }
const BARE = { id: 'hall-loop', length: 10, checkpoints: [0, 15, 30, 45], points: [] } // no `laps`

function setup(scene) {
	const clock = fakeClock()
	const out = new Map()
	const room = createRcRoom({ now: clock.now, timers: clock.timers, send: (c, m) => out.get(c).push(m), close: () => {} })
	room.setScene(scene)
	let n = 0
	const open = (name) => {
		const c = `c${++n}`
		out.set(c, [])
		room.connect(c)
		room.handle(c, { t: 'join', name })
		return c
	}
	const all = (c, t) => out.get(c).filter((m) => m.t === t)
	return { clock, room, open, all }
}

test('§3 speed cap: 24 m/s × the scene scale (2.4 at 0.1), 24 without a scale', () => {
	const car = (v, scale) => S.cleanCar({ p: [0, 0, 0], yaw: 0, v }, BOUNDS, 4, 3, scale).v
	assert.equal(car(5, 0.1), 2.4)
	assert.equal(car(-5, 0.1), -2.4)
	assert.equal(car(2, 0.1), 2)
	assert.equal(car(5, 1), 5)
	assert.equal(car(30, undefined), S.MAX_SPEED)
})

/** One lap of the 4 m toy track: checkpoints 1–3 100 ms apart, then the line at `atMs` after the start. */
function lapAt(scale, atMs) {
	const { room, clock, open, all } = setup({ scale, tracks: [TOY], bounds: BOUNDS })
	const a = open('A')
	room.host('start')
	clock.advance(COUNTDOWN_MS)
	const s = (cp, lap) => room.handle(a, { t: 's', p: [0, 0.05, 0], yaw: 0, v: 1, st: 0, cp, lap })
	for (const cp of [1, 2, 3]) {
		clock.advance(100)
		s(cp, 0)
	}
	clock.advance(atMs - 300)
	s(0, 1)
	return all(a, 'lap').length
}

test('§3 lap minimum: length / (24 m/s × scale) — a 4 m toy lap needs ≥ 1.67 s at 0.1, 0.17 s without a scale', () => {
	assert.equal(lapAt(undefined, 1000), 1, 'scale 1: 1 s for 4 m is a lap')
	assert.equal(lapAt(0.1, 1000), 0, 'scale 0.1: 1 s for 4 m is faster than 2.4 m/s')
	assert.equal(lapAt(0.1, Math.ceil((TOY.length / (S.MAX_SPEED * 0.1)) * 1000) + 1), 1)
})

test('§3 item reach × scale: a box claim within 0.8 m and a use within 0.4 m at 0.1 (8 m / 4 m without)', () => {
	const run = (scale, dBox, dUse) => {
		const clk = fakeClock()
		const sent = []
		let car = [dBox, 0, 0]
		const items = I.createRoomItems({ now: clk.now, timers: clk.timers, rng: () => 0.3, toAll: (m) => sent.push(m), toPlayer: () => {},
			position: () => null, carOf: () => car, isPlayer: () => true })
		items.setTrack({ boxes: [{ id: 0, x: 0, z: 0 }] }, BOUNDS, scale)
		items.handle(1, { t: 'box', id: 0 })
		const claimed = sent.some((m) => m.t === 'box')
		car = [0, 0, 0]
		items.handle(1, { t: 'use', item: 'slick', p: [dUse, 0, 0], yaw: 0 })
		return [claimed, sent.some((m) => m.t === 'haz')]
	}
	assert.equal(I.BOX_REACH, 8)
	assert.equal(I.USE_REACH, 4)
	assert.deepEqual(run(0.1, 0.7, 0.3), [true, true])
	assert.deepEqual(run(0.1, 0.9, 0.3), [false, false], 'a claim 0.9 m away is ignored at 0.1')
	assert.deepEqual(run(0.1, 0.7, 0.5), [true, false], 'a use 0.5 m away is ignored at 0.1')
	assert.deepEqual(run(undefined, 7, 3), [true, true], 'v2 reach without a scale')
	assert.deepEqual(run(1, 9, 3), [false, false])
})

test('§3 laps follow the track: the scene auto-pick and host track take its laps; a track without laps keeps the count', () => {
	const { room } = setup({ scale: 0.1, tracks: [TOY, LONG, BARE], bounds: BOUNDS })
	assert.equal(room.snapshot().trackId, 'stage-oval')
	assert.equal(room.snapshot().laps, 3)
	assert.equal(room.host('track', { trackId: 'room-long-tour' }).ok, true)
	assert.equal(room.snapshot().laps, 1)
	assert.equal(room.host('laps', { laps: 5 }).ok, true)
	assert.equal(room.host('track', { trackId: 'hall-loop' }).ok, true)
	assert.equal(room.snapshot().laps, 5, 'no suggestion: the host count stays')
	assert.equal(room.host('track', { trackId: 'stage-oval' }).ok, true)
	assert.equal(room.snapshot().laps, 3)
	assert.equal(room.host('laps', { laps: 7 }).ok, true)
	room.setScene({ scale: 0.1, tracks: [TOY, LONG], bounds: BOUNDS }) // a re-bake keeping the track: the host count stays
	assert.equal(room.snapshot().laps, 7)
	room.setScene({ scale: 0.1, tracks: [LONG, BARE], bounds: BOUNDS }) // the track is gone: the auto-pick suggests
	assert.equal(room.snapshot().trackId, 'room-long-tour')
	assert.equal(room.snapshot().laps, 1)
})

'use strict'

/**
 * WO-1106 B36 / B39 / B41 — the RC room (modules/rc-game/server/rc-room.js) on a fake clock: a silent spectator is
 * timed out like a silent player (its seat freed, the count broadcast); every racer gone during the countdown ends in
 * results instead of `race` forever (on drop, on kick and at the countdown's end); a `ready` that changes nothing
 * broadcasts nothing.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createRcRoom, COUNTDOWN_MS } = require('../../modules/rc-game/server/rc-room')

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
const BOUNDS = { min: [-20, -1, -30], max: [20, 10, 20] }

function setup(o = {}) {
	const clock = fakeClock()
	const out = new Map()
	const closed = new Map()
	const room = createRcRoom({ now: clock.now, timers: clock.timers, send: (c, m) => out.get(c).push(m), close: (c, code) => closed.set(c, code), ...o })
	room.setScene({ tracks: [TRACK], bounds: BOUNDS })
	let n = 0
	const open = (name, extra = {}) => {
		const c = `c${++n}`
		out.set(c, [])
		room.connect(c)
		room.handle(c, { t: 'join', name, ...extra })
		return c
	}
	const of = (c, t) => out.get(c).filter((m) => m.t === t)
	return { clock, room, out, closed, open, of }
}

test('B36: a silent spectator is closed 4408 after 10 s and frees its seat; a pinging one stays', () => {
	const { room, clock, closed, open, of } = setup({ maxSpectators: 2 })
	const a = open('Ann')
	const quiet = open('Quiet', { spectator: true })
	const talker = open('Talker', { spectator: true })
	assert.equal(room.snapshot().spectators, 2)
	for (let i = 0; i < 6; i++) {
		clock.advance(2000)
		room.handle(a, { t: 'ping' })
		room.handle(talker, { t: 'ping' })
	}
	assert.equal(closed.get(quiet), 4408, 'the silent spectator is closed')
	assert.equal(closed.has(talker), false, 'a spectator that pings stays')
	assert.equal(closed.has(a), false)
	assert.equal(room.snapshot().spectators, 1)
	assert.equal(of(a, 'state').at(-1).state.spectators, 1, 'the freed seat is broadcast')
	const next = open('Next', { spectator: true })
	assert.equal(of(next, 'welcome').length, 1, 'the freed seat can be taken')
})

test('B39: every racer gone during the countdown → results (drop), never `race` forever', () => {
	const { room, clock, open, of } = setup()
	const a = open('Ann'), b = open('Ben'), sp = open('Eye', { spectator: true })
	assert.equal(room.host('start').ok, true)
	assert.equal(room.snapshot().phase, 'countdown')
	room.disconnect(a)
	assert.equal(room.snapshot().phase, 'countdown', 'one racer is still there')
	room.disconnect(b)
	assert.equal(room.snapshot().phase, 'results')
	assert.equal(of(sp, 'results').length, 1)
	clock.advance(COUNTDOWN_MS + 100)
	assert.equal(room.snapshot().phase, 'results', 'the countdown step does not turn results into a race')
	assert.equal(room.host('laps', { laps: 2 }).ok, true, 'host actions work again (no 409)')
	assert.equal(room.host('track', { trackId: TRACK.id }).ok, true)
})

test('B39: kick of the last racer in the countdown → results; racers that vanish without a close → results at the countdown end', () => {
	const R = setup()
	const a = R.open('Ann')
	R.room.host('start')
	const id = R.of(a, 'welcome')[0].id
	assert.equal(R.room.host('kick', { id }).ok, true)
	assert.equal(R.room.snapshot().phase, 'results')
	assert.equal(R.room.host('start').ok, false, 'no players: start refused, not stuck')

	// entering `race` with no connected racer: checked at once
	const S = setup()
	const b = S.open('Ben')
	S.room.host('start')
	S.room.world().players.get(S.of(b, 'welcome')[0].id).connected = false // gone without a close (the drop path is above)
	S.clock.advance(COUNTDOWN_MS)
	assert.equal(S.room.snapshot().phase, 'results', 'checked when the race begins')
})

test('B39: a paused countdown that ended in results is not turned into a race by the resume', () => {
	const { room, clock, open } = setup()
	const a = open('Ann')
	room.host('start')
	room.host('pause', { on: true })
	room.disconnect(a)
	assert.equal(room.snapshot().phase, 'results')
	room.host('pause', { on: false })
	clock.advance(COUNTDOWN_MS + 100)
	assert.equal(room.snapshot().phase, 'results')
})

test('B41: `ready` broadcasts state only when it changes', () => {
	const { room, open, of } = setup()
	const a = open('Ann'), b = open('Ben')
	const n0 = of(b, 'state').length
	room.handle(a, { t: 'ready', ready: true })
	assert.equal(of(b, 'state').length, n0 + 1)
	for (let i = 0; i < 40; i++) room.handle(a, { t: 'ready', ready: true })
	assert.equal(of(b, 'state').length, n0 + 1, 'the same ready again: no broadcast')
	room.handle(a, { t: 'ready', ready: false })
	assert.equal(of(b, 'state').length, n0 + 2)
	assert.equal(of(b, 'state').at(-1).state.players.find((p) => p.name === 'Ann').ready, false)
	room.handle(a, { t: 'ready' }) // missing = not ready: unchanged
	assert.equal(of(b, 'state').length, n0 + 2)
})

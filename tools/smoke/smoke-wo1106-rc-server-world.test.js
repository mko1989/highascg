'use strict'

/**
 * WO-1106 A32 (server half, RC) — `{ t: 'wq', re: true }` from an RC page whose pre-load queue overflowed: the RC world
 * adapter (modules/rc-game/server/rc-world.js) leaves that socket out of exactly one viewers() call, so the REAL hub
 * (modules/game-world/server/world-hub.js) forgets its view and serves it afresh (a new `wst` + every `add`); the
 * socket's visitor cap stays. Mirrors Salad's test in smoke-wo1106-salad-world.test.js.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createRcRoom } = require('../../modules/rc-game/server/rc-room')
const { createRcWorld } = require('../../modules/rc-game/server/rc-world')
const { createHub } = require('../../modules/game-world/server/world-hub')

const KEY = Symbol.for('highascg.game-world/1')
const reg = () => globalThis[KEY] || (globalThis[KEY] = { v: 1, games: new Map(), hub: null })

test.after(() => {
	reg().hub = null
})

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

/** Another game's room with one car next to the RC track — just the adapter surface the hub reads. */
function otherRoom() {
	const a = { id: 'sk', ents: [{ k: 'car', id: 1, p: [1, 0.25, 1], yaw: 0, c: '#ff0000', n: 'other-1', f: 0 }] }
	return Object.assign(a, { entities: () => a.ents, viewers: () => [], send: () => true, toAll() {},
		board: () => ({ phase: 'race', endsAt: null, top: [], players: 1, bots: 0 }), apply: () => true, bonus: () => true })
}

test('A32: `wq` re: true → the hub forgets that socket\'s view for one tick and serves it afresh (wst + every add again); the cap stays', (t) => {
	const clk = fakeClock()
	const sent = new Map()
	const send = (c, m) => {
		if (!sent.has(c)) sent.set(c, [])
		sent.get(c).push(m)
		return true
	}
	const room = createRcRoom({ now: clk.now, timers: clk.timers, send })
	room.setScene({ tracks: [{ id: 'oval', length: 40, checkpoints: [0, 15, 30, 45], points: [[-2, 0.25, -3], [4, 0.25, -3], [4, 0.25, 5]] }],
		bounds: { min: [-20, -1, -30], max: [20, 10, 20] } })
	const w = createRcWorld({ room: () => room, send, now: clk.now })
	const hub = createHub({ now: clk.now, timers: clk.timers, registry: reg(), seed: 5, defer: (fn) => fn() })
	reg().hub = hub
	const a = { name: 'Ann' }
	room.connect(a)
	room.handle(a, { t: 'join', name: 'Ann' })
	room.handle(a, { t: 's', p: [0, 0.25, 0], yaw: 0, v: 0, st: 0 })
	const ping = clk.timers.setInterval(() => room.handle(a, { t: 'ping', c: 0 }), 2000)
	hub.attach(otherRoom())
	w.attach()
	t.after(() => {
		clk.timers.clearInterval(ping)
		hub.dispose()
		reg().hub = null
		room.dispose()
	})
	const of = (type) => (sent.get(a) || []).filter((m) => m.t === type)
	const adds = () => of('wv').filter((m) => Array.isArray(m.add) && m.add.some((x) => x[1] === 'car')).length

	w.quality(a, { t: 'wq', n: 20 })
	clk.advance(1000)
	const wst0 = of('wst').length
	assert.ok(wst0 >= 1, 'the world is on for this socket')
	clk.advance(1000)
	assert.equal(of('wst').length, wst0, 'no wst while nothing changes')
	const before = of('wv').length
	assert.equal(adds(), 1, 'the other game\'s car was added once')
	w.quality(a, { t: 'wq', re: true })
	assert.equal(w.adapter.viewers().length, 0, 'left out of one viewers() call')
	assert.equal(w.adapter.viewers()[0].cap, 20, 'then back, keeping its cap')
	w.quality(a, { t: 'wq', re: true })
	clk.advance(400)
	assert.equal(of('wst').length, wst0 + 1, 'a fresh wst')
	assert.ok(of('wv').length > before, 'the view again')
	assert.equal(adds(), 2, 'the car added again')
})

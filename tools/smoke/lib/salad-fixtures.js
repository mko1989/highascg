'use strict'

/**
 * WO-1089 — Stage Salad smoke fixtures: a manual clock with timers (deterministic rounds), seeded dice, the shared
 * physics (the ES modules the browser runs, required as the server requires them) and a synthetic venue shaped like
 * the box's hall (a hall floor, a raised stage along one side, an LED wall behind it, a truss line over it).
 */

const path = require('path')

const ROOT = path.join(__dirname, '..', '..', '..')
const SALAD = path.join(ROOT, 'modules', 'stage-salad')

/** The shared client modules exactly as salad-kit.js hands them to the server. */
const shared = () => require(path.join(SALAD, 'server', 'salad-kit.js')).shared()
const server = (f) => require(path.join(SALAD, 'server', f))

function createClock(t0 = 1_000_000) {
	let t = t0
	let seq = 0
	const q = new Map()
	const add = (fn, ms, every) => {
		const id = ++seq
		q.set(id, { at: t + Math.max(0, Number(ms) || 0), fn, every })
		return id
	}
	const timers = {
		setTimeout: (fn, ms) => add(fn, ms, 0),
		clearTimeout: (id) => q.delete(id),
		setInterval: (fn, ms) => add(fn, ms, Math.max(1, ms)),
		clearInterval: (id) => q.delete(id),
	}
	function advance(ms) {
		const end = t + ms
		for (;;) {
			let next = null
			for (const [id, e] of q) if (e.at <= end && (!next || e.at < next[1].at || (e.at === next[1].at && id < next[0]))) next = [id, e]
			if (!next) break
			const [id, e] = next
			t = e.at
			if (e.every) e.at += e.every
			else q.delete(id)
			e.fn()
		}
		t = end
	}
	return { now: () => t, timers, advance, pending: () => q.size }
}

function dice(seed = 1) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) | 0
		let x = Math.imul(a ^ (a >>> 15), 1 | a)
		x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296
	}
}

/** Hall 30 × 50 m at y 0.24, stage 3 × 15 m (y 0.64) on the +x side, LED wall 15 × 3 m behind it (p = the picture's centre, as rc-video sends it), 6 lights on a truss. */
const SCENE = Object.freeze({
	floors: [{ id: 'hall', y: 0.241, rect: [-15.254, -27.734, 15.016, 34.491] }, { id: 'stage', y: 0.639, rect: [9.55, -4, 12.55, 11] }],
	bounds: { min: [-15.3, 0, -27.8], max: [15.1, 5.99, 34.5] },
})
const LIVE = Object.freeze({
	screens: [{ id: 'led_wall_1', p: [12.7, 2.739, 3.5], rot: [0, -90, 0], size: [15, 3] }],
	lights: [0, 1, 2, 3, 4, 5].map((i) => ({ i, p: [9.2, 5.2, -2 + i * 2.5] })),
})
const venue = () => shared().venue.buildVenue(SCENE, LIVE)

/** A tracking snapshot: world persons [{ id, x, y (PSN), … }]. */
const snapOf = (persons) => ({ world: { persons: persons.map((p) => ({ height: 1.75, name: `P${p.id}`, ...p })) } })
const PUPPET = Object.freeze({ id: 900001, puppet: true, name: 'TEST puppet 1', height: 1.55,
	traits: { top: [110, 60, 150], bottom: [30, 40, 80], skin: [88, 58, 40], hair: [150, 150, 150], hair_len: 'short', locked: true } })

/** A room on the manual clock with one synthetic venue; `sent` collects every message per connection. */
function makeRoom({ seed = 7, maxPlayers } = {}) {
	const clk = createClock()
	const sent = new Map()
	const all = []
	const { createSaladRoom } = server('salad-room.js')
	const room = createSaladRoom({ now: clk.now, timers: clk.timers, rng: dice(seed), maxPlayers,
		send: (c, m) => {
			if (!sent.has(c)) sent.set(c, [])
			sent.get(c).push(m)
			all.push(m)
		},
		close: (c, code) => (c.closed = code) })
	room.setVenue(venue())
	/** A guest (pings every 2 s like the page; `silent` = never). */
	const join = (name, extra = {}, { silent = false } = {}) => {
		const c = { name }
		room.connect(c)
		room.handle(c, { t: 'join', name, ...extra })
		if (!silent) {
			const ping = clk.timers.setInterval(() => (c.closed ? clk.timers.clearInterval(ping) : room.handle(c, { t: 'ping', c: 0 })), 2000)
			c.stop = () => clk.timers.clearInterval(ping)
		}
		return c
	}
	const of = (c, t) => (sent.get(c) || []).filter((m) => !t || m.t === t)
	return { clk, room, join, of, all, sent }
}

module.exports = { ROOT, SALAD, shared, server, createClock, dice, SCENE, LIVE, venue, snapOf, PUPPET, makeRoom }

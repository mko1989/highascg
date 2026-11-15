'use strict'

/**
 * WO-1082 — RC race bots: server/rc-room-bots.js runs client/bot-brain.js against the real room (rc-room.js) with a
 * fake clock: bots join as players flagged `bot`, race with the client physics, and the room's own referee counts
 * their laps; they claim item boxes and use items through the same messages as a browser; the room's size limit holds;
 * a socket cannot call itself a bot; the timer runs only while bots exist; the host action is checked in rc-game.js.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRcRoom } = require('../../modules/rc-game/server/rc-room')
const { createRoomBots, MAX_BOTS, LEVELS } = require('../../modules/rc-game/server/rc-room-bots')
const F = require('./lib/rc-client-fixtures')

const ROOT = path.join(__dirname, '..', '..')

function fakeClock() {
	let t = 1000000
	let seq = 0
	const timers = new Map()
	const add = (fn, ms, every) => {
		timers.set(++seq, { fn, at: t + ms, every })
		return seq
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

/** A seeded RNG (mulberry32) so the races repeat exactly. */
function seeded(a) {
	return () => {
		a = (a + 0x6d2b79f5) | 0
		let x = Math.imul(a ^ (a >>> 15), 1 | a)
		x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296
	}
}

function ovalScene({ boxes = false } = {}) {
	const t = F.ovalTrack(12, 7, 140, 0, 3)
	let len = 0
	for (let i = 0; i < t.points.length; i++) {
		const a = t.points[i], b = t.points[(i + 1) % t.points.length]
		len += Math.hypot(b[0] - a[0], b[2] - a[2])
	}
	t.length = len
	if (boxes) t.boxes = [20, 55, 90, 125].map((i, id) => ({ id, x: t.points[i][0], y: 0.5, z: t.points[i][2] }))
	return { tracks: [t], floors: F.BIG_FLOORS, obstacles: [], occ: [], scale: 1, bounds: { min: [-30, -2, -30], max: [30, 10, 30] } }
}

async function setup(opts = {}) {
	const clock = fakeClock()
	const out = new Map()
	const sent = [] // every message a bot sent to the room
	const room = createRcRoom({ now: clock.now, timers: clock.timers, rng: seeded(7),
		send: (c, m) => (c.botSink ? c.botSink(m) : out.get(c)?.push(m)), close: (c) => c.close?.() })
	const scene = ovalScene(opts)
	room.setScene(scene)
	const bots = createRoomBots({ now: clock.now, timers: clock.timers, rng: seeded(11),
		connect: (c) => room.connect(c),
		handle: (c, m) => {
			sent.push(m)
			room.handle(c, m)
		},
		disconnect: (c) => room.disconnect(c) })
	bots.setScene(scene)
	await bots.preload()
	let n = 0
	const human = (name = 'Human') => {
		const c = `h${++n}`
		out.set(c, [])
		room.connect(c)
		room.handle(c, { t: 'join', name })
		return c
	}
	return { clock, room, bots, out, sent, human }
}

test('bots join as flagged players, race with the client physics and the room referees their laps', async () => {
	const { clock, room, bots, sent } = await setup()
	assert.deepEqual(bots.setCount(3, 'hard'), { ok: true, count: 3 })
	assert.equal(bots.count(), 3)
	assert.equal(bots.timerRunning(), true)
	const st = room.state()
	assert.equal(st.players.length, 3)
	assert.ok(st.players.every((p) => p.bot === true && /^Bot /.test(p.name)), 'flagged and named')
	assert.equal(new Set(st.players.map((p) => p.slot)).size, 3, 'own grid slots')
	assert.equal(room.host('laps', { laps: 2 }).ok, true)
	assert.equal(room.host('start').ok, true)
	clock.advance(60000)
	const res = room.state()
	assert.equal(res.phase, 'results', 'every bot finished: the race ended')
	const states = sent.filter((m) => m.t === 's')
	assert.ok(states.length > 300, `bots reported their cars (${states.length})`)
	assert.ok(Math.max(...states.map((m) => m.v)) > 10, 'up to speed')
	const laps = states.reduce((m, s) => Math.max(m, s.lap), 0)
	assert.equal(laps, 2, 'two laps reported, never more than the race has')
})

test('a bot-only race finishes in a sane time and every bot gets a total', async () => {
	const { clock, room, bots } = await setup()
	const results = []
	const spy = 'spy'
	room.connect(spy)
	bots.setCount(4)
	const orig = room.handle
	orig.call(room, spy, { t: 'join', name: 'Watcher', spectator: true })
	room.host('laps', { laps: 2 })
	room.host('start')
	for (let i = 0; i < 120 && room.state().phase !== 'results'; i++) clock.advance(500)
	assert.equal(room.state().phase, 'results')
	results.push(...room.state().players)
	assert.equal(results.length, 4)
	assert.equal(bots.count(), 4, 'bots stay for the next race')
	bots.setCount(0)
	assert.equal(bots.timerRunning(), false, 'no bots → no timer')
	assert.ok(room.state().players.every((p) => !p.connected), 'left: listed (disconnected) until the lobby, like a player')
	room.host('stop')
	assert.equal(room.state().players.length, 0, 'gone from the room')
})

test('bots claim item boxes and use what they get (box / use go through the room like a browser)', async () => {
	const { clock, room, bots, sent } = await setup({ boxes: true })
	bots.setCount(3)
	room.host('laps', { laps: 3 })
	room.host('start')
	clock.advance(45000)
	const claims = sent.filter((m) => m.t === 'box')
	const uses = sent.filter((m) => m.t === 'use')
	assert.ok(claims.length >= 3, `claims ${claims.length}`)
	assert.ok(uses.length >= 2, `uses ${uses.length}`)
	assert.ok(uses.every((u) => ['turbo', 'slick', 'rocket', 'pulse', 'shield'].includes(u.item)))
})

test('room size holds (10 players), a socket cannot claim the bot flag, level and count are bounded', async () => {
	const { room, bots, human } = await setup()
	for (let i = 0; i < 8; i++) human(`H${i}`)
	const r = bots.setCount(5)
	assert.equal(r.ok, true)
	assert.equal(bots.count(), 2, 'only the two free seats')
	assert.equal(room.state().players.length, 10)
	const fake = human('Sneaky')
	room.handle(fake, { t: 'join', name: 'Sneaky', bot: true })
	assert.ok(room.state().players.filter((p) => !/^Bot /.test(p.name)).every((p) => !p.bot), 'humans are never bots')
	assert.equal(MAX_BOTS, 9)
	assert.deepEqual(Object.keys(LEVELS), ['easy', 'normal', 'hard'])
	bots.dispose()
	assert.equal(bots.count(), 0)
	assert.equal(bots.timerRunning(), false)
})

test('rc-game.js: the `bots` host action is validated, idle-only, and bot sockets never reach a WebSocket', () => {
	const src = fs.readFileSync(path.join(ROOT, 'modules/rc-game/server/rc-game.js'), 'utf8')
	assert.match(src, /if \(ws\.botSink\) return ws\.botSink\(m\)/)
	assert.match(src, /action === 'bots'/)
	assert.match(src, /count 0–\$\{MAX_BOTS\}/)
	assert.match(src, /if \(ph !== 'lobby' && ph !== 'results'\) return \{ status: 409/)
	assert.match(src, /bots\?\.dispose\(\)/)
	const room = fs.readFileSync(path.join(ROOT, 'modules/rc-game/server/rc-room.js'), 'utf8')
	assert.match(room, /bot: !!c\.conn\?\.botSink/)
})

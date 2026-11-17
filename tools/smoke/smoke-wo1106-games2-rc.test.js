'use strict'

/**
 * WO-1106 games-2 — Stage Sprint RC server (modules/rc-game/server/*) with the Game World hub
 * (modules/game-world/server/world-hub.js):
 *   A35 (server half)  the server's bots take the cross-game R2 slick patches like players: hub.patches(gameId) →
 *                      [{ x, y, z, r, until }] (server ms), rc-world.js patches(), rc-room-bots.js hands them to every
 *                      bot step as `world.patches`. Through the real hub, rc-game.js and the client's bot brain: a splat
 *                      under a bot lowers its speed; no patch = the very same messages as without the world.
 *   B34                a dropped player resumes with its `welcome` token (rc-resume.js): the same id, slot, colour and
 *                      lap count; a wrong token is a normal join (counted as bad); the old half-open socket is closed
 *                      (4410); a kicked player's token is void; `full` never hits a resuming racer; 200 reload cycles
 *                      keep one entry.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { EventEmitter } = require('events')
const { pathToFileURL } = require('url')

const { createRcGame } = require('../../modules/rc-game/server/rc-game')
const { createRcRoom, COUNTDOWN_MS, GRACE_MS } = require('../../modules/rc-game/server/rc-room')
const { REPLACED_CODE } = require('../../modules/rc-game/server/rc-resume')
const { createHub } = require('../../modules/game-world/server/world-hub')
const F = require('./lib/rc-client-fixtures')

const KEY = Symbol.for('highascg.game-world/1')
const reg = () => globalThis[KEY] || (globalThis[KEY] = { v: 1, games: new Map(), hub: null })
const CLIENT = path.join(__dirname, '..', '..', 'modules', 'rc-game', 'client')

function makeClock(t0 = 5_000_000) {
	let t = t0
	let seq = 0
	const timers = new Map()
	const add = (fn, ms, every) => (timers.set(++seq, { fn, at: t + Math.max(0, Number(ms) || 0), every }), seq)
	return {
		now: () => t,
		timers: {
			setTimeout: (fn, ms) => add(fn, ms, 0),
			setInterval: (fn, ms) => add(fn, ms, Math.max(1, ms)),
			clearTimeout: (id) => timers.delete(id),
			clearInterval: (id) => timers.delete(id),
		},
		pending: () => timers.size,
		advance(ms) {
			const end = t + ms
			for (;;) {
				let next = null
				for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at || (x.at === next[1].at && id < next[0]))) next = [id, x]
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

/** A socket as the `ws` package hands it to the game: send / close / events; `got(t)` = the parsed messages of type t. */
function fakeWs() {
	const ws = new EventEmitter()
	Object.assign(ws, { readyState: 1, bufferedAmount: 0, sent: [], closedWith: null })
	ws.send = (s) => ws.sent.push(s)
	ws.close = (code) => {
		if (ws.closedWith != null) return
		ws.closedWith = code ?? 1000
		ws.readyState = 3
		ws.emit('close', code)
	}
	ws.msg = (m) => ws.emit('message', Buffer.from(JSON.stringify(m)), false)
	ws.got = (t) => ws.sent.map((s) => JSON.parse(s)).filter((m) => !t || m.t === t)
	return ws
}

const flush = async (n = 20) => {
	for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}


/** A seeded RNG (mulberry32) so two runs repeat exactly. */
function seeded(a) {
	return () => {
		a = (a + 0x6d2b79f5) | 0
		let x = Math.imul(a ^ (a >>> 15), 1 | a)
		x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296
	}
}

function ovalScene() {
	const t = F.ovalTrack(12, 7, 140, 0, 3)
	let len = 0
	for (let i = 0; i < t.points.length; i++) {
		const a = t.points[i], b = t.points[(i + 1) % t.points.length]
		len += Math.hypot(b[0] - a[0], b[2] - a[2])
	}
	t.length = len
	return { tracks: [t], floors: F.BIG_FLOORS, obstacles: [], occ: [], scale: 1, bounds: { min: [-30, -2, -30], max: [30, 10, 30] } }
}
const fakeBaker = () => {
	const json = ovalScene()
	return { rev: () => 'oval-1', get: async () => ({ rev: 'oval-1', json, text: JSON.stringify(json), glb: Buffer.alloc(0), gz: null }), drop() {} }
}

/** The client's own bot modules (what rc-room-bots.js loads), each bot seeded and kept for inspection. */
function botLoader(made) {
	const mod = (f) => import(pathToFileURL(path.join(CLIENT, f)).href)
	return () => Promise.all(['bot-brain.js', 'physics.js', 'track-math.js', 'occ.js'].map(mod)).then(([B, ...W]) => {
		const wrapped = { ...B, createBot: (o) => {
			const bot = B.createBot({ ...o, skill: 0.9, rng: seeded(31 + made.length) })
			made.push(bot)
			return bot
		} }
		return [wrapped, W]
	})
}

/**
 * The real RC game (fake clock, fake baker, the client bot brain) with one bot, optionally in the real hub with a world
 * page open (so the world tick runs). Returns what the bot sent to the room as JSON strings.
 */
async function race(t, { world = false, splat = null } = {}) {
	const clock = makeClock()
	const made = []
	let hub = null
	if (world) {
		hub = createHub({ now: clock.now, timers: clock.timers, registry: reg(), seed: 3, defer: (fn) => fn() })
		reg().hub = hub
		hub.openWorld(() => true)
	}
	const game = createRcGame({ now: clock.now, timers: clock.timers, baker: fakeBaker(), loadBots: botLoader(made), log: () => {}, lanIps: () => [] })
	t.after(() => {
		game.disable()
		hub?.dispose()
		reg().hub = null
	})
	game.host({ action: 'enable' })
	await flush()
	const room = game.room()
	const sent = []
	const handle = room.handle
	room.handle = (c, m) => (c.botSink && m.t === 's' && sent.push(JSON.stringify(m)), handle(c, m))
	assert.equal(game.host({ action: 'bots', count: 1, level: 'hard' }).status, 200)
	await flush()
	assert.equal(made.length, 1, 'one bot drives')
	assert.equal(game.host({ action: 'start' }).status, 200)
	const speeds = []
	let slick = 0
	for (let ms = 0; ms < 14000; ms += 20) {
		if (splat && ms >= splat.from && ms < splat.to) {
			const c = made[0].G.car // cabbages right under the bot's next physics steps (≈ 15 m/s: 0.25 m a step)
			for (const dt of [0.01, 0.025, 0.04]) hub.landed({ g: 'salad', pid: 1, veg: 'cabbage', p: [c.x + c.vx * dt, c.y, c.z + c.vz * dt], tag: 'floor' })
		}
		clock.advance(20)
		const car = made[0].G.car
		if (car?.wslick) slick++
		if (ms % 100 === 80) speeds.push(car ? Math.hypot(car.vx, car.vz) : 0)
	}
	return { sent, speeds, slick, hub, clock }
}

test('A35: hub.patches → the live R2 patches as { x, y, z, r, until }; none while safe, off, soft, not running or detached', (t) => {
	const clock = makeClock()
	const hub = createHub({ now: clock.now, timers: clock.timers, registry: { games: new Map(), hub: null }, seed: 1, defer: (fn) => fn() })
	t.after(() => hub.dispose())
	const ad = (id) => ({ id, entities: () => [], viewers: () => [], board: () => ({ phase: 'lobby' }), send: () => true })
	hub.attach(ad('rc'))
	assert.deepEqual(hub.patches('rc'), [], 'the world does not run (one room, no page)')
	hub.attach(ad('salad'))
	assert.equal(hub.running(), true)
	hub.landed({ g: 'salad', pid: 1, veg: 'tomato', p: [1, 0.25, 2], tag: 'floor' })
	assert.deepEqual(hub.patches('rc'), [{ x: 1, y: 0.25, z: 2, r: 0.15, until: clock.now() + 8000 }])
	hub.setAffect('rc', 'soft')
	assert.deepEqual(hub.patches('rc'), [], 'soft: the visual only, never a slide')
	hub.setAffect('rc', 'off')
	assert.deepEqual(hub.patches('rc'), [])
	hub.setAffect('rc', 'on')
	hub.setSafe(true)
	assert.deepEqual(hub.patches('rc'), [], 'presenter safe')
	hub.setSafe(false)
	assert.equal(hub.patches('rc').length, 1)
	assert.deepEqual(hub.patches('sk'), [], 'a game that is not attached gets none')
	clock.advance(8000)
	assert.deepEqual(hub.patches('rc'), [], 'gone after its 8 s')
})

test('A35: no patch → the bot sends exactly what it sends without the Game World (byte for byte)', async (t) => {
	const alone = await race(t)
	const inWorld = await race(t, { world: true })
	assert.ok(alone.sent.length > 100, `the bot raced (${alone.sent.length} states)`)
	assert.equal(inWorld.hub.running(), true, 'the world tick ran')
	assert.deepEqual(inWorld.sent, alone.sent)
	assert.equal(inWorld.slick, 0)
})

test('A35: a cabbage splat under a bot (through the real hub) makes it slide: slower than the same bot on a clean floor', async (t) => {
	const clean = await race(t, { world: true })
	const splat = { from: 7000, to: 10000 }
	const slick = await race(t, { world: true, splat })
	assert.ok(slick.slick > 10, `the bot stood on a slick patch (${slick.slick} samples)`)
	const i0 = splat.from / 100, i1 = splat.to / 100
	assert.deepEqual(slick.speeds.slice(0, i0), clean.speeds.slice(0, i0), 'the same race up to the first splat')
	const { PHYS } = await import(pathToFileURL(path.join(CLIENT, 'phys-const.js')).href)
	const cap = PHYS.TOP_ON * 0.85 // R2: top speed × 0.85 on a patch (physics.js WSLICK_TOP)
	const peak = (r) => Math.max(...r.speeds.slice(i0 + 2, i1))
	assert.ok(peak(clean) > cap * 1.03, `the clean run goes faster there (${peak(clean).toFixed(2)} m/s)`)
	assert.ok(peak(slick) <= cap * 1.01, `on the patches the bot keeps under ${cap.toFixed(2)} m/s (${peak(slick).toFixed(2)})`)
	const mean = (a) => a.reduce((x, v) => x + v, 0) / a.length
	assert.ok(mean(slick.speeds.slice(i0 + 2, i1)) < mean(clean.speeds.slice(i0 + 2, i1)), 'slower on average')
})

/* ---------- B34: resume ---------- */

const TRACK = { id: 'stage-oval', length: 40, checkpoints: [0, 15, 30, 45], points: [] }
function roomSetup() {
	const clock = makeClock()
	const out = new Map()
	const closed = new Map()
	const room = createRcRoom({ now: clock.now, timers: clock.timers, send: (c, m) => out.get(c)?.push(m), close: (c, code) => closed.set(c, code) })
	room.setScene({ tracks: [TRACK], bounds: { min: [-20, -1, -30], max: [20, 10, 20] } })
	let n = 0
	const open = () => {
		const c = `c${++n}`
		out.set(c, [])
		room.connect(c)
		return c
	}
	const last = (c, t) => [...out.get(c)].reverse().find((m) => m.t === t)
	const join = (name, extra = {}) => {
		const c = open()
		const r = room.handle(c, { t: 'join', name, color: '#3366ff', ...extra })
		return { c, r, w: last(c, 'welcome'), full: !!last(c, 'full') }
	}
	const lap = (c, from = 0) => {
		for (const cp of [1, 2, 3]) clock.advance(1000), room.handle(c, { t: 's', p: [1, 1, 1], yaw: 0, v: 3, st: 0, cp, lap: from })
		clock.advance(1000)
		for (const o of out.keys()) room.handle(o, { t: 'ping' }) // the others stay alive (housekeeping drops silent sockets)
		room.handle(c, { t: 's', p: [1, 1, 1], yaw: 0, v: 3, st: 0, cp: 0, lap: from + 1 })
	}
	return { clock, room, out, closed, open, last, join, lap }
}

test('B34 RC: the welcome token resumes the same racer (id, slot, colour, lap count, still racing) — never in a state', () => {
	const { clock, room, closed, join, lap } = roomSetup()
	const a = join('Ann'), b = join('Bob')
	assert.match(a.w.resume, /^1\.[A-Za-z0-9_-]{22}$/, 'a 128-bit secret bound to the id')
	assert.notEqual(a.w.resume, b.w.resume)
	room.host('laps', { laps: 3 })
	room.host('start')
	clock.advance(COUNTDOWN_MS)
	lap(a.c)
	assert.equal(JSON.stringify(room.state()).includes(a.w.resume.split('.')[1]), false, 'the token is not in the state')
	room.disconnect(a.c) // the page reloads
	for (let i = 0; i < 5; i++) clock.advance(GRACE_MS / 10), room.handle(b.c, { t: 'ping' })
	const back = join('Someone else', { resume: a.w.resume, color: '#000000' })
	assert.equal(back.w.resumed, true)
	assert.equal(back.w.id, a.w.id)
	assert.deepEqual([back.w.you.name, back.w.you.color, back.w.you.slot], [a.w.you.name, a.w.you.color, a.w.you.slot])
	assert.deepEqual(back.w.you.race, { lap: 1, cp: 0 }, 'the server\'s lap count comes back')
	assert.equal(back.w.resume, a.w.resume, 'the same token for the entry\'s life')
	const me = room.state().players.find((p) => p.id === a.w.id)
	assert.deepEqual([me.connected, me.racing], [true, true])
	assert.equal(room.state().players.length, 2, 'no second entry')
	lap(back.c, 1) // the lap count goes on from 1
	assert.equal(room.order().find((o) => o.id === a.w.id).laps, 2)
	assert.equal(closed.size, 0)
})

test('B34 RC: gone longer than the grace → back on its seat, but out of this race (races the next one)', () => {
	const { clock, room, join } = roomSetup()
	const a = join('Ann'), b = join('Bob')
	room.host('start')
	clock.advance(COUNTDOWN_MS)
	room.disconnect(a.c)
	for (let t = 0; t <= GRACE_MS; t += 2000) clock.advance(2000), room.handle(b.c, { t: 'ping' })
	const back = join('Ann', { resume: a.w.resume })
	assert.equal(back.w.id, a.w.id)
	assert.equal(back.w.you.race, undefined)
	assert.equal(room.state().players.find((p) => p.id === a.w.id).racing, false)
})

test('B34 RC: a half-open old socket is closed (4410) and forgotten; a wrong token is a normal join counted as bad', () => {
	const { room, closed, join, out } = roomSetup()
	const a = join('Ann')
	const back = join('Ann', { resume: a.w.resume }) // the old socket never closed (half-open)
	assert.equal(back.w.id, a.w.id)
	assert.equal(closed.get(a.c), REPLACED_CODE)
	assert.equal(room.connections(), 1, 'the old socket record is gone')
	room.disconnect(a.c) // its late close event drops nothing
	assert.equal(room.state().players[0].connected, true)
	const n = out.get(back.c).length
	room.handle(a.c, { t: 'ready', ready: true })
	assert.equal(out.get(back.c).length, n, 'the old socket speaks for nobody')
	const wrong = join('Eve', { resume: `${a.w.id}.${'A'.repeat(22)}` })
	assert.equal(wrong.r, 'bad', 'counted on the socket\'s bad-message counter')
	assert.notEqual(wrong.w.id, a.w.id)
	assert.equal(wrong.w.resumed, undefined)
	const junk = join('Joe', { resume: '../../etc' })
	assert.equal(junk.r, 'bad')
	assert.ok(junk.w, 'still joins')
	assert.equal(room.state().players.length, 3)
})

test('B34 RC: a kicked player\'s token is void; a lobby drop is a fresh join; a full room never refuses a resuming racer', () => {
	const { clock, room, join } = roomSetup()
	const a = join('Ann')
	room.host('kick', { id: a.w.id })
	const k = join('Ann', { resume: a.w.resume })
	assert.notEqual(k.w.id, a.w.id)
	assert.equal(k.w.resumed, undefined)
	assert.equal(k.r, undefined, 'a stale token is not counted as bad')
	room.disconnect(k.c) // the lobby: a dropped player leaves the list at once (nothing to keep)
	const fresh = join('Ann', { resume: k.w.resume })
	assert.notEqual(fresh.w.id, k.w.id)
	assert.equal(room.state().players.length, 1)
	const ps = [fresh]
	for (let i = 0; i < 9; i++) ps.push(join(`p${i}`))
	room.host('start')
	clock.advance(COUNTDOWN_MS)
	room.disconnect(ps[3].c)
	const late = join('late') // a full room: a joiner takes the longest-gone racer's seat
	assert.equal(late.full, false, 'takes the dropped racer\'s seat')
	const voided = join('p2', { resume: ps[3].w.resume })
	assert.notEqual(voided.w?.id, ps[3].w.id, 'its seat went: its token is void')
	room.disconnect(ps[4].c)
	const back = join('p3', { resume: ps[4].w.resume })
	assert.equal(back.w.id, ps[4].w.id, 'a full room still takes its own racer back')
	assert.equal(room.state().players.filter((p) => p.connected).length, 10)
})

test('B34 RC: 200 reload cycles with the token keep one entry (players and sockets do not grow)', () => {
	const { clock, room, join } = roomSetup()
	let cur = join('Ann')
	const id = cur.w.id
	const token = cur.w.resume
	room.host('start')
	clock.advance(COUNTDOWN_MS)
	for (let i = 0; i < 200; i++) {
		if (i % 2) room.disconnect(cur.c)
		cur = join('Ann', { resume: token })
		assert.equal(cur.w.id, id)
	}
	assert.equal(room.state().players.length, 1)
	assert.equal(room.connections(), 1)
})

test('B34 RC service: a wrong resume token counts on the socket\'s bad-message counter (the 21st bad → 1008); a good one resumes', async (t) => {
	const clock = makeClock()
	const game = createRcGame({ now: clock.now, timers: clock.timers, baker: fakeBaker(), log: () => {}, lanIps: () => [] })
	t.after(() => game.disable())
	game.host({ action: 'enable' })
	await flush()
	const a = fakeWs()
	game.attach(a)
	a.msg({ t: 'join', name: 'Ann', color: '#ff5533' })
	const token = a.got('welcome')[0].resume
	const eve = fakeWs()
	game.attach(eve)
	for (let i = 0; i < 20; i++) eve.emit('message', Buffer.from('not json'), false)
	assert.equal(eve.closedWith, null, '20 bad messages are tolerated')
	eve.msg({ t: 'join', name: 'Eve', resume: `${token.split('.')[0]}.${'Z'.repeat(22)}` })
	assert.equal(eve.closedWith, 1008, 'the wrong token was the 21st')
	assert.equal(a.closedWith, null, 'nothing happened to Ann')
	const back = fakeWs()
	game.attach(back)
	back.msg({ t: 'join', name: 'Ann', resume: token })
	assert.equal(back.got('welcome')[0].id, a.got('welcome')[0].id)
	assert.equal(a.closedWith, 4410, 'the half-open page is closed')
})

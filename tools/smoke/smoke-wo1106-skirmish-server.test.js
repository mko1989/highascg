'use strict'

/**
 * WO-1106 — Stage Skirmish server fixes (work/work-orders/1106_WO_review_fix_list_wo1099_1105_and_older.md), on the
 * pure room with an injected clock and a hand-made arena (toy scale 0.1, one 4-cell-thick block across x = 0 at z = 1):
 *   A3   a stunned bot neither walks nor fires (combat.fire refuses any stunned soldier)
 *   A5   the world adapter's send says whether the game's sendTo handed the message to the socket
 *   A32  `wq` { re: true } (the page's pre-load queue overflowed): that socket's view is served afresh
 *   A24  R4 (a shot sparks a car) starts at the shooter's server position, never the claimed muzzle
 *   B34  at most 10 disconnected players stay listed; the oldest goes first; a join is never refused for it
 *   B36  a silent spectator times out like a player; ≤ 4 sockets per remote address
 *   B55  a silence buys ≤ 0.25 s of movement; a target in a wall or a step through a thick block is refused
 *   B57  no hit / boom while paused, bot rockets in flight are dropped, the spotlight's move waits out the pause
 *   B58  another weapon fires only after the 250 ms raise time
 *   B59  the shooter's spread seed is echoed in `shot`
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')

const ROOT = path.join(__dirname, '..', '..')
const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
require('../../modules/toy-skirmish/register')({ requireCore, coreRoot: ROOT, log: () => {} })
const { createSkRoom, MAX_GHOSTS } = require('../../modules/toy-skirmish/server/sk-room')
const { createSkGame, MAX_PER_ADDRESS } = require('../../modules/toy-skirmish/server/sk-game')
const SW = require('../../modules/toy-skirmish/server/sk-world')
const SS = require('../../modules/toy-skirmish/server/sk-sanitize')
const R = require('../../modules/toy-skirmish/server/sk-rules')

const KEY = Symbol.for('highascg.game-world/1')
const reg = () => globalThis[KEY] || (globalThis[KEY] = { v: 1, games: new Map(), hub: null })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-sk-'))
test.after(() => {
	reg().hub = null
	reg().games.delete('sk')
	fs.rmSync(TMP, { recursive: true, force: true })
})

const ARENA = {
	id: 'box', name: 'Box', floor: 'hall', y: 0, rect: [-2, -2, 2, 2],
	blocks: [{ x: 0, z: 1, w: 0.6, d: 0.12, h: 0.1, yaw: 0, c: 0 }], // z 0.94 … 1.06: four 3 cm cells thick
	spawns: [[-1.5, -1.5], [0, -1.5], [1.5, -1.5], [-1.5, -0.6], [1.5, -0.6], [-1.5, 0.6], [1.5, 0.6], [-1.5, 1.5], [0, 1.6], [1.5, 1.5]]
		.map(([x, z]) => ({ x, z, yaw: 0, team: z < 0 ? 0 : 1 })),
	pickups: [['rattler', -0.5, -0.5], ['health', 0.5, -0.5], ['thumper', 0.5, 0.5]].map(([kind, x, z], id) => ({ id, kind, x, z })),
}
const SCENE = { rev: 'wo1106', scale: 0.1, floors: [{ id: 'hall', y: 0, rect: [-3, -3, 3, 3] }], occ: [], arenas: [ARENA] }

function makeClock() {
	let t0 = 5_000_000
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

function setup(t, o = {}) {
	const clock = makeClock()
	const closed = []
	let world = null
	const room = createSkRoom({ now: clock.now, timers: clock.timers, rng: R.mulberry32(5), send: (c, m) => c.out.push(m), maxPlayers: o.maxPlayers,
		close: (c, code, reason) => closed.push([c.name, code, reason]), ...(o.world ? { tap: (m) => world.onShot(m) } : {}) })
	if (o.world) world = SW.createSkWorld({ room: () => room, send: (c, m) => c.out.push(m), now: clock.now })
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
	const join = (name, extra = {}, talk = true) => {
		const c = { name, out: [] }
		room.connect(c)
		room.handle(c, { t: 'join', name, color: '#ff5533', ...extra })
		if (talk) talking.add(c)
		c.id = c.out.find((m) => m.t === 'welcome')?.id
		c.p = X.players.get(c.id)
		return c
	}
	const place = (c, x, z) => Object.assign(c.p, { pos: [x, z], protectUntil: 0, alive: true, moveAt: clock.now() })
	const last = (c, type) => c.out.filter((m) => m.t === type).at(-1)
	t.after(() => {
		room.dispose()
		assert.equal(clock.pending(), 0, 'no timer survives dispose')
	})
	return { clock, room, X, join, place, last, closed, talking, world: () => world }
}

let n = 5000
const fire = (S, c, w = 'pea', extra = {}) => {
	S.room.handle(c, { t: 'fire', w, n: ++n, p: c.p.pos.slice(), yaw: 0, ...extra })
	return n
}
const shotsOf = (c) => c.out.filter((m) => m.t === 'shot')

test('A3: a stunned bot stands still and holds fire; any stunned soldier\'s fire is refused by the referee', (t) => {
	const S = setup(t)
	const a = S.join('Ann')
	S.room.host('bots', { n: 1 })
	const bot = [...S.X.players.values()].find((p) => p.bot)
	S.clock.advance(1000)
	const p0 = bot.pos.slice()
	S.clock.advance(1000)
	assert.notDeepEqual(bot.pos, p0, 'unstunned it walks (the control)')
	bot.stunUntil = S.clock.now() + 1500
	const p1 = bot.pos.slice()
	S.clock.advance(1000)
	assert.deepEqual(bot.pos, p1, 'stunned: no step')
	assert.equal(bot.mv, 0)
	assert.equal(S.room.combat.fire(bot, { w: 'pea', n: 1, p: bot.pos.slice(), yaw: 0 }), null, 'stunned: no fire (bots go through combat.fire)')
	S.clock.advance(1000)
	assert.notDeepEqual(bot.pos, p1, 'after the stun it walks again')
	assert.ok(S.room.combat.fire(bot, { w: 'pea', n: 2, p: bot.pos.slice(), yaw: 0 }), 'and fires again')
	assert.ok(a.p.alive)
})

test('A5: the world adapter send is false when sendTo skipped it (closed / backpressure), true when handed over', async (t) => {
	const game = createSkGame({ now: () => 1, log: () => {}, lanIps: () => [],
		bakerDeps: { loadProject: () => ({ name: 'Smoke hall', previs: {} }), mvrStore: { get: () => null, mesh: async () => null }, cacheDir: path.join(TMP, 'a5') } })
	t.after(() => game.disable())
	game.host({ action: 'enable' })
	await game.scene().catch(() => null)
	const ws = fakeWs()
	game.attach(ws, '10.9.0.1')
	const A = game.worldAdapter()
	assert.equal(A.send(ws, { t: 'wv', v: 1 }), true)
	assert.equal(JSON.parse(ws.sent.at(-1)).t, 'wv')
	ws.bufferedAmount = 300 * 1024
	assert.equal(A.send(ws, { t: 'wv', v: 1 }), false, 'over 256 KB queued: skipped → false')
	ws.bufferedAmount = 0
	ws.readyState = 3
	assert.equal(A.send(ws, { t: 'wv', v: 1 }), false, 'closed → false')
	ws.readyState = 1
	ws.send = () => {
		throw new Error('gone')
	}
	assert.equal(A.send(ws, { t: 'wv', v: 1 }), false, 'threw → false')
})

test('A24: hub.shot starts at the shooter\'s server position, not the claimed muzzle', (t) => {
	const calls = []
	reg().hub = { shot: (q) => calls.push(q), attach() {}, detach() {}, quality() {} }
	t.after(() => (reg().hub = null))
	const S = setup(t, { world: true })
	const a = S.join('Ann')
	S.clock.advance(R.RULES.protectMs)
	S.place(a, -1.5, -0.6)
	S.room.handle(a, { t: 'fire', w: 'pea', n: ++n, p: [-0.4, 0.3], yaw: 0.2 }) // a claimed muzzle 1.5 m away (inside rect + 2 u)
	assert.equal(calls.length, 1)
	assert.deepEqual([calls[0].o[0], calls[0].o[2]], [-1.5, -0.6])
})

test('A32: `wq` re: true leaves that socket out of exactly one viewers() call (the hub serves it afresh); its cap stays', (t) => {
	const S = setup(t, { world: true })
	const W = S.world()
	const a = S.join('Ann'), b = S.join('Ben')
	W.quality(a, { t: 'wq', n: 20 })
	assert.deepEqual(W.adapter.viewers().map((v) => [v.key.name, v.cap]), [['Ann', 20], ['Ben', 12]])
	W.quality(a, { t: 'wq', re: true })
	assert.deepEqual(W.adapter.viewers().map((v) => v.key.name), ['Ben'], 'left out once')
	assert.deepEqual(W.adapter.viewers().map((v) => [v.key.name, v.cap]), [['Ann', 20], ['Ben', 12]], 'then back with its cap')
	assert.ok(b)
})

test('B34: ≤ 10 disconnected players stay listed (oldest evicted first); joins are never refused for them', (t) => {
	const S = setup(t, { maxPlayers: 3 })
	const a = S.join('Ann'), b = S.join('Ben')
	S.room.host('start')
	S.clock.advance(R.RULES.countdownMs + 100)
	assert.equal(S.room.snapshot().phase, 'match')
	const ghosts = []
	for (let i = 0; i < 30; i++) {
		const g = S.join(`G${i}`)
		assert.ok(g.id, `join ${i} welcomed`)
		g.p.score = i
		ghosts.push(g)
		S.room.disconnect(g)
		S.talking.delete(g)
		S.clock.advance(10)
		assert.ok(S.X.players.size <= 3 + MAX_GHOSTS, `players ${S.X.players.size} after ${i + 1} cycles`)
	}
	const listed = S.room.snapshot().players
	assert.equal(listed.filter((p) => !p.connected).length, MAX_GHOSTS)
	assert.deepEqual(listed.filter((p) => !p.connected).map((p) => p.score), [20, 21, 22, 23, 24, 25, 26, 27, 28, 29], 'the newest ten keep their score')
	assert.ok(S.X.players.has(a.id) && S.X.players.has(b.id), 'connected players are never evicted')
})

test('B36: a silent spectator times out (4408); ≤ 4 sockets per remote address', async (t) => {
	const S = setup(t)
	S.join('Ann')
	const eye = S.join('Eye', { spectator: true }, false)
	const wall = S.join('Wall', { spectator: true })
	assert.equal(S.room.snapshot().spectators, 2)
	S.clock.advance(11000)
	assert.deepEqual(S.closed.filter((c) => c[0] === 'Eye'), [['Eye', 4408, 'silent']])
	assert.equal(S.closed.some((c) => c[0] === 'Wall'), false, 'a pinging spectator stays')
	assert.equal(S.room.snapshot().spectators, 1)
	assert.ok(eye && wall)

	const game = createSkGame({ now: () => 1, log: () => {}, lanIps: () => [],
		maxPerAddress: 4,
		bakerDeps: { loadProject: () => ({ name: 'Smoke hall', previs: {} }), mvrStore: { get: () => null, mesh: async () => null }, cacheDir: path.join(TMP, 'b36') } })
	t.after(() => game.disable())
	game.host({ action: 'enable' })
	await game.scene().catch(() => null)
	assert.equal(MAX_PER_ADDRESS, 0, 'off by default (NAT\'d guest Wi-Fi shares one address)')
	const same = Array.from({ length: 5 }, () => fakeWs())
	same.forEach((ws) => game.attach(ws, '::ffff:10.0.0.7'))
	assert.deepEqual(same.map((ws) => ws.closedWith), [null, null, null, null, 1013])
	assert.equal(game.socketCount(), 4)
	const other = fakeWs()
	game.attach(other, '10.0.0.8')
	assert.equal(other.closedWith, null, 'another address is not counted')
	const unknown = Array.from({ length: 5 }, () => fakeWs())
	unknown.forEach((ws) => game.attach(ws))
	assert.ok(unknown.every((ws) => ws.closedWith === null), 'no address known: no per-address cap')
	same[0].emit('close')
	const again = fakeWs()
	game.attach(again, '::ffff:10.0.0.7')
	assert.equal(again.closedWith, null, 'a closed socket frees its place')
	const open = createSkGame({ now: () => 1, log: () => {}, lanIps: () => [],
		bakerDeps: { loadProject: () => ({ name: 'Smoke hall', previs: {} }), mvrStore: { get: () => null, mesh: async () => null }, cacheDir: path.join(TMP, 'b36d') } })
	t.after(() => open.disable())
	open.host({ action: 'enable' })
	await open.scene().catch(() => null)
	const six = Array.from({ length: 6 }, () => fakeWs())
	six.forEach((ws) => open.attach(ws, '10.0.0.9'))
	assert.ok(six.every((ws) => ws.closedWith === null), 'default: no per-address cap')
})

test('B55: a silence buys ≤ 0.25 s of movement; a target in a wall or a step through a thick block is refused', (t) => {
	const S = setup(t)
	const a = S.join('Ann')
	S.clock.advance(R.RULES.protectMs)
	S.place(a, -1.5, -1.5)
	S.clock.advance(9000)
	S.room.handle(a, { t: 's', p: [1.5, -1.5], yaw: 0, mv: 1 })
	assert.ok(Math.abs(a.p.pos[0] - (-1.5 + R.SOLDIER.maxSpeed * 0.1 * 0.25)) < 1e-9, `9 s of silence then 3 m: clamped to 6 u/s × 0.25 s (${a.p.pos[0]})`)
	S.place(a, 0, 0.9)
	S.clock.advance(100)
	S.room.handle(a, { t: 's', p: [0, 0.97], yaw: 0, mv: 1 })
	assert.deepEqual(a.p.pos, [0, 0.9], 'a target inside the block: refused')
	S.place(a, 0, 0.92)
	S.clock.advance(300)
	S.room.handle(a, { t: 's', p: [0, 1.07], yaw: 0, mv: 1 })
	assert.deepEqual(a.p.pos, [0, 0.92], 'a 15 cm step through the 12 cm block: refused')
	S.room.handle(a, { t: 's', p: [0.05, 0.9], yaw: 0, mv: 1 })
	assert.deepEqual(a.p.pos, [0.05, 0.9], 'an ordinary step is accepted')
	S.place(a, 0.33, 0.92)
	S.clock.advance(50)
	S.room.handle(a, { t: 's', p: [0.34, 0.96], yaw: 0, mv: 1 })
	assert.deepEqual(a.p.pos, [0.34, 0.96], 'past the block\'s corner (its edge is 4 cm away): accepted')
})

test('B57: no hit / boom while paused; bot rockets in flight dropped; the spotlight move waits out the pause', (t) => {
	const S = setup(t)
	const a = S.join('Ann'), b = S.join('Ben')
	S.clock.advance(R.RULES.protectMs)
	S.place(a, -1.5, -0.6), S.place(b, -1.5, 0.4)
	const pea = fire(S, a)
	a.p.w.thumper = 4
	S.clock.advance(300)
	const rocket = fire(S, a, 'thumper')
	S.room.host('pause', { on: true })
	assert.equal(S.room.combat.hit(a.p, { n: pea, id: b.id, k: 1 }), false, 'paused: no hit')
	assert.equal(S.room.combat.boom(a.p, { n: rocket, p: [-1.5, 0.3] }), false, 'paused: no boom')
	assert.equal(b.p.hp, 100)
	S.room.host('pause', { on: false })
	assert.equal(S.room.combat.hit(a.p, { n: pea, id: b.id, k: 1 }), true, 'resumed: the same hit lands')

	S.room.host('bots', { n: 1 })
	const bot = [...S.X.players.values()].find((p) => p.bot)
	bot.ai.rockets.push({ n: 1, at: S.clock.now() + 60000, p: [0, 0] })
	S.room.host('pause', { on: true })
	S.clock.advance(300)
	assert.deepEqual(bot.ai.rockets, [], 'paused: the bot\'s rockets in flight are gone')
	S.room.host('pause', { on: false })

	S.room.host('mode', { mode: 'spot' })
	S.clock.advance(500)
	const sp = S.room.snapshot().spot
	assert.ok(sp, 'the pool is placed')
	S.room.host('pause', { on: true })
	S.clock.advance(60000)
	assert.deepEqual([S.room.snapshot().spot.x, S.room.snapshot().spot.z], [sp.x, sp.z], 'it does not move in the pause')
	S.room.host('pause', { on: false })
	assert.equal(S.room.snapshot().spot.movesAt, sp.movesAt + 60000, 'its move is shifted by the pause')
})

test('B58: another weapon fires only after the 250 ms raise time; the same weapon keeps its own interval', (t) => {
	const S = setup(t)
	const a = S.join('Ann'), b = S.join('Ben')
	S.clock.advance(R.RULES.protectMs)
	S.place(a, -1.5, -0.6)
	Object.assign(a.p.w, { rattler: 60, scatter: 8, longshot: 5, thumper: 4 })
	const n0 = shotsOf(b).length
	fire(S, a, 'pea')
	for (const w of ['rattler', 'scatter', 'longshot', 'thumper']) fire(S, a, w)
	assert.equal(shotsOf(b).length - n0, 1, 'every held weapon in the same millisecond: only the first')
	S.clock.advance(200)
	fire(S, a, 'rattler')
	assert.equal(shotsOf(b).length - n0, 1, '200 ms later: still raising')
	S.clock.advance(30)
	fire(S, a, 'rattler')
	assert.equal(shotsOf(b).length - n0, 2, '230 ms (the 10 % tolerance): the rattler fires')
	S.clock.advance(90)
	fire(S, a, 'rattler')
	assert.equal(shotsOf(b).length - n0, 3, 'the same weapon: its own 85 ms interval')
})

test('B59: the shooter\'s spread seed is echoed in `shot`; a bad one is replaced by the server\'s', (t) => {
	assert.equal(SS.cleanFire({ t: 'fire', w: 'pea', n: 1, p: [0, 0], yaw: 0, seed: 4294967295 }).seed, 4294967295)
	for (const seed of [-1, 4294967296, 1.5, '7', null]) assert.equal('seed' in SS.cleanFire({ t: 'fire', w: 'pea', n: 1, p: [0, 0], yaw: 0, seed }), false)
	const S = setup(t)
	const a = S.join('Ann'), b = S.join('Ben')
	S.clock.advance(R.RULES.protectMs)
	S.place(a, -1.5, -0.6)
	fire(S, a, 'pea', { seed: 123456789 })
	assert.equal(S.last(b, 'shot').seed, 123456789)
	S.clock.advance(400)
	fire(S, a, 'pea', { seed: -5 })
	const s = S.last(b, 'shot')
	assert.ok(Number.isInteger(s.seed) && s.seed >= 0 && s.seed !== -5, 'a bad seed: the server draws one')
})

function fakeWs() {
	const ws = new EventEmitter()
	Object.assign(ws, { readyState: 1, bufferedAmount: 0, sent: [], closedWith: null })
	ws.send = (s) => ws.sent.push(s)
	ws.close = (code) => {
		if (ws.closedWith != null) return
		ws.closedWith = code ?? 1000
		ws.readyState = 3
	}
	return ws
}

'use strict'

/**
 * WO-1081 — Stage Skirmish bots (work/notes/skirmish-game-contract.md §8) on a generated arena of the default hall (baked
 * into a temp cache): the host's count and the free places (a joining guest takes a bot's place), the bot timer only
 * while bots exist, and one simulated minute of a match (injected clock and timers) watched through a spectator:
 * bots move along passable cells, fire only at an enemy in line of sight within 45 u, never faster than the weapon's
 * interval and never a weapon they do not hold, and they score.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
require('../../modules/toy-skirmish/register')({ requireCore, coreRoot: ROOT, log: () => {} })
const { kit } = require('../../modules/toy-skirmish/server/sk-kit')
const { createSkScene } = require('../../modules/toy-skirmish/server/sk-scene')
const { createSkRoom } = require('../../modules/toy-skirmish/server/sk-room')
const R = require('../../modules/toy-skirmish/server/sk-rules')
const G = require('../../modules/toy-skirmish/server/sk-grid')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1081-bots-'))
let scene = null

test.before(async () => {
	const baker = kit().createSceneBaker({ loadProject: () => ({ name: 'Smoke hall', previs: {} }), mvrStore: { get: () => null, mesh: async () => null },
		cacheDir: path.join(TMP, 'cache'), log: () => {} })
	scene = (await createSkScene({ baker, pause: async () => {} }).get()).json
})
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

function makeClock() {
	let t0 = 9_000_000
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

function setup(t, onSend = () => {}) {
	const clock = makeClock()
	const room = createSkRoom({ now: clock.now, timers: clock.timers, rng: R.mulberry32(3), send: (c, m) => (c.out.push(m), onSend(m)) })
	room.setScene(scene)
	t.after(() => {
		room.dispose()
		assert.equal(clock.pending(), 0, 'no timer survives dispose')
	})
	const join = (name, extra = {}) => {
		const c = { name, out: [] }
		room.connect(c)
		room.handle(c, { t: 'join', name, ...extra })
		return c
	}
	return { clock, room, X: room.ctx, join }
}

test('the host count, the free places and the bot timer', (t) => {
	const { room, join } = setup(t)
	assert.equal(room.timers().bots, false, 'no bots → no bot timer')
	assert.deepEqual(room.host('bots', { n: 6 }), { ok: true })
	let st = room.snapshot()
	assert.equal(st.bots, 6)
	assert.deepEqual(st.players.map((p) => p.name), ['Sgt Sprocket', 'Pip Pebble', 'Cpl Crumb', 'Major Mallow', 'Cadet Button', 'Lt Biscuit'])
	assert.ok(st.players.every((p) => p.bot && p.connected), 'bots are in play')
	assert.equal(room.timers().bots, true)
	const humans = []
	for (let n = 0; n < 5; n++) humans.push(join(`H${n}`))
	st = room.snapshot()
	assert.equal(st.players.filter((p) => p.bot).length, 5, 'the 5th guest takes a bot\'s place (10 players)')
	assert.equal(st.bots, 6, 'the wish stays')
	for (const h of humans.slice(0, 3)) room.disconnect(h)
	assert.equal(room.snapshot().players.filter((p) => p.bot).length, 6, 'places given back')
	const bot = room.snapshot().players.find((p) => p.bot)
	assert.deepEqual(room.host('kick', { id: bot.id }), { ok: true })
	assert.equal(room.snapshot().bots, 5, 'a kicked bot is one fewer wanted')
	room.host('bots', { n: 0 })
	assert.equal(room.snapshot().players.filter((p) => p.bot).length, 0)
	assert.equal(room.timers().bots, false, 'no bots → the timer is gone')
})

test('a simulated minute: bots never overlap a solid cell, fire only with line of sight, obey intervals and ammo, and score', (t) => {
	const shots = []
	let ctx = null
	const { clock, room, X, join } = setup(t, (m) => {
		if (m.t !== 'shot' || !ctx) return
		const p = ctx.players.get(m.id)
		const enemies = [...ctx.players.values()].filter((q) => q !== p && q.alive && q.pos)
		shots.push({ m, w: { ...p.w }, at: ctx.now(), seen: enemies.some((q) => Math.hypot(q.pos[0] - p.pos[0], q.pos[1] - p.pos[1]) <= 45 * ctx.u + 1e-9 &&
			G.lineClear(ctx.grid, p.pos[0], p.pos[1], q.pos[0], q.pos[1])) })
	})
	ctx = X
	const watcher = join('Watcher', { spectator: true })
	room.host('arena', { id: scene.arenas.find((a) => Math.max(a.rect[2] - a.rect[0], a.rect[3] - a.rect[1]) <= 6.5)?.id ?? scene.arenas[0].id })
	room.host('bots', { n: 4 })
	room.host('start')
	const moved = new Map()
	const lastPos = new Map()
	let offGrid = 0, samples = 0
	for (let s = 0; s < 600; s++) {
		clock.advance(100)
		for (const p of X.players.values()) {
			if (!p.alive || !p.pos) continue
			samples++
			if (!G.clearAt(X.grid, p.pos[0], p.pos[1], R.SOLDIER.radius * X.u * 0.98)) offGrid++ // 2 %: positions are rounded to 0.1 mm
			const was = lastPos.get(p.id)
			if (was) moved.set(p.id, (moved.get(p.id) || 0) + Math.hypot(p.pos[0] - was[0], p.pos[1] - was[1]))
			lastPos.set(p.id, p.pos.slice())
		}
		if (room.snapshot().phase !== 'match' && s > 40) break
	}
	t.diagnostic(`shots ${shots.length}, kills ${watcher.out.filter((m) => m.t === 'kill').length}, booms ${watcher.out.filter((m) => m.t === 'boom').length}, picks ${watcher.out.filter((m) => m.t === 'pk').length}`)
	assert.equal(offGrid, 0, `no bot overlaps a solid cell (${samples} samples)`)
	for (const [id, d] of moved) assert.ok(d > 20 * X.u, `bot ${id} walked ${(d / X.u).toFixed(0)} u`)
	assert.ok(shots.length > 10, 'they fight')
	assert.ok(shots.every((s) => s.seen), 'every shot had an enemy in sight')
	const lastBy = new Map()
	for (const s of shots) {
		assert.ok(s.w[s.m.w] !== undefined, `holds ${s.m.w}`)
		assert.ok(s.w[s.m.w] === -1 || s.w[s.m.w] >= 0, 'ammo never below zero')
		const k = `${s.m.id}|${s.m.w}`
		if (lastBy.has(k)) assert.ok(s.at - lastBy.get(k) >= R.WEAPONS[s.m.w].interval * 1000 - 1e-6, `${s.m.w} interval`)
		lastBy.set(k, s.at)
	}
	const kills = watcher.out.filter((m) => m.t === 'kill')
	assert.ok(kills.length > 0, 'somebody was fragged')
	const st = room.snapshot()
	assert.ok(st.players.some((p) => p.kills > 0), 'and it counted')
	for (const m of watcher.out.filter((x) => x.t === 'dmg')) assert.ok(m.hp >= 0 && m.hp < 100)
})

test('bot pathing: A* over the passable cells joins every spawn and pickup of every arena', (t) => {
	const { room, X } = setup(t)
	for (const a of scene.arenas) {
		room.host('arena', { id: a.id })
		const s0 = a.spawns[0]
		for (const p of [...a.spawns, ...a.pickups]) {
			const route = G.findPath(X.grid, X.mask, s0.x, s0.z, p.x, p.z)
			assert.ok(route && route.length >= 1, `${a.id}: route to (${p.x}, ${p.z})`)
			for (let i = 1; i < route.length; i++) {
				const q = G.cellIndex(X.grid, route[i][0], route[i][1])
				assert.ok(q >= 0 && X.mask[q] === 1, `${a.id}: route on passable cells`)
				assert.ok(Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]) <= X.grid.cell * Math.SQRT2 + 1e-6 || i === route.length - 1,
					`${a.id}: route steps are neighbour cells`)
			}
		}
	}
})

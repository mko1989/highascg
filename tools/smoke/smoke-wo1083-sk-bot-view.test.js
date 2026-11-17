'use strict'

/**
 * WO-1083 — Stage Skirmish: a bot never out-sees a player. The view rule (server/sk-view.js) is the client's follow
 * camera (client/cam.js) — pinned here by its constants and by projecting edge points back through the client's own
 * `screenToPlane` — and the bots (sk-bots.js + sk-bot-aim.js) and the referee (sk-combat.js) obey it: a bot and a
 * target on a hand-made arena (toy scale 0.1) at distances beyond, at and inside the limit, sideways and up-screen,
 * with and without a block between; a bot holding every weapon (Longshot range 120 u) fires at nothing outside the
 * frame or behind cover, and the referee refuses bot hits / splash outside it while a human's stay as before.
 * Also: reaction time, turn rate, a lost target is not tracked, and the aim error grows with distance.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
require('../../modules/toy-skirmish/register')({ requireCore, coreRoot: ROOT, log: () => {} })
const { createSkRoom } = require('../../modules/toy-skirmish/server/sk-room')
const R = require('../../modules/toy-skirmish/server/sk-rules')
const V = require('../../modules/toy-skirmish/server/sk-view')
const A = require('../../modules/toy-skirmish/server/sk-bot-aim')

const U = 0.1
const BOT_AT = [3, 3] // metres: the middle of a 60 × 60 u arena

function scene(blocks = []) {
	const arena = { id: 'open', name: 'Open', floor: 'hall', y: 0, rect: [0, 0, 6, 6], blocks,
		spawns: [{ x: BOT_AT[0], z: BOT_AT[1], yaw: 0, team: 0 }], pickups: [] }
	return { rev: 'wo1083', scale: U, floors: [{ id: 'hall', y: 0, rect: [0, 0, 6, 6] }], occ: [], arenas: [arena] }
}

function makeClock() {
	let t0 = 7_000_000
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

/** A room with one bot (every weapon, full ammo) and one idle human target at offset [dx, dz] u from the bot. */
function setup(t, { blocks = [], level = 'normal', botYaw = 0 } = {}) {
	const clock = makeClock()
	const out = []
	const room = createSkRoom({ now: clock.now, timers: clock.timers, rng: R.mulberry32(11), send: (c, m) => out.push(m) })
	room.setScene(scene(blocks))
	t.after(() => room.dispose())
	const X = room.ctx
	const c = { out: [] }
	room.connect(c)
	room.handle(c, { t: 'join', name: 'Target' })
	const human = [...X.players.values()].find((p) => !p.bot)
	room.host('bots', { n: 1 })
	room.host('botlevel', { level })
	const bot = [...X.players.values()].find((p) => p.bot)
	const arm = () => {
		bot.w = { pea: -1, rattler: 180, scatter: 32, longshot: 20, thumper: 16 }
		bot.pos = BOT_AT.slice()
		bot.yaw = botYaw
		bot.ai.aim = botYaw
		bot.protectUntil = 0
	}
	arm()
	const place = (dx, dz) => {
		human.pos = [BOT_AT[0] + dx * U, BOT_AT[1] + dz * U]
		human.protectUntil = 0
		human.alive = true
		human.hp = 100
	}
	/** Run ms of bot ticks keeping both soldiers where they were put; → { shots, dmg } of the bot in that time. */
	const run = (ms) => {
		const n0 = out.length
		for (let k = 0; k < ms / 100; k++) {
			const keep = human.pos.slice()
			clock.advance(100)
			room.handle(c, { t: 'ping', c: 1 })
			bot.pos = BOT_AT.slice()
			human.pos = keep
			if (!human.alive) place((keep[0] - BOT_AT[0]) / U, (keep[1] - BOT_AT[1]) / U)
		}
		const mine = out.slice(n0)
		return { shots: mine.filter((m) => m.t === 'shot' && m.id === bot.id), dmg: mine.filter((m) => m.t === 'dmg' && m.by === bot.id && m.id === human.id),
			booms: mine.filter((m) => m.t === 'boom' && m.by === bot.id) }
	}
	return { clock, room, X, bot, human, place, run, arm, out }
}

test('the server view constants are the client camera\'s (client/cam.js)', () => {
	const cam = fs.readFileSync(path.join(ROOT, 'modules/toy-skirmish/client/cam.js'), 'utf8')
	const num = (name) => Number(cam.match(new RegExp(`export const ${name} = ([0-9.]+)`))[1])
	assert.equal(V.VIEW.HEIGHT_U, num('HEIGHT_U'))
	assert.equal(V.VIEW.PITCH_DEG, num('PITCH_DEG'))
	assert.equal(V.VIEW.FOV_DEG, num('FOV_DEG'))
	assert.equal(V.VIEW.LEAD_U, num('LEAD_U'))
	const loop = fs.readFileSync(path.join(ROOT, 'modules/toy-skirmish/client/loop.js'), 'utf8')
	assert.match(loop, /want = followCam\(G\.my\.x, y, G\.my\.z, G\.s, G\.alive \? fwd\(G\.my\.yaw\) : null\)/, 'the player camera is followCam at its defaults, leaning at the aim')
})

test('ndcOf is the exact inverse of the client\'s screenToPlane (camera leaning at the point)', async () => {
	const cam = await import(path.join(ROOT, 'modules/toy-skirmish/client/cam.js'))
	for (let k = 0; k < 72; k++) {
		const a = (k * 5 * Math.PI) / 180
		const dir = [Math.sin(a), -Math.cos(a)]
		for (const r of [1, 3, V.reachAlong(dir[0], dir[1], false)]) {
			const p = [dir[0] * r, dir[1] * r]
			const n = V.ndcOf(p[0], p[1])
			const pose = cam.followCam(0, 0, 0, 1, dir)
			const back = cam.screenToPlane(pose, n, V.VIEW.ASPECT, cam.FOV_DEG, 0)
			assert.ok(Math.hypot(back[0] - p[0], back[1] - p[1]) < 1e-6, `${k * 5}° at ${r.toFixed(2)} u`)
		}
	}
})

test('the view limit: about 4.75 u up / down screen, 6.85 u sideways, never past 7.1 u — far inside every weapon range', () => {
	const near = (v, want) => assert.ok(Math.abs(v - want) < 0.05, `${v} ≈ ${want}`)
	near(V.reachAlong(0, -1), 4.75) // screen-up (upstage); the down-screen side is the shorter one
	near(V.reachAlong(0, 1), 4.75)
	near(V.reachAlong(1, 0), 6.85)
	near(V.reachAlong(-1, 0), 6.85)
	near(V.reachAlong(0, -1, false), 5.94) // one way only: a player sees farther up-screen than down
	near(V.reachAlong(0, 1, false), 4.75)
	assert.ok(V.REACH_U <= 7.1)
	for (const W of Object.values(R.WEAPONS)) assert.ok(W.range > V.REACH_U)
	assert.equal(V.botSees([0, 0], [0.68, 0], U), true)
	assert.equal(V.botSees([0, 0], [0.70, 0], U), false)
	assert.equal(V.botSees([0, 0], [0, -0.47], U), true)
	assert.equal(V.botSees([0, 0], [0, -0.49], U), false)
})

for (const [label, dir, limit] of [['sideways', [1, 0], 6.85], ['up-screen', [0, -1], 4.75], ['down-screen', [0, 1], 4.75]]) {
	test(`a bot holding every weapon fires at nothing beyond the view ${label}, and at a target inside it`, (t) => {
		const { place, run, human } = setup(t)
		for (const d of [25, 12, 8, limit + 0.15]) {
			place(dir[0] * d, dir[1] * d)
			const r = run(2000)
			assert.equal(r.shots.length, 0, `no shot at ${d} u ${label}`)
			assert.equal(r.dmg.length, 0, `no damage at ${d} u`)
			assert.equal(human.hp, 100)
		}
		place(dir[0] * (limit - 0.15), dir[1] * (limit - 0.15))
		const edge = run(3000)
		assert.ok(edge.shots.length > 0, `fires at the limit (${(limit - 0.15).toFixed(2)} u ${label})`)
		place(dir[0] * 3, dir[1] * 3)
		const close = run(3000)
		assert.ok(close.shots.length > 0 && close.dmg.length > 0, 'fires and hurts at 3 u')
	})
}

test('a block between them: no shot, no damage, even at 3 u; the same spot in the open is a fight', (t) => {
	// a 2 × 0.6 u block (0.8 u tall) across the line at 1.5 u up-screen of the bot
	const wall = [{ x: BOT_AT[0], z: BOT_AT[1] - 0.15, w: 0.2, d: 0.06, h: 0.08, yaw: 0, c: 0 }]
	const { place, run } = setup(t, { blocks: wall })
	place(0, -3)
	const r = run(4000)
	assert.equal(r.shots.length, 0)
	assert.equal(r.dmg.length, 0)
	place(1.5, 0)
	assert.ok(run(3000).shots.length > 0, 'beside the block it fires')
})

test('the referee: a bot hit or splash outside the view is refused whatever the weapon; a human\'s is not', (t) => {
	const { clock, room, bot, human, place } = setup(t)
	const combat = room.combat
	let n = 1000
	const fireAt = (p, w, dx, dz) => {
		p.lastFire = {}
		p.fireW = null // WO-1106 B58: and the raise-time gap of a weapon switch
		return combat.fire(p, { w, n: ++n, p: p.pos.slice(), yaw: R.yawTo(p.pos[0], p.pos[1], p.pos[0] + dx, p.pos[1] + dz) })
	}
	for (const [dx, dz] of [[30, 0], [0, -10], [8, 0], [0, 5]]) {
		place(dx, dz)
		const rec = fireAt(bot, 'longshot', dx, dz)
		assert.ok(rec, 'the fire itself is accepted (ammo, interval)')
		assert.equal(combat.hit(bot, { n: rec.n, id: human.id, k: 1 }), false, `bot longshot at (${dx}, ${dz}) u refused`)
	}
	place(6, 0)
	const rec = fireAt(bot, 'longshot', 6, 0)
	assert.equal(combat.hit(bot, { n: rec.n, id: human.id, k: 1 }), true, 'inside the view: accepted')
	// a human keeps the contract's rule (range + 3 u, the tolerant line): blind fire at 30 u is legal for a player
	human.w.longshot = 5
	place(30, 0)
	human.alive = true
	bot.hp = 100
	const hrec = fireAt(human, 'longshot', -30, 0)
	assert.equal(combat.hit(human, { n: hrec.n, id: bot.id, k: 1 }), true, 'a human\'s 30 u hit stands')
	// beyond range + slack nobody hits: 124 u apart (the arena is 60 u — put them there by hand)
	bot.pos = [0, 0]
	human.pos = [12.4, 0]
	const far = fireAt(human, 'longshot', 1, 0)
	assert.equal(combat.hit(human, { n: far.n, id: bot.id, k: 1 }), false, 'past range + 3 u: refused for anyone')
	// splash: a bot rocket bursting next to a soldier it could not see from where it fired spares him
	bot.pos = BOT_AT.slice()
	for (const [d, hurt] of [[9, false], [6, true]]) {
		place(d, 0)
		bot.hp = 100
		const rr = fireAt(bot, 'thumper', 1, 0)
		clock.advance(500) // 11 u of flight
		bot.pos = BOT_AT.slice()
		place(d, 0)
		assert.equal(combat.boom(bot, { n: rr.n, p: [human.pos[0] - 0.5 * U, human.pos[1]] }), true, 'the burst itself is shown')
		assert.equal(human.hp < 100, hurt, `splash on a soldier ${d} u away: ${hurt ? 'hurt' : 'spared'}`)
	}
})

test('reaction time and turn rate: the first shot waits for both; a lost target is not tracked or shot at', (t) => {
	const { place, run, bot, clock } = setup(t, { botYaw: Math.PI / 2 }) // aim at −X: the target sits at +X (half a turn away)
	place(4, 0)
	const t0 = clock.now()
	let first = null
	for (let k = 0; k < 30 && first == null; k++) {
		const r = run(100)
		if (r.shots.length) first = clock.now() - t0
	}
	const L = A.LEVELS.normal
	const turnMs = ((180 - L.cone) / L.turn) * 1000
	assert.ok(first != null, 'it fires eventually')
	assert.ok(first >= Math.max(L.react[0], turnMs), `first shot after ${first} ms ≥ reaction ${L.react[0]} / turn ${turnMs.toFixed(0)} ms`)
	// the target steps out of view: the aim stops following it and no shot leaves
	place(20, 0)
	const aim0 = bot.ai.aim
	const r = run(1500)
	assert.equal(r.shots.length, 0)
	assert.equal(bot.ai.target, null, 'forgotten')
	assert.ok(Math.abs(bot.ai.aim - aim0) < 1e-9, 'not tracking (it stands still)')
})

test('aim error grows with distance and with an easier level', () => {
	const X = { rng: () => 1 } // the far edge of the uniform error
	const p = { ai: { aim: 0 } }
	const e = (d, l) => A.shotYaw(X, p, d, A.LEVELS[l])
	assert.ok(e(2, 'normal') < e(6, 'normal'))
	assert.ok(e(4, 'hard') < e(4, 'normal') && e(4, 'normal') < e(4, 'easy'))
	for (const l of A.LEVEL_IDS) assert.ok(A.LEVELS[l].turn <= 720 && A.LEVELS[l].react[0] >= 200, `${l} stays humanlike`)
})

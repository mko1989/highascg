'use strict'

/**
 * WO-1081 Stage Skirmish — browser client, shots and score logic (modules/toy-skirmish/client/shots.js, score.js;
 * contract work/notes/skirmish-game-contract.md §3/§5/§7):
 *  - the spread from a shot's `seed` is deterministic and bit-identical to the server's (sk-rules.js pelletYaws);
 *    one draw per pellet, every pellet inside ± spread / 2, the Scatter fires 8, the Longshot never spreads;
 *  - hitscan: the first soldier on the ray is hit (radius 0.18 u), never the shooter, never one behind a solid;
 *  - the Thumper rocket: same path from the same shot on every client, swept soldier hits, wall impact, 4 s expiry,
 *    splash 90 → 0 over 4 u (× 0.5 on its owner);
 *  - scoreboard order / rank / leader, team grouping, auto-switch, weapon cycling, keys, minimap fit, clock.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const REPO = path.join(__dirname, '..', '..')
const SK = path.join(REPO, 'modules', 'toy-skirmish', 'client')
const KIT = pathToFileURL(path.join(REPO, 'modules', 'rc-game', 'client') + path.sep).href
registerHooks({
	resolve(spec, ctx, next) {
		if (spec.startsWith('./kit/') && ctx.parentURL && ctx.parentURL.includes('/toy-skirmish/client/'))
			return next(KIT + spec.slice(6), ctx)
		return next(spec, ctx)
	},
})
const load = (f) => import(pathToFileURL(path.join(SK, f)).href)
const SERVER_RULES = path.join(REPO, 'modules', 'toy-skirmish', 'server', 'sk-rules.js')

let S, K, C, G

before(async () => {
	S = await load('shots.js')
	K = await load('score.js')
	C = await load('sk-const.js')
	G = await load('grid.js')
})

/** An open 6 × 6 m arena (no occ → plain grid), optionally with one block. */
function arena(blocks = []) {
	return G.buildArenaGrid({ floor: 'x', y: 0, rect: [-3, -3, 3, 3], blocks }, [], 0.1)
}

describe('WO-1081 Skirmish client: spread', () => {
	it('mulberry32 is deterministic per seed', () => {
		const a = S.mulberry32(12345)
		const b = S.mulberry32(12345)
		const c = S.mulberry32(54321)
		const xs = Array.from({ length: 20 }, () => a())
		assert.deepEqual(xs, Array.from({ length: 20 }, () => b()))
		assert.notDeepEqual(xs, Array.from({ length: 20 }, () => c()))
		for (const x of xs) assert.ok(x >= 0 && x < 1)
	})

	it('pellet yaws: count, bounds, longshot straight', () => {
		const sc = S.pelletYaws('scatter', 0.5, 99)
		assert.equal(sc.length, 8)
		const half = (C.WEAPONS.scatter.spread * Math.PI) / 360
		for (const y of sc) assert.ok(Math.abs(y - 0.5) <= half + 1e-12)
		assert.deepEqual(S.pelletYaws('scatter', 0.5, 99), sc)
		assert.notDeepEqual(S.pelletYaws('scatter', 0.5, 100), sc)
		assert.deepEqual(S.pelletYaws('longshot', 1.25, 7), [1.25])
		assert.equal(S.pelletYaws('pea', 0, 1).length, 1)
		assert.deepEqual(S.pelletYaws('nope', 2, 1), [2])
	})

	it('is bit-identical to the server (sk-rules.js) when that file is present', (t) => {
		let R
		try {
			R = require(SERVER_RULES)
		} catch {
			return t.skip('server half not installed')
		}
		for (const w of ['pea', 'rattler', 'scatter', 'longshot']) {
			for (const seed of [0, 1, 42, 2147483646, 987654321]) {
				const yaw = (seed % 628) / 100 - 3.14
				assert.deepEqual(S.pelletYaws(w, yaw, seed), R.pelletYaws(w, yaw, seed), `${w} seed ${seed}`)
			}
		}
	})
})

describe('WO-1081 Skirmish client: hitscan', () => {
	const s = 0.1
	it('hits the first soldier on the ray, not the shooter', () => {
		const g = arena()
		// yaw 0 faces −Z: from (0, 2) towards (0, −3)
		const soldiers = [
			{ id: 'me', x: 0, z: 2 },
			{ id: 'far', x: 0, z: -1 },
			{ id: 'near', x: 0.005, z: 1 },
		]
		const tr = S.traceShot({ id: 'me', w: 'longshot', p: [0, 2], yaw: 0, seed: 1 }, g, soldiers, s)
		assert.equal(tr.rays.length, 1)
		assert.equal(tr.rays[0].hit, 'near')
		assert.equal(tr.hits.get('near'), 1)
		assert.ok(!tr.hits.has('far'))
		assert.ok(Math.abs(tr.rays[0].len - (1 - Math.sqrt(0.018 ** 2 - 0.005 ** 2))) < 1e-9)
	})

	it('misses a soldier just outside 0.18 u and stops at the range', () => {
		const miss = S.traceShot({ id: 'me', w: 'longshot', p: [0, 2], yaw: 0, seed: 0 }, null, [{ id: 'x', x: 0.0185, z: 1 }], 0.1)
		assert.equal(miss.rays[0].hit, null)
		assert.equal(miss.hits.size, 0)
		const hit = S.traceShot({ id: 'me', w: 'longshot', p: [0, 2], yaw: 0, seed: 0 }, null, [{ id: 'x', x: 0.0175, z: 1 }], 0.1)
		assert.equal(hit.rays[0].hit, 'x')
		const tr2 = S.traceShot({ id: 'me', w: 'scatter', p: [0, 0], yaw: 0, seed: 5 }, null, [], 0.1)
		for (const r of tr2.rays) assert.ok(Math.abs(r.len - 1.6) < 1e-9) // 16 u at scale 0.1
	})

	it('a solid between stops the ray before the soldier', () => {
		const g = arena([{ x: 0, z: 0, w: 0.6, d: 0.12, h: 0.1, yaw: 0, c: 0 }])
		const tr = S.traceShot({ id: 'me', w: 'longshot', p: [0, 1], yaw: 0, seed: 1 }, g, [{ id: 'v', x: 0, z: -1 }], 0.1)
		assert.equal(tr.rays[0].hit, null)
		assert.ok(tr.rays[0].len < 1.0 && tr.rays[0].len > 0.85, `len ${tr.rays[0].len}`)
	})

	it('scatter counts pellets per soldier (≤ 8)', () => {
		const tr = S.traceShot({ id: 'me', w: 'scatter', p: [0, 0.3], yaw: 0, seed: 77 }, arena(), [{ id: 'v', x: 0, z: 0 }], 0.1)
		const k = tr.hits.get('v')
		assert.ok(k >= 1 && k <= 8, `pellets ${k}`)
	})
})

describe('WO-1081 Skirmish client: rocket', () => {
	const s = 0.1
	const shot = { id: 'me', n: 3, w: 'thumper', p: [0, 2.5], yaw: 0, ts: 1000, seed: 0 }

	it('flies the same path on every client', () => {
		const a = S.createRocket(shot, arena(), s)
		const b = S.createRocket(shot, arena(), s)
		for (const t of [0, 0.1, 0.5, 1]) assert.deepEqual(S.rocketAt(a, t, s), S.rocketAt(b, t, s))
		const [x, z, d] = S.rocketAt(a, 0.5, s)
		assert.ok(Math.abs(d - C.ROCKET.SPEED * 0.5 * s) < 1e-9)
		assert.ok(Math.abs(x) < 1e-12 && Math.abs(z - (2.5 - d)) < 1e-9)
	})

	it('hits a soldier it sweeps past between two frames (not its owner)', () => {
		const r = S.createRocket(shot, arena(), s)
		const vs = [
			{ id: 'me', x: 0, z: 2.4 },
			{ id: 'v', x: 0.01, z: 1.5 },
		]
		assert.equal(S.stepRocket(r, 0.1, vs, s), null) // 0.22 m flown
		const end = S.stepRocket(r, 0.6, vs, s) // 1.32 m: past v at 1.0 m
		assert.ok(end && end.hit === 'v' && !end.wall)
		assert.ok(end.z > 1.5 && end.z < 1.53)
		assert.equal(S.stepRocket(r, 0.9, vs, s), null) // done stays done
	})

	it('ends at a wall, or after its life', () => {
		const g = arena([{ x: 0, z: 0, w: 0.6, d: 0.12, h: 0.1, yaw: 0, c: 1 }])
		const r = S.createRocket(shot, g, s)
		assert.ok(r.hitWall && r.wall > 2.35 && r.wall < 2.5)
		const end = S.stepRocket(r, 2, [], s)
		assert.ok(end.wall && end.hit === null && !end.expired)
		const open = S.createRocket({ ...shot, p: [0, 0], yaw: 0 }, null, s)
		assert.equal(S.stepRocket(open, 3.9, [], s), null)
		const e2 = S.stepRocket(open, 4.01, [], s)
		assert.ok(e2.expired && !e2.wall)
	})

	it('splash 90 → 0 over 4 u, owner × 0.5', () => {
		assert.equal(S.splashDamage(0, 0.1), 90)
		assert.ok(Math.abs(S.splashDamage(0.2, 0.1) - 45) < 1e-9)
		assert.equal(S.splashDamage(0.4, 0.1), 0)
		assert.equal(S.splashDamage(1, 0.1), 0)
		assert.ok(Math.abs(S.splashDamage(0.2, 0.1, true) - 22.5) < 1e-9)
	})

	it('shot counter is strictly increasing', () => {
		const n = S.createShotCounter(5000)
		assert.deepEqual([n(), n(), n()], [5001, 5002, 5003])
	})
})

describe('WO-1081 Skirmish client: score + weapons', () => {
	const P = [
		{ id: 1, name: 'Bea', score: 3, kills: 3, deaths: 2, team: 0 },
		{ id: 2, name: 'Al', score: 5, kills: 5, deaths: 4, team: 1 },
		{ id: 3, name: 'Cy', score: 3, kills: 3, deaths: 1, team: 1 },
		{ id: 4, name: 'Di', score: 3, kills: 3, deaths: 1, team: 0 },
	]

	it('orders by score, kills, fewer deaths, name', () => {
		assert.deepEqual(K.orderPlayers(P).map((p) => p.id), [2, 3, 4, 1])
		assert.deepEqual(K.orderPlayers(P, 'tdm', [6, 8]).map((p) => p.id), [2, 3, 4, 1])
		assert.deepEqual(K.orderPlayers(P, 'tdm', [9, 8]).map((p) => p.id), [4, 1, 2, 3])
		assert.deepEqual(K.orderPlayers(null), [])
	})

	it('ranks share ties; leader; enemies by team', () => {
		assert.equal(K.rankOf(P, 2), 1)
		assert.equal(K.rankOf(P, 1), 2)
		assert.equal(K.rankOf(P, 3), 2)
		assert.equal(K.rankOf(P, 99), 0)
		assert.equal(K.leaderOf(P).id, 2)
		const st = { mode: 'tdm', players: P }
		assert.equal(K.isEnemy(st, 1, 4), false)
		assert.equal(K.isEnemy(st, 1, 2), true)
		assert.equal(K.isEnemy({ mode: 'dm', players: P }, 1, 4), true)
		assert.equal(K.isEnemy(st, 1, 1), false)
	})

	it('auto-switch: a newly usable better weapon is taken; a dry one falls back', () => {
		assert.equal(K.autoSwitch({ pea: -1 }, { pea: -1, rattler: 60 }, 'pea'), 'rattler')
		assert.equal(K.autoSwitch({ pea: -1, thumper: 4 }, { pea: -1, thumper: 4, rattler: 60 }, 'thumper'), 'thumper')
		assert.equal(K.autoSwitch({ pea: -1, rattler: 60 }, { pea: -1, rattler: 120 }, 'pea'), 'pea') // not new
		assert.equal(K.autoSwitch({ pea: -1, scatter: 1, rattler: 5 }, { pea: -1, scatter: 0, rattler: 5 }, 'scatter'), 'rattler')
		assert.equal(K.autoSwitch({ pea: -1, longshot: 1 }, { pea: -1, longshot: 0 }, 'longshot'), 'pea')
		assert.equal(K.bestWeapon({ pea: -1, rattler: 3, longshot: 2 }), 'longshot')
	})

	it('cycles through usable weapons and maps keys', () => {
		const a = { pea: -1, scatter: 8, thumper: 0, longshot: 2 }
		assert.equal(K.cycleWeapon(a, 'pea', 1), 'scatter')
		assert.equal(K.cycleWeapon(a, 'scatter', 1), 'longshot')
		assert.equal(K.cycleWeapon(a, 'longshot', 1), 'pea')
		assert.equal(K.cycleWeapon(a, 'pea', -1), 'longshot')
		assert.equal(K.cycleWeapon({ pea: -1 }, 'pea', 1), 'pea')
		assert.equal(K.weaponForKey(a, 3), 'scatter')
		assert.equal(K.weaponForKey(a, 5), null)
		assert.equal(K.weaponForKey(a, 9), null)
	})

	it('minimap keeps the aspect inside the margin; clock and ordinals', () => {
		const f = K.minimapFit([-3, -1, 3, 1], 180, 135, 6)
		assert.ok(Math.abs(f.k - 28) < 1e-9)
		assert.deepEqual(f.toPx(-3, -1), [6, f.oy])
		const [px, py] = f.toPx(3, 1)
		assert.ok(Math.abs(px - 174) < 1e-9 && Math.abs(py - (f.oy + 56)) < 1e-9)
		assert.equal(K.fmtClock(61000), '1:01')
		assert.equal(K.fmtClock(-5), '0:00')
		assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(K.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd'])
	})
})

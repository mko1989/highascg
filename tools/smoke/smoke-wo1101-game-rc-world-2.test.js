'use strict'

/**
 * WO-1102 — Stage Sprint RC in the Game World (work/notes/game-world-contract.md §6.2 R1 / R2 / R3 / R4), the client
 * side: modules/rc-game/client/world-fx.js (pure: hop / bump / boost / wobble, soft = visual only, slickUnder),
 * physics.js `car.wslick` (grip × 0.55, top speed × 0.85; unset or 0 → the very same physics, step by step) and
 * bot-brain.js (an `xfx` for the bot's own car is queued and applied, others' ignored; no driving while the state says
 * paused). A game alone never receives an `xfx`, so none of this runs then. Server side: smoke-wo1101-game-rc-world.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const F = require('./lib/rc-client-fixtures.js')

let P, TM, W, B

before(async () => {
	P = await F.load('physics.js')
	TM = await F.load('track-math.js')
	W = await F.load('world-fx.js')
	B = await F.load('bot-brain.js')
})

/** A seeded RNG (mulberry32). */
function seeded(a) {
	return () => {
		a = (a + 0x6d2b79f5) | 0
		let x = Math.imul(a ^ (a >>> 15), 1 | a)
		x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296
	}
}

const PH = { HOP_V: 2.4 }
const car0 = () => ({ x: 1, y: 0, z: 2, yaw: 0, vx: 2, vy: 0, vz: -4, grounded: true, boost: 0, boostKind: '', spin: 0, wfx: null })

describe('world-fx.js (pure)', () => {
	it('hop: speed × 0.6, upward 1.6 × HOP_V when grounded, airborne, a timer of dur (≤ 2 s)', () => {
		const c = car0()
		assert.equal(W.applyWorldFx(c, { t: 'xfx', k: 'hop', id: 1, dur: 0.6 }, PH), true)
		assert.ok(Math.abs(c.vx - 1.2) < 1e-12 && Math.abs(c.vz + 2.4) < 1e-12)
		assert.ok(Math.abs(c.vy - 2.4 * 1.6) < 1e-12)
		assert.equal(c.grounded, false)
		assert.deepEqual(c.wfx, { k: 'hop', t: 0.6 })
		const air = { ...car0(), grounded: false, vy: -1 }
		W.applyWorldFx(air, { k: 'hop', dur: 9 }, PH)
		assert.equal(air.vy, -1, 'no second jump in the air')
		assert.equal(air.wfx.t, 2, 'dur clamped to 2 s')
		const noP = car0()
		W.applyWorldFx(noP, { k: 'hop', dur: 'x' })
		assert.ok(Math.abs(noP.vy - 0.24 * 1.6) < 1e-12, 'toy-scale default HOP_V')
		assert.equal(noP.wfx.t, 0)
	})

	it('bump × 0.8; boost ≥ dur (0.4 default) unless spinning, keeps a running boost kind; wobble × 0.95 + 0.25 s', () => {
		const b = car0()
		assert.equal(W.applyWorldFx(b, { k: 'bump', dur: 0.2 }, PH), true)
		assert.ok(Math.abs(b.vx - 1.6) < 1e-12 && Math.abs(b.vz + 3.2) < 1e-12)
		assert.equal(b.wfx, null, 'a bump has no timer')
		const m = car0()
		assert.equal(W.applyWorldFx(m, { k: 'boost', dur: 0 }, PH), true)
		assert.deepEqual([m.boost, m.boostKind], [0.4, 'mini'])
		const turbo = { ...car0(), boost: 1.2, boostKind: 'turbo' }
		W.applyWorldFx(turbo, { k: 'boost', dur: 0.4 }, PH)
		assert.deepEqual([turbo.boost, turbo.boostKind], [1.2, 'turbo'], 'never shortens a boost')
		const spun = { ...car0(), spin: 0.5 }
		assert.equal(W.applyWorldFx(spun, { k: 'boost', dur: 0.4 }, PH), false)
		assert.equal(spun.boost, 0)
		const w = car0()
		assert.equal(W.applyWorldFx(w, { k: 'wobble', dur: 0 }, PH), true)
		assert.ok(Math.abs(w.vx - 1.9) < 1e-12)
		assert.deepEqual(w.wfx, { k: 'wobble', t: 0.25, ph: 0 })
	})

	it('soft, unknown kinds, a missing car or message: nothing changes', () => {
		for (const m of [{ k: 'hop', soft: true }, { k: 'stun', dur: 1 }, { k: 'step' }, null]) {
			const c = car0()
			assert.equal(W.applyWorldFx(c, m, PH), false)
			assert.deepEqual(c, car0())
		}
		assert.equal(W.applyWorldFx(null, { k: 'hop' }, PH), false)
		assert.doesNotThrow(() => W.stepWorldFx(null, 0.1))
	})

	it('stepWorldFx: wobble jitters the yaw within ± 8° and ends after its time, hop just runs down', () => {
		const c = car0()
		W.applyWorldFx(c, { k: 'wobble', dur: 0.25 }, PH)
		let maxOff = 0
		let steps = 0
		while (c.wfx && steps < 100) {
			W.stepWorldFx(c, 1 / 60)
			maxOff = Math.max(maxOff, Math.abs(c.yaw))
			steps++
		}
		assert.ok(steps === 15 || steps === 16, `0.25 s at 60 Hz (${steps})`)
		assert.ok(maxOff > 0.02 && maxOff <= (16 * Math.PI) / 180 + 1e-9, `jitter ${maxOff}`)
		const spun = { ...car0(), spin: 0.3 }
		W.applyWorldFx(spun, { k: 'wobble', dur: 0.25 }, PH)
		W.stepWorldFx(spun, 1 / 60)
		assert.equal(spun.yaw, 0, 'no jitter during a spin-out')
		const h = car0()
		W.applyWorldFx(h, { k: 'hop', dur: 0.1 }, PH)
		W.stepWorldFx(h, 0.05)
		assert.equal(h.yaw, 0)
		assert.ok(h.wfx)
		W.stepWorldFx(h, 0.06)
		assert.equal(h.wfx, null)
	})

	it('slickUnder: 1 inside a patch (r, ± 0.2 m in height), 0 outside, junk skipped', () => {
		const c = { x: 1, y: 0.25, z: 2 }
		assert.equal(W.slickUnder(c, [{ x: 1.1, y: 0.3, z: 2.1, r: 0.15 }]), 1)
		assert.equal(W.slickUnder(c, [{ x: 1.2, y: 0.25, z: 2, r: 0.15 }]), 0, 'outside the radius')
		assert.equal(W.slickUnder(c, [{ x: 1, y: 0.6, z: 2, r: 0.5 }]), 0, 'a patch on another floor')
		assert.equal(W.slickUnder({ x: 0, y: 0.1, z: 0 }, [{ x: 0, z: 0, r: 0.1 }]), 1, 'y defaults to 0')
		assert.equal(W.slickUnder(c, [null, { x: NaN, z: 2, r: 9 }, { x: 1, z: 2, y: 0.25, r: 0.06 }]), 1)
		assert.equal(W.slickUnder(c, null), 0)
		assert.equal(W.slickUnder(null, []), 0)
		assert.equal(W.slickUnder(c, []), 0)
	})
})

describe('physics.js car.wslick', () => {
	const env = () => {
		const T = TM.prepareTrack(F.ovalTrack(12, 7, 140, 0, 3))
		return { T, env: P.createEnv(T, F.BIG_FLOORS, []) }
	}
	const run = (wslick, n = 120) => {
		const { T, env: E } = env()
		const c = P.createCar(TM.gridPose(T, 0))
		if (wslick !== 'unset') c.wslick = wslick
		const states = []
		for (let i = 0; i < n; i++) {
			P.stepCar(c, { throttle: 1, steer: Math.sin(i / 10) * 0.6, drift: i > 60 && i < 80 }, E, [])
			const { wslick: _w, ...rest } = c
			states.push(JSON.stringify(rest))
		}
		return { c, states }
	}

	it('wslick unset vs 0: the very same state after every one of 120 steps', () => {
		const a = run('unset'), b = run(0)
		assert.equal(a.states.length, 120)
		assert.deepEqual(b.states, a.states)
		assert.ok(Math.hypot(a.c.vx, a.c.vz) > 3, 'the car really drove')
	})

	it('wslick 1: top speed × 0.85 and less grip (the sideways slide lasts longer)', () => {
		const c = P.createCar({ x: 0, z: 0, yaw: 0 })
		const top = P.topSpeed(c)
		assert.ok(Math.abs(P.topSpeed({ ...c, wslick: 1 }) - top * 0.85) < 1e-9)
		const { T, env: E } = env()
		const slide = (wslick) => {
			const k = P.createCar(TM.gridPose(T, 0))
			k.wslick = wslick
			const [rx, rz] = P.rightOf(k.yaw)
			const [fx, fz] = P.forwardOf(k.yaw)
			k.vx = fx * 4 + rx * 3
			k.vz = fz * 4 + rz * 3
			for (let i = 0; i < 6; i++) P.stepCar(k, {}, E, [])
			const [qx, qz] = P.rightOf(P.frameYaw(k))
			return Math.abs(k.vx * qx + k.vz * qz)
		}
		assert.ok(slide(1) > slide(0) * 1.2, `slick slide ${slide(1)} vs ${slide(0)}`)
		const fast = run(0, 360).c, slick = run(1, 360).c
		assert.ok(Math.hypot(slick.vx, slick.vz) < Math.hypot(fast.vx, fast.vz), 'slower on a patch')
	})
})

describe('bot-brain.js', () => {
	const world = () => {
		const T = TM.prepareTrack(F.ovalTrack(12, 7, 140, 0, 3))
		return { T, env: P.createEnv(T, F.BIG_FLOORS, []) }
	}
	const racing = (bot, t0, paused) => {
		const state = { phase: 'race', trackId: 'oval', laps: 3, startAt: t0 - 2000, players: [{ id: 1, slot: 0, racing: true }], ...(paused ? { paused: true } : {}) }
		bot.onMessage({ t: 'state', state }, t0)
	}

	it('drives in a race, holds the car still while the state says paused, drives again after', () => {
		const w = world()
		const bot = B.createBot({ rng: seeded(5), skill: 1 })
		const t0 = 5_000_000
		bot.onMessage({ t: 'welcome', id: 1, you: { id: 1, slot: 0 }, state: { phase: 'lobby', players: [{ id: 1, slot: 0 }] } }, t0)
		racing(bot, t0, false)
		let t = t0
		for (let i = 0; i < 60; i++) bot.step(w, (t += 33), 2)
		const moving = bot.G.car
		assert.ok(Math.hypot(moving.vx, moving.vz) > 1, 'racing')
		racing(bot, t, true)
		const held = JSON.stringify([moving.x, moving.z, moving.yaw])
		for (let i = 0; i < 60; i++) bot.step(w, (t += 33), 2)
		assert.equal(JSON.stringify([bot.G.car.x, bot.G.car.z, bot.G.car.yaw]), held, 'paused: not one step')
		racing(bot, t, false)
		for (let i = 0; i < 10; i++) bot.step(w, (t += 33), 2)
		assert.notEqual(JSON.stringify([bot.G.car.x, bot.G.car.z, bot.G.car.yaw]), held, 'resumed')
	})

	it('an `xfx` for its own car is applied at the next step (even paused); others\' and soft ones change nothing', () => {
		const w = world()
		const bot = B.createBot({ rng: seeded(9) })
		const t0 = 5_000_000
		bot.onMessage({ t: 'welcome', id: 1, you: { id: 1, slot: 0 }, state: { phase: 'lobby', players: [{ id: 1, slot: 0 }] } }, t0)
		racing(bot, t0, true)
		bot.step(w, t0 + 33, 2)
		const before = JSON.stringify(bot.G.car)
		bot.onMessage({ t: 'xfx', k: 'hop', id: 2, dur: 0.6 }, t0 + 40)
		bot.onMessage({ t: 'xfx', k: 'hop', id: 1, dur: 0.6, soft: true }, t0 + 40)
		bot.step(w, t0 + 66, 2)
		assert.equal(JSON.stringify(bot.G.car), before, 'another car / soft: untouched')
		bot.onMessage({ t: 'xfx', k: 'hop', id: 1, dur: 0.6 }, t0 + 70)
		assert.equal(JSON.stringify(bot.G.car), before, 'queued, not applied on receipt')
		bot.step(w, t0 + 99, 2)
		assert.equal(bot.G.car.grounded, false)
		assert.equal(bot.G.car.wfx.k, 'hop')
		for (let i = 0; i < 6; i++) bot.onMessage({ t: 'xfx', k: 'bump', id: 1, dur: 0.2 }, t0 + 100)
		const vx = bot.G.car.vx
		bot.step(w, t0 + 132, 2)
		assert.ok(Math.abs(bot.G.car.vx - vx * 0.8 ** 4) < 1e-9, 'at most 4 queued effects per step')
	})
})

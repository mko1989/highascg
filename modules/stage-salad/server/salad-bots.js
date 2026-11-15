'use strict'

/**
 * WO-1089 — Stage Salad bots (contract §10): virtual players the server runs. They take slots like guests (a joining
 * guest takes a bot's place), draw their band for 0.7 s (others see it stretch) and fire through the SAME referee
 * (salad-shots.js fire), so every limit a guest has, they have. Aim: aim.js solveAim at the avatar's body centre
 * (hard bots lead a walking avatar), then humanlike error — yaw and power drawn from a normal distribution whose σ
 * grows with distance and never goes below the level's floor, so no level is perfect. A think time between shots.
 * In the lobby they practise at half the pace. No bots → no bot work (the room's tick skips this).
 */

const { shared } = require('./salad-kit')

const NAMES = ['Chef Bot', 'Sous-Bot', 'Mr Radish', 'Ms Parsnip', 'Captain Kale', 'Dr Beet', 'Lady Leek', 'Sir Sprout']
const COLORS = ['#ffb020', '#22c7b8', '#c86bff', '#5ee06b', '#ff6bc1', '#3aa0ff', '#f5e663', '#ff4d3d']
const LEVELS = Object.freeze({
	easy: { yawDeg: 3.5, power: 0.07, think: [1800, 3200], lead: 0 },
	normal: { yawDeg: 2, power: 0.04, think: [1200, 2400], lead: 0.5 },
	hard: { yawDeg: 1.1, power: 0.022, think: [800, 1600], lead: 1 },
})
const PER_M_DEG = 0.15
const DRAW_MS = 700
const MAX_BOTS = 8
const VEG_WEIGHTS = [['tomato', 4], ['potato', 2], ['carrot', 2], ['cabbage', 1.5], ['onion', 1.5], ['peas', 1]]
const DEG = Math.PI / 180

/**
 * @param {object} X room context { now, rng, players, phase(), safe(), venue() }
 * @param {object} shots salad-shots.js · @param {object} presenters salad-presenters.js
 * @param {{ add: (name, color) => object, remove: (p) => void, room: () => { maxPlayers, humans } }} hooks
 */
function createBots(X, shots, presenters, hooks) {
	const S = shared()
	let wanted = 0
	let level = 'normal'
	const bots = new Map() // pid → { p, nextAt, plan, n }

	const gauss = () => {
		const u = Math.max(1e-9, X.rng()), v = X.rng()
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
	}
	const between = ([a, b]) => a + X.rng() * (b - a)
	function pickVeg() {
		const total = VEG_WEIGHTS.reduce((s, w) => s + w[1], 0)
		let r = X.rng() * total
		for (const [id, w] of VEG_WEIGHTS) if ((r -= w) < 0) return id
		return 'tomato'
	}

	function sync() {
		const { maxPlayers, humans } = hooks.room()
		const n = Math.max(0, Math.min(wanted, maxPlayers - humans))
		while (bots.size > n) {
			const last = [...bots.values()].pop()
			bots.delete(last.p.id)
			hooks.remove(last.p)
		}
		while (bots.size < n) {
			const k = [...Array(NAMES.length).keys()].find((i) => ![...bots.values()].some((b) => b.k === i)) ?? bots.size
			const p = hooks.add(NAMES[k % NAMES.length], COLORS[k % COLORS.length])
			if (!p) break
			bots.set(p.id, { p, k, nextAt: X.now() + between(LEVELS[level].think), plan: null, n: 0 })
		}
	}

	/**
	 * A plan for one shot: the solver's yaw / pitch / power for the avatar's body centre, with the level's error.
	 * Exported for the smokes (aim error bounds). → { veg, a: [yaw, pitch], p, ideal } | null
	 */
	function plan(p, t = X.now()) {
		const v = X.venue()
		if (!v || p.slot == null) return null
		const targets = presenters.tids().map((tid) => presenters.pose(tid, t)).filter(Boolean)
		if (!targets.length) return null
		const tg = targets[Math.floor(X.rng() * targets.length) % targets.length]
		const L = LEVELS[level]
		const veg = S.veggies.VEGGIES[pickVeg()]
		const origin = S.venue.pouch(v.slots[p.slot])
		const s = S.body.scaleOf(tg.height)
		const aimAt = [tg.x, tg.y + 0.48 * s, tg.z]
		const vel = presenters.vel ? presenters.vel(tg.tid) : null
		const ideal = S.aim.solveAim(veg, origin, aimAt, { vel: vel && L.lead ? [vel[0] * L.lead, vel[1] * L.lead] : null })
		if (!ideal) return null
		const d = Math.hypot(aimAt[0] - origin[0], aimAt[2] - origin[2])
		const yawErr = gauss() * (L.yawDeg + PER_M_DEG * d) * DEG
		const powErr = gauss() * L.power
		const slotYaw = v.slots[p.slot].yaw
		const lim = shots.LIMITS.yawDeg * DEG * 0.98
		let yaw = ideal.yaw + yawErr
		const off = Math.atan2(Math.sin(yaw - slotYaw), Math.cos(yaw - slotYaw))
		if (Math.abs(off) > lim) yaw = slotYaw + Math.sign(off) * lim
		const power = Math.max(S.veggies.POWER_MIN, Math.min(S.veggies.POWER_MAX, ideal.power + powErr))
		return { veg: veg.id, a: [yaw, ideal.pitch], p: power, ideal }
	}

	/** The room's tick. */
	function tick(t = X.now()) {
		if (!bots.size) return
		const ph = X.phase()
		const active = (ph === 'lobby' || ph === 'round') && !X.safe()
		for (const b of bots.values()) {
			const p = b.p
			if (!active) {
				b.plan = null
				p.pull = 0
				continue
			}
			if (b.plan) {
				const k = Math.min(1, (t - b.plan.from) / DRAW_MS)
				p.aim = b.plan.a.slice()
				p.pull = Math.round(k * b.plan.p * 1000) / 1000
				if (t >= b.plan.from + DRAW_MS) {
					shots.fire(p, { n: ++b.n, veg: b.plan.veg, a: b.plan.a, p: b.plan.p }, t)
					b.plan = null
					p.pull = 0
					const pace = ph === 'lobby' ? 2 : 1
					b.nextAt = Math.max(p.readyAt, t) + between(LEVELS[level].think) * pace
				}
			} else if (t >= b.nextAt && t >= p.readyAt) {
				const pl = plan(p, t)
				if (pl) b.plan = { ...pl, from: t }
				else b.nextAt = t + 1000
			}
		}
	}

	return {
		sync,
		tick,
		plan,
		setWanted(n) {
			wanted = n
			sync()
		},
		wanted: () => wanted,
		setLevel(l) {
			if (!Object.prototype.hasOwnProperty.call(LEVELS, l)) return false
			level = l
			return true
		},
		level: () => level,
		count: () => bots.size,
		isBot: (pid) => bots.has(pid),
		kick(p) {
			bots.delete(p.id)
			wanted = Math.max(0, wanted - 1)
			hooks.remove(p)
		},
		dispose() {
			bots.clear()
		},
	}
}

module.exports = { createBots, LEVELS, MAX_BOTS, NAMES }

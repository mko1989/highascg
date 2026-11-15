'use strict'

/**
 * WO-1089 — Stage Salad scoring (work/notes/stage-salad-contract.md §7). Pure.
 * points = round(base[part] × veg.points × distance × streak × bank):
 *   base head 100, body 50, legs 30 · distance 1 + clamp((d − 6) / 10, 0, 1) (d = horizontal launch → hit, m)
 *   streak 1 + 0.25 × (consecutive hits − 1), at most 2 · bank 1.5 for an onion that bounced before the hit
 */

const BASE = Object.freeze({ head: 100, body: 50, legs: 30 })

const distanceFactor = (d) => 1 + Math.max(0, Math.min(1, (d - 6) / 10))
const streakFactor = (n) => Math.min(2, 1 + 0.25 * Math.max(0, n - 1))

/** @param {{ part: string, veg: object, dist: number, streak: number, bounced?: boolean }} h */
function points(h) {
	const base = BASE[h.part]
	if (!base) return 0
	const bank = h.bounced && h.veg.bank ? h.veg.bank : 1
	return Math.round(base * h.veg.points * distanceFactor(h.dist) * streakFactor(h.streak) * bank)
}

module.exports = { points, distanceFactor, streakFactor, BASE }

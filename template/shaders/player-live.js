/*
 * WO-580 — the live clock rate for player.js (owner, on show 25.09: speed changes "refresh to the shader" and "I'd like
 * the changes to happen smoothly and not abruptly"). Shader Live's "Speed ×" used to rewrite every iTime multiplier and
 * recompile; the picture's phase is iTime × k, so after 20 min on air a 0.5 → 0.475 step jumped ~30 s of animation in one
 * frame. Now the node sends CG UPDATE `{ timeScale }` and this runs iTime at that rate (ShaderToyLite addTime), eased over
 * ~TAU_S: the picture speeds up or slows down from where it is, never jumps, nothing recompiles.
 * Loaded by player.js like player-smooth.js (a separate file for the 500-line limit); `module.exports` for the smoke.
 */
;(() => {
	'use strict'

	const TAU_S = 0.35
	const MIN = 0.05
	const MAX = 10

	/** A CG UPDATE value → a rate (anything else → 1). */
	const rateOf = (v) => {
		const n = Number(v)
		return Number.isFinite(n) && n > 0 ? Math.min(MAX, Math.max(MIN, n)) : 1
	}

	/** One frame: the eased rate and the seconds iTime must move beyond real time (negative = slower). */
	const step = (rate, target, dt) => {
		const d = Math.min(0.1, Math.max(0, dt))
		const next = rate + (target - rate) * (1 - Math.exp(-d / TAU_S))
		return { rate: Math.abs(next - target) < 1e-4 ? target : next, extra: (next - 1) * d }
	}

	const api = {
		rateOf,
		step,
		/** @param {{ toy: any, target: () => number }} opts — `target` reads player.js's latest `timeScale` */
		create({ toy, target }) {
			let rate = rateOf(target())
			let prev = performance.now()
			return {
				/** Per rendered frame (ShaderToyLite draw callback). */
				frame() {
					const now = performance.now()
					const r = step(rate, rateOf(target()), (now - prev) / 1000)
					prev = now
					rate = r.rate
					if (r.extra !== 0) toy.addTime(r.extra)
				},
				rate: () => rate,
			}
		},
	}
	if (typeof module !== 'undefined' && module.exports) module.exports = api
	else window.__SHADERFX_LIVE__ = api
})()

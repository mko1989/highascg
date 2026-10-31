'use strict'

/**
 * WO-893 — smoothing of the pixel-map colours (pixel-map-service.js). A screen region's mean jumps from frame to frame
 * (video cuts, flicker, a thin moving edge), and on a real LED head that reads as erratic flashing. The smoothing runs
 * AFTER the region average — one RGB triple per mapping, not per screen pixel, so it costs next to nothing:
 *
 *   state s (float RGB 0–255, per mapping id) follows the target x (the fresh raw mean, or black once the channel has
 *   had no frame for HOLD_MS) with an exponential step  s += k · (x − s),  k = 1 − exp(−dt / τ).
 *   τ = attack_ms while the target is brighter than the state (luma), release_ms while darker. ONE k for all three
 *   channels, so a red → blue change moves straight through RGB (no component overshoots, no magenta swell).
 *   dt is the time between two sample() calls, clamped to MAX_DT_S (a stalled engine must not jump the colour).
 *   τ = 0 → s = x exactly: attack 0 / release 0 is the unsmoothed WO-807 path, byte for byte.
 *
 * `snap` (0 = off): when a new frame of one channel changes its mappings by this much on average (mean over the channel's
 * mappings of the largest per-component change, raw against previous raw), it is a cut, not noise: the state of that
 * whole channel jumps to the raw value at once. A single region changing does not move the mean enough to snap.
 * Pure: no I/O, no clock.
 */

const MAX_DT_S = 0.1
const LIMITS = Object.freeze({ attack_ms: 5000, release_ms: 10000, snap: 255 })
const BLACK = Object.freeze([0, 0, 0])

/** A setting value → integer within 0…max; anything that is not a finite number (or numeric string) → 0. */
function clampSetting(v, max) {
	const n = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN
	return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : 0
}

/** Stored / loaded settings → { smooth: { attack_ms, release_ms, snap } }, always complete and clamped (junk → 0). */
function normalizeSettings(raw) {
	const s = raw && typeof raw === 'object' && raw.smooth && typeof raw.smooth === 'object' ? raw.smooth : {}
	const out = {}
	for (const k of Object.keys(LIMITS)) out[k] = clampSetting(s[k], LIMITS[k])
	return { smooth: out }
}

/**
 * Strict check for a write (POST): `raw` must be { smooth: { attack_ms?, release_ms?, snap? } }, each given value a number
 * (or numeric string); omitted ones keep `current`; values are clamped to their range.
 * → { ok: true, settings } | { ok: false, error }
 */
function validateSettings(raw, current = normalizeSettings(null)) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'body must be { smooth: { attack_ms, release_ms, snap } }' }
	const s = raw.smooth
	if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, error: 'smooth must be an object' }
	const out = { ...current.smooth }
	for (const k of Object.keys(LIMITS)) {
		if (s[k] === undefined) continue
		const n = typeof s[k] === 'number' || (typeof s[k] === 'string' && s[k].trim() !== '') ? Number(s[k]) : NaN
		if (!Number.isFinite(n)) return { ok: false, error: `smooth.${k} must be a number 0…${LIMITS[k]}` }
		out[k] = clampSetting(n, LIMITS[k])
	}
	return { ok: true, settings: { smooth: out } }
}

const isOff = (smooth) => !(smooth.attack_ms > 0) && !(smooth.release_ms > 0)
const isDefault = (settings) => isOff(settings.smooth) && !(settings.smooth.snap > 0)
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/** One step of state s toward target x after dt seconds. → new float [r, g, b] (a copy of x when τ = 0). */
function stepRgb(s, x, dt, smooth) {
	const tau = (luma(x) > luma(s) ? smooth.attack_ms : smooth.release_ms) / 1000
	if (!(tau > 0)) return [x[0], x[1], x[2]]
	const k = 1 - Math.exp(-Math.min(MAX_DT_S, Math.max(0, dt)) / tau)
	return [s[0] + k * (x[0] - s[0]), s[1] + k * (x[1] - s[1]), s[2] + k * (x[2] - s[2])]
}

/** Mean over mappings of max |Δ component| between two frames' raw means ([r, g, b] | null each); 0 with nothing comparable. */
function frameJump(prev, next) {
	let sum = 0
	let n = 0
	for (let i = 0; i < next.length; i++) {
		const a = prev[i]
		const b = next[i]
		if (!a || !b) continue
		sum += Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]))
		n++
	}
	return n ? sum / n : 0
}

/** The per-mapping float states. */
function createSmoother() {
	const state = new Map() // mapping id → [r, g, b]
	return {
		/** The smoothed colour as written, or null for a mapping with no state (black). */
		get: (id) => state.get(id) || null,
		clear: () => state.clear(),
		/** State := v at once (a snap). */
		set: (id, v) => state.set(id, [v[0], v[1], v[2]]),
		/** Move the state toward `target` (null = black) by dt; a mapping without a state starts AT the target. */
		update(id, target, dt, smooth) {
			const x = target || BLACK
			const s = state.get(id)
			state.set(id, s ? stepRgb(s, x, dt, smooth) : [x[0], x[1], x[2]])
		},
	}
}

module.exports = { MAX_DT_S, LIMITS, normalizeSettings, validateSettings, isOff, isDefault, luma, stepRgb,
	frameJump, createSmoother }

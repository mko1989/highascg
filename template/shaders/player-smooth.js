/*
 * WO-875 — spectrum smoothing for the shader audio texture, after GLava (github.com/jarcode-foss/glava, its
 * "gravity" + "avg" transforms and smooth_audio). Lazily loaded by player.js; Node requires it for tests. The Godot
 * Visuals run the same steps (godot/client/features/visuals/spectrum_smooth.gd) — keep the two identical.
 *
 * Runs once per RENDERED frame on the latest raw 512 FFT bytes (AnalyserNode semantics, frames arrive at 30 Hz), so
 * falls are continuous at 50/60 fps instead of 30 Hz steps:
 *   spread  bin k averages its ±floor(k·spread) neighbours — 0 at the bass, wider up the spectrum (GLava's
 *           log-scaled smoothing, kept in linear bins so bin k still means the same frequency to every shader)
 *   fall    gravity: a bin rises at once and drops at most `fall` bytes per second (0 = off)
 *   frames  windowed average of the last n gravity outputs (GLava's window_frame / window_shallow for 3; 1 = off)
 * The node sends its settings in every audio_fft frame (`smooth`, config audioCapture.spectrum); without them the
 * DEFAULTS apply. { fall: 0, frames: 1, spread: 0 } is the raw spectrum.
 */
;(() => {
	'use strict'

	const DEFAULTS = { fall: 200, frames: 3, spread: 0.02 }
	const MAX_FRAMES = 8

	const num = (v, fb, lo, hi) => {
		const n = Number(v)
		return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb
	}

	function params(p) {
		const o = p && typeof p === 'object' ? p : {}
		return {
			fall: num(o.fall, DEFAULTS.fall, 0, 5000),
			frames: Math.round(num(o.frames, DEFAULTS.frames, 1, MAX_FRAMES)),
			spread: num(o.spread, DEFAULTS.spread, 0, 0.25),
		}
	}

	/** Weight of the frame `age` renders old in an `m`-frame window (symmetric, so age order does not matter). */
	function weight(age, m) {
		if (m < 3) return 1
		const c = Math.cos((2 * Math.PI * age) / (m - 1))
		return m === 3 ? 0.7 - 0.3 * c : 0.6 - 0.4 * c
	}

	function create(n) {
		const grav = new Float32Array(n)
		const hist = Array.from({ length: MAX_FRAMES }, () => new Float32Array(n))
		const prefix = new Float64Array(n + 1)
		const out = new Uint8Array(n)
		let head = 0
		let filled = 0
		let frames = 0
		let at = 0
		return {
			/** One rendered frame now: step() with the time since the last call (player.js). */
			frame(raw, p) {
				const now = performance.now()
				const dt = at ? (now - at) / 1000 : 0
				at = now
				return this.step(raw, dt, p)
			},
			/** `raw` (n bytes) → the smoothed n bytes (the same array every call). `dt` in seconds. */
			step(raw, dt, p) {
				const q = params(p)
				const d = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0
				if (q.frames !== frames) {
					frames = q.frames
					head = 0
					filled = 0
				}
				for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + (raw[i] || 0)
				const h = hist[head]
				for (let k = 0; k < n; k++) {
					const r = Math.floor(k * q.spread)
					let v = raw[k] || 0
					if (r >= 1) {
						const lo = Math.max(0, k - r)
						const hi = Math.min(n, k + r + 1)
						v = (prefix[hi] - prefix[lo]) / (hi - lo)
					}
					const g = grav[k] - q.fall * d
					grav[k] = q.fall > 0 && g > v ? g : v
					h[k] = grav[k]
				}
				head = (head + 1) % frames
				filled = Math.min(filled + 1, frames)
				let total = 0
				const w = []
				for (let age = 0; age < filled; age++) {
					w.push(weight(age, filled))
					total += w[age]
				}
				for (let k = 0; k < n; k++) {
					let s = 0
					for (let age = 0; age < filled; age++) s += w[age] * hist[(head - 1 - age + frames) % frames][k]
					const b = Math.round(s / total)
					out[k] = b < 0 ? 0 : b > 255 ? 255 : b
				}
				return out
			},
		}
	}

	const api = { DEFAULTS, params, weight, create }
	if (typeof module === 'object' && module.exports) module.exports = api
	else window.__SHADERFX_SMOOTH__ = api
})()

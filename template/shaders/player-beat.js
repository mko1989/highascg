/*
 * WO-662 — beat reactivity companion for player.js (owner 21.10: "Add beat detection and a way to weave it into
 * shaders audio reactivity"). Lazily loaded by player.js when a shader is audio reactive; it is a separate file
 * because player.js sits near the 500-line limit.
 *
 * The node detects beats on the routed audio (src/audio/beat-detect.js) and every WS `audio_fft` frame carries
 * `beat: { n, age, bpm, conf, phase, level }` and `bands: [bass, mid, high]`. This turns them into the
 * ShaderToyLite uniforms, per rendered frame:
 *   iBeat       x = pulse (1 on the beat, decays in ~DECAY_MS), y = BPM, z = phase 0..1 on the beat grid, w = count
 *   iAudioBands x = bass, y = mid, z = high, w = low-band level
 *   iBeatFx     the shader's own beat knobs (config.audio.beat: flash, bump — applied around mainImage)
 * and the third knob, kick, pushes iTime forward on each beat so time-driven shaders surge with the music.
 * `age` is extrapolated from the frame's arrival time, so the pulse is smooth at any render rate and lands on the
 * beat even though frames come at 30 Hz. Stale feed (> FRESH_MS) → all zeros: shaders fall back to their own
 * motion instead of freezing mid-pulse. Knobs change live via CG UPDATE `{ beat: {...} }` (no recompile).
 */
;(() => {
	'use strict'

	const DECAY_MS = 180
	const FRESH_MS = 1500
	const KICK_SEC = 4 // iTime speed-up at the peak of the pulse, per unit of kick (integral ≈ 0.7 s per beat at 1)

	const clamp01 = (v) => {
		const n = Number(v)
		return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
	}
	const knobs = (b) => ({ flash: clamp01(b && b.flash), bump: clamp01(b && b.bump), kick: clamp01(b && b.kick) })

	window.__SHADERFX_BEAT__ = {
		/** @param {{ toy: any, config: any }} opts */
		create({ toy, config }) {
			let fx = knobs(config.audio && config.audio.beat)
			let age = -1
			let bpm = 0
			let count = 0
			let level = 0
			let bands = [0, 0, 0]
			let at = 0
			let prev = performance.now()
			return {
				/** One WS audio_fft frame's data. */
				onFrame(d) {
					if (d.beat && typeof d.beat === 'object') {
						age = Number(d.beat.age)
						bpm = Number(d.beat.bpm) || 0
						count = Number(d.beat.n) || 0
						level = Number(d.beat.level) || 0
					}
					if (Array.isArray(d.bands)) bands = d.bands.map(Number)
					at = performance.now()
				},
				setFx(b) {
					fx = knobs(b)
				},
				/** Per rendered frame (ShaderToyLite draw callback). */
				update() {
					const now = performance.now()
					const dt = Math.min(0.1, (now - prev) / 1000)
					prev = now
					const fresh = at > 0 && now - at < FRESH_MS
					const a = fresh && age >= 0 ? age + (now - at) : -1
					const pulse = a >= 0 ? Math.exp(-a / DECAY_MS) : 0
					const period = bpm > 0 ? 60000 / bpm : 0
					const phase = period && a >= 0 ? (a % period) / period : 0
					toy.setBeat(
						[pulse, fresh ? bpm : 0, phase, count],
						fresh ? [bands[0] || 0, bands[1] || 0, bands[2] || 0, level] : [0, 0, 0, 0],
						[fx.flash, fx.bump, 0, 0]
					)
					if (fx.kick > 0 && pulse > 0.01) toy.addTime(fx.kick * KICK_SEC * pulse * dt)
				},
			}
		},
	}
})()

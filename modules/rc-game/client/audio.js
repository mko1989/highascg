/* global window */
/**
 * Optional sound (WO-1074): a tiny WebAudio engine whine + countdown / lap beeps + v2 effect blips. Off by default; the AudioContext is
 * only created on the first unmute (a user gesture). No audio files.
 */

export function createAudio() {
	let ctx = null
	let osc = null
	let osc2 = null
	let gain = null
	let filter = null
	let muted = true

	function ensure() {
		if (ctx) return true
		const AC = window.AudioContext || window.webkitAudioContext
		if (!AC) return false
		try {
			ctx = new AC()
		} catch {
			return false
		}
		gain = ctx.createGain()
		gain.gain.value = 0
		filter = ctx.createBiquadFilter()
		filter.type = 'lowpass'
		filter.frequency.value = 900
		osc = ctx.createOscillator()
		osc.type = 'sawtooth'
		osc.frequency.value = 70
		osc2 = ctx.createOscillator()
		osc2.type = 'square'
		osc2.frequency.value = 140
		const g2 = ctx.createGain()
		g2.gain.value = 0.3
		osc.connect(filter)
		osc2.connect(g2).connect(filter)
		filter.connect(gain).connect(ctx.destination)
		osc.start()
		osc2.start()
		return true
	}

	return {
		get muted() {
			return muted
		},
		setMuted(m) {
			muted = !!m
			if (!muted && ensure()) ctx.resume?.()
			if (gain && ctx) gain.gain.setTargetAtTime(muted ? 0 : 0.035, ctx.currentTime, 0.05)
		},
		/** @param {number} speed m/s @param {number} throttle 0…1 */
		engine(speed, throttle) {
			if (muted || !ctx) return
			const f = 60 + Math.abs(speed) * 22 + throttle * 25
			const t = ctx.currentTime
			osc.frequency.setTargetAtTime(f, t, 0.06)
			osc2.frequency.setTargetAtTime(f * 2.01, t, 0.06)
			filter.frequency.setTargetAtTime(600 + Math.abs(speed) * 160, t, 0.08)
			gain.gain.setTargetAtTime(0.02 + throttle * 0.025, t, 0.1)
		},
		/** Short synthesized effects (v2): boost, mini, pickup, item, hit, pulse, land, wall. */
		sfx(kind) {
			if (muted || !ctx) return
			const S = {
				boost: ['sawtooth', 180, 720, 380, 0.08],
				mini: ['square', 520, 1040, 160, 0.06],
				pickup: ['triangle', 880, 1320, 140, 0.1],
				item: ['triangle', 660, 990, 220, 0.1],
				hit: ['sawtooth', 220, 55, 420, 0.12],
				pulse: ['sine', 1400, 120, 360, 0.14],
				land: ['sine', 120, 60, 120, 0.12],
				wall: ['square', 140, 90, 90, 0.06],
			}[kind]
			if (!S) return
			const [type, f0, f1, ms, vol] = S
			const t = ctx.currentTime
			const o = ctx.createOscillator()
			const g = ctx.createGain()
			o.type = type
			o.frequency.setValueAtTime(f0, t)
			o.frequency.exponentialRampToValueAtTime(f1, t + ms / 1000)
			g.gain.setValueAtTime(vol, t)
			g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000)
			o.connect(g).connect(ctx.destination)
			o.start(t)
			o.stop(t + ms / 1000 + 0.05)
		},
		beep(freq = 660, ms = 120) {
			if (muted || !ctx) return
			const o = ctx.createOscillator()
			const g = ctx.createGain()
			o.type = 'sine'
			o.frequency.value = freq
			g.gain.value = 0.12
			g.gain.setTargetAtTime(0, ctx.currentTime + ms / 1000, 0.03)
			o.connect(g).connect(ctx.destination)
			o.start()
			o.stop(ctx.currentTime + ms / 1000 + 0.2)
		},
	}
}

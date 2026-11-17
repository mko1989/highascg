/* global window */
/**
 * Sound of Stage Salad (WO-1089 §0 / §11): our own synthesized WebAudio blips only — no audio files. A band creak
 * that rises with the pull, a twang at the release, a soft splat, a hollow bonk (potato / carrot), a boing (onion bank
 * shots, umbrella), a little sparkle for a head hit, chimes at the round's start and end, count-down ticks. Off until
 * the player unmutes (the AudioContext is created in that gesture).
 */

export function createAudio() {
	let ctx = null
	let noise = null
	let muted = true
	let lastCreak = 0

	function ensure() {
		if (ctx) return true
		const AC = window.AudioContext || window.webkitAudioContext
		if (!AC) return false
		try {
			ctx = new AC()
		} catch {
			return false
		}
		noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate)
		const d = noise.getChannelData(0)
		for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
		return true
	}

	// WO-1106 B62: no nodes while the context is suspended (they would queue up and play all at once on resume)
	const live = () => !muted && ctx && (ctx.state ?? 'running') === 'running'

	function tone(type, f0, f1, ms, vol, at = 0, mid = null) {
		const t = ctx.currentTime + at
		const end = t + ms / 1000
		const g = ctx.createGain()
		g.gain.setValueAtTime(0.0001, t)
		g.gain.exponentialRampToValueAtTime(vol, t + 0.008)
		g.gain.exponentialRampToValueAtTime(0.0005, end)
		g.connect(ctx.destination)
		const o = ctx.createOscillator()
		o.type = type
		o.frequency.setValueAtTime(f0, t)
		if (mid) {
			o.frequency.exponentialRampToValueAtTime(mid, t + ms / 2000)
			o.frequency.exponentialRampToValueAtTime(f1, end)
		} else o.frequency.exponentialRampToValueAtTime(f1, end)
		o.connect(g)
		o.start(t)
		o.stop(end + 0.03)
	}

	function hiss(f0, f1, ms, vol) {
		const t = ctx.currentTime
		const end = t + ms / 1000
		const g = ctx.createGain()
		g.gain.setValueAtTime(vol, t)
		g.gain.exponentialRampToValueAtTime(0.0005, end)
		const f = ctx.createBiquadFilter()
		f.type = 'lowpass'
		f.frequency.setValueAtTime(f0, t)
		f.frequency.exponentialRampToValueAtTime(f1, end)
		const n = ctx.createBufferSource()
		n.buffer = noise
		n.connect(f).connect(g).connect(ctx.destination)
		n.start(t)
		n.stop(end + 0.03)
	}

	const SOUNDS = {
		twang: () => (tone('triangle', 210, 95, 260, 0.12), tone('sine', 420, 180, 120, 0.05)),
		splat: (v) => hiss(1100, 160, 200, 0.18 * v),
		bonk: (v) => tone('square', 520, 260, 90, 0.06 * v),
		boing: (v) => tone('sine', 260, 300, 380, 0.11 * v, 0, 640),
		sparkle: () => [1568, 2093, 2637].forEach((f, k) => tone('sine', f, f * 1.01, 140, 0.04, k * 0.06)),
		start: () => [523, 659, 784, 1047].forEach((f, k) => tone('triangle', f, f, 180, 0.09, k * 0.11)),
		end: () => [784, 659, 523, 392].forEach((f, k) => tone('triangle', f, f, 220, 0.09, k * 0.13)),
		tick: () => tone('sine', 660, 660, 90, 0.07),
		nope: () => tone('square', 180, 150, 70, 0.04),
	}

	return {
		get muted() {
			return muted
		},
		setMuted(m) {
			muted = !!m
			if (!muted && ensure()) ctx.resume?.()
		},
		/** A sound by name; vol 0…1 (far-away splats are quieter). */
		play(kind, vol = 1) {
			if (!live() || !SOUNDS[kind]) return
			try {
				SOUNDS[kind](Math.max(0.05, Math.min(1, vol)))
			} catch {
				/* an old WebAudio: silence is fine */
			}
		},
		/** Called every frame while pulling: a short creak each time the pull grows another step, higher as it grows. */
		creak(pull) {
			if (!live()) return
			const step = Math.floor(pull * 10)
			if (step <= lastCreak) {
				lastCreak = Math.min(lastCreak, step)
				return
			}
			lastCreak = step
			tone('sawtooth', 90 + pull * 160, 70 + pull * 140, 70, 0.025 + pull * 0.03)
		},
		resetCreak() {
			lastCreak = 0
		},
	}
}

/* global window */
/**
 * Sound of Stage Skirmish (WO-1081 §9): synthesized WebAudio blips only — no audio files. One voice per weapon
 * (Peashooter pop, Rattler tick, Scatter crunch, Longshot zap, Thumper whoomp), hit, frag, being fragged, pick-up,
 * explosion, countdown beeps. Off by default; the AudioContext is created on the first unmute (a user gesture).
 * The kit's audio.js is not used: it carries the RC engine whine and the RC effect names.
 */

/** [wave, f0, f1, ms, volume, noise?] per sound. */
export const SOUNDS = Object.freeze({
	pea: ['square', 920, 420, 70, 0.06],
	rattler: ['sawtooth', 520, 260, 45, 0.045],
	scatter: ['sawtooth', 240, 70, 160, 0.09, true],
	longshot: ['sine', 2200, 300, 260, 0.08],
	thumper: ['triangle', 160, 60, 220, 0.12],
	hit: ['square', 1400, 1100, 50, 0.05],
	hurt: ['sawtooth', 200, 90, 140, 0.08],
	frag: ['triangle', 660, 1320, 220, 0.11],
	fragged: ['sawtooth', 300, 70, 420, 0.1],
	pickup: ['triangle', 880, 1560, 150, 0.09],
	boom: ['sawtooth', 120, 35, 420, 0.14, true],
	empty: ['square', 180, 160, 40, 0.04],
	surge: ['sine', 300, 1200, 500, 0.1],
})

export function createAudio() {
	let ctx = null
	let noiseBuf = null
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
		noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate)
		const d = noiseBuf.getChannelData(0)
		for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
		return true
	}

	function play(kind, vol = 1) {
		if (muted || !ctx) return
		const S = SOUNDS[kind]
		if (!S) return
		const [type, f0, f1, ms, v, noise] = S
		const t = ctx.currentTime
		const end = t + ms / 1000
		const g = ctx.createGain()
		g.gain.setValueAtTime(v * vol, t)
		g.gain.exponentialRampToValueAtTime(0.0008, end)
		g.connect(ctx.destination)
		const o = ctx.createOscillator()
		o.type = type
		o.frequency.setValueAtTime(f0, t)
		o.frequency.exponentialRampToValueAtTime(f1, end)
		o.connect(g)
		o.start(t)
		o.stop(end + 0.03)
		if (noise) {
			const n = ctx.createBufferSource()
			n.buffer = noiseBuf
			const f = ctx.createBiquadFilter()
			f.type = 'lowpass'
			f.frequency.setValueAtTime(2400, t)
			f.frequency.exponentialRampToValueAtTime(200, end)
			n.connect(f).connect(g)
			n.start(t)
			n.stop(end + 0.03)
		}
	}

	return {
		get muted() {
			return muted
		},
		setMuted(m) {
			muted = !!m
			if (!muted && ensure()) ctx.resume?.()
		},
		/** A sound by name; `vol` 0…1 (far-away shots are quieter). */
		play,
		beep(freq = 660, ms = 120) {
			if (muted || !ctx) return
			const o = ctx.createOscillator()
			const g = ctx.createGain()
			o.type = 'sine'
			o.frequency.value = freq
			g.gain.value = 0.1
			g.gain.setTargetAtTime(0, ctx.currentTime + ms / 1000, 0.03)
			o.connect(g).connect(ctx.destination)
			o.start()
			o.stop(ctx.currentTime + ms / 1000 + 0.2)
		},
	}
}

'use strict'

/**
 * WO-872 — the onset strength the beat tracker listens to (stage 1 of 3: onset → tempo → grid).
 *
 * SuperFlux (Böck & Widmer 2013) on log-spaced bands, as fosfora does it (crates/fosfora-app/src/audio/beat.rs:307-440):
 * band magnitudes are log-compressed, each band's rise is taken against the max of itself and its neighbours one hop
 * back (vibrato and slides do not read as onsets), and the bands are averaged per partition — low (< 250 Hz),
 * mid (250 Hz–2 kHz), high — then mixed 0.60 / 0.28 / 0.12, so kicks and bass carry the beat and hats only help.
 * Replaces the WO-662 flat flux (every bin up to 10 kHz weighted alike), which put the grid on hats and off-beats
 * (GTZAN tune split: 35 % of beats within ±10 % of a period of the reference).
 */

const { fftRadix2 } = require('./fft')

const PARTS = [
	{ hi: 250, w: 0.6 },
	{ hi: 2000, w: 0.28 },
	{ hi: Infinity, w: 0.12 },
]

function hann(n) {
	const w = new Float64Array(n)
	for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
	return w
}

/**
 * @param {{ sampleRate: number, fftSize?: number, bands?: number, gateDb?: number }} opts
 * @returns {{ step(input: Float32Array, start: number): { odf: number, db: number }, reset(): void, size: number }}
 *   `input` is a ring of `size` samples whose oldest sample sits at `start`.
 */
function createOnsetFunction(opts) {
	const sr = opts.sampleRate
	const n = opts.fftSize || 4096 // 11.7 Hz bins at 48 kHz, so the < 250 Hz partition has bands to work with (1024: F −.12, 2048: −.04)
	const gateDb = opts.gateDb ?? -60
	const binHz = sr / n
	// log-spaced edges 20 Hz–16 kHz, snapped to bins; bands narrower than a bin merge into their neighbour
	const want = opts.bands || 64
	const edges = []
	for (let i = 0; i <= want; i++) {
		const b = Math.max(1, Math.round((20 * (16000 / 20) ** (i / want)) / binHz))
		if (!edges.length || b > edges[edges.length - 1]) edges.push(Math.min(b, n / 2))
	}
	const nb = edges.length - 1
	const part = new Uint8Array(nb)
	const perPart = [0, 0, 0]
	for (let b = 0; b < nb; b++) {
		const hz = ((edges[b] + edges[b + 1]) / 2) * binHz
		part[b] = PARTS.findIndex((p) => hz < p.hi)
		perPart[part[b]]++
	}
	const w = hann(n)
	const re = new Float64Array(n)
	const im = new Float64Array(n)
	const cur = new Float64Array(nb)
	const prev = new Float64Array(nb)
	let primed = false

	return {
		size: n,
		step(input, start) {
			let ms = 0
			for (let i = 0; i < n; i++) {
				const v = input[(start + i) % n]
				ms += v * v
				re[i] = v * w[i]
				im[i] = 0
			}
			fftRadix2(re, im)
			for (let b = 0; b < nb; b++) {
				let s = 0
				for (let k = edges[b]; k < edges[b + 1]; k++) s += Math.hypot(re[k], im[k])
				cur[b] = Math.log(1 + (100 * s) / (edges[b + 1] - edges[b]))
			}
			const sum = [0, 0, 0]
			if (primed) {
				for (let b = 0; b < nb; b++) {
					const ref = Math.max(prev[b], b > 0 ? prev[b - 1] : 0, b + 1 < nb ? prev[b + 1] : 0)
					const d = cur[b] - ref
					if (d > 0) sum[part[b]] += d
				}
			}
			prev.set(cur)
			primed = true
			const db = 10 * Math.log10(ms / n + 1e-12)
			if (db < gateDb) return { odf: 0, db }
			const mean = sum.map((s, p) => (perPart[p] ? s / perPart[p] : 0))
			return { odf: PARTS.reduce((a, p, i) => a + p.w * mean[i], 0), db }
		},
		reset() {
			prev.fill(0)
			primed = false
		},
	}
}

module.exports = { createOnsetFunction }

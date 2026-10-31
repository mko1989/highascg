'use strict'

/**
 * WO-879 — tap tempo: the operator's beat when the tracker cannot lock (a live band, a noisy room, the desk feed gone).
 * Two or more taps (each within MAX_GAP_MS of the one before) set the tempo from their mean interval and switch the
 * beat output to the tapped grid; one tap later re-phases it ("the beat is here"); auto() gives the detector back.
 * merge() keeps the frame's beat count `n` monotonic across every switch (consumers read a change of n as a beat), so
 * a tap, a re-phase or the way back to auto never fires a beat twice or jumps the count. Pure: time comes in as ms.
 */

const MAX_GAP_MS = 2000
const MIN_BPM = 40
const MAX_BPM = 240
const KEEP = 8 // the last taps averaged

function createTapTempo() {
	let taps = []
	let period = 0
	let anchor = -1 // ms of the tapped beat the grid counts from
	let base = 0 // tap-grid beats before the anchor
	let active = false
	let outN = null
	let last = null // { key, n, age } of the previous merge's source

	const gridN = (t) => base + Math.max(0, Math.floor((t - anchor) / period))

	return {
		/** One tap at `t` ms. @returns the state() */
		tap(t) {
			if (taps.length && t - taps[taps.length - 1] > MAX_GAP_MS) taps = []
			if (taps.length && t - taps[taps.length - 1] < 60000 / MAX_BPM / 2) return this.state() // a bounce
			taps.push(t)
			if (taps.length > KEEP) taps.shift()
			if (taps.length >= 2) {
				const p = (taps[taps.length - 1] - taps[0]) / (taps.length - 1)
				period = Math.min(60000 / MIN_BPM, Math.max(60000 / MAX_BPM, p))
				active = true
			}
			if (active) {
				// The tap is a beat: the grid restarts on it, counting on from where it was. A tap just after a grid
				// beat (late, < ¼ beat) is that beat, not another one.
				if (anchor >= 0) {
					const n = gridN(t)
					const since = (t - anchor) % period
					base = since < period / 4 ? n : n + 1
				} else base = 0
				anchor = t
			}
			return this.state()
		},
		/** Back to the detector's beat. */
		auto() {
			active = false
			taps = []
		},
		state() {
			return { tap: active, bpm: active ? Math.round(600000 / period) / 10 : 0, taps: taps.length }
		},
		/**
		 * The frame's beat: the detector's snapshot, or the tapped grid while tapping; `n` counts on across switches.
		 * @param {{ n: number, age: number, bpm: number, conf: number, phase: number, level: number, locked: boolean }} det
		 * @param {number} t ms on the tap clock
		 */
		merge(det, t) {
			let src = det
			if (active && t >= anchor) {
				const k = Math.floor((t - anchor) / period)
				const age = t - anchor - k * period
				src = {
					...det,
					n: base + k,
					age: Math.round(age),
					bpm: Math.round(600000 / period) / 10,
					conf: 1,
					phase: Math.round((age / period) * 1000) / 1000,
					locked: true,
					tap: true,
				}
			}
			const key = src === det ? 'det' : 'tap'
			if (outN == null) outN = src.n
			else if (last.key === key) outN += Math.max(0, src.n - last.n)
			else if (key === 'tap' && src.age < period / 4 && !(last.age >= 0 && last.age < period / 4)) outN++ // the tap that starts it is a beat
			last = { key, n: src.n, age: src.age }
			return { ...src, n: outN }
		},
	}
}

module.exports = { createTapTempo }

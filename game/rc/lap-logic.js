/**
 * Lap / checkpoint logic (WO-1074) — pure. Mirrors what the contract's `s` message reports:
 * `cp` = index (into track.checkpoints) of the last checkpoint passed IN ORDER, `lap` = completed laps.
 *
 * A race starts at cp 0 / lap 0 (the start line counts as passed, whichever side of it the grid is). Only the NEXT
 * checkpoint, crossed in the driving direction, advances; crossing checkpoint 0 after the last one completes a lap.
 * Driving backwards over a gate, or crossing gates out of order (e.g. on a figure-eight's other branch), never counts.
 * v2: with the car's heights (ay, by) a crossing well above / below the gate (stage part over a hall gate) never counts.
 */
import { gateCrossing } from './track-math.js'

export function createLapState(startMs = null) {
	return { cp: 0, lap: 0, lapStart: startMs, lastMs: null, bestMs: null, times: [] }
}

/** Reset for a new race starting at startMs (server clock). */
export function resetLaps(st, startMs = null) {
	Object.assign(st, createLapState(startMs))
	return st
}

/**
 * Feed one movement A → B (optional heights ay → by).
 * @returns {null | { type: 'cp', cp: number } | { type: 'lap', lap: number, ms: number|null }}
 */
export function lapStep(T, st, ax, az, bx, bz, nowMs, ay = null, by = null) {
	const n = T.checkpoints.length
	if (!n) return null
	const next = (st.cp + 1) % n
	if (gateCrossing(T, next, ax, az, bx, bz, ay, by) !== 1) return null
	if (next !== 0) {
		st.cp = next
		return { type: 'cp', cp: next }
	}
	st.cp = 0
	st.lap += 1
	let ms = null
	if (st.lapStart != null && nowMs != null) {
		ms = Math.max(0, Math.round(nowMs - st.lapStart))
		st.lastMs = ms
		st.times.push(ms)
		if (st.bestMs == null || ms < st.bestMs) st.bestMs = ms
	}
	st.lapStart = nowMs
	return { type: 'lap', lap: st.lap, ms }
}

/** Format milliseconds as m:ss.t (or s.t under a minute). */
export function fmtTime(ms) {
	if (ms == null || !Number.isFinite(ms) || ms < 0) return '–'
	const tenths = Math.floor(ms / 100) % 10
	const sec = Math.floor(ms / 1000)
	const m = Math.floor(sec / 60)
	const s = sec % 60
	return m ? `${m}:${String(s).padStart(2, '0')}.${tenths}` : `${s}.${tenths}`
}

/**
 * Race standings (WO-1074) — pure. Every car (own and remote) is tracked the same way: a lap state fed with its
 * positions (own: physics; remote: interpolated snapshots), plus the server's `lap` messages, which win when ahead.
 * Positions sort by finished first (total time), then progress (laps × length + distance along the lap).
 */
import { nearestOnTrack, progressOf } from './track-math.js'
import { createLapState, lapStep, resetLaps } from './lap-logic.js'

/** Longest plausible move between two samples (24 m/s cap × a slow 150 ms frame ≈ 3.6 m). */
export const MAX_STEP_M = 4

export class RaceTracker {
	constructor(T) {
		this.T = T
		/** @type {Map<any, { lap: object, x: number, y: number|null, z: number, seg: number, progress: number, serverLap: number, finishedMs: number|null }>} */
		this.cars = new Map()
		this.startMs = null
	}

	setTrack(T) {
		this.T = T
		this.cars.clear()
		this.startMs = null
	}

	reset(startMs = null) {
		this.startMs = startMs
		for (const c of this.cars.values()) {
			resetLaps(c.lap, startMs)
			c.serverLap = 0
			c.finishedMs = null
			c.seg = -1
		}
	}

	_get(id) {
		let c = this.cars.get(id)
		if (!c) {
			c = {
				lap: createLapState(this.startMs),
				x: NaN,
				y: null,
				z: NaN,
				seg: -1,
				progress: 0,
				serverLap: 0,
				finishedMs: null,
			}
			this.cars.set(id, c)
		}
		return c
	}

	/**
	 * A car's new position (y optional: height-aware gates and nearest point). `teleport` (respawn, first sight) skips
	 * the gate test. Returns the lap event or null.
	 */
	move(id, x, z, nowMs, teleport = false, y = null) {
		const T = this.T
		const c = this._get(id)
		let ev = null
		/* a jump of more than MAX_STEP_M (respawn, grid placement, snapshot snap) is never a gate crossing */
		const jumped = !Number.isFinite(c.x) || Math.hypot(x - c.x, z - c.z) > MAX_STEP_M
		const hasY = Number.isFinite(y) && y !== null
		if (T && !teleport && !jumped) ev = lapStep(T, c.lap, c.x, c.z, x, z, nowMs, hasY ? c.y : null, hasY ? y : null)
		c.x = x
		c.z = z
		c.y = hasY ? y : null
		if (T) {
			const yy = hasY ? y : null
			const near = nearestOnTrack(T, x, z, c.seg, 6, yy)
			/* a wrong-branch hint (big jump) → rescan the whole track */
			const n2 = near.score > T.half + 2 ? nearestOnTrack(T, x, z, -1, 6, yy) : near
			c.seg = n2.seg
			c.progress = progressOf(T, this.lapsOf(id), c.lap.cp, n2.s)
		}
		return ev
	}

	/** Server `lap` message (authoritative lap count). */
	serverLap(id, lap) {
		const c = this._get(id)
		c.serverLap = Math.max(c.serverLap, lap | 0)
		if (c.serverLap > c.lap.lap) {
			c.lap.lap = c.serverLap
			c.lap.cp = 0
		}
	}

	finish(id, totalMs) {
		this._get(id).finishedMs = totalMs
	}

	lapsOf(id) {
		const c = this.cars.get(id)
		return c ? Math.max(c.lap.lap, c.serverLap) : 0
	}

	remove(id) {
		this.cars.delete(id)
	}

	/** Ids in race order. */
	order() {
		return [...this.cars.entries()]
			.sort(([, a], [, b]) => {
				if (a.finishedMs != null || b.finishedMs != null) {
					if (a.finishedMs == null) return 1
					if (b.finishedMs == null) return -1
					return a.finishedMs - b.finishedMs
				}
				return b.progress - a.progress
			})
			.map(([id]) => id)
	}

	/** 1-based position of id (0 when unknown). */
	positionOf(id) {
		return this.order().indexOf(id) + 1
	}
}

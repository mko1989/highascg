'use strict'

/**
 * WO-1083 — Stage Skirmish mode `spot` ("Spotlight", every soldier for themselves): one spotlight pool lies on the
 * arena floor (radius 2.5 u) and moves to another pickup pad every 40 s (at least 12 u away when the arena allows; the
 * clients see `movesAt` and warn 5 s ahead). A soldier who stands in it ALONE scores a point per full second held;
 * two or more inside = contested, nobody scores. Frags do not score in this mode (kills and deaths are still counted);
 * the limit is points (default 60). In the lobby the spot is there to try, nothing is scored. Pure: clock, rng and
 * senders come in through the room context X (sk-room.js), which runs `tick` every 250 ms while the mode is `spot`
 * and the phase is lobby or match.
 *
 *   info()   → { x, z, r, movesAt, holder: id | null, contested } (metres / server ms) or null — `state.spot`
 *   tick()   moves the spot when due, finds the holder, scores
 *   reset()  no spot (a new arena, a mode change, the lobby after a match); the next tick places one
 */

const SPOT = Object.freeze({ radiusU: 2.5, moveMs: 40000, warnMs: 5000, tickMs: 250, pointMs: 1000, minMoveU: 12 })

/** @param {object} X the room context  @param {{ changed: () => void }} hooks  changed: the holder / place changed */
function createSpot(X, hooks) {
	let cur = null // { x, z, r, movesAt, i }
	let holder = null
	let contested = false
	let heldMs = 0
	let last = 0

	function place(t) {
		const pads = (X.arena?.pickups || []).map((p, i) => ({ x: p.x, z: p.z, i }))
		if (!pads.length) return (cur = null)
		let pool = pads.filter((p) => p.i !== cur?.i)
		const far = cur ? pool.filter((p) => Math.hypot(p.x - cur.x, p.z - cur.z) >= SPOT.minMoveU * X.u) : pool
		if (far.length) pool = far
		if (!pool.length) pool = pads
		const p = pool[Math.floor(X.rng() * pool.length)]
		cur = { x: p.x, z: p.z, r: SPOT.radiusU * X.u, movesAt: t + SPOT.moveMs, i: p.i }
		holder = null
		contested = false
		heldMs = 0
		hooks.changed()
	}

	function tick() {
		const t = X.now()
		const dt = last ? Math.min(1000, Math.max(0, t - last)) : 0
		last = t
		if (!X.arena) return
		if (!cur || t >= cur.movesAt) place(t)
		if (!cur) return
		const inside = [...X.players.values()].filter((p) => p.alive && p.pos && (p.connected || p.bot) && Math.hypot(p.pos[0] - cur.x, p.pos[1] - cur.z) <= cur.r)
		const h = inside.length === 1 ? inside[0] : null
		const c = inside.length > 1
		if (h !== holder || c !== contested) {
			if (h !== holder) heldMs = 0
			holder = h
			contested = c
			hooks.changed()
		}
		if (!holder || X.phase() !== 'match') return
		heldMs += dt
		let scored = false
		while (heldMs >= SPOT.pointMs) {
			heldMs -= SPOT.pointMs
			holder.score++
			holder.spot = (holder.spot || 0) + 1
			scored = true
		}
		if (scored) X.scored()
	}

	return {
		tick,
		info: () => (cur ? { x: cur.x, z: cur.z, r: cur.r, movesAt: cur.movesAt, holder: holder?.id ?? null, contested } : null),
		reset() {
			cur = null
			holder = null
			contested = false
			heldMs = 0
			last = 0
		},
	}
}

module.exports = { createSpot, SPOT }

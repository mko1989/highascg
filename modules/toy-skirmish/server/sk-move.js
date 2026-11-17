'use strict'

/**
 * WO-1081 / WO-1106 B55 — Stage Skirmish: a soldier's own position report `s` (contract §7), split out of sk-room.js.
 * The browser moves its soldier; the server only bounds what it accepts:
 *   - at most 20 reports a second (more are dropped);
 *   - outside the arena rect + 2 u: ignored;
 *   - farther than 6 u/s × (the time since the last accepted report + 0.1 s of slack for network bunching) — that
 *     window capped at 0.25 s, so a long silence never buys a long jump — is clamped to that distance;
 *   - the (clamped) point must be clear of the arena's solid grid (half the soldier's radius: positions are rounded)
 *     and the step to it must cross no solid cell of the grid shrunk by one cell (§5's tolerance: a corner cut by a
 *     short step after a dropped report is fine, a thick block is not) — else the report is refused.
 */

const S = require('./sk-sanitize')
const { RULES, SOLDIER } = require('./sk-rules')
const G = require('./sk-grid')

const STATE_HZ = 20
const SLACK_S = 0.1
const WINDOW_S = 0.25

/**
 * @param {object} X the room context  @param {number[]} sTimes the socket's recent report times (kept here)
 * @param {object} p the soldier (alive, placed)  @param {object} m the raw `s`  @param {number} t now (ms)
 * @returns {boolean} true when p moved (pos / yaw / mv / held updated)
 */
function acceptMove(X, sTimes, p, m, t) {
	const v = S.cleanMove(m)
	if (!v) return false
	if (sTimes.length >= STATE_HZ && t - sTimes[0] < 1000) return false // over 20 per second: dropped
	sTimes.push(t)
	if (sTimes.length > STATE_HZ) sTimes.shift()
	const r = X.arena.rect, sl = RULES.posSlack * X.u
	let [x, z] = v.p
	if (x < r[0] - sl || x > r[2] + sl || z < r[1] - sl || z > r[3] + sl) return false
	const dx = x - p.pos[0], dz = z - p.pos[1]
	const d = Math.hypot(dx, dz)
	const allowed = SOLDIER.maxSpeed * X.u * Math.min(WINDOW_S, Math.max(0, t - p.moveAt) / 1000 + SLACK_S)
	if (d > allowed) {
		x = Math.round((p.pos[0] + (dx / d) * allowed) * 1e4) / 1e4
		z = Math.round((p.pos[1] + (dz / d) * allowed) * 1e4) / 1e4
	}
	if (X.grid && (!G.clearAt(X.grid, x, z, SOLDIER.radius * X.u * 0.5) || !G.lineClear(X.grid, p.pos[0], p.pos[1], x, z, true))) return false
	p.pos = [x, z]
	p.yaw = v.yaw
	p.mv = v.mv
	p.moveAt = t
	if (v.w && p.w[v.w] !== undefined) p.held = v.w
	return true
}

module.exports = { acceptMove, STATE_HZ, WINDOW_S }

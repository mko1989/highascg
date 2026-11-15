'use strict'

/**
 * WO-1083 — Stage Skirmish: what a player can see (pure). A player's view is the browser's follow camera (client/cam.js
 * `followCam`): HEIGHT_U up, pitched PITCH_DEG down from the audience side, vertical field of view FOV_DEG, leaning
 * LEAD_U towards the aim. On the floor that frame is small — at a 16:10 viewport about 6.5 u up-screen, 5 u down-screen
 * and 7.4 u to either side of the own soldier — while the weapons reach 16–120 u. A bot must never notice, aim at or
 * hurt a soldier a human standing where the bot stands could not see, so every bot rule uses `botSees` below:
 *
 *   inFrame(dx, dz)        the plan offset (u, viewer → point) lies inside the follow camera's frame when that camera
 *                          leans towards the point, at the REFERENCE viewport (ASPECT 16:10 — narrower than a 16:9 or
 *                          phone-landscape browser, wider only than a 4:3 tablet) and EDGE (the inner 90 % of the frame:
 *                          a soldier cut by the screen edge or under the HUD is not "seen");
 *   botSees(a, b, u)       both ways: b is in a's frame AND a is in b's frame (the one being shot could see its shooter
 *                          by aiming that way) — the frame is not symmetric (down-screen is shorter), so this is the
 *                          stricter of the two: about ± 4.75 u screen-up / down, ± 6.85 u sideways, never past REACH_U.
 *
 * The camera numbers are the client's (a smoke pins them against client/cam.js). Lengths in u; positions in metres
 * with `u` = metres per u.
 */

const VIEW = Object.freeze({
	HEIGHT_U: 9, // client/cam.js HEIGHT_U
	PITCH_DEG: 64, // client/cam.js PITCH_DEG
	FOV_DEG: 40, // client/cam.js FOV_DEG (vertical)
	LEAD_U: 1.6, // client/cam.js LEAD_U
	ASPECT: 16 / 10, // reference viewport (width / height)
	EDGE: 0.9, // fraction of the frame that counts as seen (both axes)
})

const PITCH = (VIEW.PITCH_DEG * Math.PI) / 180
const TV = Math.tan((VIEW.FOV_DEG * Math.PI) / 360)
const BACK = VIEW.HEIGHT_U / Math.tan(PITCH)
const LEN = Math.hypot(VIEW.HEIGHT_U, BACK)
const FY = -VIEW.HEIGHT_U / LEN, FZ = -BACK / LEN // camera forward (fx = 0); right = +X; up = (0, −FZ, FY)

/** Normalised screen position [x, y] (−1…1, y up) of a floor point (dx, dz) u from the viewer, camera leaning at it. */
function ndcOf(dx, dz) {
	const d = Math.hypot(dx, dz)
	const lx = d > 1e-9 ? (dx / d) * VIEW.LEAD_U : 0
	const lz = d > 1e-9 ? (dz / d) * VIEW.LEAD_U : 0
	const vx = dx - lx, vy = -VIEW.HEIGHT_U, vz = dz - lz - BACK // point − eye
	const zc = vy * FY + vz * FZ
	if (zc <= 1e-9) return null
	const yc = vy * -FZ + vz * FY
	return [vx / (zc * TV * VIEW.ASPECT), yc / (zc * TV)]
}

/** Is the plan offset (dx, dz) in u inside the reference frame (camera leaning towards it)? */
function inFrame(dx, dz) {
	const n = ndcOf(dx, dz)
	return !!n && Math.abs(n[0]) <= VIEW.EDGE && Math.abs(n[1]) <= VIEW.EDGE
}

/** Farthest seen distance (u) along a plan direction (binary search; the frame is convex along a ray). */
function reachAlong(dx, dz, both = true) {
	let lo = 0, hi = 50
	for (let i = 0; i < 50; i++) {
		const m = (lo + hi) / 2
		if (inFrame(dx * m, dz * m) && (!both || inFrame(-dx * m, -dz * m))) lo = m
		else hi = m
	}
	return lo
}

/** The largest both-ways distance in any direction (u): a quick reject and the reported limit. */
const REACH_U = (() => {
	let best = 0
	for (let k = 0; k < 360; k++) best = Math.max(best, reachAlong(Math.sin((k * Math.PI) / 180), -Math.cos((k * Math.PI) / 180)))
	return Math.ceil(best * 100) / 100
})()

/** a, b: [x, z] in metres; u = metres per u. Could a player at a see b, and b see a? */
function botSees(a, b, u) {
	const dx = (b[0] - a[0]) / u, dz = (b[1] - a[1]) / u
	if (Math.hypot(dx, dz) > REACH_U) return false
	return inFrame(dx, dz) && inFrame(-dx, -dz)
}

module.exports = { VIEW, REACH_U, ndcOf, inFrame, reachAlong, botSees }

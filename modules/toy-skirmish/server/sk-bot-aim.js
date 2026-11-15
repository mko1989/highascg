'use strict'

/**
 * WO-1083 — Stage Skirmish: how a bot notices, turns and aims (pure; the room context X comes in). A bot plays by what
 * a human in its place could do (owner, 15.11: "bots shouldnt be able to aim longer than a player can"):
 *   notice   an enemy that is alive, not spawn-protected, inside the follow camera's frame both ways (sk-view.js
 *            `botSees`: ≤ 4.75 u screen-up / down, ≤ 6.85 u sideways, never past 7.1 u) and with a line to it that
 *            crosses no solid cell; the nearest such enemy is the target. Nothing else of an enemy is known — a target
 *            out of sight is dropped at once (no turning towards it, no firing).
 *   react    a new target is fired at only after a reaction time drawn per sighting (level `react` ms); one seen again
 *            within REACQUIRE_MS of losing it keeps its sighting (a flicker behind a table leg is not a new surprise);
 *   turn     the aim turns at most `turn` °/s (no snap), towards the target, or the walking direction when there is none;
 *   fire     only while the aim is within `cone` ° of the target, with an error uniform in ± (`base` + `perU` × distance) °;
 *            the referee (sk-combat.js) re-checks range, view and line for every bot hit regardless.
 * LEVELS are the host's bot skill (easy / normal / hard); every level obeys the same view rule.
 */

const G = require('./sk-grid')
const { botSees } = require('./sk-view')
const { WEAPONS, ROCKET } = require('./sk-rules')

const DEG = Math.PI / 180
const REACQUIRE_MS = 400

const LEVELS = Object.freeze({
	easy: Object.freeze({ react: [520, 820], turn: 270, base: 3, perU: 1.1, cone: 9 }),
	normal: Object.freeze({ react: [300, 500], turn: 450, base: 1.5, perU: 0.6, cone: 6 }),
	hard: Object.freeze({ react: [200, 320], turn: 720, base: 0.8, perU: 0.35, cone: 4 }),
})
const LEVEL_IDS = Object.keys(LEVELS)

/** Angle into (−π, π]. */
function wrap(a) {
	let v = a % (2 * Math.PI)
	if (v > Math.PI) v -= 2 * Math.PI
	if (v <= -Math.PI) v += 2 * Math.PI
	return v
}
const angDiff = (from, to) => wrap(to - from)

/** One step of at most maxStep radians from cur towards want. */
function turnTowards(cur, want, maxStep) {
	const d = angDiff(cur, want)
	return wrap(Math.abs(d) <= maxStep ? want : cur + Math.sign(d) * maxStep)
}

/** Could bot p notice q from where it stands: the view rule and a line that crosses no solid cell. */
function canSee(X, p, q, t) {
	if (!q.alive || !q.pos || q.protectUntil > t) return false
	return botSees(p.pos, q.pos, X.u) && G.lineClear(X.grid, p.pos[0], p.pos[1], q.pos[0], q.pos[1])
}

/** The nearest enemy p can notice, or null. */
function spot(X, p, enemies, t) {
	let best = null, bd = Infinity
	for (const q of enemies) {
		const d = Math.hypot(q.pos[0] - p.pos[0], q.pos[1] - p.pos[1])
		if (d < bd && canSee(X, p, q, t)) (best = q), (bd = d)
	}
	return best
}

/**
 * Update the bot's target, reaction and aim for this tick. heading: the walking yaw or null. → true when it may fire.
 * ai fields: target, seenSince, reactMs, lostId, lostAt, aim (radians).
 */
function aimStep(X, p, q, t, dt, heading, L) {
	const ai = p.ai
	if (ai.aim == null) ai.aim = p.yaw || 0
	if (q !== ai.target) {
		if (ai.target) (ai.lostId = ai.target.id), (ai.lostAt = t)
		const again = q && ai.lostId === q.id && t - ai.lostAt <= REACQUIRE_MS
		ai.target = q
		if (q && !again) (ai.seenSince = t), (ai.reactMs = L.react[0] + X.rng() * (L.react[1] - L.react[0]))
	}
	const want = q ? Math.atan2(-(q.pos[0] - p.pos[0]), -(q.pos[1] - p.pos[1])) : heading
	if (want != null) ai.aim = turnTowards(ai.aim, want, L.turn * DEG * dt)
	p.yaw = Math.round(ai.aim * 1000) / 1000
	return !!q && t - ai.seenSince >= ai.reactMs && Math.abs(angDiff(ai.aim, want)) <= L.cone * DEG
}

/** The yaw a bot's shot leaves at: its aim plus the level's error for a target d u away. */
function shotYaw(X, p, d, L) {
	const err = (L.base + L.perU * d) * DEG
	return p.ai.aim + (X.rng() * 2 - 1) * err
}

/** Best weapon held (with ammo) for a target d u away (always inside the view, ≤ 7.1 u), or null. */
function choose(p, d) {
	const has = (w) => p.w[w] !== undefined && p.w[w] !== 0 && d <= WEAPONS[w].range
	if (has('scatter') && d <= 8) return 'scatter'
	if (has('thumper') && d > ROCKET.splash + 0.5) return 'thumper' // its own splash stays clear of it
	for (const w of ['longshot', 'rattler', 'scatter', 'pea']) if (has(w)) return w
	return null
}

module.exports = { LEVELS, LEVEL_IDS, wrap, spot, aimStep, shotYaw, choose }

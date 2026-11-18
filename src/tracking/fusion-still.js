'use strict'

/**
 * WO-616 T10a — fusion's stand-still veto (fusion.js). A detector takes furniture for people (a lectern, a piano
 * leg): such a "person" never walks and only one camera reports it, at a spot another live camera sees well and
 * finds nobody. Its world track is marked `still` and left out of Fusion.persons().
 *
 *   becomes still   one camera's support alone for STILL_AFTER_MS, another camera has the spot in view
 *                   (fusion-reproject.inView) and no free box of its own there (columnMatch), and the track has not
 *                   walked STILL_MOVE_M in the last WALKED_KEEP_MS.
 *                   Or, with two cameras live: nobody else can see the spot and its score stays under WEAK_SCORE
 *                   (a chair stack in the corner of one picture).
 *   while still     it keeps its own box (same camera track id, within STILL_HOLD_M) out of the association —
 *                   else a passer-by pairs with the lectern.
 *   ends            the track walks STILL_MOVE_M, or another camera shows a free matching box for STILL_SEEN_MS
 *                   (a presenter stepping up to the lectern: both boxes become one person again).
 *   remembered      a track that loses its box (a flickering detection) leaves its spot and its time alone; a new
 *                   one-camera track there carries on from it instead of showing for another STILL_AFTER_MS.
 */

const { assign } = require('./hungarian')
const { columnMatch, inView } = require('./fusion-reproject')

const STILL_AFTER_MS = 5000
const STILL_MOVE_M = 1.0
const STILL_SEEN_MS = 3000
const STILL_HOLD_M = 0.5
const WALKED_KEEP_MS = 20000 // a walk counts this long: a walker's track that ends up on furniture is vetoed in the end
const WEAK_SCORE = 0.4 // below this average a stand-still track needs no second camera's word (two-camera rigs only)
const SCORE_BLEND = 0.05
const SPOT_M = 0.75
const SPOTS_MAX = 32

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const at = (t) => [t.ax.p, t.ay.p]

/** Fields a new track starts with; `spots` = the fusion's remembered still spots (one is used up when it applies). */
function stillStart(m, spots, now) {
	const i =
		m.cameras.length === 1 ? spots.findIndex((s) => s.camera === m.cameras[0] && dist2(s.at, [m.x, m.y]) <= SPOT_M) : -1
	const [spot] = i >= 0 ? spots.splice(i, 1) : [null]
	const still = !!spot && spot.alone >= STILL_AFTER_MS
	return {
		anchor: [m.x, m.y],
		walkedAt: null,
		aloneSince: spot && !still ? now - spot.alone : null,
		seenSince: null,
		still,
	}
}

/** A pruned track that was still, or on its way there (a detection that flickers), leaves its spot and its time alone. */
function rememberSpot(t, spots) {
	if (!t.still && t.aloneSince === null) return
	spots.push({ camera: t.cameras[0], at: at(t), alone: t.still ? STILL_AFTER_MS : t.seen - t.aloneSince })
	if (spots.length > SPOTS_MAX) spots.shift()
}

/** Still tracks take their own boxes first → [[track, obs]…]; those obs are removed from `obs` (mutated). */
function holdStill(tracks, obs) {
	const stills = tracks.filter((t) => t.still)
	if (!stills.length || !obs.length) return []
	const cost = stills.map((t) => obs.map((o) => (t.keys.includes(o.key) ? dist2(o.feet, at(t)) : Infinity)))
	const pairs = assign(cost, STILL_HOLD_M).map(([i, j]) => [stills[i], obs[j]])
	for (const [, o] of pairs) obs.splice(obs.indexOf(o), 1)
	return pairs
}

/**
 * Judge one track supported in this step. `fresh`: the live cameras [{ id, entry }], `obs`: every observation of
 * the step, `claimed`: keys of boxes that are part of a two-camera person.
 */
function judgeStill(t, { fresh, obs, claimed, now, planeZ }) {
	const p = at(t)
	if (dist2(p, t.anchor) > STILL_MOVE_M) Object.assign(t, { walkedAt: now, still: false, anchor: p })
	const own = t.cameras[0]
	const body = { camera: own, entry: fresh.find((c) => c.id === own)?.entry, feet: p, box: [0, 0, 0, 0.5], ray: null }
	const single = t.cameras.length === 1 && !!body.entry
	const watched = single && fresh.some((c) => c.id !== own && inView(c.entry, p[0], p[1], planeZ))
	const seen = single && obs.some((o) => o.camera !== own && !claimed.has(o.key) && columnMatch(body, o, planeZ))
	if (t.still) {
		t.seenSince = seen ? (t.seenSince ?? now) : null
		if (seen && now - t.seenSince >= STILL_SEEN_MS) Object.assign(t, { still: false, aloneSince: null, seenSince: null })
		return
	}
	t.scoreAvg = t.scoreAvg === undefined ? t.score : t.scoreAvg + SCORE_BLEND * (t.score - t.scoreAvg)
	const weak = single && fresh.length > 1 && !watched && t.scoreAvg < WEAK_SCORE // beside the stage, in one camera's corner
	const alone = ((watched && !seen) || weak) && !(t.walkedAt !== null && now - t.walkedAt <= WALKED_KEEP_MS)
	t.aloneSince = alone ? (t.aloneSince ?? now) : null
	if (alone && now - t.aloneSince >= STILL_AFTER_MS) Object.assign(t, { still: true, anchor: p, seenSince: null })
}

module.exports = { stillStart, rememberSpot, holdStill, judgeStill, STILL_AFTER_MS }

'use strict'

/**
 * WO-1074 §3 — toy scale. The room stays life-size; the cars, the tracks and everything the game adds shrink by one
 * number, `scale` (live: RC_SCALE = 0.1 — "like toys in the room"). Every length, speed and acceleration of the game
 * scales by it; times, angles and lap counts do not. The scene JSON carries `scale` (absent → 1, the v2 sizes).
 *
 * The track rules are written once, at scale 1 (rc-track-check*.js, rc-ground.js, the v2 generator). A toy track is
 * judged and generated in the **unit frame**: every coordinate of the track and of the scene divided by `scale` (the
 * hall becomes ten times larger, the 0.58 m stage 5.8 m high), so each v2 rule holds with its lengths × scale, slopes
 * and kinks unchanged. What only exists at toy scale — the occupancy grids per floor (`occ`, rc-scene-occ.js), up to
 * 2500 points, widths 0.30–0.45 m — rides along as `scene.toy` of the unit scene (rc-track-check-occ.js).
 */

const { fieldOf } = require('./rc-scene-height')
const { fromJSON: occFromJSON } = require('./rc-scene-occ')

const RC_SCALE = 0.1
const TOY_MAX_POINTS = 2500
const TOY_WIDTH = [0.3, 0.45] // m (world)

/** The scale a scene / call asks for: opts.scale, else scene.scale, else 1 (only 0 < s ≤ 1 counts). */
function sceneScale(scene, opts = {}) {
	const s = opts.scale ?? scene?.scale ?? 1
	return typeof s === 'number' && Number.isFinite(s) && s > 0 && s <= 1 ? s : 1
}

/** Round a world value that came from a unit-frame value rounded to 1 mm (→ 0.1 mm at scale 0.1; float noise gone). */
const roundTo = (s) => {
	const q = Math.max(1, Math.round(1000 / s))
	return (v) => Math.round(v * q) / q + 0 // + 0: no -0 (JSON drops the sign)
}

/** A copy of track `t` with every length × k (points, width, length, grid / pads / boxes positions); yaw, indices kept. */
function scaleTrack(t, k, round = (v) => v) {
	const P = (p) => p.map((v) => round(v * k))
	const xyz = (o) => ({ ...o, x: round(o.x * k), y: round(o.y * k), z: round(o.z * k), ...(Object.is(o.yaw, -0) ? { yaw: 0 } : {}) }) // -0 does not survive JSON
	const out = { ...t, points: (t.points || []).map((p) => (Array.isArray(p) ? P(p) : p)) }
	if (typeof t.width === 'number') out.width = round(t.width * k)
	if (typeof t.length === 'number') out.length = round(t.length * k)
	for (const key of ['grid', 'pads', 'boxes']) if (Array.isArray(t[key])) out[key] = t[key].map((o) => (o && typeof o === 'object' ? xyz(o) : o))
	return out
}

/** A unit-frame view of a world height field (queries in unit coordinates). */
function unitField(F, s) {
	if (!F) return null
	return {
		cell: F.cell / s, bin: F.bin / s, x0: F.x0 / s, z0: F.z0 / s, nx: F.nx, nz: F.nz, floor: F.floor / s, base: F.base / s,
		bandHit: (x, z, half, yLo, yHi) => F.bandHit(x * s, z * s, half * s, yLo * s, yHi * s),
		topBelow: (x, z, y) => F.topBelow(x * s, z * s, y * s) / s,
		bottomAbove: (x, z, y) => F.bottomAbove(x * s, z * s, y * s) / s,
	}
}

const unitCache = new WeakMap()

/**
 * The unit-frame view of a world scene at scale s (cached per scene object): floors, obstacles, bounds ÷ s, the height
 * field wrapped, and `toy` = { s, occ: [world grids], minWidth, maxWidth, maxPoints } (unit lengths).
 */
function toUnitScene(scene, s) {
	const hit = unitCache.get(scene)
	if (hit && hit.s === s) return hit.unit
	const d = (v) => v / s
	const box = (o) => ({ ...o, min: o.min.map(d), max: o.max.map(d) })
	const occ = (Array.isArray(scene?.occ) ? scene.occ : []).map((o) => (o && typeof o.segNear === 'function' ? o : occFromJSON(o))).filter(Boolean)
	const unit = {
		floors: (scene?.floors || []).filter((f) => f && Array.isArray(f.rect)).map((f) => ({ ...f, y: d(f.y), rect: f.rect.map(d) })),
		obstacles: (scene?.obstacles || []).filter((o) => o && Array.isArray(o.min) && Array.isArray(o.max)).map(box),
		bounds: scene?.bounds ? { min: scene.bounds.min.map(d), max: scene.bounds.max.map(d) } : null,
		field: unitField(fieldOf(scene), s),
		toy: { s, occ, minWidth: TOY_WIDTH[0] / s, maxWidth: TOY_WIDTH[1] / s, maxPoints: TOY_MAX_POINTS },
	}
	unitCache.set(scene, { s, unit })
	return unit
}

module.exports = { RC_SCALE, TOY_MAX_POINTS, TOY_WIDTH, sceneScale, scaleTrack, roundTo, toUnitScene }

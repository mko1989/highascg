'use strict'

/**
 * WO-667 T2 — 3D body joints for each fused world person (research step 3, the posed previs dummies). Inputs are
 * the sidecar's per-camera COCO keypoints (`kps`, tools/tracking-detect/pose.py: 17 × [x, y, v], 0–1 in the frame).
 *
 *   2+ cameras  each joint seen (v ≥ MIN_VIS) by two or more of the person's cameras is triangulated with fusion's
 *               least-squares ray point; refused when the rays are near-parallel or miss each other (> MAX_GAP_M).
 *   1 camera    the joint's ray is cut with the upright plane through the person's floor position, facing that
 *               camera — flat but in the right place, so a single-camera rig still gets a pose.
 *   smoothing   per world person, each joint eases toward the new value (ALPHA); a jump > SNAP_M snaps.
 *
 * Output: `joints` on the world person — 17 × ([x, y, z] PSN metres, mm-rounded | null), COCO order.
 */

const { pixelRay } = require('./camera-model')
const { triangulate } = require('./fusion')

const NK = 17
const MIN_VIS = 0.5
const MIN_ANGLE_DEG = 5
const MAX_GAP_M = 0.2
const ALPHA = 0.5
const SNAP_M = 0.5
const KEEP_MS = 1000

const angleDeg = (a, b) => (Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI

/** One camera's ray through keypoint j of a person, or null (not visible / camera can't say). */
function kpRay(view, j) {
	const k = view.person.kps
	if (!Array.isArray(k) || k.length < NK * 3 || !(k[j * 3 + 2] >= MIN_VIS)) return null
	const [w, h] = view.entry.raster
	return pixelRay(view.entry.cam, [k[j * 3] * w, k[j * 3 + 1] * h], w, h)
}

/** Ray ∩ the upright plane through floor point (x, y) whose normal points (horizontally) at the ray's origin. */
function onUprightPlane(ray, x, y) {
	const n = [ray.o[0] - x, ray.o[1] - y]
	const len = Math.hypot(n[0], n[1])
	if (len < 1e-6) return null
	const nx = n[0] / len, ny = n[1] / len
	const den = nx * ray.d[0] + ny * ray.d[1]
	if (Math.abs(den) < 1e-6) return null
	const t = (nx * (x - ray.o[0]) + ny * (y - ray.o[1])) / den
	return t > 0 ? [ray.o[0] + t * ray.d[0], ray.o[1] + t * ray.d[1], ray.o[2] + t * ray.d[2]] : null
}

/**
 * Raw joints of one world person. `views` = [{ entry (solved camera), person (with kps) }], biggest box first —
 * the first view is the monocular fallback. → 17 × ([x, y, z] | null), or null when no view has keypoints.
 */
function personJoints(wp, views) {
	const vs = views.filter((v) => v.entry?.cam && Array.isArray(v.person?.kps))
	if (!vs.length) return null
	const out = []
	for (let j = 0; j < NK; j++) {
		const rays = vs.map((v) => kpRay(v, j)).filter(Boolean)
		let p = null
		if (rays.length >= 2) {
			let wide = false
			for (let a = 0; a < rays.length && !wide; a++) for (let b = a + 1; b < rays.length; b++) if (angleDeg(rays[a].d, rays[b].d) >= MIN_ANGLE_DEG) wide = true
			const tri = wide ? triangulate(rays) : null
			if (tri && tri.gap <= MAX_GAP_M) p = tri.p
		}
		if (!p && rays.length) p = onUprightPlane(rays[0], wp.x, wp.y)
		out.push(p && p.every(Number.isFinite) ? p : null)
	}
	return out.some(Boolean) ? out : null
}

/** Per world person smoothing + the snapshot hook. */
class Pose3D {
	constructor() {
		this.last = new Map() // world id → { at, joints }
	}

	/**
	 * One fusion step: eases the joints of every world person supported in it (age_s 0) toward what `frames`
	 * (detect-service frames(): [{ id, entry, persons }]) show now; forgets persons fusion dropped.
	 */
	update(world, frames, now) {
		const byKey = new Map()
		for (const f of frames) for (const p of f.persons) byKey.set(`${f.id}:${p.tid}`, { entry: f.entry, person: p })
		const ids = new Set(world.map((w) => w.id))
		for (const id of [...this.last.keys()]) if (!ids.has(id)) this.last.delete(id)
		for (const w of world) {
			if (w.age_s !== 0) continue
			const views = (w.keys || []).map((k) => byKey.get(k)).filter(Boolean)
			views.sort((a, b) => area(b.person.box) - area(a.person.box))
			const raw = personJoints(w, views)
			if (!raw) continue
			const prev = this.last.get(w.id)
			this.last.set(w.id, { at: now, joints: raw.map((p, j) => ease(prev?.joints[j], p)) })
		}
	}

	/** World persons → copies with `joints` where some are known from the last KEEP_MS (a coasting person keeps them). */
	decorate(world, now) {
		return world.map((w) => {
			const l = this.last.get(w.id)
			return l && now - l.at <= KEEP_MS ? { ...w, joints: l.joints.map(round3) } : w
		})
	}

	reset() {
		this.last.clear()
	}
}

const area = (b) => (b[2] - b[0]) * (b[3] - b[1])
const round3 = (p) => (p ? p.map((v) => Math.round(v * 1000) / 1000) : null)

function ease(prev, p) {
	if (!p) return prev || null
	if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) > SNAP_M) return p
	return prev.map((v, i) => v + ALPHA * (p[i] - v))
}

module.exports = { Pose3D, personJoints, onUprightPlane, NK }

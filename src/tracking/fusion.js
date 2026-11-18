'use strict'

/**
 * WO-616 T10a — multi-camera fusion: every watched camera's detected persons → one list of WORLD persons on the
 * stage floor with stable ids (the two-camera workflow, WO-616 "enhanced tracking" 3–5). New work — OpenFollow has
 * no fusion (its stations only share markers); the per-camera inputs are its detector + ByteTrack (T9a).
 *
 *   observe    each fresh box (matched this sidecar step) → feet point on the floor (monocular, depth-uncertain)
 *              + head ray (top-centre pixel through the solved camera, lens inverted).
 *   associate  cameras in id order; each camera's boxes are Hungarian-matched to the clusters so far — on floor
 *              distance of the feet (gate ASSOC_GATE_M), or on their head rays meeting (headMatch): the feet point
 *              assumes the stage plane and a whole box, so a person beside the stage, behind a monitor or cut by the
 *              picture edge lands metres apart per camera (opposite cameras err in opposite directions) while
 *              the head rays still cross. Unmatched boxes open a cluster. A cluster holds ≤ 1 box per camera.
 *   measure    2+ cameras: least-squares point nearest all head rays → x/y (precise) + height; refused (feet mean
 *              instead) when the rays are near-parallel, miss each other or give an implausible head height.
 *              1 camera: its feet point, with a sigma growing with the distance to the camera.
 *   track      one constant-velocity Kalman filter per world person; clusters → tracks by Hungarian on distance
 *              to the prediction (gate TRACK_GATE_M), a box key (camera:tid) the track carried last step making it
 *              free — ByteTrack keeps ids per camera, the world track owns the person id. A track with no support
 *              coasts as `predicted` and is dropped after STALE_MS (OpenFollow's 1 s marker rule).
 *
 * The engine steps only when some camera brought a new frame; each camera contributes its latest frame while it
 * is fresher than FRAME_MAX_AGE_MS (the cameras are not frame-locked; 67 ms apart at walking pace ≈ 9 cm).
 */

const { pixelRay } = require('./camera-model')
const { boxPoint } = require('./detect-model')
const { assign } = require('./hungarian')
const { columnMatch, cutTop } = require('./fusion-reproject')
const { stillStart, rememberSpot, holdStill, judgeStill } = require('./fusion-still')

const ASSOC_GATE_M = 0.75
const TRACK_GATE_M = 1.0
const STICKY_MAX_M = 2.0
const STALE_MS = 1000
const FRAME_MAX_AGE_MS = 250
const MIN_RAY_ANGLE_DEG = 8
const MAX_RAY_GAP_M = 0.35
const HEAD_HEIGHT_M = [0.9, 2.5]
const HEAD_MATCH_HEIGHT_M = [0.2, 2.5] // above the plane, for pairing only: a person on the hall floor beside a riser, bent over
const HEAD_MATCH_FEET_MISS_M = 0.5 // each camera's feet ray must pass this near the vertical under the head…
const HEAD_MATCH_FLOOR_M = [-1.0, 0.3] // …at a floor level this far from the plane (the hall floor under a riser, never well above it)…
const HEAD_MATCH_FLOOR_AGREE_M = 0.4 // …the same level for both cameras…
const HEAD_MATCH_BODY_M = [0.8, 2.3] // …leaving a body of this height under the head
const SIGMA_FUSED_M = 0.05
const SIGMA_MONO_BASE_M = 0.05
const SIGMA_MONO_PER_M = 0.02
const ACCEL_NOISE = 2.0 // m²/s³ white-acceleration spectral density
const MAX_DT_S = 0.5
const SPAWN_MIN_SCORE = 0.25 // one camera alone opens a person only above this (chair stacks and cases score 0.1–0.2); two cameras always do

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** One fresh person of camera `c` → an observation, or null when the camera cannot place it on the floor. */
function observe(p, c, planeZ) {
	const feet = boxPoint(p.box, c.entry, planeZ)
	if (!feet) return null
	const [w, h] = c.entry.raster
	const ray = pixelRay(c.entry.cam, [((p.box[0] + p.box[2]) / 2) * w, p.box[1] * h], w, h)
	const cam = c.entry.cam
	const range = Math.hypot(feet[0] - Number(cam.pos_x), feet[1] - Number(cam.pos_y))
	return {
		key: `${c.id}:${p.tid}`,
		camera: c.id,
		entry: c.entry,
		tid: p.tid,
		score: p.score,
		box: p.box,
		feet: [feet[0], feet[1]],
		ray,
		range,
	}
}

/**
 * Do the head rays of two boxes (different cameras) meet at one head? → a cost on the feet-distance scale
 * (0 … ASSOC_GATE_M as the rays' miss distance goes 0 … MAX_RAY_GAP_M), or Infinity. Head rays alone cross by
 * chance (two cameras facing each other along a stage share most epipolar planes), so the feet must agree too: each
 * camera's feet ray has to pass under the head, both at the same floor level, with a body's height in between.
 */
function headMatch(a, b, planeZ = 0) {
	if (!a.ray || !b.ray || a.camera === b.camera || cutTop(a) || cutTop(b)) return Infinity
	const rays = [a.ray, b.ray]
	if (maxRayAngle(rays) < MIN_RAY_ANGLE_DEG) return Infinity
	const tri = triangulate(rays)
	if (!tri || tri.gap > MAX_RAY_GAP_M) return Infinity
	const hgt = tri.p[2] - planeZ
	if (!(hgt >= HEAD_MATCH_HEIGHT_M[0] && hgt <= HEAD_MATCH_HEIGHT_M[1])) return Infinity
	const levels = [a, b].map((o) => floorUnder(o, tri.p, planeZ))
	if (levels.some((z) => z === null || z - planeZ < HEAD_MATCH_FLOOR_M[0] || z - planeZ > HEAD_MATCH_FLOOR_M[1]))
		return Infinity
	if (Math.abs(levels[0] - levels[1]) > HEAD_MATCH_FLOOR_AGREE_M) return Infinity
	const body = tri.p[2] - (levels[0] + levels[1]) / 2
	if (body < HEAD_MATCH_BODY_M[0] || body > HEAD_MATCH_BODY_M[1]) return Infinity
	return (ASSOC_GATE_M * tri.gap) / MAX_RAY_GAP_M
}

/** Height at which the feet ray of `o` (camera → its feet point on the plane) passes under the head `p`; null when it misses. */
function floorUnder(o, p, planeZ) {
	const c = o.ray.o
	const dx = o.feet[0] - c[0],
		dy = o.feet[1] - c[1]
	const len2 = dx * dx + dy * dy
	if (len2 < 1e-9) return null
	const t = ((p[0] - c[0]) * dx + (p[1] - c[1]) * dy) / len2
	if (Math.hypot(c[0] + t * dx - p[0], c[1] + t * dy - p[1]) > HEAD_MATCH_FEET_MISS_M) return null
	return c[2] + t * (planeZ - c[2])
}

/** Two boxes of different cameras as one person, beyond floor distance: the head rays meet, or one's body explains the other's box. */
function pairCost(a, b, planeZ) {
	const ab = columnMatch(a, b, planeZ),
		ba = columnMatch(b, a, planeZ)
	return Math.min(
		headMatch(a, b, planeZ),
		ab ? ASSOC_GATE_M * ab.cost : Infinity,
		ba ? ASSOC_GATE_M * ba.cost : Infinity
	)
}

/** A pair made on the picture (columnMatch): the box that shows less than the body gets `feetBad` — measure() skips its feet. */
function markHiddenFeet(a, b, planeZ) {
	if (headMatch(a, b, planeZ) < Infinity) return
	const ab = columnMatch(a, b, planeZ),
		ba = columnMatch(b, a, planeZ)
	if (ab?.feetBad && !ba?.feetBad) b.feetBad = true
	else if (ba?.feetBad && !ab?.feetBad) a.feetBad = true
}

/** Observations → clusters ([obs…], ≤ 1 per camera), cameras in id order. */
function associate(obs, gate = ASSOC_GATE_M, planeZ = 0) {
	const byCam = new Map()
	for (const o of obs) {
		if (!byCam.has(o.camera)) byCam.set(o.camera, [])
		byCam.get(o.camera).push(o)
	}
	const clusters = []
	for (const cam of [...byCam.keys()].sort()) {
		const list = byCam.get(cam)
		const centres = clusters.map(feetMean)
		const pairs = assign(
			centres.map((c, i) =>
				list.map((o) => Math.min(dist2(c, o.feet), ...clusters[i].map((m) => pairCost(m, o, planeZ))))
			),
			gate
		)
		const used = new Set()
		for (const [i, j] of pairs) {
			if (dist2(centres[i], list[j].feet) > gate) for (const m of clusters[i]) markHiddenFeet(m, list[j], planeZ)
			clusters[i].push(list[j])
			used.add(j)
		}
		list.forEach((o, j) => used.has(j) || clusters.push([o]))
	}
	return clusters
}

function feetMean(cl) {
	return [cl.reduce((s, o) => s + o.feet[0], 0) / cl.length, cl.reduce((s, o) => s + o.feet[1], 0) / cl.length]
}

/** Point nearest (least squares) to every ray { o, d } (unit d); null when degenerate. Also the worst miss distance. */
function triangulate(rays) {
	const A = [0, 0, 0, 0, 0, 0, 0, 0, 0]
	const b = [0, 0, 0]
	for (const { o, d } of rays) {
		for (let i = 0; i < 3; i++) {
			for (let j = 0; j < 3; j++) {
				const m = (i === j ? 1 : 0) - d[i] * d[j]
				A[i * 3 + j] += m
				b[i] += m * o[j]
			}
		}
	}
	const p = solve3(A, b)
	if (!p) return null
	let gap = 0
	for (const { o, d } of rays) {
		const v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]]
		const t = v[0] * d[0] + v[1] * d[1] + v[2] * d[2]
		gap = Math.max(gap, Math.hypot(v[0] - t * d[0], v[1] - t * d[1], v[2] - t * d[2]))
	}
	return { p, gap }
}

function solve3(A, b) {
	const det = (m) =>
		m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
	const D = det(A)
	if (Math.abs(D) < 1e-9) return null
	return [0, 1, 2].map((k) => det(A.map((v, i) => (i % 3 === k ? b[Math.floor(i / 3)] : v))) / D)
}

/** Largest angle (deg) between any two rays of the cluster. */
function maxRayAngle(rays) {
	let best = 0
	for (let i = 0; i < rays.length; i++) {
		for (let j = i + 1; j < rays.length; j++) {
			const c = rays[i].d[0] * rays[j].d[0] + rays[i].d[1] * rays[j].d[1] + rays[i].d[2] * rays[j].d[2]
			best = Math.max(best, (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI)
		}
	}
	return best
}

/** A cluster → one floor measurement { x, y, height, sigma, source, cameras, keys, score, area (largest box) }. */
function measure(cl, planeZ = 0) {
	const cameras = cl.map((o) => o.camera)
	const keys = cl.map((o) => o.key)
	const score = Math.max(...cl.map((o) => o.score))
	const area = Math.max(...cl.map((o) => (o.box[2] - o.box[0]) * (o.box[3] - o.box[1])))
	if (cl.length >= 2) {
		const rays = cl.filter((o) => o.ray && !cutTop(o) && !o.feetBad).map((o) => o.ray)
		const tri = rays.length >= 2 && maxRayAngle(rays) >= MIN_RAY_ANGLE_DEG ? triangulate(rays) : null
		const hgt = tri ? tri.p[2] - planeZ : NaN
		const [lo, hi] = cl.length === 2 && headMatch(cl[0], cl[1], planeZ) < Infinity ? HEAD_MATCH_HEIGHT_M : HEAD_HEIGHT_M
		if (tri && tri.gap <= MAX_RAY_GAP_M && hgt >= lo && hgt <= hi) {
			return {
				x: tri.p[0],
				y: tri.p[1],
				height: hgt,
				sigma: SIGMA_FUSED_M,
				source: 'fused',
				triangulated: true,
				cameras,
				keys,
				score,
				area,
			}
		}
		let sw = 0,
			sx = 0,
			sy = 0
		const good = cl.filter((o) => !o.feetBad)
		for (const o of good.length ? good : cl) {
			const wgt = 1 / monoSigma(o) ** 2
			sw += wgt
			sx += wgt * o.feet[0]
			sy += wgt * o.feet[1]
		}
		return {
			x: sx / sw,
			y: sy / sw,
			height: null,
			sigma: 1 / Math.sqrt(sw),
			source: 'fused',
			triangulated: false,
			cameras,
			keys,
			score,
			area,
		}
	}
	const o = cl[0]
	return {
		x: o.feet[0],
		y: o.feet[1],
		height: null,
		sigma: monoSigma(o),
		source: o.camera,
		triangulated: false,
		cameras,
		keys,
		score,
		area,
	}
}

const monoSigma = (o) => SIGMA_MONO_BASE_M + SIGMA_MONO_PER_M * o.range

/** Constant-velocity Kalman on one axis: state [p, v], covariance [pp, pv, vv]. */
function kfPredict(a, dt) {
	a.p += a.v * dt
	const q = ACCEL_NOISE
	const pp = a.P[0] + 2 * dt * a.P[1] + dt * dt * a.P[2] + (q * dt ** 3) / 3
	const pv = a.P[1] + dt * a.P[2] + (q * dt ** 2) / 2
	const vv = a.P[2] + q * dt
	a.P = [pp, pv, vv]
}

function kfUpdate(a, z, r) {
	const s = a.P[0] + r
	const k0 = a.P[0] / s,
		k1 = a.P[1] / s
	const y = z - a.p
	a.p += k0 * y
	a.v += k1 * y
	a.P = [(1 - k0) * a.P[0], (1 - k0) * a.P[1], a.P[2] - k1 * a.P[1]]
}

const newAxis = (p, sigma) => ({ p, v: 0, P: [sigma * sigma, 0, 1] })

class Fusion {
	constructor() {
		this.tracks = []
		this.nextId = 1
		this.frames = new Map() // camera id → last frame used
		this.spots = [] // fusion-still: where a vetoed track lost its box
		this.lastAt = null
	}

	/**
	 * cams: [{ id, entry (tracking camera, solved), at (ms the frame arrived), frame, persons }] — persons as
	 * detect-model personsFrom. Returns true when it stepped (some camera brought a new frame).
	 */
	step({ cams, now, planeZ = 0 }) {
		const fresh = (cams || []).filter(
			(c) => c?.entry?.cam && Array.isArray(c.entry.raster) && now - c.at <= FRAME_MAX_AGE_MS
		)
		const isNew = fresh.some((c) => this.frames.get(c.id) !== c.frame)
		this._prune(now)
		if (!isNew) return false
		for (const c of fresh) this.frames.set(c.id, c.frame)
		const dt = this.lastAt === null ? 0 : Math.min(MAX_DT_S, Math.max(0, (now - this.lastAt) / 1000))
		this.lastAt = now
		for (const t of this.tracks) {
			kfPredict(t.ax, dt)
			kfPredict(t.ay, dt)
		}
		const obs = []
		for (const c of fresh) {
			for (const p of c.persons || []) {
				if (!(Number(p.age_s) <= 0)) continue // only boxes matched this sidecar step are measurements
				const o = observe(p, c, planeZ)
				if (o) obs.push(o)
			}
		}
		const all = obs.slice()
		for (const [t, o] of holdStill(this.tracks, obs)) this._update(t, measure([o], planeZ), now) // fusion-still: furniture keeps its box
		const ms = associate(obs, ASSOC_GATE_M, planeZ).map((cl) => measure(cl, planeZ))
		const free = this.tracks.filter((t) => t.seen !== now && !t.still)
		const cost = free.map((t) =>
			ms.map((m) => {
				const d = Math.hypot(t.ax.p - m.x, t.ay.p - m.y)
				return m.keys.some((k) => t.keys.includes(k)) && d <= STICKY_MAX_M ? 0 : d
			})
		)
		const used = new Set()
		for (const [i, j] of assign(cost, TRACK_GATE_M)) {
			this._update(free[i], ms[j], now)
			used.add(j)
		}
		ms.forEach((m, j) => used.has(j) || ((m.cameras.length > 1 || m.score >= SPAWN_MIN_SCORE) && this._spawn(m, now)))
		const claimed = new Set(ms.flatMap((m) => (m.keys.length > 1 ? m.keys : [])))
		for (const t of this.tracks) {
			if (t.seen !== now) t.source = 'predicted'
			else judgeStill(t, { fresh, obs: all, claimed, now, planeZ })
		}
		return true
	}

	_update(t, m, now) {
		const r = m.sigma * m.sigma
		kfUpdate(t.ax, m.x, r)
		kfUpdate(t.ay, m.y, r)
		Object.assign(t, { seen: now, source: m.source, cameras: m.cameras, keys: m.keys, score: m.score, area: m.area })
		if (m.height !== null) t.height = t.height === null ? m.height : t.height + 0.3 * (m.height - t.height)
	}

	_spawn(m, now) {
		this.tracks.push({
			id: this.nextId++,
			ax: newAxis(m.x, m.sigma),
			ay: newAxis(m.y, m.sigma),
			height: m.height,
			seen: now,
			born: now,
			...stillStart(m, this.spots, now),
			source: m.source,
			cameras: m.cameras,
			keys: m.keys,
			score: m.score,
			area: m.area,
		})
	}

	_prune(now) {
		for (const t of this.tracks) if (now - t.seen > STALE_MS) rememberSpot(t, this.spots)
		this.tracks = this.tracks.filter((t) => now - t.seen <= STALE_MS)
		if (!this.tracks.length && this.lastAt !== null && now - this.lastAt > STALE_MS) this.frames.clear()
	}

	/**
	 * World persons for clients / the pin: [{ id, x, y, vx, vy, height, source, cameras, keys, score, area, age_s }].
	 * A track under the stand-still veto is left out. age_s is 0 for a person supported in the latest step (as the sidecar's boxes), else the time since its last support.
	 */
	persons(now) {
		const r3 = (v) => Math.round(v * 1000) / 1000
		return this.tracks
			.filter((t) => !t.still)
			.map((t) => ({
				id: t.id,
				x: r3(t.ax.p),
				y: r3(t.ay.p),
				vx: r3(t.ax.v),
				vy: r3(t.ay.v),
				height: t.height === null ? null : r3(t.height),
				source: t.source,
				cameras: t.cameras,
				keys: t.keys,
				score: t.score,
				area: t.area,
				age_s: t.seen === this.lastAt ? 0 : Math.max(0, (now - t.seen) / 1000), // 0 = supported in the latest step (sidecar semantics)
			}))
	}

	reset() {
		this.tracks = []
		this.spots = []
		this.frames.clear()
		this.lastAt = null
	}
}

module.exports = {
	Fusion,
	observe,
	associate,
	headMatch,
	measure,
	triangulate,
	STALE_MS,
	FRAME_MAX_AGE_MS,
}

'use strict'

/**
 * WO-1074 — RC car game: race tracks generated from the scene's floors and obstacles (pure, deterministic for a given
 * input). Each floor gets a few shape families (oval / loop, figure-eight, GP, slalom) fitted into it by a fixed search
 * over width, size, position and orientation; the first candidate `validateTrack` accepts is kept, a family with none
 * is left out. Fewer than two tracks → a 30 × 20 m arena floor is added (beside the scene when its middle is blocked).
 */

const { validateTrack, polyLength, resampleClosed, yawOf, GRID_SLOTS } = require('./rc-track-check')
const { freeRegions } = require('./rc-track-space')

const EDGE = 0.25 // extra margin between the road edge and the floor edge
const STEP = 0.1 // dense sampling of the shapes (m)
const SPACING = 0.5 // target spacing of the emitted centre line
const DEFAULT_ARENA = { w: 30, d: 20 }

const TAU = Math.PI * 2

/** A closed rounded rectangle w × d (x × z) centred on 0 with corner radius r, counter-clockwise from bottom-left. */
function roundedRect(w, d, r) {
	r = Math.max(0.01, Math.min(r, w / 2, d / 2))
	const out = []
	const line = (a, b) => {
		const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP))
		for (let i = 0; i < n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])
	}
	const arc = (cx, cz, a0) => {
		const n = Math.max(2, Math.ceil((Math.PI / 2) * r / STEP))
		for (let i = 0; i < n; i++) {
			const a = a0 + ((Math.PI / 2) * i) / n
			out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)])
		}
	}
	const x = w / 2 - r, z = d / 2 - r
	line([-x, -d / 2], [x, -d / 2])
	arc(x, -z, -Math.PI / 2)
	line([w / 2, -z], [w / 2, z])
	arc(x, z, 0)
	line([x, d / 2], [-x, d / 2])
	arc(-x, z, Math.PI / 2)
	line([-w / 2, z], [-w / 2, -z])
	arc(-x, -z, Math.PI)
	return out
}

/** Lemniscate of Gerono: x = w/2 cos t, z = d/2 sin 2t — one crossing in the middle. */
function figureEight(w, d) {
	const out = []
	const n = Math.ceil((2 * (w + d)) / STEP)
	for (let i = 0; i < n; i++) {
		const t = (TAU * i) / n
		out.push([(w / 2) * Math.cos(t), (d / 2) * Math.sin(2 * t)])
	}
	return out
}

/** A stadium whose bottom straight weaves (a smooth sine under a half-sine envelope: no kink where it meets the arcs). */
function slalom(w, d, amp) {
	const r = (d - 2 * amp) / 2
	if (r < 1.2) return null
	const base = roundedRect(w, d - 2 * amp, r)
	const x0 = -(w / 2 - r), x1 = w / 2 - r
	const len = x1 - x0
	const waves = Math.max(1, Math.round(len / 7.5))
	const zb = -(d - 2 * amp) / 2
	return base.map(([x, z]) => {
		if (Math.abs(z - zb) > 1e-9 || x < x0 || x > x1) return [x, z]
		const s = (x - x0) / len
		return [x, z + amp * Math.sin(TAU * waves * s) * Math.sin(Math.PI * s)]
	})
}

/** A polar "GP" outline r(θ) = 1 + a cos 2θ + b sin 3θ + c cos θ stretched to w × d (kidney / varied corners). */
function grandPrix(w, d, k) {
	const out = []
	const n = 2000
	for (let i = 0; i < n; i++) {
		const t = (TAU * i) / n
		const r = 1 + k.a * Math.cos(2 * t) + k.b * Math.sin(3 * t) + k.c * Math.cos(t)
		out.push([r * Math.cos(t), r * Math.sin(t)])
	}
	const bx = bbox(out)
	return out.map(([x, z]) => [((x - (bx[0] + bx[2]) / 2) / (bx[2] - bx[0])) * w, ((z - (bx[1] + bx[3]) / 2) / (bx[3] - bx[1])) * d])
}

const GP_VARIANTS = [{ a: 0.22, b: 0.1, c: 0.12 }, { a: 0.3, b: 0.06, c: 0.18 }, { a: 0.15, b: 0.14, c: 0 }]

function bbox(pts) {
	const b = [Infinity, Infinity, -Infinity, -Infinity]
	for (const [x, z] of pts) {
		if (x < b[0]) b[0] = x
		if (z < b[1]) b[1] = z
		if (x > b[2]) b[2] = x
		if (z > b[3]) b[3] = z
	}
	return b
}

/** Dense shape for a family at w × d (x-long), or null when it cannot exist at that size. */
function shapeOf(family, w, d, variant) {
	switch (family) {
		case 'oval':
			return roundedRect(w, d, d / 2)
		case 'loop':
			return roundedRect(w, d, Math.max(2, Math.min(d / 2, 0.3 * Math.min(w, d))))
		case 'around':
			return roundedRect(w, d, variant)
		case 'figure-eight':
			return w >= 6 && d >= 3 ? figureEight(w, d) : null
		case 'slalom':
			return slalom(w, d, Math.min(1, d / 6))
		case 'gp':
			return grandPrix(w, d, GP_VARIANTS[variant || 0])
	}
	return null
}

/** Index of the point at the end of the straightest ~8 m run (the start line; the grid sits on that run), away from a
 * figure-eight's crossing. */
function straightestStart(pts, width) {
	const n = pts.length
	const L = polyLength(pts)
	const back = Math.max(3, Math.round((8 / L) * n))
	const win = Math.ceil((Math.PI * width) / (L / n))
	const crowded = pts.map((p, i) => pts.some((q, j) => {
		const sep = Math.min(Math.abs(i - j), n - Math.abs(i - j))
		return sep > win && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.6 * width
	}))
	const head = pts.map((p, i) => {
		const q = pts[(i + 1) % n]
		return Math.atan2(q[1] - p[1], q[0] - p[0])
	})
	const turn = head.map((h, i) => {
		let d = h - head[(i - 1 + n) % n]
		while (d > Math.PI) d -= TAU
		while (d < -Math.PI) d += TAU
		return Math.abs(d)
	})
	let best = 0, bestT = Infinity
	for (let i = 0; i < n; i++) {
		let t = 0
		for (let k = -back; k <= 2; k++) t += turn[(i + k + n) % n] + (crowded[(i + k + n) % n] ? 10 : 0)
		if (t < bestT - 1e-9) (bestT = t), (best = i)
	}
	return best
}

/** Ten staggered slots behind points[0], following the centre line backwards, facing the driving direction. */
function startGrid(pts, width) {
	const n = pts.length
	const out = []
	let i = 0, along = 0
	for (let k = 0; k < GRID_SLOTS; k++) {
		const want = 1.2 + k * 0.75
		for (;;) {
			if (i >= n) return null
			const a = pts[(n - i) % n], b = pts[(n - i - 1 + n) % n]
			const seg = Math.hypot(a[0] - b[0], a[1] - b[1])
			if (along + seg >= want) {
				const f = (want - along) / seg
				const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f
				const tx = (a[0] - b[0]) / seg, tz = (a[1] - b[1]) / seg // driving direction
				const side = (k % 2 === 0 ? 1 : -1) * (width / 4)
				out.push({ x: round(x - tz * side), z: round(z + tx * side), yaw: round(yawOf(tx, tz)) })
				break
			}
			along += seg
			i++
		}
	}
	return out
}

const round = (v) => Math.round(v * 1000) / 1000

/** Turn a dense closed curve placed on the floor into a full track object (not yet validated); null when unusable. */
function buildTrack(dense, meta) {
	if (!dense.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) return null
	const L0 = polyLength(dense)
	if (!(L0 >= 20 && L0 <= 260)) return null
	const n = Math.max(60, Math.min(200, Math.round(L0 / SPACING)))
	let pts = resampleClosed(dense, n)
	const s = straightestStart(pts, meta.width)
	pts = pts.slice(s).concat(pts.slice(0, s)).map(([x, z]) => [round(x), round(z)])
	const length = Math.round(polyLength(pts) * 1000) / 1000
	const k = Math.max(4, Math.min(10, Math.round(length / 10)))
	const checkpoints = Array.from({ length: k }, (_, i) => Math.round((i * n) / k))
	return { id: meta.id, name: meta.name, floor: meta.floor.id, y: meta.floor.y, width: meta.width, closed: true, points: pts,
		length, checkpoints, grid: startGrid(pts, meta.width) || [] }
}

/** Candidate placements: the available rect at shrinking sizes, centred then shifted, long axis first along the long side. */
function* placements(avail, family) {
	const aw = avail[2] - avail[0], ad = avail[3] - avail[1]
	if (aw <= 0 || ad <= 0) return
	const cap = family === 'loop' ? 70 : 34 // the hall loop may use a big hall; the others stay a sensible size
	for (const s of [1, 0.8, 0.6]) {
		for (const turned of [false, true]) {
			const W = turned ? ad : aw, D = turned ? aw : ad // the shape's own x / z extents before turning
			const w = Math.min(W * s, cap), d = Math.min(D * s, cap)
			const sx = turned ? d : w, sz = turned ? w : d
			const slackX = aw - sx, slackZ = ad - sz
			const offs = []
			for (const [fx, fz] of [[0, 0], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]]) offs.push([fx * slackX, fz * slackZ])
			const seen = new Set()
			for (const [ox, oz] of offs) {
				const key = `${ox.toFixed(2)},${oz.toFixed(2)}`
				if (seen.has(key)) continue
				seen.add(key)
				yield { w, d, turned, cx: (avail[0] + avail[2]) / 2 + ox, cz: (avail[1] + avail[3]) / 2 + oz }
			}
			if (Math.abs(aw - ad) < 1e-6) break
		}
	}
}

function place(dense, at) {
	const b = bbox(dense)
	const mx = (b[0] + b[2]) / 2, mz = (b[1] + b[3]) / 2
	return dense.map(([x, z]) => {
		const u = x - mx, v = z - mz
		return at.turned ? [at.cx - v, at.cz + u] : [at.cx + u, at.cz + v]
	})
}

const FAMILIES = {
	stage: [['oval', 'oval', 'Stage oval'], ['figure-eight', 'figure-eight', 'Stage figure-eight'], ['gp', 'gp', 'Stage GP'],
		['slalom', 'slalom', 'Stage slalom']],
	hall: [['loop', 'loop', 'Hall loop'], ['slalom', 'slalom', 'Hall slalom'], ['gp', 'gp', 'Hall GP'],
		['figure-eight', 'figure-eight', 'Hall figure-eight']],
}

function familiesFor(floor) {
	if (FAMILIES[floor.id]) return FAMILIES[floor.id]
	const label = String(floor.id).charAt(0).toUpperCase() + String(floor.id).slice(1)
	return FAMILIES.hall.map(([suffix, fam, name]) => [suffix, fam, name.replace('Hall', label)])
}

/** One family on one floor → generator of candidate tracks (yields null between tries so a caller can pace it). */
function* searchFamily(scene, floor, suffix, family, name) {
	const id = `${floor.id}-${suffix}`
	const short = Math.min(floor.rect[2] - floor.rect[0], floor.rect[3] - floor.rect[1])
	const widths = (floor.id === 'stage' ? [2.2, 1.8, 1.5] : [3, 2.4, 2]).filter((w) => w <= short / 2.2)
	const variants = family === 'gp' ? [0, 1, 2] : [0]
	for (const width of widths) {
		const m = width / 2 + EDGE
		const avail = [floor.rect[0] + m, floor.rect[1] + m, floor.rect[2] - m, floor.rect[3] - m]
		if (family === 'loop' && (yield* aroundStage(scene, floor, { id, name, width, avail }))) return
		for (const region of freeRegions(floor, scene.obstacles, width)) {
			for (const variant of variants) {
				for (const at of placements(region, family)) {
					const dense = shapeOf(family, at.w, at.d, variant)
					const t = dense && buildTrack(place(dense, at), { id, name, floor, width })
					if (t && validateTrack(t, scene).ok) return yield t
					yield null
				}
			}
		}
	}
}

/** Hall loop candidates that circle an elevated stage standing on this floor. */
function* aroundStage(scene, floor, o) {
	const st = (scene.floors || []).find((f) => f.id === 'stage')
	if (!st || st.y < floor.y + 0.1) return
	const sr = st.rect
	for (const gap of [0.6, 1.5, 3]) {
		const m = o.width / 2 + gap
		const r = [sr[0] - m, sr[1] - m, sr[2] + m, sr[3] + m]
		if (r[0] < o.avail[0] || r[1] < o.avail[1] || r[2] > o.avail[2] || r[3] > o.avail[3]) continue
		const at = { cx: (r[0] + r[2]) / 2, cz: (r[1] + r[3]) / 2, turned: false }
		const t = buildTrack(place(shapeOf('around', r[2] - r[0], r[3] - r[1], Math.max(m, 1.3)), at), { ...o, floor })
		if (t && validateTrack(t, scene).ok) {
			yield t
			return true
		}
		yield null
	}
}

/** Generator over the whole scene: yields null between tries and { done, tracks, floors, bounds } last. */
function* trackJobs(scene) {
	const floors = (scene?.floors || []).filter((f) => f && Array.isArray(f.rect))
	const tracks = []
	const sc = { floors: [...floors], obstacles: scene?.obstacles || [], bounds: scene?.bounds }
	const runFloor = function* (floor) {
		for (const [suffix, fam, name] of familiesFor(floor)) {
			for (const t of searchFamily(sc, floor, suffix, fam, name)) {
				if (t) tracks.push(t)
				else yield null
			}
		}
	}
	const order = [...floors].sort((a, b) => (a.id === 'stage' ? -1 : b.id === 'stage' ? 1 : 0))
	for (const f of order) yield* runFloor(f)
	let bounds = scene?.bounds ? { min: [...scene.bounds.min], max: [...scene.bounds.max] } : null
	if (tracks.length < 2) {
		const hall = floors.find((f) => f.id === 'hall')
		const y = hall ? hall.y : 0
		const b = bounds || { min: [-15, y, -10], max: [15, y + 5, 10] }
		const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2
		const { w, d } = DEFAULT_ARENA
		for (const x0 of [cx - w / 2, b.max[0] + 2, b.min[0] - 2 - w]) {
			const arena = { id: 'arena', y, rect: [x0, cz - d / 2, x0 + w, cz + d / 2] }
			sc.floors = [...floors, arena]
			const before = tracks.length
			yield* runFloor(arena)
			if (tracks.length >= 2) {
				floors.push(arena)
				if (tracks.length > before && bounds) {
					bounds.min[0] = Math.min(bounds.min[0], arena.rect[0]); bounds.max[0] = Math.max(bounds.max[0], arena.rect[2])
					bounds.min[2] = Math.min(bounds.min[2], arena.rect[1]); bounds.max[2] = Math.max(bounds.max[2], arena.rect[3])
				}
				break
			}
			tracks.splice(before)
		}
	}
	yield { done: true, tracks, floors, bounds }
}

/** Tracks for `scene` ({ floors, obstacles, bounds }) → { tracks, floors (+ an arena when needed), bounds }. */
function generateTracks(scene) {
	for (const r of trackJobs(scene)) if (r && r.done) return r
	return { tracks: [], floors: [], bounds: null }
}

/** Same as generateTracks, awaiting `pause()` every `every` tries (the bake keeps the event loop free). */
async function generateTracksAsync(scene, pause, every = 4) {
	let k = 0
	for (const r of trackJobs(scene)) {
		if (r && r.done) return r
		if (++k % every === 0) await pause()
	}
	return { tracks: [], floors: [], bounds: null }
}

module.exports = { generateTracks, generateTracksAsync, validateTrack }

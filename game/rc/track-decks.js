/**
 * §2.7 elevated decks drawn (WO-1074): under the road of every deck and slab-ramp segment (track-math segDeck /
 * segSlab) a slab DECK_SLAB thick with its side faces, square pillars down to the floor about every PILLAR_STEP m
 * (skipped where one would stand in an obstacle or pass through another part of the ribbon — a bridge's lower road),
 * low glowing rails along both edges, and an end face only where a deck stops in mid-air (a drop's lip). The road,
 * kerb stripes and edge lines on top are track-mesh.js's. Pure geometry into TriBatches (node-testable, no three.js).
 * §3 toy scale: every size × T.scale (k); no pillar stands on a blocked occupancy cell (a table leg, G.occ).
 */
import { leftNormal, pointAt } from './track-math.js'
import { floorOnlyAt, DECK_SLAB } from './ground.js'
import { forSegsNear } from './seg-grid.js'
import { occSquareBlocked } from './occ.js'
import { lin } from './mesh-util.js'

const PILLAR_STEP = 4
const PILLAR_W = 0.22
const RAIL_H = 0.22 // rail top above the road
const RAIL_W = 0.07
const SLAB = lin('#2a2e38')
const SLAB_EDGE = lin('#3ee6ff')
const PILLAR = lin('#4a4f5c')
const RAIL = lin('#7ff3ff')
const RAIL_SIDE = lin('#1fb8d6')

/** Is segment i elevated (a deck or a slab ramp)? */
export const elevated = (T, i) => !!(T.segDeck?.[i] || T.segSlab?.[i])

/**
 * Add the deck geometry of T to the batches { slab, rails } (TriBatch). `sidePoint(T, i, off, dy)` is track-mesh's,
 * `kerb` the kerb width outside the road edge. G (ground.js, may carry `boxes`) gives the floor under a pillar.
 */
export function buildDecks(T, G, b, sidePoint, kerb) {
	const n = T.n
	const segs = T.closed ? n : n - 1
	const o = T.half + kerb
	const k = T.scale ?? 1
	const lift = 0.012 * k
	const slab = DECK_SLAB * k
	const railH = RAIL_H * k
	for (let i = 0; i < segs; i++) {
		if (!elevated(T, i)) continue
		const j = (i + 1) % n
		const P = (q, off, dy) => sidePoint(T, q, off, dy)
		// underside, and the slab's two side faces with a thin glowing line along the top edge
		b.slab.quad(P(i, -o, -slab), P(j, -o, -slab), P(j, o, -slab), P(i, o, -slab), SLAB)
		for (const sgn of [1, -1]) {
			const s = sgn * o
			b.slab.quad(P(i, s, lift), P(j, s, lift), P(j, s, -slab), P(i, s, -slab), SLAB)
			b.slab.quad(P(i, s, -0.02 * k), P(j, s, -0.02 * k), P(j, s, -0.07 * k), P(i, s, -0.07 * k), SLAB_EDGE)
			// the rail: a low bar standing on the slab's outer edge (top + inner + outer faces)
			const a = s,
				c = s + sgn * RAIL_W * k
			b.rails.quad(P(i, a, railH), P(j, a, railH), P(j, c, railH), P(i, c, railH), RAIL)
			b.rails.quad(P(i, a, lift), P(j, a, lift), P(j, a, railH), P(i, a, railH), RAIL_SIDE)
			b.rails.quad(P(i, c, lift), P(j, c, lift), P(j, c, railH), P(i, c, railH), RAIL_SIDE)
		}
		// an end face where the elevated road stops in mid-air (the lip of a drop): not at a deck ↔ ramp joint
		const prev = (i - 1 + n) % n
		const open = (q) => q < segs && !elevated(T, q) && !!(T.segGap?.[q] || T.segStep?.[q])
		if (open(prev)) endFace(b.slab, i, o, P, k)
		if (open(j)) endFace(b.slab, j, o, P, k)
	}
	pillars(T, G, b.slab)
}

function endFace(batch, q, o, P, k) {
	batch.quad(P(q, o, 0.012 * k), P(q, -o, 0.012 * k), P(q, -o, -DECK_SLAB * k), P(q, o, -DECK_SLAB * k), SLAB)
}

/** Pillars every PILLAR_STEP m along the elevated stretches, two per station (inside the road edges). */
function pillars(T, G, batch) {
	const total = T.total
	const k = T.scale ?? 1
	let s = 1 * k
	while (s < total) {
		const p = pointAt(T, s)
		if (!elevated(T, p.seg)) {
			s += 0.5 * k
			continue
		}
		const [lx, lz] = leftNormal(p.ux, p.uz)
		for (const sgn of [1, -1]) {
			const off = sgn * (T.half - 0.45 * k)
			const x = p.x + lx * off,
				z = p.z + lz * off
			const top = p.y - DECK_SLAB * k
			const floor = G ? floorOnlyAt(G, x, z) : T.box.minY
			if (floor === null || top - floor < 0.3 * k) continue
			if (inObstacle(G, x, z, floor, top, k) || underRibbon(T, p.seg, x, z, top, k)) continue
			if (G?.occ?.length && occSquareBlocked(G.occ, x, z, (PILLAR_W / 2) * k, floor, G.eps)) continue
			pillar(batch, x, z, floor, top, k)
		}
		s += PILLAR_STEP * k
	}
}

const inObstacle = (G, x, z, floor, top, k = 1) =>
	(G?.boxes || []).some(
		(b) =>
			x > b.x0 - 0.15 * k &&
			x < b.x1 + 0.15 * k &&
			z > b.z0 - 0.15 * k &&
			z < b.z1 + 0.15 * k &&
			b.y1 > floor + 0.05 * k &&
			b.y0 < top
	)

/** Would a pillar under segment `seg` pass through another (lower) part of the ribbon? (grid query on long tracks) */
function underRibbon(T, seg, x, z, top, k = 1) {
	const reach = T.half + 0.5 * k
	const hits = (i) => {
		const g = T.segs[i]
		if (Math.abs(i - seg) < 4 || Math.min(g.ay, g.ay + g.dy) > top - 0.05 * k) return false
		let t = ((x - g.ax) * g.dx + (z - g.az) * g.dz) / (g.len * g.len)
		t = t < 0 ? 0 : t > 1 ? 1 : t
		return Math.hypot(x - g.ax - g.dx * t, z - g.az - g.dz * t) < reach
	}
	if (T.sgrid) {
		let found = false
		forSegsNear(T.sgrid, x, z, reach, (i) => (found ||= hits(i)))
		return found
	}
	for (let i = 0; i < T.segs.length; i++) if (hits(i)) return true
	return false
}

function pillar(batch, x, z, y0, y1, k = 1) {
	const h = (PILLAR_W / 2) * k
	const c = [
		[x - h, z - h],
		[x + h, z - h],
		[x + h, z + h],
		[x - h, z + h],
	]
	for (let k = 0; k < 4; k++) {
		const a = c[k],
			d = c[(k + 1) % 4]
		batch.quad([a[0], y1, a[1]], [d[0], y1, d[1]], [d[0], y0, d[1]], [a[0], y0, a[1]], PILLAR)
	}
}

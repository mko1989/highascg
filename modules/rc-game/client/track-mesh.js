/**
 * Track drawing (WO-1074 v2): the asphalt ribbon following the centre line's height through the whole room, kerbs and
 * edge lines, ramps as solid wedges (side skirts down to the floor below, bright yellow / black edge markings, an end
 * face where a ramp stops in mid-air), drops (a striped ledge marker, nothing over the step itself, landing chevrons)
 * and faint direction arrows. §2.7 decks and slab ramps (a ramp joining two decks) get no skirts: a slab on pillars
 * with glowing rails (track-decks.js). Vertex-coloured, unlit, a handful of draw calls. Gantry, posts: track-deco.js.
 * §3.1 tunnels: the tubes through the tables (track-tunnel.js).
 * §3 toy scale: every size below is its scale-1 value × T.scale (k); the polygon offsets keep the layers apart.
 */
import { leftNormal, pointAt } from './track-math.js'
import { floorOnlyAt } from './ground.js'
import { TriBatch, flatMat, freezeGroup, disposeGroup, lin } from './mesh-util.js'
import { buildTrackDeco } from './track-deco.js'
import { buildDecks } from './track-decks.js'
import { buildTunnels } from './track-tunnel.js'
import * as THREE from 'three'

const ASPHALT = lin('#3a3d45')
const ASPHALT_UP = lin('#454a57') // ramps: a touch lighter so the slope reads
const KERB_A = lin('#e0301e')
const KERB_B = lin('#f2f2f2')
const HAZ_A = lin('#ffc81a')
const HAZ_B = lin('#17181c')
const LINE = lin('#e6e6e0')
const SKIRT = lin('#2b2f3a')
const SKIRT_EDGE = lin('#ffc81a')
const CHEVRON = lin('#3ee6ff')
const LIFT = 0.012 // road above the floor it lies on (plus polygon offset)
const KERB_W = 0.2
const LINE_W = 0.06

/** Offset point i sideways by `off` (+ = left) at the centre-line height + dy. */
export function sidePoint(T, i, off, dy = 0) {
	const [tx, tz] = T.tangents[i]
	const [lx, lz] = leftNormal(tx, tz)
	const p = T.pts[i]
	return [p[0] + lx * off, T.ys[i] + dy, p[1] + lz * off]
}

/** Floor height under a plan point (the floor below a ramp / a ledge), without the ramps themselves. */
function floorUnder(G, T, x, z) {
	const y = G ? floorOnlyAt(G, x, z) : null
	return y === null ? T.box.minY : y
}

/** Build the track group for a prepared track. @param {object} [G] ground (ground.js) for the ramp skirts */
export function buildTrackMesh(T, G = null) {
	const group = new THREE.Group()
	group.name = 'track-' + (T.id || '')
	const n = T.n
	const segs = T.closed ? n : n - 1
	const half = T.half
	const k = T.scale ?? 1
	const lift = LIFT * k
	const kerbW = KERB_W * k

	const road = new TriBatch()
	const kerbs = new TriBatch()
	const lines = new TriBatch()
	const skirts = new TriBatch()
	let sAcc = 0
	for (let i = 0; i < segs; i++) {
		const j = (i + 1) % n
		const len = T.segs[i].len
		if (T.segStep[i]) {
			sAcc += len
			continue // the ledge: nothing drawn over the step itself
		}
		const ramp = !!T.segRamp[i]
		const P = (q, off, dy) => sidePoint(T, q, off, dy)
		road.quad(P(i, half, lift), P(j, half, lift), P(j, -half, lift), P(i, -half, lift), ramp ? ASPHALT_UP : ASPHALT)
		const band = Math.floor(sAcc / (0.6 * k)) % 2
		sAcc += len
		const yk = lift + 0.004 * k
		const yl = lift + 0.006 * k
		for (const sgn of [1, -1]) {
			const o0 = sgn * half
			const o1 = sgn * (half + kerbW)
			const col = ramp ? (band ? HAZ_A : HAZ_B) : band ? KERB_A : KERB_B
			kerbs.quad(P(i, o0, yk), P(j, o0, yk), P(j, o1, yk), P(i, o1, yk), col)
			const l0 = sgn * (half - 0.1 * k)
			const l1 = sgn * (half - 0.1 * k - LINE_W * k)
			lines.quad(P(i, l0, yl), P(j, l0, yl), P(j, l1, yl), P(i, l1, yl), LINE)
		}
		if (ramp && G && !T.segSlab?.[i]) rampSkirts(skirts, T, G, i, j, k)
	}
	if (G) {
		const fed = new Set((T.decks || []).map((d) => d.from))
		for (const r of T.ramps) if (!fed.has(r.to)) rampEndFace(skirts, T, G, r.to, k)
	}
	const rails = new TriBatch()
	if (T.decks?.length) buildDecks(T, G, { slab: skirts, rails }, sidePoint, kerbW)
	for (const d of T.drops) ledgeMarker(lines, T, d.at, k)
	for (const d of T.drops) landingChevrons(kerbs, T, d.land, k)

	for (const [b, off] of [
		[road, 1],
		[skirts, 0],
		[rails, 0],
		[kerbs, 2],
		[lines, 3],
	]) {
		const m = b.mesh(flatMat(off))
		if (m) group.add(m)
	}
	const arrows = arrowBatch(T).mesh(flatMat(4, { transparent: true, opacity: 0.3, depthWrite: false }))
	if (arrows) group.add(arrows)
	const tunnels = buildTunnels(T, G?.occRaw) // §3.1: the tubes through the tables (arches on the furniture faces)
	if (tunnels) group.add(tunnels)
	const deco = buildTrackDeco(T)
	group.add(deco)
	group.userData.lights = deco.userData.lights
	return freezeGroup(group)
}

/** Ramp side walls: from the kerb's outer edge straight down to the floor below (a solid wedge). */
function rampSkirts(b, T, G, i, j, k = 1) {
	const o = T.half + KERB_W * k
	for (const sgn of [1, -1]) {
		const a = sidePoint(T, i, sgn * o, LIFT * k)
		const c = sidePoint(T, j, sgn * o, LIFT * k)
		const fa = floorUnder(G, T, a[0], a[2])
		const fc = floorUnder(G, T, c[0], c[2])
		if (a[1] - fa < 0.03 * k && c[1] - fc < 0.03 * k) continue
		b.quad(a, c, [c[0], fc, c[2]], [a[0], fa, a[2]], SKIRT)
		/* a bright band along the top edge (never below the floor) */
		const e = 0.07 * k
		b.quad(a, c, [c[0], Math.max(fc, c[1] - e), c[2]], [a[0], Math.max(fa, a[1] - e), a[2]], SKIRT_EDGE)
	}
}

/** A ramp that ends above the floor ahead (a kicker): its vertical end face. */
function rampEndFace(b, T, G, i, k = 1) {
	if (i < 0 || i >= T.n) return
	const o = T.half + KERB_W * k
	const L = sidePoint(T, i, o, LIFT * k)
	const R = sidePoint(T, i, -o, LIFT * k)
	const [tx, tz] = T.tangents[i]
	const ahead = floorUnder(G, T, T.pts[i][0] + tx * 0.3 * k, T.pts[i][1] + tz * 0.3 * k)
	if (T.ys[i] - ahead < 0.1 * k) return
	b.quad(L, R, [R[0], ahead, R[2]], [L[0], ahead, L[2]], SKIRT)
	b.quad(L, R, [R[0], R[1] - 0.07 * k, R[2]], [L[0], L[1] - 0.07 * k, L[2]], SKIRT_EDGE)
}

/** Yellow / black blocks across the road just before the ledge. */
function ledgeMarker(b, T, at, k = 1) {
	if (at < 0 || at >= T.n) return
	const s1 = T.cumS[at]
	const cols = Math.max(6, Math.round(T.width / (0.35 * k)))
	for (let r = 0; r < 2; r++) {
		const p0 = pointAt(T, s1 - 0.5 * k * (r + 1))
		const p1 = pointAt(T, s1 - 0.5 * k * r - 0.02 * k)
		const n0 = leftNormal(p0.ux, p0.uz)
		const n1 = leftNormal(p1.ux, p1.uz)
		for (let c = 0; c < cols; c++) {
			const o0 = -T.half + (c * T.width) / cols
			const o1 = o0 + T.width / cols
			const Q = (p, nrm, o) => [p.x + nrm[0] * o, p.y + LIFT * k + 0.008 * k, p.z + nrm[1] * o]
			b.quad(Q(p0, n0, o0), Q(p0, n0, o1), Q(p1, n1, o1), Q(p1, n1, o0), (r + c) % 2 ? HAZ_A : HAZ_B)
		}
	}
}

/** Three bright chevrons on the landing zone, pointing on. */
function landingChevrons(b, T, land, k = 1) {
	if (land < 0 || land >= T.n) return
	for (let c = 0; c < 3; c++) {
		const p = pointAt(T, T.cumS[land] + 0.4 * k + c * 0.9 * k)
		chevron(b, p, T.half * 0.7, 0.32 * k, 0.22 * k, LIFT * k + 0.01 * k, CHEVRON, 0.35 * k)
	}
}

function chevron(b, p, wing, back, thick, dy, col, nose = 0.35) {
	const [lx, lz] = leftNormal(p.ux, p.uz)
	const y = p.y + dy
	const tip = [p.x + p.ux * nose, y, p.z + p.uz * nose]
	const lA = [p.x + lx * wing - p.ux * back, y, p.z + lz * wing - p.uz * back]
	const rA = [p.x - lx * wing - p.ux * back, y, p.z - lz * wing - p.uz * back]
	const inward = (q) => [q[0] - p.ux * thick, y, q[2] - p.uz * thick]
	b.quad(lA, tip, inward(tip), inward(lA), col)
	b.quad(tip, rA, inward(rA), inward(tip), col)
}

/** Faint direction arrows every ~5 m (not over steps, ramps or the start). */
function arrowBatch(T) {
	const b = new TriBatch()
	const k = T.scale ?? 1
	for (let s = 3 * k; s < T.total - 2 * k; s += 5 * k) {
		const p = pointAt(T, s)
		if (T.segStep[p.seg] || T.segRamp[p.seg]) continue
		chevron(b, p, T.half * 0.55, 0.25 * k, 0.18 * k, LIFT * k + 0.01 * k, [1, 1, 1], 0.35 * k)
	}
	return b
}

export { disposeGroup }

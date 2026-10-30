'use strict'

/**
 * WO-869 — pure geometry for mapping-node slices. A slice's user fields (dst rect, rotation about its centre, flips,
 * 4-corner warp) compile to ONE quad: the four destination corners that the source rectangle's corners ul, ur, lr,
 * ll land on, in output pixels. Every backend consumes that quad (DeckLink placement, the screen-consumer
 * `<slices>` / `APPLY … SLICES SET`, the Godot output canvas), so the rules live here once.
 *
 * Order of operations (also the Godot port's, slice_model.gd):
 *   1. the dst rect's screen corners (ul, ur, lr, ll);
 *   2. rotated about the rect centre by `rotation` degrees (clockwise on screen: y grows downwards);
 *   3. `warp[i]` added to screen corner i (keystone);
 *   4. the flips decide which screen corner each SOURCE corner lands on (flipH: src ul → screen ur …).
 */

/** @typedef {[number, number]} Pt */

/** @param {{x:number,y:number,w:number,h:number}} r @returns {Pt[]} ul, ur, lr, ll */
function rectCorners(r) {
	return [
		[r.x, r.y],
		[r.x + r.w, r.y],
		[r.x + r.w, r.y + r.h],
		[r.x, r.y + r.h],
	]
}

/** @param {Pt[]} pts @param {Pt} c @param {number} deg */
function rotateAbout(pts, c, deg) {
	if (!deg) return pts.map((p) => [p[0], p[1]])
	const a = (deg * Math.PI) / 180
	const cos = Math.cos(a)
	const sin = Math.sin(a)
	// 90° steps stay exact (no 6.1e-17 residue) so a rotated 1:1 slice keeps integer corners.
	const q = Math.round(deg / 90)
	const exact = Math.abs(deg - q * 90) < 1e-12
	const cs = exact ? [1, 0, -1, 0][((q % 4) + 4) % 4] : cos
	const sn = exact ? [0, 1, 0, -1][((q % 4) + 4) % 4] : sin
	return pts.map(([x, y]) => {
		const dx = x - c[0]
		const dy = y - c[1]
		return [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs]
	})
}

/** Screen-corner index each source corner (ul, ur, lr, ll) lands on. */
function flipPermutation(flipH, flipV) {
	if (flipH && flipV) return [2, 3, 0, 1]
	if (flipH) return [1, 0, 3, 2]
	if (flipV) return [3, 2, 1, 0]
	return [0, 1, 2, 3]
}

/**
 * The slice's screen corners (ul, ur, lr, ll on screen) after rotation and warp — what an editor draws handles on.
 * @param {{ rect: {x:number,y:number,w:number,h:number}, rotation?: number, warp?: Pt[] }} dst
 * @returns {Pt[]}
 */
function screenCorners(dst) {
	const r = dst.rect
	const c = [r.x + r.w / 2, r.y + r.h / 2]
	const pts = rotateAbout(rectCorners(r), c, Number(dst.rotation) || 0)
	const warp = Array.isArray(dst.warp) ? dst.warp : []
	return pts.map((p, i) => {
		const w = Array.isArray(warp[i]) ? warp[i] : [0, 0]
		return [p[0] + (Number(w[0]) || 0), p[1] + (Number(w[1]) || 0)]
	})
}

/**
 * The compiled destination quad in SOURCE corner order: dst[k] = where src corner k (ul, ur, lr, ll) lands.
 * @param {{ rect: object, rotation?: number, flipH?: boolean, flipV?: boolean, warp?: Pt[] }} dst
 * @returns {Pt[]}
 */
function dstQuad(dst) {
	const sc = screenCorners(dst)
	return flipPermutation(!!dst.flipH, !!dst.flipV).map((i) => sc[i])
}

function cross(o, a, b) {
	return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/**
 * Strictly convex, non-degenerate quad of either winding (a flipped slice arrives mirrored). Bow-ties, concave
 * corners and collapsed edges are rejected — the screen consumer refuses them too.
 * @param {Pt[]} q
 */
function isConvexQuad(q) {
	if (!Array.isArray(q) || q.length !== 4) return false
	for (const p of q) if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false
	let sign = 0
	for (let i = 0; i < 4; i++) {
		const c = cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4])
		if (Math.abs(c) < 1e-6) return false
		const s = Math.sign(c)
		if (sign === 0) sign = s
		else if (s !== sign) return false
	}
	// Four same-sign turns = convex; the area guard only rejects a quad collapsed to (almost) nothing.
	const area = quadArea(q)
	return Math.abs(area) > 1e-6
}

/** Signed shoelace area. */
function quadArea(q) {
	let a = 0
	for (let i = 0; i < 4; i++) a += q[i][0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * q[i][1]
	return a / 2
}

/** @param {Pt[]} pts */
function bounds(pts) {
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const [x, y] of pts) {
		minX = Math.min(minX, x)
		minY = Math.min(minY, y)
		maxX = Math.max(maxX, x)
		maxY = Math.max(maxY, y)
	}
	return { minX, minY, maxX, maxY }
}

/**
 * Homography H (3x3, row-major, h33 = 1) mapping 4 points `from` onto `to` (DLT, 8x8 Gaussian elimination).
 * @param {Pt[]} from @param {Pt[]} to @returns {number[] | null}
 */
function homography(from, to) {
	const A = []
	const b = []
	for (let i = 0; i < 4; i++) {
		const [x, y] = from[i]
		const [u, v] = to[i]
		A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
		b.push(u)
		A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
		b.push(v)
	}
	const n = 8
	for (let col = 0; col < n; col++) {
		let piv = col
		for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
		if (Math.abs(A[piv][col]) < 1e-12) return null
		;[A[col], A[piv]] = [A[piv], A[col]]
		;[b[col], b[piv]] = [b[piv], b[col]]
		for (let r = 0; r < n; r++) {
			if (r === col) continue
			const f = A[r][col] / A[col][col]
			if (!f) continue
			for (let c = col; c < n; c++) A[r][c] -= f * A[col][c]
			b[r] -= f * b[col]
		}
	}
	const h = b.map((v, i) => v / A[i][i])
	return [...h, 1]
}

/** @param {number[]} H @param {Pt} p @returns {Pt} */
function applyHomography(H, p) {
	const [x, y] = p
	const w = H[6] * x + H[7] * y + H[8]
	return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]
}

/**
 * True when the slice is an unrotated, unwarped, unflipped 1:1 copy (dst rect size == src size): the shape a
 * DeckLink `<subregion>` or a plain xrandr head can show without any resampling.
 */
function isOneToOne(slice) {
	const d = slice?.dst || {}
	const r = d.rect || {}
	const s = slice?.src || {}
	if (d.flipH || d.flipV) return false
	if ((Number(d.rotation) || 0) % 360 !== 0) return false
	if (Array.isArray(d.warp) && d.warp.some((w) => Array.isArray(w) && (w[0] || w[1]))) return false
	return r.w === s.w && r.h === s.h
}

module.exports = {
	rectCorners,
	rotateAbout,
	flipPermutation,
	screenCorners,
	dstQuad,
	isConvexQuad,
	quadArea,
	bounds,
	homography,
	applyHomography,
	isOneToOne,
}

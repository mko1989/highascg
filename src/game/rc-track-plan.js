'use strict'

/**
 * WO-1074 v2 — track plans (pure): a closed polygon whose corners are rounded with a radius each ("fillet polygon"),
 * sampled densely; straight legs stay exactly straight (ramps and drops are laid on them). Plus the local frame of a
 * floor rect's edge (u along the edge, v out of the rect) the room designs are written in, and the v1 shape families
 * (oval, figure-eight, slalom, GP) for single-floor tracks.
 */

const { TAU, bbox } = require('./rc-track-geo')

const STEP = 0.1 // dense sampling (m)

/**
 * Closed polygon `V` ([[x, z]]) with corner radii `R` (number or per-corner array) → { pts, L } (dense, starting where
 * corner 0's arc ends) or null when a corner does not fit (the arcs of a leg overlap) or the polygon is degenerate.
 */
function filletPolygon(V, R) {
	const m = V.length
	if (m < 3) return null
	const rad = (k) => (Array.isArray(R) ? R[k] : R)
	const corners = []
	for (let k = 0; k < m; k++) {
		const p = V[(k - 1 + m) % m], c = V[k], q = V[(k + 1) % m]
		const li = Math.hypot(c[0] - p[0], c[1] - p[1]), lo = Math.hypot(q[0] - c[0], q[1] - c[1])
		if (li < 1e-6 || lo < 1e-6) return null
		const di = [(c[0] - p[0]) / li, (c[1] - p[1]) / li], dout = [(q[0] - c[0]) / lo, (q[1] - c[1]) / lo]
		const cross = di[0] * dout[1] - di[1] * dout[0]
		const dot = Math.max(-1, Math.min(1, di[0] * dout[0] + di[1] * dout[1]))
		const theta = Math.acos(dot) // turn angle
		if (theta > Math.PI - 1e-3) return null // a reversal
		const r = rad(k)
		const t = theta < 1e-6 ? 0 : r * Math.tan(theta / 2)
		corners.push({ c, di, dout, theta, r, t, side: cross >= 0 ? 1 : -1, li, lo })
	}
	for (let k = 0; k < m; k++) {
		const a = corners[k], b = corners[(k + 1) % m]
		if (a.t + b.t > a.lo + 1e-9) return null
	}
	const out = []
	const line = (a, b) => {
		const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP))
		for (let i = 0; i < n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])
	}
	for (let k = 0; k < m; k++) {
		const cn = corners[k], nx = corners[(k + 1) % m]
		// arc of corner k (from T1 to T2), then the straight leg to the next corner's T1
		const T1 = [cn.c[0] - cn.di[0] * cn.t, cn.c[1] - cn.di[1] * cn.t]
		const T2 = [cn.c[0] + cn.dout[0] * cn.t, cn.c[1] + cn.dout[1] * cn.t]
		if (cn.t > 0) {
			const nrm = [-cn.di[1] * cn.side, cn.di[0] * cn.side] // towards the centre
			const ctr = [T1[0] + nrm[0] * cn.r, T1[1] + nrm[1] * cn.r]
			const a0 = Math.atan2(T1[1] - ctr[1], T1[0] - ctr[0])
			const steps = Math.max(2, Math.ceil((cn.theta * cn.r) / STEP))
			for (let i = 0; i < steps; i++) {
				const a = a0 + cn.side * ((cn.theta * i) / steps)
				out.push([ctr[0] + cn.r * Math.cos(a), ctr[1] + cn.r * Math.sin(a)])
			}
		}
		const N1 = [nx.c[0] - nx.di[0] * nx.t, nx.c[1] - nx.di[1] * nx.t]
		line(T2, N1)
	}
	let L = 0
	for (let i = 0; i < out.length; i++) {
		const a = out[i], b = out[(i + 1) % out.length]
		L += Math.hypot(b[0] - a[0], b[1] - a[1])
	}
	return { pts: out, L }
}

/**
 * The frame of one edge of `rect` ([minX, minZ, maxX, maxZ]): u runs along the edge, v points out of the rect (v = 0 on
 * the edge). → { id, toWorld([u, v]) → [x, z], fromWorld, u0, u1 (the edge's extent in u), depth (the rect's, in −v) }.
 */
function edgeFrames(rect) {
	const w = rect[2] - rect[0], d = rect[3] - rect[1]
	return [
		{ id: 'front', toWorld: ([u, v]) => [u, rect[3] + v], fromWorld: ([x, z]) => [x, z - rect[3]], u0: rect[0], u1: rect[2], depth: d },
		{ id: 'back', toWorld: ([u, v]) => [-u, rect[1] - v], fromWorld: ([x, z]) => [-x, rect[1] - z], u0: -rect[2], u1: -rect[0], depth: d },
		{ id: 'right', toWorld: ([u, v]) => [rect[2] + v, -u], fromWorld: ([x, z]) => [-z, x - rect[2]], u0: -rect[3], u1: -rect[1], depth: w },
		{ id: 'left', toWorld: ([u, v]) => [rect[0] - v, u], fromWorld: ([x, z]) => [z, rect[0] - x], u0: rect[1], u1: rect[3], depth: w },
	]
}

/** A rect's extent in a frame → [u0, v0, u1, v1]. */
function rectIn(frame, r) {
	const c = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].map((p) => frame.fromWorld(p))
	return [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))]
}

// ---- v1 single-floor shape families (dense, centred on 0, x-long)

function roundedRect(w, d, r) {
	r = Math.max(0.01, Math.min(r, w / 2, d / 2))
	const x = w / 2, z = d / 2
	const f = filletPolygon([[-x, -z], [x, -z], [x, z], [-x, z]], r)
	return f ? f.pts : null
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

/** A stadium whose bottom straight weaves (a smooth sine under a half-sine envelope). */
function slalom(w, d, amp, rMin) {
	const r = (d - 2 * amp) / 2
	if (r < rMin) return null
	const base = roundedRect(w, d - 2 * amp, r)
	if (!base) return null
	const x0 = -(w / 2 - r), x1 = w / 2 - r
	const len = x1 - x0
	const waves = Math.max(1, Math.round(len / 9))
	const zb = -(d - 2 * amp) / 2
	return base.map(([x, z]) => {
		if (Math.abs(z - zb) > 1e-9 || x < x0 || x > x1) return [x, z]
		const s = (x - x0) / len
		return [x, z + amp * Math.sin(TAU * waves * s) * Math.sin(Math.PI * s)]
	})
}

const GP_VARIANTS = [{ a: 0.22, b: 0.1, c: 0.12 }, { a: 0.3, b: 0.06, c: 0.18 }, { a: 0.15, b: 0.14, c: 0 }]

/** A polar "GP" outline r(θ) = 1 + a cos 2θ + b sin 3θ + c cos θ stretched to w × d. */
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

/** Dense shape for a family at w × d (x-long), or null when it cannot exist at that size. */
function shapeOf(family, w, d, variant, rMin) {
	switch (family) {
		case 'oval':
			return roundedRect(w, d, d / 2)
		case 'loop':
			return roundedRect(w, d, Math.max(rMin + 0.5, Math.min(d / 2, 0.3 * Math.min(w, d))))
		case 'figure-eight':
			return w >= 4 * rMin && d >= 2 * rMin ? figureEight(w, d) : null
		case 'slalom':
			return slalom(w, d, Math.min(1.5, d / 6), rMin)
		case 'gp':
			return grandPrix(w, d, GP_VARIANTS[variant || 0])
	}
	return null
}

/** Place a centred dense shape at { cx, cz, turned }. */
function place(dense, at) {
	const b = bbox(dense)
	const mx = (b[0] + b[2]) / 2, mz = (b[1] + b[3]) / 2
	return dense.map(([x, z]) => {
		const u = x - mx, v = z - mz
		return at.turned ? [at.cx - v, at.cz + u] : [at.cx + u, at.cz + v]
	})
}

module.exports = { STEP, filletPolygon, edgeFrames, rectIn, shapeOf, place }

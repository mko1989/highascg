'use strict'

/**
 * WO-624 E3 / WO-616 T13 — moving-head position calibration (owner 20.10: "dont see an option to calibrate lights").
 * Pure. The operator jogs a head onto floor spots it can see in the camera view and drops a marker on each spot; every
 * spot gives one (pan, tilt) ↔ stage point pair. From 3+ pairs this solves the head's pose — x, y, z and yaw (PSN, the
 * follow-ik.js frame); `hang` is the operator's (a hung head is the floor head upside down: both explain the same rays
 * with another yaw, so it is not identifiable from directions).
 *
 * Tilt inversion is the same machine turned 180° (beam(p, −t) = beam(p + 180, t)) and is absorbed by the yaw; pan
 * inversion is not — it mirrors the sweep — so both pan senses are solved and a much better mirrored fit says "flip
 * Invert pan".
 *
 * Method: a 5° yaw sweep, each yaw giving the position closest to all the backward rays (3×3 least squares), then
 * Levenberg–Marquardt over (x, y, z, yaw) on the residual beam(pose, pan, tilt) − unit(point − position).
 */

const { beam } = require('./follow-ik')

const DEG = 180 / Math.PI
const MIN_POINTS = 3
/** The mirrored pan sense must beat the configured one by this factor before Invert pan is suggested. */
const FLIP_MARGIN = 2
/** WO-700 R4: an offset fit worse than this (RMS °) from 3+ marks asks whether the head stands elsewhere. */
const PLACE_ABOVE_DEG = 1
/** … within this far of where it is patched (m): further means the marks or the hang are wrong, not the spot. */
const PLACE_MAX_M = 10
/** WO-700 R5: a mirrored offset (pan + 180, tilt flipped) must fit this much better (RMS °) to beat a small one. */
const MIRROR_TOL_DEG = 1

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (v) => {
	const n = Math.hypot(v[0], v[1], v[2])
	return n < 1e-12 ? [0, 0, 0] : v.map((x) => x / n)
}

/** Angle (degrees) between the commanded beam and the ray to each point, for pose `q` = [x, y, z, yaw]. */
function errors(q, hang, pts, sign) {
	const pose = { x: q[0], y: q[1], z: q[2], yaw: q[3], hang }
	return pts.map((p) => {
		const b = beam(pose, sign * p.pan, p.tilt)
		const d = unit(sub([p.x, p.y, p.z], q))
		return Math.acos(Math.max(-1, Math.min(1, dot(b, d)))) * DEG
	})
}

function residuals(q, hang, pts, sign) {
	const pose = { x: q[0], y: q[1], z: q[2], yaw: q[3], hang }
	const out = []
	for (const p of pts) {
		const b = beam(pose, sign * p.pan, p.tilt)
		const d = unit(sub([p.x, p.y, p.z], q))
		out.push(b[0] - d[0], b[1] - d[1], b[2] - d[2])
	}
	return out
}

const cost = (r) => r.reduce((s, x) => s + x * x, 0)

/** Solve the n×n system A·x = b (Gaussian elimination, partial pivoting); null when singular. */
function solveLinear(A, b) {
	const n = b.length
	const M = A.map((row, i) => [...row, b[i]])
	for (let c = 0; c < n; c++) {
		let p = c
		for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
		if (Math.abs(M[p][c]) < 1e-12) return null
		;[M[c], M[p]] = [M[p], M[c]]
		for (let r = 0; r < n; r++) {
			if (r === c) continue
			const f = M[r][c] / M[c][c]
			for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
		}
	}
	return M.map((row, i) => row[n] / row[i])
}

/** For a fixed yaw the beams are known: the position nearest every backward ray point − t·beam. */
function nearestOrigin(yaw, hang, pts, sign) {
	const A = [
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
	]
	const b = [0, 0, 0]
	for (const p of pts) {
		const d = beam({ yaw, hang }, sign * p.pan, p.tilt)
		const P = [p.x, p.y, p.z]
		for (let i = 0; i < 3; i++) {
			for (let j = 0; j < 3; j++) {
				const m = (i === j ? 1 : 0) - d[i] * d[j]
				A[i][j] += m
				b[i] += m * P[j]
			}
		}
	}
	return solveLinear(A, b)
}

function levenbergMarquardt(q0, hang, pts, sign) {
	return lm(q0, (q) => residuals(q, hang, pts, sign), [1e-5, 1e-5, 1e-5, 1e-4])
}

/** Levenberg–Marquardt on any residual function, central-difference Jacobian with `steps` per parameter. */
function lm(q0, resid, steps) {
	let q = q0.slice()
	let r = resid(q)
	let c = cost(r)
	let lambda = 1e-3
	for (let it = 0; it < 200; it++) {
		const J = steps.map((h, k) => {
			const qp = q.slice()
			const qm = q.slice()
			qp[k] += h
			qm[k] -= h
			const rp = resid(qp)
			const rm = resid(qm)
			return rp.map((v, i) => (v - rm[i]) / (2 * h))
		})
		const JTJ = J.map((a) => J.map((b) => dot2(a, b)))
		const JTr = J.map((a) => dot2(a, r))
		let improved = false
		while (lambda < 1e10) {
			const A = JTJ.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)))
			const dq = solveLinear(
				A,
				JTr.map((v) => -v)
			)
			if (!dq) {
				lambda *= 10
				continue
			}
			const qn = q.map((v, i) => v + dq[i])
			const rn = resid(qn)
			const cn = cost(rn)
			if (cn < c) {
				const done = c - cn < 1e-15 * (1 + c)
				q = qn
				r = rn
				c = cn
				lambda = Math.max(1e-9, lambda / 10)
				improved = !done
				break
			}
			lambda *= 10
		}
		if (!improved) break
	}
	return { q, c }
}

function dot2(a, b) {
	let s = 0
	for (let i = 0; i < a.length; i++) s += a[i] * b[i]
	return s
}

const wrapYaw = (y) => {
	const w = ((((y + 180) % 360) + 360) % 360) - 180
	return Math.round(w * 100) / 100
}

/** Best pose for one pan sense: the yaw sweep's best seeds, each refined. */
function solveSense(hang, pts, sign) {
	const seeds = []
	for (let yaw = -180; yaw < 180; yaw += 5) {
		const o = nearestOrigin(yaw, hang, pts, sign)
		if (!o) continue
		const q = [...o, yaw]
		seeds.push({ q, c: cost(residuals(q, hang, pts, sign)) })
	}
	seeds.sort((a, b) => a.c - b.c)
	let best = null
	for (const s of seeds.slice(0, 6)) {
		const r = levenbergMarquardt(s.q, hang, pts, sign)
		if (!best || r.c < best.c) best = r
	}
	return best
}

/** Smallest spread of the points across the floor (m): ~0 when they lie on one line (yaw / position trade off). */
function spread(pts) {
	const n = pts.length
	const mx = pts.reduce((s, p) => s + p.x, 0) / n
	const my = pts.reduce((s, p) => s + p.y, 0) / n
	let a = 0
	let b = 0
	let c = 0
	for (const p of pts) {
		a += (p.x - mx) ** 2
		b += (p.x - mx) * (p.y - my)
		c += (p.y - my) ** 2
	}
	a /= n
	b /= n
	c /= n
	const tr = (a + c) / 2
	return Math.sqrt(Math.max(0, tr - Math.sqrt(Math.max(0, tr * tr - (a * c - b * b)))))
}

/**
 * @param {{ pan: number, tilt: number, x: number, y: number, z: number }[]} pts pan / tilt in the follow engine's
 *   commanded degrees (before the profile's inverts, as aim() writes them); x, y, z PSN metres
 * @param {{ hang?: 'truss'|'floor' }} [opts]
 * @returns {{ ok: false, need: number } | { ok: true, pose: { x, y, z, yaw, hang }, flip_pan: boolean,
 *   rms_deg: number, max_deg: number, errors_deg: number[], spread_m: number, warning: string|null }}
 */
function solveFixturePose(pts, opts = {}) {
	const list = (Array.isArray(pts) ? pts : [])
		.filter((p) => [p?.pan, p?.tilt, p?.x, p?.y, p?.z].every((v) => Number.isFinite(Number(v))))
		.map((p) => ({ pan: Number(p.pan), tilt: Number(p.tilt), x: Number(p.x), y: Number(p.y), z: Number(p.z) }))
	if (list.length < MIN_POINTS) return { ok: false, need: MIN_POINTS - list.length }
	const hang = opts.hang === 'floor' ? 'floor' : 'truss'
	const keep = solveSense(hang, list, 1)
	const flip = solveSense(hang, list, -1)
	const flipPan = !!flip && (!keep || flip.c * FLIP_MARGIN < keep.c)
	const best = flipPan ? flip : keep
	const errs = errors(best.q, hang, list, flipPan ? -1 : 1)
	const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length)
	const r2 = (v) => Math.round(v * 100) / 100
	const sp = spread(list)
	let warning = null
	if (sp < 0.3) warning = 'The points lie almost on one line — add one well off that line.'
	else if (rms > 2) warning = 'Poor fit — check the hang, the pan / tilt ranges and that each marker sits on its spot.'
	return {
		ok: true,
		pose: { x: r2(best.q[0]), y: r2(best.q[1]), z: r2(best.q[2]), yaw: wrapYaw(best.q[3]), hang },
		flip_pan: flipPan,
		rms_deg: r2(rms),
		max_deg: r2(Math.max(...errs)),
		errors_deg: errs.map(r2),
		spread_m: r2(sp),
		warning,
	}
}

/**
 * WO-700 R3 (owner 23.10: "beam is on mark makes the fixture it self change position rather then changing where the
 * beam points") — the head stays where it is patched; what is solved is the pan / tilt offset the previs adds to the
 * angles the head is sent, so its beam lands where the real one does. One point fixes both; more are least squares.
 *
 * @param {{ pan: number, tilt: number, x: number, y: number, z: number }[]} pts pan / tilt = the angles sent
 *   (physical degrees), x, y, z the mark (PSN m)
 * @param {(pan: number, tilt: number, pose?: object) => { origin: number[], dir: number[] }} forward the head's beam
 *   at those angles (from `pose`, default where it is patched)
 * @param {{ pose?: { x: number, y: number } }} [opts] the patched pose: lets R4 test whether the head stands elsewhere
 * @returns {{ ok: false, need: 1 } | { ok: true, offset: { pan, tilt }, rms_deg, max_deg, errors_deg, warning,
 *   place: { x, y, offset: { pan, tilt }, rms_deg } | null }}
 */
function solveOffsets(pts, forward, opts = {}) {
	const list = (Array.isArray(pts) ? pts : []).filter((p) => [p?.pan, p?.tilt, p?.x, p?.y, p?.z].every(Number.isFinite))
	if (!list.length) return { ok: false, need: 1 }
	const rays = (q, pose) =>
		list.map((p) => {
			const { origin, dir } = forward(p.pan + q[0], p.tilt + q[1], pose)
			return { b: unit(dir), d: unit(sub([p.x, p.y, p.z], origin)) }
		})
	const resid = (q, pose) => rays(q, pose).flatMap(({ b, d }) => [b[0] - d[0], b[1] - d[1], b[2] - d[2]])
	const seeds = []
	for (let op = -180; op < 180; op += 15) for (let ot = -165; ot <= 165; ot += 15) seeds.push([op, ot])
	const fits = seeds
		.map((q) => ({ q, c: cost(resid(q)) }))
		.sort((a, b) => a.c - b.c)
		.slice(0, 8)
		.map((s) => lm(s.q, resid, [1e-4, 1e-4]))
	// the same beam is reached with pan + 180 and the tilt mirrored: the smallest correction wins among near-equal
	// fits. Near, not equal: the lens sits off the tilt axis, so the mirror fits marks that disagree a little better
	// or worse — live 23.10 two marks 3° apart picked (−168°, +139°) and the digital head was drawn flipped over
	const wrap = (v) => ((((v + 180) % 360) + 360) % 360) - 180
	const rmsOf = (q) => {
		const e = rays(q).map(({ b, d }) => Math.acos(Math.max(-1, Math.min(1, dot(b, d)))) * DEG)
		return Math.sqrt(e.reduce((s, x) => s + x * x, 0) / e.length)
	}
	fits.forEach((f) => (f.rms = rmsOf(f.q)))
	const best = Math.min(...fits.map((f) => f.rms))
	const size = (f) => Math.abs(wrap(f.q[0])) + Math.abs(wrap(f.q[1]))
	const pick = fits.filter((f) => f.rms <= best + MIRROR_TOL_DEG).sort((a, b) => size(a) - size(b))[0]
	const errs = rays(pick.q).map(({ b, d }) => Math.acos(Math.max(-1, Math.min(1, dot(b, d)))) * DEG)
	const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length)
	const r2 = (v) => Math.round(v * 100) / 100
	const place =
		rms > PLACE_ABOVE_DEG && list.length >= MIN_POINTS && opts.pose
			? solvePlace(opts.pose, pick.q, resid, rays, rms)
			: null
	return {
		ok: true,
		offset: { pan: r2(wrap(pick.q[0])), tilt: r2(wrap(pick.q[1])) },
		rms_deg: r2(rms),
		max_deg: r2(Math.max(...errs)),
		errors_deg: errs.map(r2),
		place,
		warning: place
			? `The marks do not agree on one offset — the head is not where it is patched: the marks put it near X ${place.x}  Y ${place.y} — check its position in the patch.`
			: rms > 2
				? 'The marks do not agree on one offset — check where the head is patched (position, hang) and that the beam was on each mark.'
				: Math.abs(wrap(pick.q[1])) > 45
					? 'A large tilt offset — is the hang (truss / floor) right, and was the real beam on the mark?'
					: null,
	}
}

/**
 * WO-700 R4 (owner 23.10: "mark 1 and 4 calibrated position correctly but 2 and 3 didnt") — when no single offset
 * fits, the head is not where it is patched: one offset then turns the beam onto the marks on one side and misses the
 * other side. With 3+ marks, find the floor position (x, y; height, yaw and hang kept) the marks put the head at —
 * a hint in the warning only (R6, owner: "the calibration cant move the position of the fixture in 3d enviroment").
 */
function solvePlace(pose, q0, resid, rays, rms) {
	const at = (q) => ({ ...pose, x: q[0], y: q[1] })
	let best = null
	for (const [dx, dy] of [
		[0, 0],
		[2, 0],
		[-2, 0],
		[0, 2],
		[0, -2],
	]) {
		const f = lm([pose.x + dx, pose.y + dy, q0[0], q0[1]], (q) => resid(q.slice(2), at(q)), [1e-4, 1e-4, 1e-4, 1e-4])
		if (!best || f.c < best.c) best = f
	}
	const errs = rays(best.q.slice(2), at(best.q)).map(({ b, d }) => Math.acos(Math.max(-1, Math.min(1, dot(b, d)))) * DEG)
	const fit = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length)
	if (!(fit < rms / 2) || Math.hypot(best.q[0] - pose.x, best.q[1] - pose.y) > PLACE_MAX_M) return null
	const r2 = (v) => Math.round(v * 100) / 100
	const wrap = (v) => ((((v + 180) % 360) + 360) % 360) - 180
	return {
		x: r2(best.q[0]),
		y: r2(best.q[1]),
		offset: { pan: r2(wrap(best.q[2])), tilt: r2(wrap(best.q[3])) },
		rms_deg: r2(fit),
	}
}

module.exports = { solveFixturePose, solveOffsets, MIN_POINTS, errors, spread }

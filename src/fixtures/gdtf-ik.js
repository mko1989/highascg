'use strict'

/**
 * WO-615 T9 — follow / point-at IK on the fixture type's own GDTF Axis chain, so a beam lands on the target with the
 * head's real yoke and tilt-pivot offsets (the generic follow-ik.js model pivots everything at the pose point).
 *
 * Forward kinematics are the previs's (fixtures_3d.gd): the gdtf-rig.js nodes in Godot's frame (Y up), each Axis
 * node = rest · rotation(pan: about local Y, tilt: about local X, physical degrees), the beam along its node's −Y,
 * the fixture placed by its pose exactly as fixtures_3d_model.gd pose_xform (hung = the GDTF rest pose, floor =
 * turned over about Z, yaw about Y). So what the IK solves is what the previs then draws.
 *
 * The solve is in physical degrees (damped Gauss-Newton from the previous aim and its flipped branch, then a coarse
 * grid if neither converges); every pan ± 360° copy inside the function's range is a candidate and the one nearest
 * the previous aim wins (as follow-ik.js). Results are commanded degrees from the DMX centre — what axisBytes writes —
 * via the patch's invert (toPhys / toDeg). Pure.
 *
 *   chainOf(rig)                 → [{ xf, axis }] root → the first beam under both a pan and a tilt axis, or null
 *   beamOf(chain, pose, pan, tilt) → { origin, dir } in PSN (x stage left, y upstage, z up)
 *   aimFixture(fx, target, prev) → { pan, tilt } commanded, or null — the chain IK when fx.gdtf.chain, else aim()
 *                                (the chain IK honours the patch's calibrated `offset`, WO-700 R3)
 */

const { aim } = require('./follow-ik')
const { offsetAt, sentFor } = require('./beam-offset')

const RAD = Math.PI / 180

/** 12-number affine (basis x, y, z columns, origin) products, as gdtf-rig.js writes them. */
function mul(a, b) {
	const o = new Array(12)
	for (let c = 0; c < 4; c++) {
		for (let r = 0; r < 3; r++) {
			o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2] + (c === 3 ? a[9 + r] : 0)
		}
	}
	return o
}

function rotY(deg) {
	const c = Math.cos(deg * RAD)
	const s = Math.sin(deg * RAD)
	return [c, 0, -s, 0, 1, 0, s, 0, c, 0, 0, 0]
}

function rotX(deg) {
	const c = Math.cos(deg * RAD)
	const s = Math.sin(deg * RAD)
	return [1, 0, 0, 0, c, s, 0, -s, c, 0, 0, 0]
}

function rotZ(deg) {
	const c = Math.cos(deg * RAD)
	const s = Math.sin(deg * RAD)
	return [c, s, 0, -s, c, 0, 0, 0, 1, 0, 0, 0]
}

/**
 * fixtures_3d_model.gd pose_xform: position (x, z, −y); rotation Y(−yaw) · X(pitch) · Z(roll) (Godot's YXZ Euler —
 * pitch / roll come from MVR mounts, WO-615 T10), floor = turned over about Z.
 */
function poseXf(pose) {
	let m = mul(mul(rotY(-(Number(pose.yaw) || 0)), rotX(Number(pose.pitch) || 0)), rotZ(Number(pose.roll) || 0))
	if (pose.hang === 'floor') m = mul(m, [-1, 0, 0, 0, -1, 0, 0, 0, 1, 0, 0, 0])
	m[9] = Number(pose.x) || 0
	m[10] = Number.isFinite(Number(pose.z)) ? Number(pose.z) : 6
	m[11] = -(Number(pose.y) || 0)
	return m
}

function chainOf(rig) {
	const nodes = rig?.nodes || []
	for (let i = 0; i < nodes.length; i++) {
		if (nodes[i].kind !== 'Beam') continue
		const path = []
		for (let j = i, guard = 0; j >= 0 && guard < 64; j = nodes[j].parent, guard++) path.unshift(nodes[j])
		const kinds = new Set(path.map((n) => n.axis).filter(Boolean))
		if (kinds.has('pan') && kinds.has('tilt')) return path.map((n) => ({ xf: n.xf, axis: n.axis || '' }))
	}
	return null
}

function beamOf(chain, pose, pan, tilt) {
	let m = poseXf(pose)
	for (const n of chain) {
		m = mul(m, n.xf)
		if (n.axis === 'pan') m = mul(m, rotY(pan))
		else if (n.axis === 'tilt') m = mul(m, rotX(tilt))
	}
	const g2p = (x, y, z) => [x, -z, y] // Godot → PSN
	return { origin: g2p(m[9], m[10], m[11]), dir: g2p(-m[3], -m[4], -m[5]) }
}

function initialFn(c) {
	return c.functions[c.initial] || c.functions[0]
}

function axisFn(fx, attribute) {
	for (const c of fx.gdtf?.channels || []) {
		const f = initialFn(c)
		if (f && f.attribute === attribute) return f
	}
	return null
}

/**
 * IK degrees from the DMX centre ↔ the function's physical value, as follow-ik.js axisBytes writes them (`invert` =
 * the patch's flip XOR a falling range, gdtf-patch.js applyType) — so an unflipped head gets physical = IK degrees.
 */
function toPhys(f, ax, deg) {
	let n = Math.max(0, Math.min(1, (deg + ax.range / 2) / ax.range))
	if (ax.invert) n = 1 - n
	return f.physFrom + n * (f.physTo - f.physFrom)
}

function toDeg(f, ax, phys) {
	const span = f.physTo - f.physFrom
	let n = span === 0 ? 0.5 : (phys - f.physFrom) / span
	if (ax.invert) n = 1 - n
	return n * ax.range - ax.range / 2
}

/**
 * The axis as the GDTF file runs it (a falling range inverts, the patch's flip does not): the chain IK solves the
 * head's geometric angle and converts with this, so axisBytes (flip XOR falling) then sends a flipped head the mirror
 * value — the T6 meaning of a patch flip (the real head turns opposite to its file; the previs shows the file).
 */
const fileAxis = (f, ax) => ({ range: ax.range, invert: f.physTo < f.physFrom })

/** Beam direction minus the direction to the target (0 when the beam passes through it), or null. */
function residual(chain, pose, target, p, t) {
	const { origin, dir } = beamOf(chain, pose, p, t)
	const w = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]]
	const n = Math.hypot(w[0], w[1], w[2])
	return n < 1e-6 ? null : [dir[0] - w[0] / n, dir[1] - w[1] / n, dir[2] - w[2] / n]
}

const sq = (r) => r[0] * r[0] + r[1] * r[1] + r[2] * r[2]
const OK = 1e-6 // |r|² — about 0.06° off the target

/** Damped Gauss-Newton on (pan, tilt) physical degrees → { p, t, err } or null. */
function refine(chain, pose, target, p, t) {
	let r = residual(chain, pose, target, p, t)
	if (!r) return null
	let lambda = 1e-3
	for (let it = 0; it < 40 && sq(r) > 1e-12; it++) {
		const h = 0.01
		const rp = residual(chain, pose, target, p + h, t)
		const rt = residual(chain, pose, target, p, t + h)
		if (!rp || !rt) return null
		const jp = rp.map((v, i) => (v - r[i]) / h)
		const jt = rt.map((v, i) => (v - r[i]) / h)
		const a = sq(jp) + lambda
		const b = jp[0] * jt[0] + jp[1] * jt[1] + jp[2] * jt[2]
		const d = sq(jt) + lambda
		const gp = -(jp[0] * r[0] + jp[1] * r[1] + jp[2] * r[2])
		const gt = -(jt[0] * r[0] + jt[1] * r[1] + jt[2] * r[2])
		const det = a * d - b * b
		if (Math.abs(det) < 1e-18) break
		const dp = Math.max(-60, Math.min(60, (gp * d - gt * b) / det))
		const dt = Math.max(-60, Math.min(60, (gt * a - gp * b) / det))
		const r2 = residual(chain, pose, target, p + dp, t + dt)
		if (r2 && sq(r2) < sq(r)) {
			p += dp
			t += dt
			r = r2
			lambda = Math.max(1e-9, lambda / 10)
		} else lambda *= 10
	}
	return { p, t, err: sq(r) }
}

function aimChain(fx, target, prev) {
	const pf = axisFn(fx, 'Pan')
	const tf = axisFn(fx, 'Tilt')
	if (!pf || !tf) return aim(fx, target, prev)
	const chain = fx.gdtf.chain
	const pa = fileAxis(pf, fx.pan)
	const ta = fileAxis(tf, fx.tilt)
	// WO-700 R3 / R7: the real head points at its sent angle + the calibrated correction there (beam-offset.js)
	const sp = toPhys(pf, pa, prev.pan)
	const st = toPhys(tf, ta, prev.tilt)
	const e0 = offsetAt(fx, sp, st)
	const p0 = sp + e0.pan
	const t0 = st + e0.tilt
	const sols = []
	for (const [p, t] of [[p0, t0], [p0 + 180, -t0]]) {
		const s = refine(chain, fx.pose, target, p, t)
		if (s && s.err < OK) sols.push(s)
	}
	if (!sols.length) {
		const grid = []
		for (let p = -180; p < 180; p += 30) {
			for (let t = -150; t <= 150; t += 30) {
				const r = residual(chain, fx.pose, target, p, t)
				if (r) grid.push([sq(r), p, t])
			}
		}
		for (const [, p, t] of grid.sort((x, y) => x[0] - y[0]).slice(0, 4)) {
			const s = refine(chain, fx.pose, target, p, t)
			if (s && s.err < OK) sols.push(s)
		}
	}
	const inside = (f, v) => v >= Math.min(f.physFrom, f.physTo) - 1e-6 && v <= Math.max(f.physFrom, f.physTo) + 1e-6
	let best = null
	let cost = Infinity
	for (const s of sols) {
		const gt = ((((s.t + 180) % 360) + 360) % 360) - 180
		const base = s.p - e0.pan - 360 * Math.round((s.p - e0.pan) / 360)
		for (let k = -3; k <= 3; k++) {
			const { pan: p, tilt: t } = sentFor(fx, base + e0.pan + 360 * k, gt)
			if (!inside(tf, t) || !inside(pf, p)) continue
			const cand = { pan: toDeg(pf, pa, p), tilt: toDeg(tf, ta, t) }
			const c = Math.abs(cand.pan - prev.pan) + Math.abs(cand.tilt - prev.tilt)
			if (c < cost) {
				cost = c
				best = cand
			}
		}
	}
	return best
}

function aimFixture(fx, target, prev = { pan: 0, tilt: 0 }) {
	return fx.gdtf?.chain && fx.pose ? aimChain(fx, target, prev) : aim(fx, target, prev)
}

module.exports = { chainOf, beamOf, aimFixture, axisFn, toPhys, toDeg, fileAxis, poseXf }

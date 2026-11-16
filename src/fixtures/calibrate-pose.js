'use strict'

/**
 * WO-764 — where a head really hangs (x, y, z, yaw, PITCH, ROLL), solved from its (pan, tilt) ↔ stage-mark pairs through
 * the head's own beam model (the GDTF axis chain calibrate-session.js liveModel reads its angles for), with a fit report
 * the operator can act on. It is the desk's pose (WO-765 MVR export) — the previs never reads it (WO-700 R6).
 *
 * Unknowns and marks: every mark gives two angles. The position and the turn (x, y, z, yaw) need 3 marks (6 angles for
 * 4 unknowns). Pitch and roll — a raked pipe, a turned clamp — are solved too from MIN_MARKS_6 marks when the marks
 * contradict the patch's values (the six-parameter fit beats the four-parameter one by more than AIM_NOISE_DEG of aiming
 * error explains, χ² 99 %) and pin them down (1 σ ≤ SD_TILT_DEG from the least-squares covariance); else they stay the
 * patch's — which keeps the position tighter when the head is level as patched — and the report says which. Marks close together or in a line are reported weak, a mark the solved head misses by more than
 * BAD_MISS_M (on its own floor height) bad. A pan running mirrored (desk patch inverted against the GDTF) is caught by
 * solving the mirrored sense too.
 *
 * Method: x, y, z, yaw by LM from the patched pose (yaw seeds every 15°), then — with enough marks — LM over all six from
 * that. Pure.
 */

const { lm, solveLinear, spread } = require('./calibrate-solve')
const { poseXf } = require('./gdtf-ik')

const DEG = 180 / Math.PI
const MIN_MARKS = 3
const MIN_MARKS_6 = 4
/** Assumed aiming error of "the beam is on the mark" (°): an LD centring a beam by eye at 5–15 m. */
const AIM_NOISE_DEG = 0.3
/** χ² (2 degrees of freedom) at 99 %: the marks contradict the patch's pitch / roll. */
const CHI2_2_99 = 9.21
/** … and a solved pitch / roll is used only when the marks determine it to this (1 σ, °). */
const SD_TILT_DEG = 3
/** A solved pitch / roll further than this from the patch is not believed (a head is not clamped 30° off level). */
const MAX_TILT_CHANGE_DEG = 30
const WEAK_SPREAD_M = 0.3
/** 1 σ of the desk's aim over the marked area (m) above which the marks are too few / too close (aimSd). */
const WEAK_AIM_M = 0.1
const BAD_MISS_M = 0.25
const BAD_RMS_DEG = 2
const FLIP_MARGIN = 2

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (v) => {
	const n = Math.hypot(v[0], v[1], v[2])
	return n < 1e-12 ? [0, 0, 0] : v.map((x) => x / n)
}
const r2 = (v) => Math.round(v * 100) / 100 || 0
const r3 = (v) => Math.round(v * 1000) / 1000 || 0
const wrap = (v) => ((((v + 180) % 360) + 360) % 360) - 180
const angle = (b, d) => Math.acos(Math.max(-1, Math.min(1, dot(b, d)))) * DEG

/** Angle (°) between the two poses' rotations (hang included). */
function turnedDeg(a, b) {
	const A = poseXf(a)
	const B = poseXf(b)
	let tr = 0
	for (let c = 0; c < 3; c++) tr += A[c * 3] * B[c * 3] + A[c * 3 + 1] * B[c * 3 + 1] + A[c * 3 + 2] * B[c * 3 + 2]
	return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * DEG
}

/** How far the mark lies off the beam, across it (m). */
function offM(origin, dir, p) {
	const w = sub([p.x, p.y, p.z], origin)
	const k = dot(w, dir)
	return Math.hypot(w[0] - k * dir[0], w[1] - k * dir[1], w[2] - k * dir[2])
}

/** Where the beam misses the mark (m): on the mark's own height when the beam comes down to it, else off the ray. */
function missM(origin, dir, p) {
	if (dir[2] < -0.05 && p.z < origin[2]) {
		const t = (p.z - origin[2]) / dir[2]
		return Math.hypot(origin[0] + t * dir[0] - p.x, origin[1] + t * dir[1] - p.y)
	}
	return offM(origin, dir, p)
}

/** Covariance of the fitted parameters (their own units: m, °) at AIM_NOISE_DEG per angle: σ² · (JᵀJ)⁻¹; null when singular. */
function covariance(resid, q, steps) {
	const J = steps.map((h, k) => {
		const qp = q.slice()
		const qm = q.slice()
		qp[k] += h
		qm[k] -= h
		const rp = resid(qp)
		const rm = resid(qm)
		return rp.map((v, i) => (v - rm[i]) / (2 * h))
	})
	const n = steps.length
	const JTJ = J.map((a) => J.map((b) => a.reduce((s, v, i) => s + v * b[i], 0)))
	const s2 = (AIM_NOISE_DEG / DEG) ** 2
	const cols = Array.from({ length: n }, (_, k) => solveLinear(JTJ, Array.from({ length: n }, (_, i) => (i === k ? 1 : 0))))
	return cols.some((c) => !c) ? null : cols.map((c) => c.map((v) => v * s2))
}

const sdOf = (C, n) => Array.from({ length: n }, (_, k) => (C && C[k][k] > 0 ? Math.sqrt(C[k][k]) : Infinity))

/**
 * How far (1 σ, m) a desk aiming from the solved pose would put the beam off `targets`: the direction to each target in
 * the head's own frame — all a pan / tilt solve sees — propagated through the covariance, times the throw.
 */
function aimSd(C, q, at, targets) {
	if (!C) return Infinity
	const local = (qq, T) => {
		const m = poseXf(at(qq))
		const w = [T[0] - m[9], T[2] - m[10], -T[1] - m[11]] // PSN → Godot, relative to the head
		return unit([dot(m.slice(0, 3), w), dot(m.slice(3, 6), w), dot(m.slice(6, 9), w)])
	}
	let worst = 0
	for (const T of targets) {
		const g = q.map((_, k) => {
			const h = k < 3 ? 1e-4 : 1e-3
			const qp = q.slice()
			const qm = q.slice()
			qp[k] += h
			qm[k] -= h
			const a = local(qp, T)
			const b = local(qm, T)
			return [0, 1, 2].map((i) => (a[i] - b[i]) / (2 * h))
		})
		let v = 0
		for (let i = 0; i < 3; i++) for (let j = 0; j < q.length; j++) for (let k = 0; k < q.length; k++) v += g[j][i] * C[j][k] * g[k][i]
		const m = poseXf(at(q))
		const throwM = Math.hypot(T[0] - m[9], T[1] + m[11], T[2] - m[10])
		worst = Math.max(worst, Math.sqrt(Math.max(0, v)) * throwM)
	}
	return worst
}

/**
 * @param {{ pan, tilt, x, y, z, name? }[]} pts physical angles the real head was at, the mark it was on (PSN m)
 * @param {(pan: number, tilt: number, pose: object) => { origin: number[], dir: number[] }} forward the head's beam
 * @param {{ pose: { x, y, z, yaw, hang?, pitch?, roll? }, mirrorPan?: (pan: number) => number }} opts the patched pose;
 *   mirrorPan: the same DMX read in the other pan sense (default −pan)
 * @returns {{ ok: false, need: number } | { ok: true, pose, dof: 4 | 6, held: string[], rms_deg, max_deg, errors_deg,
 *   miss_m, off_m, worst: { i, name, off_m, miss_m, deg }, spread_m, moved_m, turned_deg, sd: { aim_m, pos_m, yaw_deg, pitch_deg, roll_deg },
 *   flip_pan, verdict: 'good' | 'weak' | 'bad', note: string, warning: string | null }}
 */
function solveHeadPose(pts, forward, opts = {}) {
	const list = (Array.isArray(pts) ? pts : []).filter((p) => [p?.pan, p?.tilt, p?.x, p?.y, p?.z].every(Number.isFinite))
	if (list.length < MIN_MARKS) return { ok: false, need: MIN_MARKS - list.length }
	const p0 = opts.pose || {}
	const base = {
		x: Number(p0.x) || 0, y: Number(p0.y) || 0, z: Number(p0.z) || 0, yaw: Number(p0.yaw) || 0,
		pitch: Number(p0.pitch) || 0, roll: Number(p0.roll) || 0, hang: p0.hang === 'floor' ? 'floor' : 'truss',
	}
	const mirror = typeof opts.mirrorPan === 'function' ? opts.mirrorPan : (p) => -p
	const at = (q) => ({ ...base, x: q[0], y: q[1], z: q[2], yaw: q[3], ...(q.length > 4 ? { pitch: q[4], roll: q[5] } : {}) })
	const rays = (q, panOf = (p) => p) =>
		list.map((p) => {
			const { origin, dir } = forward(panOf(p.pan), p.tilt, at(q))
			return { origin, b: unit(dir), d: unit(sub([p.x, p.y, p.z], origin)) }
		})
	const residOf = (panOf) => (q) => rays(q, panOf).flatMap(({ b, d }) => [b[0] - d[0], b[1] - d[1], b[2] - d[2]])
	const cost = (r) => r.reduce((s, x) => s + x * x, 0)
	const STEP4 = [1e-4, 1e-4, 1e-4, 1e-3]
	const STEP6 = [...STEP4, 1e-3, 1e-3]

	const solve4 = (panOf) => {
		const resid = residOf(panOf)
		const seeds = []
		for (let dy = -180; dy < 180; dy += 15) seeds.push([base.x, base.y, base.z, base.yaw + dy])
		return seeds
			.map((q) => ({ q, c: cost(resid(q)) }))
			.sort((a, b) => a.c - b.c)
			.slice(0, 6)
			.map((s) => lm(s.q, resid, STEP4))
			.reduce((a, b) => (b.c < a.c ? b : a))
	}
	const rmsOf = (q, panOf) => {
		const e = rays(q, panOf).map(({ b, d }) => angle(b, d))
		return Math.sqrt(e.reduce((s, x) => s + x * x, 0) / e.length)
	}

	const four = solve4((p) => p)
	const mirrored = solve4(mirror)
	const flipPan = mirrored.c * FLIP_MARGIN < four.c && rmsOf(mirrored.q, mirror) + 0.5 < rmsOf(four.q, (p) => p)
	const panOf = flipPan ? mirror : (p) => p
	const resid = residOf(panOf)
	const best = flipPan ? mirrored : four
	let q = best.q
	let dof = 4
	const C4 = covariance(resid, q, STEP4)
	let C6 = null
	let tiltHint = false
	if (list.length >= MIN_MARKS_6 && !flipPan) {
		const seeds = [[...q, base.pitch, base.roll]]
		if (base.pitch || base.roll) seeds.push([...q, 0, 0])
		const six = seeds.map((s) => lm(s, resid, STEP6)).reduce((a, b) => (b.c < a.c ? b : a))
		C6 = covariance(resid, six.q, STEP6)
		const sd6 = sdOf(C6, 6)
		// the patch's pitch / roll are dropped only when the marks contradict them: the six-parameter fit is better by more
		// than chance at AIM_NOISE_DEG (χ², 2 extra parameters, 99 %) — else they stay, which keeps the position tighter
		const sigma = AIM_NOISE_DEG / DEG
		const contradicts = (best.c - six.c) / (sigma * sigma) > CHI2_2_99
		const tame = Math.abs(wrap(six.q[4] - base.pitch)) <= MAX_TILT_CHANGE_DEG && Math.abs(wrap(six.q[5] - base.roll)) <= MAX_TILT_CHANGE_DEG
		if (contradicts && tame && sd6[4] <= SD_TILT_DEG && sd6[5] <= SD_TILT_DEG) {
			q = six.q
			dof = 6
		} else if (contradicts) tiltHint = true
	}
	const C = dof === 6 ? C6 : C4
	const sd = sdOf(C, dof)
	const solved = at(q)
	const rs = rays(q, panOf)
	const errs = rs.map(({ b, d }) => angle(b, d))
	const miss = rs.map(({ origin, b }, i) => missM(origin, b, list[i]))
	// the verdict reads the miss across the beam: on the floor a grazing beam (a floor head on a floor mark) multiplies it
	const off = rs.map(({ origin, b }, i) => offM(origin, b, list[i]))
	const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length)
	const wi = off.indexOf(Math.max(...off))
	const nameOf = (i) => String(list[i].name || `mark ${i + 1}`)
	const sp = spread(list)
	const posSd = Math.hypot(sd[0], sd[1], sd[2])
	// the stage the marks span: every mark and their middle
	const mid = [0, 1, 2].map((i) => list.reduce((t, p) => t + [p.x, p.y, p.z][i], 0) / list.length)
	const aim = aimSd(C, q, at, [...list.map((p) => [p.x, p.y, p.z]), mid])
	const pose = { x: r3(solved.x), y: r3(solved.y), z: r3(solved.z), yaw: r2(wrap(solved.yaw)), pitch: r2(wrap(solved.pitch)),
		roll: r2(wrap(solved.roll)), hang: base.hang }
	const moved = Math.hypot(solved.x - base.x, solved.y - base.y, solved.z - base.z)
	const held = dof === 6 ? [] : ['pitch', 'roll']
	let verdict = 'good'
	let note
	if (flipPan) {
		verdict = 'bad'
		note = 'bad: the pan runs the other way round — check Invert pan (desk and patch)'
	} else if (off[wi] > BAD_MISS_M || rms > BAD_RMS_DEG) {
		verdict = 'bad'
		note = `bad: ${r2(off[wi])} m off on ${nameOf(wi)} — was the beam on that mark, is the mark measured right?`
	} else if (sp < WEAK_SPREAD_M) {
		verdict = 'weak'
		note = 'weak: marks nearly in line — add one well off that line'
	} else if (aim > WEAK_AIM_M) {
		verdict = 'weak'
		note = `weak: a desk aiming from this pose could miss by ±${r2(aim)} m — add marks further apart`
	} else if (tiltHint) {
		verdict = 'weak'
		note = 'weak: the head is not level as patched (pitch / roll), but the marks cannot pin it down — add marks further apart'
	} else if (list.length < MIN_MARKS_6) {
		// 3 marks give 6 angles for x, y, z, yaw: they fit a head that is not level too (a 3° rake moves it ~0.5 m)
		verdict = 'weak'
		note = `weak: 3 marks fit (${r2(rms)}°) but cannot check that the head is level — aim it at a 4th mark`
	} else {
		note = `good: fit ${r2(rms)}°, worst ${Math.round(off[wi] * 100)} cm (${nameOf(wi)})`
		note += dof === 6 ? ' · pitch / roll solved' : ' · pitch / roll as patched (the marks agree)'
	}
	return {
		ok: true,
		pose,
		dof,
		held,
		rms_deg: r2(rms),
		max_deg: r2(Math.max(...errs)),
		errors_deg: errs.map(r2),
		miss_m: miss.map(r3),
		off_m: off.map(r3),
		worst: { i: wi, name: nameOf(wi), off_m: r3(off[wi]), miss_m: r3(miss[wi]), deg: r2(errs[wi]) },
		spread_m: r2(sp),
		moved_m: r3(moved),
		turned_deg: r2(turnedDeg(base, solved)),
		sd: { aim_m: r3(aim), pos_m: r3(posSd), yaw_deg: r2(sd[3]), pitch_deg: dof === 6 ? r2(sd[4]) : null, roll_deg: dof === 6 ? r2(sd[5]) : null },
		flip_pan: flipPan,
		verdict,
		note,
		warning: verdict === 'good' ? null : note,
	}
}

module.exports = { solveHeadPose, turnedDeg }

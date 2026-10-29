'use strict'

/**
 * WO-804 — the heads nobody measured, inferred from the anchors that were (rig-anchors.js picks them, calibrate-solve.js
 * solvePoseForward solves them). Pure. Model (b) of the WO's comparison — the rig is off as a whole, then per row:
 *
 *   rig fit   from all solved anchors: a turn in plan (≥ 2 anchors spread ≥ RIG_SPREAD_M in plan) and a shift
 *             (x, y, mean z) — the MVR origin against the taped stage origin.
 *   row       what the rig fit leaves at a row's anchors: one anchor → that offset for the whole row (trim height,
 *             a shift); two or more spread ≥ ROW_SPREAD_M along the row → a straight line through them (the row's
 *             turn and rake). A row without an anchor gets the rig fit alone.
 *   yaw       patched yaw − the rig turn (pose.yaw runs clockwise seen from above: 90 = stage left) + the mean yaw the
 *             row's anchors are off by. Hang, pitch and roll stay as patched.
 *
 * Residuals (what the operator reads): a measured head — its solve fit (rms_deg) and `loo_m`, how far the model misses
 * it when it is left out. An inferred head — `residual_m`, leave-one-out misses of heads predicted the way it is: on a
 * row with 2+ anchors the nearest one's; on a row with one anchor the RMS over anchors that shared a row (each then
 * predicted from one row-mate); on a row with none the RMS over anchors alone on their row (predicted by the rig fit
 * only). null with fewer than two anchors.
 */

const RIG_SPREAD_M = 0.5
const ROW_SPREAD_M = 1

const DEG = 180 / Math.PI
const wrap = (v) => ((((v + 180) % 360) + 360) % 360) - 180
const r2 = (v) => Math.round(v * 100) / 100 || 0
const r3 = (v) => Math.round(v * 1000) / 1000 || 0
const posOf = (p) => [Number(p.x), Number(p.y), Number(p.z)]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** The rig fit from anchors [{ p: patched [x,y,z], s: solved [x,y,z] }] → { turn (rad, ccw in plan), apply(p) }. */
function rigFit(pairs) {
	const n = pairs.length
	if (!n) return { turn: 0, shift: [0, 0, 0], apply: (p) => p.slice() }
	const cp = [0, 1, 2].map((i) => pairs.reduce((s, a) => s + a.p[i], 0) / n)
	const cs = [0, 1, 2].map((i) => pairs.reduce((s, a) => s + a.s[i], 0) / n)
	let c = 0
	let d = 0
	let spread = 0
	for (const a of pairs) {
		const p = sub(a.p, cp)
		const s = sub(a.s, cs)
		d += p[0] * s[0] + p[1] * s[1]
		c += p[0] * s[1] - p[1] * s[0]
		spread = Math.max(spread, Math.hypot(p[0], p[1]))
	}
	const turn = n >= 2 && spread >= RIG_SPREAD_M / 2 ? Math.atan2(c, d) : 0
	const [cos, sin] = [Math.cos(turn), Math.sin(turn)]
	const apply = (q) => {
		const p = sub(q, cp)
		return [cs[0] + p[0] * cos - p[1] * sin, cs[1] + p[0] * sin + p[1] * cos, cs[2] + p[2]]
	}
	return { turn, shift: sub(apply(cp), cp), apply }
}

/**
 * Predict one head from a set of anchors. `anchors`: [{ id, row, p, s, yaw0, yaw }] (patched / solved position and
 * yaw); `rowOf`: head id → row { id, dir }.
 */
function predict(head, anchors, rowOf) {
	const fit = rigFit(anchors)
	const p = posOf(head.pose)
	const base = fit.apply(p)
	const yaw0 = Number(head.pose.yaw) || 0
	const row = rowOf.get(String(head.id))
	const own = row ? anchors.filter((a) => a.row === row.id) : []
	const out = { pos: base, yaw: yaw0 - fit.turn * DEG, basis: own.length ? 'row' : 'rig', fit }
	if (!own.length) return out
	const err = own.map((a) => sub(a.s, fit.apply(a.p)))
	const dyaw = own.reduce((s, a) => s + wrap(a.yaw - (a.yaw0 - fit.turn * DEG)), 0) / own.length
	out.yaw += dyaw
	const along = (q) => (row.dir ? q[0] * row.dir[0] + q[1] * row.dir[1] + q[2] * row.dir[2] : 0)
	const u = own.map((a) => along(a.p))
	const lo = u.indexOf(Math.min(...u))
	const hi = u.indexOf(Math.max(...u))
	if (own.length >= 2 && u[hi] - u[lo] >= ROW_SPREAD_M) {
		const f = (along(p) - u[lo]) / (u[hi] - u[lo])
		out.pos = base.map((v, i) => v + err[lo][i] + f * (err[hi][i] - err[lo][i]))
	} else {
		out.pos = base.map((v, i) => v + err.reduce((s, e) => s + e[i], 0) / err.length)
	}
	return out
}

/**
 * @param {{ id: string, name?: string, pose: { x, y, z, yaw, hang?, pitch?, roll? } }[]} heads every calibratable head
 *   (patched poses)
 * @param {Record<string, { pose: object, rms_deg?: number, max_deg?: number, warning?: string|null }>} solved anchor
 *   id → its solve (calibrate-solve.js solvePoseForward, ok)
 * @param {{ id: string, heads: string[], dir: number[] | null }[]} rows rig-anchors.js findRows
 * @returns {{ fit: { anchors, turn_deg, shift_m }, heads: object[], measured: number, inferred: number,
 *   worst_m: number | null }}
 */
function inferRig(heads, solved, rows) {
	const list = (Array.isArray(heads) ? heads : []).filter((h) => h?.id && h.pose)
	const rowOf = new Map()
	for (const r of Array.isArray(rows) ? rows : []) for (const id of r.heads) rowOf.set(String(id), r)
	const anchors = list
		.filter((h) => solved?.[h.id]?.pose)
		.map((h) => ({
			id: String(h.id),
			row: rowOf.get(String(h.id))?.id,
			p: posOf(h.pose),
			s: posOf(solved[h.id].pose),
			yaw0: Number(h.pose.yaw) || 0,
			yaw: Number(solved[h.id].pose.yaw) || 0,
		}))
	const loo = new Map()
	if (anchors.length >= 2) {
		for (const a of anchors) {
			const h = list.find((x) => String(x.id) === a.id)
			const pr = predict(h, anchors.filter((b) => b !== a), rowOf)
			loo.set(a.id, { m: dist(pr.pos, a.s), yaw: Math.abs(wrap(pr.yaw - a.yaw)) })
		}
	}
	// a left-out anchor on a row with 2+ anchors is predicted from its row's other one(s): the error a one-anchor row
	// makes; one on a row of its own is predicted by the rig fit alone: the error of a row nobody measured
	const perRow = new Map()
	for (const a of anchors) perRow.set(a.row, (perRow.get(a.row) || 0) + 1)
	const rms = (ids) => (ids.length ? Math.sqrt(ids.reduce((s, id) => s + loo.get(id).m ** 2, 0) / ids.length) : null)
	const looIds = [...loo.keys()]
	const rowLoo = rms(looIds.filter((id) => perRow.get(anchors.find((a) => a.id === id).row) >= 2))
	const rigLoo = rms(looIds.filter((id) => perRow.get(anchors.find((a) => a.id === id).row) === 1)) ?? rms(looIds)
	const out = list.map((h) => {
		const id = String(h.id)
		const keep = { hang: h.pose.hang === 'floor' ? 'floor' : 'truss', pitch: Number(h.pose.pitch) || 0, roll: Number(h.pose.roll) || 0 }
		const s = solved?.[id]
		if (s?.pose) {
			const l = loo.get(id)
			return { id, name: h.name || id, source: 'measured', pose: { ...keep, ...s.pose }, rms_deg: s.rms_deg ?? null,
				max_deg: s.max_deg ?? null, warning: s.warning || null, loo_m: l ? r3(l.m) : null, residual_m: l ? r3(l.m) : null }
		}
		const pr = predict(h, anchors, rowOf)
		const own = anchors.filter((a) => a.row && a.row === rowOf.get(id)?.id)
		const near = own.length ? own.reduce((a, b) => (dist(b.p, posOf(h.pose)) < dist(a.p, posOf(h.pose)) ? b : a)) : null
		const res = own.length >= 2 ? loo.get(near.id)?.m ?? null : own.length === 1 ? (rowLoo ?? rigLoo) : rigLoo
		return {
			id,
			name: h.name || id,
			source: 'inferred',
			basis: pr.basis,
			pose: { x: r3(pr.pos[0]), y: r3(pr.pos[1]), z: r3(pr.pos[2]), yaw: r2(wrap(pr.yaw)), ...keep },
			moved_m: r3(dist(pr.pos, posOf(h.pose))),
			residual_m: res === null || res === undefined ? null : r3(res),
		}
	})
	const fit = rigFit(anchors)
	const inferred = out.filter((h) => h.source === 'inferred')
	const known = inferred.map((h) => h.residual_m).filter((v) => v !== null)
	return {
		fit: { anchors: anchors.length, turn_deg: r2(fit.turn * DEG), shift_m: fit.shift.map(r3) },
		heads: out,
		measured: anchors.length,
		inferred: inferred.length,
		worst_m: known.length ? Math.max(...known) : null,
	}
}

module.exports = { inferRig, rigFit, predict, RIG_SPREAD_M, ROW_SPREAD_M }

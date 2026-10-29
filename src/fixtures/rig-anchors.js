'use strict'

/**
 * WO-804 — calibrate the rig together (owner 29.10: "the app should count which of the heads are most crucial for
 * calibration and guess/calculate the rest"). Pure. From the patched pan / tilt heads (project.fixtures.patch poses,
 * PSN metres) this finds the rig's rows and picks the few anchor heads the operator measures:
 *
 *   rows     heads hung along one straight line (a truss, a pipe, a ladder, a floor line): greedy line clustering —
 *            the longest chain of heads within ROW_TOL_M of one line with no gap over ROW_GAP_M, then the next. The
 *            MVR scene keeps no truss parent per fixture (mvr-scene.js walks ChildLists but stores only `layer`), so
 *            the rows come from the positions alone. A head on no line is a row of its own.
 *   anchors  one per row of 2+ heads (the head nearest the row's middle); two (its end heads) on a row whose plan
 *            extent is LONG_ROW_M or more with 4+ heads — two measured heads give the row's turn and rake; at least
 *            3 overall, spread (the rig-wide fit needs a plan, not a line). Ordered by farthest-point sampling from
 *            the rig's outermost head, so the first three already span the rig if the operator stops early.
 *   marks    per anchor, MARKS_PER_ANCHOR of project.fixtures.marks: the one nearest under the head first, then
 *            each farthest from the ones taken (spread → the pose solve is well posed, calibrate-solve.js spread).
 *
 * Limits: a rig drawn as one scatter of heads (no lines) gets single-head rows and only the rig-wide fit; two rows
 * that touch end to end on one line are one row; heads mounted off a pipe's line by more than ROW_TOL_M split it.
 */

const ROW_TOL_M = 0.25
const ROW_GAP_M = 4
const LONG_ROW_M = 6
const MIN_ANCHORS = 3
const MARKS_PER_ANCHOR = 3

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (v) => Math.hypot(v[0], v[1], v[2])
const posOf = (h) => [Number(h.pose.x), Number(h.pose.y), Number(h.pose.z)]

/** The chain of `left` heads on the line through a → b (within tol) that holds a, consecutive gaps ≤ gap. */
function chainOn(P, left, a, b, tol, gap) {
	const d = sub(P[b], P[a])
	const n = len(d)
	if (n < 1e-6) return null
	const u = d.map((x) => x / n)
	const on = []
	let off = 0
	for (const k of left) {
		const v = sub(P[k], P[a])
		const t = dot(v, u)
		const perp = len(sub(v, u.map((x) => x * t)))
		if (perp <= tol) on.push({ k, t, perp })
	}
	on.sort((p, q) => p.t - q.t)
	const at = on.findIndex((p) => p.k === a)
	let lo = at
	let hi = at
	while (lo > 0 && on[lo].t - on[lo - 1].t <= gap) lo--
	while (hi < on.length - 1 && on[hi + 1].t - on[hi].t <= gap) hi++
	const chain = on.slice(lo, hi + 1)
	for (const p of chain) off += p.perp
	return { members: chain.map((p) => p.k), dir: u, off: off / chain.length }
}

/**
 * @param {{ id: string, pose: { x, y, z } }[]} heads
 * @returns {{ id: string, heads: string[], dir: number[] | null, extent_m: number }[]} longest first; singles last
 */
function findRows(heads, { tol = ROW_TOL_M, gap = ROW_GAP_M } = {}) {
	const P = heads.map(posOf)
	const left = new Set(heads.map((_, i) => i))
	const rows = []
	for (;;) {
		let best = null
		const idx = [...left]
		for (let i = 0; i < idx.length; i++) {
			for (let j = i + 1; j < idx.length; j++) {
				if (len(sub(P[idx[j]], P[idx[i]])) > gap) continue
				const c = chainOn(P, left, idx[i], idx[j], tol, gap)
				if (c && (!best || c.members.length > best.members.length || (c.members.length === best.members.length && c.off < best.off)))
					best = c
			}
		}
		if (!best || best.members.length < 2) break
		for (const k of best.members) left.delete(k)
		rows.push(best)
	}
	const out = rows.map((r) => {
		const ts = r.members.map((k) => dot(P[k], r.dir))
		return { members: r.members, dir: r.dir.map((v) => Math.round(v * 1e4) / 1e4), extent: Math.max(...ts) - Math.min(...ts) }
	})
	for (const k of left) out.push({ members: [k], dir: null, extent: 0 })
	return out.map((r, i) => ({
		id: `row${i + 1}`,
		heads: r.members.map((k) => heads[k].id),
		dir: r.dir,
		extent_m: Math.round(r.extent * 100) / 100,
	}))
}

/** Plan extent (m) of a row's heads along its line, ignoring height (a ladder is short in plan). */
function planExtent(row, byId) {
	if (!row.dir) return 0
	const h = Math.hypot(row.dir[0], row.dir[1])
	if (h < 1e-6) return 0
	const u = [row.dir[0] / h, row.dir[1] / h]
	const ts = row.heads.map((id) => byId.get(id).pose.x * u[0] + byId.get(id).pose.y * u[1])
	return Math.max(...ts) - Math.min(...ts)
}

/** Order `ids` by farthest-point sampling from the head farthest from their centroid. */
function spreadOrder(ids, byId) {
	if (ids.length < 2) return ids.slice()
	const P = new Map(ids.map((id) => [id, posOf(byId.get(id))]))
	const c = [0, 1, 2].map((i) => ids.reduce((s, id) => s + P.get(id)[i], 0) / ids.length)
	const first = ids.reduce((a, b) => (len(sub(P.get(b), c)) > len(sub(P.get(a), c)) ? b : a))
	const out = [first]
	const near = new Map(ids.map((id) => [id, len(sub(P.get(id), P.get(first)))]))
	while (out.length < ids.length) {
		let pick = null
		for (const id of ids) if (!out.includes(id) && (pick === null || near.get(id) > near.get(pick))) pick = id
		out.push(pick)
		for (const id of ids) near.set(id, Math.min(near.get(id), len(sub(P.get(id), P.get(pick)))))
	}
	return out
}

/** Stage marks (project.fixtures.marks) → [{ id, name, x, y, z }] with finite metres, unique ids. */
function normalizeMarks(raw) {
	const out = []
	const seen = new Set()
	for (const m of Array.isArray(raw) ? raw : []) {
		const id = Math.floor(Number(m?.id))
		const xyz = [m?.x, m?.y, m?.z ?? 0].map(Number)
		if (!(id >= 1) || seen.has(id) || !xyz.every(Number.isFinite)) continue
		seen.add(id)
		out.push({ id, name: String(m.name || `Mark ${id}`), x: xyz[0], y: xyz[1], z: xyz[2] })
	}
	return out
}

/** The marks one head is aimed at: the nearest under it first, then each farthest (in plan) from those taken. */
function marksFor(head, marks, n = MARKS_PER_ANCHOR) {
	if (!marks.length) return []
	const p = posOf(head)
	const plan = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
	const first = marks.reduce((a, b) => (plan(b, { x: p[0], y: p[1] }) < plan(a, { x: p[0], y: p[1] }) ? b : a))
	const out = [first]
	while (out.length < Math.min(n, marks.length)) {
		let pick = null
		let far = -1
		for (const m of marks) {
			if (out.includes(m)) continue
			const d = Math.min(...out.map((o) => plan(o, m)))
			if (d > far) {
				far = d
				pick = m
			}
		}
		out.push(pick)
	}
	return out.map((m) => m.id)
}

/**
 * @param {{ id: string, name?: string, pose: { x, y, z, hang? } }[]} heads the pan / tilt heads that can be calibrated
 * @param {{ marks?: object[], max?: number, marksPerAnchor?: number }} [opts] max: at most this many anchors (the
 *   most spread first); 0 / absent = the rule's own count
 * @returns {{ rows, anchors: { id, name, row, marks: number[] }[], inferred: string[], marks: object[] }}
 */
function chooseAnchors(heads, opts = {}) {
	const list = (Array.isArray(heads) ? heads : []).filter((h) => h && h.id && h.pose && posOf(h).every(Number.isFinite))
	const byId = new Map(list.map((h) => [String(h.id), h]))
	const rows = findRows(list)
	const picked = []
	for (const row of rows) {
		if (row.heads.length < 2) continue
		const along = (id) => (row.dir ? dot(posOf(byId.get(id)), row.dir) : 0)
		const sorted = row.heads.slice().sort((a, b) => along(a) - along(b))
		if (row.heads.length >= 4 && planExtent(row, byId) >= LONG_ROW_M) picked.push(sorted[0], sorted.at(-1))
		else {
			const mid = (along(sorted[0]) + along(sorted.at(-1))) / 2
			picked.push(sorted.reduce((a, b) => (Math.abs(along(b) - mid) < Math.abs(along(a) - mid) ? b : a)))
		}
	}
	// the rig-wide fit needs a plan: top up with the heads farthest from those taken
	const want = Math.min(MIN_ANCHORS, list.length)
	if (picked.length < want) {
		const order = spreadOrder([...picked, ...list.map((h) => h.id).filter((id) => !picked.includes(id))], byId)
		for (const id of order) if (picked.length < want && !picked.includes(id)) picked.push(id)
	}
	let order = spreadOrder(picked, byId)
	const max = Math.floor(Number(opts.max))
	if (max > 0) order = order.slice(0, Math.max(Math.min(MIN_ANCHORS, order.length), max))
	const marks = normalizeMarks(opts.marks)
	const per = Math.max(MIN_ANCHORS, Math.min(6, Math.floor(Number(opts.marksPerAnchor)) || MARKS_PER_ANCHOR))
	const rowOf = new Map(rows.flatMap((r) => r.heads.map((id) => [id, r.id])))
	return {
		rows,
		anchors: order.map((id) => ({ id, name: String(byId.get(id).name || id), row: rowOf.get(id), marks: marksFor(byId.get(id), marks, per) })),
		inferred: list.map((h) => String(h.id)).filter((id) => !order.includes(id)),
		marks,
	}
}

module.exports = { chooseAnchors, findRows, normalizeMarks, marksFor, spreadOrder, ROW_TOL_M, ROW_GAP_M, LONG_ROW_M, MIN_ANCHORS }

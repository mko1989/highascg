'use strict'

/**
 * WO-1074 v2 — a dense closed plan (x, z) → a full 3D track (pure; `validateTrack` still has the last word).
 *
 * The plan is resampled to 60–200 points evenly spaced in plan. Every point gets the y of the floor under it (a room
 * track: the stage's y inside the stage rect, the hall's outside). Level changes are then laid on straight stretches:
 *   - room up-crossing (hall → stage): a ramp whose top point is the first stage point (`to`), a half-cosine profile
 *     y = hall + h (1 − cos(π j / k)) / 2 over k points (zero slope at both ends, so no kink at entry or exit);
 *   - room down-crossing: the mirrored ramp, or a drop (`at` = the last stage point, `land` 3–8 m beyond);
 *   - a kicker (hall tracks): a quarter-cosine ramp up to a lip, then a drop back to the floor;
 *   - a table-top (no stage): one ramp up, a plateau, and down again.
 * Ramp length k is the larger of the slope limit (≤ 16° at the steepest point) and the kink limit (curvature × spacing
 * ≤ 0.085 rad, under the 6° rule). Then the start line (straightest flat stretch with ≥ 9.2 m of flat road behind it
 * for the grid), and the decoration (rc-track-deco.js).
 */

const G = require('./rc-track-geo')
const D = require('./rc-track-deco')

const SPACING = 0.5 // target spacing of the emitted centre line
const KINK = 0.085 // rad of pitch change per segment we allow ourselves (the rule is 6° = 0.105)
const SLOPE = Math.tan((16 * Math.PI) / 180)
const KICK_SLOPE = Math.tan((15 * Math.PI) / 180)
const STRAIGHT = 8.5 // a ramp / drop stretch must be at least this straight (rule: 8 m)
const DROP_RUN = 3.3 // planned drop length (rule 3–8 m)
const GRID_RUN = 9.2 // flat road behind the start line the grid needs
const STRAIGHT_TURN = 0.035 // rad: a "straight" grid run turns at most 2° in all
const r3 = (v) => Math.round(v * 1000) / 1000

/** Points (k) of a full ramp (half cosine) rising h at spacing sp. */
function rampSteps(h, sp) {
	const len = Math.max((h * Math.PI) / (2 * SLOPE), Math.sqrt((h * Math.PI * Math.PI * sp) / (2 * KINK)))
	return Math.max(3, Math.ceil(len / sp))
}

/** Points of a kicker (quarter cosine) rising h at spacing sp. */
function kickerSteps(h, sp) {
	const len = Math.max((h * Math.PI) / (2 * KICK_SLOPE), Math.sqrt((h * Math.PI * Math.PI * sp) / (4 * KINK)))
	return Math.max(3, Math.ceil(len / sp))
}

/**
 * Radius ≥ STRAIGHT at every point i0 … i1 (cyclic), measured over neighbours ±k for each k in `ks` — the validator's
 * own test: a ramp's interior points with k = 1, 2; a drop's at − 1 … land + 1 with k = 1.
 */
function straight(P, i0, i1, ks = [1, 2]) {
	const n = P.length
	i0 = (i0 + n) % n
	for (let i = i0; ; i = (i + 1) % n) {
		for (const k of ks) if (G.circumradius(P[(i - k + n) % n], P[i], P[(i + k) % n]) < STRAIGHT) return false
		if (i === ((i1 % n) + n) % n) return true
	}
}

/** Mark i0 … i1 (cyclic) busy; false when one already is. */
function claim(busy, i0, i1) {
	const n = busy.length
	const idx = []
	for (let i = (i0 + n) % n; ; i = (i + 1) % n) {
		if (busy[i]) return false
		idx.push(i)
		if (i === (i1 + n) % n || idx.length > n) break
	}
	for (const i of idx) busy[i] = 1
	return true
}

/** Lay the level changes of `feat` on P → { Y, ramps, drops, busy } or null when one cannot be placed. */
function levels(P, sp, meta) {
	const n = P.length
	const f = meta.features || {}
	const busy = new Uint8Array(n)
	const ramps = [], drops = []
	const at = (i) => (i + n) % n
	let Y
	if (f.room) {
		const { stage, hallY } = f.room
		const h = stage.y - hallY
		const inside = P.map(([x, z]) => G.inRect(x, z, stage.rect))
		Y = inside.map((o) => (o ? stage.y : hallY))
		const k = rampSteps(h, sp)
		const exits = [...(f.room.exits || [])]
		let ups = 0, downs = 0
		for (let i = 0; i < n; i++) {
			const j = at(i + 1)
			if (inside[i] === inside[j]) continue
			if (!inside[i]) {
				const to = j, from = at(to - k)
				if (!straight(P, from + 1, to - 1) || !claim(busy, from - 2, to + 2)) return null
				for (let q = 0; q <= k; q++) Y[at(from + q)] = hallY + (h * (1 - Math.cos((Math.PI * q) / k))) / 2
				ramps.push({ from, to })
				ups++
				continue
			}
			const exit = exits.length ? exits.shift() : 'ramp'
			if (exit === 'drop') {
				const m = Math.ceil(DROP_RUN / sp)
				if (m * sp > 8) return null
				const land = at(i + m)
				if (!straight(P, i - 1, land + 1, [1]) || !claim(busy, i - 2, land + 2)) return null
				drops.push({ at: i, land })
			} else {
				const from = i, to = at(i + k)
				if (!straight(P, from + 1, to - 1) || !claim(busy, from - 2, to + 2)) return null
				for (let q = 0; q <= k; q++) Y[at(from + q)] = stage.y - (h * (1 - Math.cos((Math.PI * q) / k))) / 2
				ramps.push({ from, to })
			}
			downs++
		}
		if (!ups || ups !== downs) return null
	} else {
		Y = P.map(() => meta.y)
	}
	if (f.kicker || f.tabletop) {
		const h = f.kicker || f.tabletop
		const k = f.kicker ? kickerSteps(h, sp) : rampSteps(h, sp)
		const flat = Math.ceil(2 / sp)
		const need = f.kicker ? k + Math.ceil(DROP_RUN / sp) : 2 * k + flat
		const run = straightRuns(P, busy)[f.run || 0] // f.run: 0 = the longest straight, 1 = the next …
		if (!run || run.len < need + 4) return null
		const from = at(run.start + Math.floor((run.len - need) / 2))
		if (f.kicker) {
			const lip = at(from + k), land = at(lip + Math.ceil(DROP_RUN / sp))
			if (!claim(busy, from - 2, land + 2)) return null
			for (let q = 0; q <= k; q++) Y[at(from + q)] = meta.y + h * (1 - Math.cos((Math.PI * q) / (2 * k)))
			ramps.push({ from, to: lip })
			drops.push({ at: lip, land })
		} else {
			const to = at(from + 2 * k + flat)
			if (!claim(busy, from - 2, to + 2)) return null
			for (let q = 0; q <= 2 * k + flat; q++) {
				const up = Math.min(q, k), down = Math.max(0, q - k - flat)
				Y[at(from + q)] = meta.y + (h * (1 - Math.cos((Math.PI * up) / k))) / 2 - (h * (1 - Math.cos((Math.PI * down) / k))) / 2
			}
			ramps.push({ from, to })
		}
	}
	return { Y, ramps, drops, busy }
}

/** Cyclic runs of straight (radius ≥ STRAIGHT), not-busy points → [{ start, len }], longest first. */
function straightRuns(P, busy) {
	const n = P.length
	const ok = P.map((_, i) => !busy[i] && [1, 2].every((k) => G.circumradius(P[(i - k + n) % n], P[i], P[(i + k) % n]) >= STRAIGHT))
	if (ok.every(Boolean)) return [{ start: 0, len: n }]
	const runs = []
	const first = ok.indexOf(false)
	for (let c = 0, cur = null; c < n; c++) {
		const i = (first + 1 + c) % n
		if (!ok[i]) cur = null
		else if (cur) cur.len++
		else runs.push((cur = { start: i, len: 1 }))
	}
	return runs.sort((a, b) => b.len - a.len || a.start - b.start)
}

/**
 * Index of the start line: the straightest flat point with GRID_RUN (or `gridRun`) of flat, feature-free road behind it.
 * opts.noStart: points that may not carry the start line itself (a bridge); opts.straight: the run must be straight.
 */
function pickStart(P, Y, busy, sp, width, gridRun = GRID_RUN, opts = {}) {
	const n = P.length
	const back = Math.ceil(gridRun / sp)
	const win = Math.ceil((Math.PI * width) / sp)
	const head = P.map((p, i) => Math.atan2(P[(i + 1) % n][1] - p[1], P[(i + 1) % n][0] - p[0]))
	const turn = head.map((h, i) => G.angleDiff(h, head[(i - 1 + n) % n]))
	const crowded = P.map((p, i) => P.some((q, j) => {
		const sep = Math.min(Math.abs(i - j), n - Math.abs(i - j))
		return sep > win && G.dist(p, q) < 1.6 * width && Math.abs(Y[i] - Y[j]) < 1.2 // a bridge's other ribbon is not near
	}))
	let best = -1, bestT = Infinity
	for (let i = 0; i < n; i++) {
		let t = 0, bend = 0
		for (let k = -back - 1; k <= 2 && t < Infinity; k++) {
			const j = (i + k + n) % n
			if (busy[j] || Math.abs(Y[j] - Y[i]) > 1e-6 || (k >= 0 && opts.noStart?.[j])) t = Infinity
			else (t += turn[j] + (crowded[j] ? 10 : 0)), (bend += k >= -back && k <= 0 ? turn[j] : 0)
		}
		if (opts.straight && bend > STRAIGHT_TURN) t = Infinity
		if (t < bestT - 1e-9) (bestT = t), (best = i)
	}
	return best
}

/**
 * §3.1: the planned tunnels (meta.tunnels: [{ a, b }] — plan points where the carve starts and ends, on a pinned
 * straight) → index ranges [{ from, to }] of the resampled plan P (the points nearest a and b), each marked busy with
 * a width + 2 points either side (no start line or grid there) → [] without tunnels, null when one is not on the plan.
 */
function tunnelRanges(P, sp, busy, meta) {
	const out = []
	const n = P.length
	for (const q of meta.tunnels || []) {
		const near = (p) => P.reduce((b, x, i) => (G.dist(x, p) < G.dist(P[b], p) ? i : b), 0)
		const from = near(q.a), to = near(q.b)
		if (G.dist(P[from], q.a) > sp || G.dist(P[to], q.b) > sp || (to - from + n) % n > n / 2) return null
		const m = Math.ceil(meta.width / sp) + 2
		for (let i = from - m; i !== to + m + 1; i++) busy[(i + n) % n] = 1
		out.push({ from, to })
	}
	return out
}

/**
 * Dense plan → track (or null when the plan cannot carry its features). meta: { id, name, floor ('room' | a floor id),
 * y (the floor's y; the hall's for a room track), width, features: { room: { stage, hallY, exits: ['ramp'|'drop'] },
 * kicker: h, tabletop: h, run: which straight carries the kicker / table-top (0 = the longest) } }. §2.7 extras:
 * `kind` (default from the floor: 'room' | 'stage-short' | 'hall'), `levels(P, sp)` → { Y, ramps, drops, decks, busy }
 * in place of the built-in level laying (the whole-room deck tracks, rc-track-sky.js), `gridRun` (m of flat road behind
 * the start line, default 9.2). §3 (toy scale, unit frame): `maxPoints` (default 200) and `maxLength` (default 260).
 * §3.1: `tunnels` ([{ a, b }], see tunnelRanges) → the track's `tunnels` (decoration keeps clear of them).
 */
function buildTrack(dense, meta, scene) {
	if (!dense || !dense.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) return null
	const L0 = G.polyLength(dense)
	if (!(L0 >= 20 && L0 <= (meta.maxLength || 260))) return null
	const n = Math.max(60, Math.min(meta.maxPoints || 200, Math.round(L0 / SPACING)))
	let P = G.resampleClosed(dense, n)
	const sp = G.polyLength(P) / n
	const lv = meta.levels ? meta.levels(P, sp) : levels(P, sp, meta)
	if (!lv) return null
	const tun = tunnelRanges(P, sp, lv.busy, meta)
	if (!tun) return null
	const st = pickStart(P, lv.Y, lv.busy, sp, meta.width, meta.gridRun, { noStart: lv.noStart, straight: meta.straightGrid })
	if (st < 0) return null
	const rot = (i) => (i - st + n) % n
	P = P.slice(st).concat(P.slice(0, st))
	const Y = lv.Y.slice(st).concat(lv.Y.slice(0, st))
	const points = P.map(([x, z], i) => [r3(x), r3(Y[i]), r3(z)])
	const ramps = lv.ramps.map((r) => ({ from: rot(r.from), to: rot(r.to) }))
	const drops = lv.drops.map((d) => ({ at: rot(d.at), land: rot(d.land) }))
	const length = r3(G.polyLength(G.plan(points)))
	const kind = meta.kind || (meta.floor === 'room' ? 'room' : meta.floor === 'stage' ? 'stage-short' : 'hall')
	const t = { id: meta.id, name: meta.name, floor: meta.floor, kind, width: meta.width, closed: true, points, length, ramps, drops }
	if (lv.decks?.length) t.decks = lv.decks.map((d) => ({ from: rot(d.from), to: rot(d.to) }))
	if (tun.length) {
		t.tunnels = tun.map((q) => ({ from: rot(q.from), to: rot(q.to) })).sort((a, b) => a.from - b.from)
		if (t.tunnels.some((q) => q.from >= q.to)) return null // spans the start line
	}
	return D.decorate(t, scene)
}

module.exports = { buildTrack, rampSteps, straight, claim, DROP_RUN }

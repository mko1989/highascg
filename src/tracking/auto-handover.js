'use strict'

/**
 * WO-1085 — spot handover, the pure core (owner 15.11: "the lone presenter is lit by the 3 heads and the rest is off,
 * then when he moves the heads follow him but also other heads 'take over' when his crossing a threshold").
 *
 * Input per step: the Auto pool's heads (floor position), the followed people (lanes: the Auto director's lane uid +
 * the marker point), the home points while home is active (WO-709), and per head whether it can be used (the LD's
 * grant) and whether it can reach a lane (IK in range). Output per head: { lane, phase, level 0…1, target }.
 *
 * Selection (chooseHeads) — each lane wants `heads` (N) heads; with too few usable heads the pool is shared evenly
 * (auto-split's idea: ⌊T / L⌋ per lane, the remainder to the nearest). Pairs are taken cheapest first on floor
 * distance; a head that can't reach a lane is no candidate for it, so the next nearest one is taken. Hysteresis: a
 * head already active for a lane costs `margin_m` less, so a new head is swapped in only when it is nearer by more than
 * the margin — standing on a threshold never flickers two heads. (A global Hungarian, auto-split's tool, was tried
 * first: when two people cross it hands every lit head to the other person at once — all of them fade out together.)
 * Take-over — a head moves through rest → preaim → in → on → out → rest:
 *   preaim  the incoming head aims at its person while still dark, for PREAIM_S (the motor gets there first);
 *   in      fades up at 1 / fade_s per second; on at full;
 *   out     keeps following its person while it fades down, and does not start fading while its replacement is
 *           still on the way — so out and in run on the same ticks and their levels sum to 1 (no dark gap, no lit
 *           swing); fully out it rests: holds its last aim, dark.
 *   A head never changes lane while lit: lit for A and wanted by B → out (on A), rest, preaim (B), in.
 * Nobody followed: `idle` 'home' holds the lit heads where they are until the director's home is active, then every
 * usable head goes to its home point (a home pseudo-lane per head, same phases); 'dark' fades everything out.
 * A head that is not usable (grant revoked) is released: no lane, its level frozen while the engine's read-through fade
 * hands it to the console (a lit head never dips first). Usable again, a lit one fades out before it is used, since its
 * aim is the console's: a beam is never swung lit.
 */

const PREAIM_S = 0.5
const MAX_DT_S = 0.5

const LIT = new Set(['preaim', 'in', 'on']) // phases that count as "active for the lane" (hysteresis, quota)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Desired head → lane. Each lane takes its cheapest candidates, pairs in order of cost (floor distance, + margin_m unless
 * the head is already active for that lane): a head contested by two people goes to the nearer one. A head active or
 * fading out for one lane is no candidate for another until it rests — a lit head is never handed across the stage;
 * after two people cross, heads migrate one cross-fade at a time through the free ones. Quotas: N per lane, or the
 * usable heads shared evenly (⌊T / L⌋ each, the remainder to the lanes nearest to a spare head).
 * @param {{ id: string, x: number, y: number }[]} heads usable heads only, pool order
 * @param {{ id: string|number, x: number, y: number }[]} lanes
 * @param {Map<string, { lane, lit: boolean }>} owner head id → the lane it is active (lit) or fading out for
 * @returns {Map<string, string|number>}
 */
function chooseHeads({ heads, lanes, n, margin, owner = new Map(), reach = () => true }) {
	const out = new Map()
	if (!heads.length || !lanes.length || !(n > 0)) return out
	const total = Math.min(n * lanes.length, heads.length)
	const per = Math.floor(total / lanes.length)
	let rem = total - per * lanes.length
	const pairs = []
	heads.forEach((h, i) =>
		lanes.forEach((lane, j) => {
			const o = owner.get(h.id)
			if ((o && o.lane !== lane.id) || !reach(h.id, lane.id)) return
			pairs.push({ h: h.id, lane: lane.id, cost: dist(h, lane) + (o?.lit ? 0 : margin), i, j })
		})
	)
	pairs.sort((a, b) => a.cost - b.cost || a.i - b.i || a.j - b.j)
	const count = new Map()
	for (const cap of [per, per + 1]) {
		for (const p of pairs) {
			const c = count.get(p.lane) || 0
			if (out.has(p.h) || c >= cap || (cap > per && !rem)) continue
			if (cap > per) rem--
			out.set(p.h, p.lane)
			count.set(p.lane, c + 1)
		}
	}
	return out
}

/**
 * Threshold lines along the rig: for heads sorted along their own axis (the farthest-apart pair), the bisector between
 * head k and head k + n — where a lone person's n-nearest set changes. → [{ at: [x, y], dir: [ux, uy], a, b }]
 * (`dir` = the rig axis, the line runs across it).
 */
function thresholds(heads, n) {
	if (!(n > 0) || heads.length <= n) return []
	let a = heads[0]
	let b = heads[heads.length - 1]
	let far = -1
	for (const p of heads)
		for (const q of heads) {
			const d = dist(p, q)
			if (d > far) [far, a, b] = [d, p, q]
		}
	if (!(far > 1e-6)) return []
	const ux = (b.x - a.x) / far
	const uy = (b.y - a.y) / far
	const s = heads.slice().sort((p, q) => p.x * ux + p.y * uy - (q.x * ux + q.y * uy))
	const out = []
	for (let k = 0; k + n < s.length; k++) {
		const p = s[k]
		const q = s[k + n]
		const r = (v) => Math.round(v * 1000) / 1000
		out.push({ at: [r((p.x + q.x) / 2), r((p.y + q.y) / 2)], dir: [r(ux), r(uy)], a: p.id, b: q.id })
	}
	return out
}

function createHandover() {
	const state = new Map() // head id → { lane, phase, level, t }
	let last = null

	const rest = (s) => Object.assign(s, { lane: null, phase: 'rest', level: 0 })

	/**
	 * @param {{ now: number, heads: { id, x, y }[], lanes: { id, x, y, mark?: object }[], home?: Map<string, object>|null,
	 *           settings: { heads, margin_m, fade_s, idle }, reach?: (headId, laneId) => boolean,
	 *           usable?: (headId) => boolean }} o  heads in pool order; lane ids must not start with "home:".
	 * @returns {Map<string, { lane: string|null, phase: string, level: number, target: object|null }>}
	 */
	function step({ now, heads, lanes, home = null, settings, reach = () => true, usable = () => true }) {
		const dt = last === null ? 0 : Math.max(0, Math.min(MAX_DT_S, (now - last) / 1000))
		last = now
		const ids = new Set(heads.map((h) => h.id))
		for (const id of [...state.keys()]) if (!ids.has(id)) state.delete(id)
		for (const h of heads) if (!state.has(h.id)) state.set(h.id, { lane: null, phase: 'rest', level: 0, t: now })
		const ok = heads.filter((h) => usable(h.id))
		const laneById = new Map(lanes.map((l) => [l.id, l]))
		const owner = new Map()
		for (const h of ok) {
			const s = state.get(h.id)
			if (s.lane !== null && (LIT.has(s.phase) || s.phase === 'out')) owner.set(h.id, { lane: s.lane, lit: LIT.has(s.phase) })
		}
		let want
		if (lanes.length) {
			want = chooseHeads({ heads: ok, lanes, n: settings.heads, margin: settings.margin_m, owner, reach })
		} else if (home && home.size) {
			want = new Map(ok.filter((h) => home.has(h.id)).map((h) => [h.id, `home:${h.id}`]))
		} else if (settings.idle === 'dark') want = new Map()
		else want = new Map(ok.filter((h) => ['in', 'on'].includes(state.get(h.id).phase)).map((h) => [h.id, state.get(h.id).lane]))
		// pass 1: phases
		for (const h of heads) {
			const s = state.get(h.id)
			if (!usable(h.id)) {
				Object.assign(s, { lane: null, phase: 'released' }) // the level is frozen: the engine fades to the console
				continue
			}
			const w = want.get(h.id) ?? null
			if (s.phase === 'released') Object.assign(s, s.level > 0 ? { phase: 'out', t: now } : { phase: 'rest', level: 0 })
			if (s.phase === 'rest' && w !== null) Object.assign(s, { lane: w, phase: 'preaim', t: now })
			else if (s.phase === 'preaim') {
				if (w === null) rest(s)
				else if (w !== s.lane) Object.assign(s, { lane: w, t: now })
				else if (now - s.t >= PREAIM_S * 1000) Object.assign(s, { phase: 'in', t: now })
			} else if ((s.phase === 'in' || s.phase === 'on') && w !== s.lane) Object.assign(s, { phase: 'out', t: now })
			else if (s.phase === 'out' && w === s.lane) Object.assign(s, { phase: 'in', t: now })
		}
		// pass 2: levels. An outgoing head that goes to rest waits while its lane still has a head on the way (pre-aiming,
		// or lit for another lane and wanted here); one that is wanted by another lane waits only for pre-aiming heads
		// (they finish in PREAIM_S), so two lanes trading heads never wait on each other.
		const preaim = new Set()
		const pending = new Set()
		for (const s of state.values()) if (s.phase === 'preaim') preaim.add(s.lane)
		for (const [id, lane] of want) {
			const s = state.get(id)
			if (!(s.lane === lane && (s.phase === 'in' || s.phase === 'on'))) pending.add(lane)
		}
		const rate = settings.fade_s > 0 ? dt / settings.fade_s : Infinity
		const out = new Map()
		for (const h of heads) {
			const s = state.get(h.id)
			if (s.phase === 'in') {
				s.level = Math.min(1, s.level + rate)
				if (s.level >= 1) s.phase = 'on'
			} else if (s.phase === 'on') s.level = 1
			else if (s.phase === 'out') {
				if (!(want.has(h.id) ? preaim : pending).has(s.lane)) s.level = Math.max(0, s.level - rate)
				if (s.level <= 0) rest(s)
			} else if (s.phase !== 'released') s.level = 0
			const target = s.lane === null ? null : targetOf(s.lane, laneById, home)
			out.set(h.id, { lane: s.lane, phase: s.phase, level: s.level, target })
		}
		return out
	}

	/** Heads active (pre-aiming, fading in or on) for a lane — the director's snapshot in handover mode. */
	function activeFor(laneId) {
		return [...state].filter(([, s]) => s.lane === laneId && LIT.has(s.phase)).map(([id]) => id)
	}

	function reset() {
		state.clear()
		last = null
	}

	return { step, activeFor, reset }
}

/** A lane's target point now: its marker, or the head's home point; null when it is gone (hold the last aim). */
function targetOf(lane, laneById, home) {
	if (typeof lane === 'string' && lane.startsWith('home:')) {
		const p = home?.get(lane.slice(5))
		return p ? { x: p.x, y: p.y, z: p.z, status: 1, stale: false, home: true } : null
	}
	return laneById.get(lane)?.mark || null
}

module.exports = { createHandover, chooseHeads, thresholds, PREAIM_S }

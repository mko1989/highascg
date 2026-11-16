'use strict'

/**
 * WO-1102 — the Game World referee (work/notes/game-world-contract.md §6). PURE: no I/O, no timers, no Date.now — the
 * clock (`now()`) and `seed` are injected and every chance comes from its own mulberry32(seed), so the same inputs give
 * the same outputs. The hub feeds it entity snapshots (Ents with their game `g`) and the games' contact queries; every
 * call returns `out = { effects, bonuses, events, fx }` that the hub delivers:
 *   effects  { k, g, id, dur, dir?, c?, soft, by: { g, name } }  → target game's adapter.apply()  (§6.2)
 *   bonuses  { g, pid, kind }                                      → source game's adapter.bonus(pid, kind)  (§6.3)
 *            kind: 'hop' (R1) | 'bounce' (R6) | 'scatter' (R5) | 'sparks' (R4) | 'bowl' (R3) | 'spot' (R9)
 *   events   { k: 'R1'…'R9', by: { g, name }, to: { g, name }, p, at }  → xev to the world pages (§6.4)
 *   fx       { g, k, id, kind, ms, c }                             → wv.fx on the visitors of that entity
 *
 * Caps (§6 "Caps"), enforced in decide() before an effect leaves: nothing while safe; target game affect 'off' → never a
 * target; target game in a frozen phase (rc / sk countdown, results) → nothing; 'soft' → visual only. Control loss also
 * degrades to visual only (soft: true, no bonus) when the target is immune (car 3 s, soldier 4 s, avatar 10 s after a
 * control-loss effect), when its control-loss `dur` in the rolling 60 s would pass 4 s, or when the source → target
 * pair already had 3 control-loss effects in 60 s. A source earns ≤ 12 bonuses in any rolling 60 s (an RC causer at most
 * one boost per 3 s). Bonuses are paid only for effects that took control (a visual-only hit earns nothing).
 * The tick rules (R3 bowled over, R7 make way, R8 rain, R9 spotlight) live in world-referee-tick.js.
 */

const { createTickRules } = require('./world-referee-tick')

const WINDOW = 60000
const IMM = Object.freeze({ car: 3000, soldier: 4000, av: 10000 })
const BUDGET_S = 4
const PAIR_MAX = 3
const BONUS_MAX = 12
const RC_BOOST_GAP = 3000
const SPLAT = new Set(['tomato', 'cabbage', 'peas'])
const VEG = Object.freeze({
	tomato: { r: 0.045, c: '#d8352a' },
	potato: { r: 0.05, c: '#a8804e' },
	carrot: { r: 0.03, c: '#f0892a' },
	cabbage: { r: 0.11, c: '#7cc152' },
	onion: { r: 0.045, c: '#e0b84c' },
	peas: { r: 0.018, c: '#62b84a' },
})
const SLICK_R = Object.freeze({ tomato: 0.15, cabbage: 0.25, peas: 0.06 })
const SLICK_MS = 8000
const MAX_PATCHES = 12
/** Hit spheres (room metres): centre = feet p + (0, dy, 0). */
const HIT = Object.freeze({ car: { dy: 0.025, r: 0.04 }, soldier: { dy: 0.03, r: 0.025 } })
const FROZEN = Object.freeze({ rc: ['countdown', 'results'], sk: ['countdown', 'results'] })
const FX_MS = Object.freeze({ hop: 600, splat: 4000, sparks: 400, scatter: 1500 })
const DUR = Object.freeze({ hop: 0.6, bump: 0.2, wobble: 0.25, stunBowl: 0.8, stun: 0.5, scatter: 0.5, step: 0.7 })
const PEA_R = 0.25
const SPARK_R = 0.04

/** Seeded PRNG (uniform [0, 1)). */
function mulberry32(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const r3 = (x) => Math.round(x * 1000) / 1000 + 0
const p3 = (p) => [r3(p[0]), r3(p[1]), r3(p[2])]
const newOut = () => ({ effects: [], bonuses: [], events: [], fx: [] })
const isLive = (e) => !(e.f & 2) && !(e.f & 4) // soldier: not dead, not protected
const finite3 = (p) => Array.isArray(p) && p.length >= 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])

/** Merge `b` into `a` (out objects). */
function merge(a, b) {
	for (const k of ['effects', 'bonuses', 'events', 'fx']) for (const x of b[k]) a[k].push(x)
	return a
}

/**
 * @param {{ seed?: number, now: () => number }} opts
 */
function createReferee(opts = {}) {
	const now = typeof opts.now === 'function' ? opts.now : () => 0
	const rng = mulberry32(Number.isFinite(opts.seed) ? opts.seed : 1)
	const world = { safe: false, affect: {}, phase: {} }
	const immUntil = new Map() // `${g}:${id}` → ms
	const durLog = new Map() // target → [{ t, dur }]
	const pairLog = new Map() // `${src}>${target}` → [t]
	const bonusLog = new Map() // src → [t]
	const rcBoostAt = new Map() // rc source → last boost ms
	const patches = [] // R2 slick patches { id, p, r, c, until }
	const counts = {} // rule → events
	let patchSeq = 0

	const prune = (map, key, t) => {
		const a = map.get(key)
		if (!a) return []
		while (a.length && (a[0].t ?? a[0]) <= t - WINDOW) a.shift()
		if (!a.length) map.delete(key)
		return a
	}
	const affectOf = (g) => world.affect[g] || 'on'
	const frozen = (g) => (FROZEN[g] || []).includes(world.phase[g]) || world.phase[g] === 'paused' || world.phase[g] === 'off'

	function setWorld(o = {}) {
		if (typeof o.safe === 'boolean') {
			world.safe = o.safe
			if (o.safe) tick.endEvent('none')
		}
		if (o.affect && typeof o.affect === 'object') world.affect = { ...o.affect }
		if (o.phase && typeof o.phase === 'object') world.phase = { ...o.phase }
	}

	/** A bonus to `src` ({ g, pid }) unless its 60 s budget (or the RC boost gap) is used up. → given? */
	function giveBonus(src, kind, out) {
		if (!src || src.g === 'world' || src.pid == null) return false
		const t = now()
		const sk = `${src.g}:${src.pid}`
		const a = prune(bonusLog, sk, t)
		if (a.length >= BONUS_MAX) return false
		if (src.g === 'rc' && t - (rcBoostAt.get(sk) ?? -Infinity) < RC_BOOST_GAP) return false
		if (src.g === 'rc') rcBoostAt.set(sk, t)
		if (!bonusLog.has(sk)) bonusLog.set(sk, a)
		a.push(t)
		out.bonuses.push({ g: src.g, pid: src.pid, kind })
		return true
	}

	/**
	 * Every effect goes through here. o = { rule, k, target: Ent (g, id, k, n, p), dur, src: { g, pid, name } | null,
	 * dir?, c?, bonus?, fx: [[kind, ms, c?]], quiet?, dropSoft? } → the effect or null (nothing at all).
	 */
	function decide(o, out) {
		const tg = o.target
		if (world.safe || !tg) return null
		const mode = affectOf(tg.g)
		if (mode === 'off' || frozen(tg.g)) return null
		const t = now()
		const tk = `${tg.g}:${tg.id}`
		const sk = o.src && o.src.g !== 'world' ? `${o.src.g}:${o.src.pid}` : null
		let soft = mode === 'soft'
		if (!soft && (immUntil.get(tk) ?? -Infinity) > t) soft = true
		const log = prune(durLog, tk, t)
		if (!soft && log.reduce((s, x) => s + x.dur, 0) + o.dur > BUDGET_S + 1e-9) soft = true
		const pk = sk ? `${sk}>${tk}` : null
		const pairs = pk ? prune(pairLog, pk, t) : []
		if (!soft && pairs.length >= PAIR_MAX) soft = true
		if (soft && o.dropSoft) return null
		if (!soft) {
			if (!durLog.has(tk)) durLog.set(tk, log)
			log.push({ t, dur: o.dur })
			if (pk) {
				if (!pairLog.has(pk)) pairLog.set(pk, pairs)
				pairs.push(t)
			}
			immUntil.set(tk, t + (IMM[tg.k] || IMM.car))
		}
		const by = { g: o.src ? o.src.g : 'world', name: o.src ? String(o.src.name || '') : '' }
		const effect = { k: o.k, g: tg.g, id: tg.id, dur: o.dur, soft, by }
		if (o.dir) effect.dir = [r3(o.dir[0]), r3(o.dir[1])]
		if (o.c) effect.c = o.c
		out.effects.push(effect)
		for (const [kind, ms, c] of o.fx || []) out.fx.push({ g: tg.g, k: tg.k, id: tg.id, kind, ms, c: c || '' })
		if (!o.quiet) {
			counts[o.rule] = (counts[o.rule] || 0) + 1
			out.events.push({ k: o.rule, by, to: { g: tg.g, name: String(tg.n || '') }, p: p3(tg.p), at: t, dur: o.dur, soft }) // dur / soft: the soak table
		}
		if (o.bonus && sk && !soft) giveBonus(o.src, o.bonus, out)
		return effect
	}

	/** R2: a slick patch where a splat vegetable ended on the floor / stage. */
	function addPatch(veg, p) {
		if (!SLICK_R[veg] || !finite3(p)) return null
		const t = now()
		const patch = { id: `p${++patchSeq}`, p: p3(p), r: SLICK_R[veg], c: VEG[veg].c, until: t + SLICK_MS }
		patches.push(patch)
		while (patches.length > MAX_PATCHES) patches.shift()
		counts.R2 = (counts.R2 || 0) + 1
		return patch
	}

	/** R5: a pea landing within 0.25 m of a live soldier of another game. */
	function peaScatter(src, p, ents, out) {
		let best = null
		let bd = PEA_R
		for (const e of ents) {
			if (e.k !== 'soldier' || e.g === src.g || !isLive(e)) continue
			const d = Math.hypot(e.p[0] - p[0], e.p[2] - p[2])
			if (d <= bd && Math.abs(e.p[1] - p[1]) <= 0.3) {
				bd = d
				best = e
			}
		}
		if (best) decide({ rule: 'R5', k: 'scatter', target: best, dur: DUR.scatter, src, bonus: 'scatter', c: VEG.peas.c, fx: [['scatter', FX_MS.scatter, VEG.peas.c]] }, out)
	}

	/**
	 * §6.1 contact: a flight of `q.g` met the collider of `target` (an Ent of another game, resolved by the hub from `w`).
	 * q = { g, pid, name?, veg, p, v, tag } → out + { end } (a splat vegetable ends on it, the others bounce).
	 */
	function contact(q, target) {
		const out = newOut()
		out.end = SPLAT.has(q && q.veg)
		if (!q || !target || world.safe || target.g === q.g) return out
		const src = { g: q.g, pid: q.pid, name: q.name }
		const c = (VEG[q.veg] || VEG.tomato).c
		if (q.tag === 'car' && target.k === 'car') {
			const fx = out.end ? [['splat', FX_MS.splat, c], ['hop', FX_MS.hop, c]] : [['hop', FX_MS.hop, c]]
			decide({ rule: out.end ? 'R1' : 'R6', k: 'hop', target, dur: DUR.hop, src, c, bonus: out.end ? 'hop' : 'bounce', fx }, out)
		} else if (q.tag === 'soldier' && target.k === 'soldier' && isLive(target)) {
			const fx = [['stun', Math.round(DUR.stun * 1000), c]]
			if (out.end) fx.unshift(['splat', FX_MS.splat, c])
			decide({ rule: 'R6', k: 'stun', target, dur: DUR.stun, src, c, bonus: 'bounce', fx }, out)
		}
		return out
	}

	/** §6.1 landed: q = { g, pid, name?, veg, p, tag } (tag 'floor' | 'stage' | …); ents = the hub's snapshot. → out (+ patch). */
	function landed(q, ents = []) {
		const out = newOut()
		if (!q || world.safe || !finite3(q.p)) return out
		if (SPLAT.has(q.veg) && (q.tag === 'floor' || q.tag === 'stage')) out.patch = addPatch(q.veg, q.p, out)
		if (q.veg === 'peas') peaScatter({ g: q.g, pid: q.pid, name: q.name }, q.p, ents, out)
		return out
	}

	/**
	 * §6.1 shot (R4): an accepted Skirmish hitscan. q = { g, pid, name?, o: [x,y,z] muzzle, yaw, range (m), los(a, b) }.
	 * `los` → true when a → b is clear (a number is read as the clear fraction, ≥ 0.999 = clear). The nearest car of
	 * another game whose hit centre is within 0.04 m of the ray gets `wobble`.
	 */
	function shot(q, ents = []) {
		const out = newOut()
		if (!q || world.safe || !finite3(q.o) || !Number.isFinite(q.yaw) || !(q.range > 0)) return out
		const d = [-Math.sin(q.yaw), 0, -Math.cos(q.yaw)]
		let best = null
		for (const e of ents) {
			if (e.k !== 'car' || e.g === q.g) continue
			const c = [e.p[0], e.p[1] + HIT.car.dy, e.p[2]]
			const s = (c[0] - q.o[0]) * d[0] + (c[2] - q.o[2]) * d[2]
			if (s < 0 || s > q.range) continue
			const cp = [q.o[0] + d[0] * s, q.o[1], q.o[2] + d[2] * s]
			const dist = Math.hypot(c[0] - cp[0], c[1] - cp[1], c[2] - cp[2])
			if (dist <= SPARK_R && (!best || s < best.s)) best = { e, s, cp }
		}
		if (!best) return out
		if (typeof q.los === 'function') {
			let r
			try {
				r = q.los(q.o, best.cp)
			} catch {
				r = false
			}
			if (!(r === true || (typeof r === 'number' && r >= 0.999))) return out
		}
		decide({ rule: 'R4', k: 'wobble', target: best.e, dur: DUR.wobble, src: { g: q.g, pid: q.pid, name: q.name }, bonus: 'sparks', fx: [['sparks', FX_MS.sparks, '#ffd060']] }, out)
		return out
	}

	const tick = createTickRules({ now, rng, world, decide, giveBonus, addPatch, peaScatter, newOut, counts, VEG, SPLAT, HIT, DUR, FX_MS, isLive, frozen, affectOf })

	/** World entities of the referee itself (rain vegetables + slick patches), as Ents of game 'world'. */
	function ents(t = now()) {
		while (patches.length && patches[0].until <= t) patches.shift()
		const list = tick.rainEnts()
		for (const x of patches) if (x.until > t) list.push({ k: 'splat', id: x.id, p: x.p, yaw: 0, c: x.c, n: '', f: 1, s: Math.round(x.r * 1000) })
		return list
	}

	return {
		setWorld,
		contact,
		landed,
		shot,
		tick: (snap) => tick.run(snap || {}),
		startEvent: tick.startEvent,
		endEvent: tick.endEvent,
		events: tick.eventsState,
		spotActive: tick.spotActive,
		ents,
		patches: () => patches.filter((x) => x.until > now()).map((x) => ({ ...x })),
		counts: () => ({ ...counts }),
		world: () => ({ safe: world.safe, affect: { ...world.affect }, phase: { ...world.phase } }),
	}
}

module.exports = { createReferee, mulberry32, merge, IMM, BUDGET_S, PAIR_MAX, BONUS_MAX, RC_BOOST_GAP, SPLAT, VEG, SLICK_R, SLICK_MS, HIT, DUR, WINDOW }

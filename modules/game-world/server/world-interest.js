'use strict'

/**
 * WO-1101 — Game World interest management (work/notes/game-world-contract.md §1.1). PURE: which foreign entities one
 * viewer gets, in what order, how often, and the `wv` message that carries them.
 *   - candidates: every entity of the OTHER games (+ world rain / patches); a world page (`g` null) sees all games
 *   - priority = horizontal dist / weight (av 6, veg 4, car 2, soldier 2, splat 1.5, sling 1); a viewer without `p`
 *     (spectator) uses the room centre, every weight × 0.5, no radius
 *   - radius by the viewer's game: rc 8 m, sk 4 m (+ anything airborne — veg, an airborne car — ≤ 6 m), salad 30 m;
 *     `av` always qualifies and always comes first (the presenter is global; ≤ 3 of them)
 *   - cap: min(cap, 20) (cap from `wq`: 6 | 12 | 20, else 12); the world spectator page 80
 *   - rate: near (≤ ⅓ radius, spectators ≤ 10 m, or any `veg`) every tick, the rest every 3rd tick (staggered by `w`)
 *   - per message ≤ 32 updates and ≤ 2560 bytes (the lowest-priority updates wait for the next tick); an entity whose
 *     fields did not change since it was last sent to this viewer is not repeated; `gone` when it leaves interest
 *   - a changed `c` / `n` / `s` (a slingshot's pull, a soldier's weapon) re-sends that entity's `add` (an upsert)
 * Per viewer state = { sent: Map(w → { a, e }), tickN }.
 */

const WEIGHT = Object.freeze({ av: 6, veg: 4, car: 2, soldier: 2, splat: 1.5, sling: 1 })
const RADIUS = Object.freeze({ rc: 8, sk: 4, salad: 30 })
const SK_AIR = 6
const SPECTATOR_NEAR = 10
const DEFAULT_CAP = 12
const MAX_CAP = 20
const WORLD_CAP = 80
const QUALITY = Object.freeze([6, 12, 20])
const MAX_UPDATES = 32
const MAX_BYTES = 2560
const FAR_EVERY = 3
const BASE_BYTES = 64 // {"t":"wv","v":1,"ts":…} + the list keys, generous

/** The `wq` value → 6 | 12 | 20 (anything else 12). */
const qualityCap = (n) => (QUALITY.includes(n) ? n : DEFAULT_CAP)

/** The visitor cap of one viewer: the world page 80; a game viewer min(cap, 20), default 12. */
function capFor(n, worldPage) {
	if (worldPage) return WORLD_CAP
	return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_CAP) : DEFAULT_CAP
}

const airborne = (e) => e.k === 'veg' || (e.k === 'car' && (e.f & 16) !== 0)

/**
 * @param {{ g: string|null, p: number[]|null, cap: number, center?: number[] }} view  g = the viewer's own game (null = world page)
 * @param {Array<{ w, g, k, p }>} ents the hub's entities this tick
 * @returns {Array<{ e, pri, near }>} best first, ≤ cap
 */
function selectInterest(view, ents) {
	const spect = !Array.isArray(view.p)
	const o = spect ? view.center || [0, 0, 0] : view.p
	const radius = spect ? Infinity : RADIUS[view.g] ?? RADIUS.salad
	const nearR = spect ? SPECTATOR_NEAR : radius / 3
	const out = []
	for (const e of ents) {
		if (view.g && e.g === view.g) continue
		const d = Math.hypot(e.p[0] - o[0], e.p[2] - o[2])
		if (e.k !== 'av' && d > radius && !(view.g === 'sk' && airborne(e) && d <= SK_AIR)) continue
		const w = (WEIGHT[e.k] || 1) * (spect ? 0.5 : 1)
		out.push({ e, pri: e.k === 'av' ? -1 / (1 + d) : d / w, near: e.k === 'veg' || d <= nearR })
	}
	out.sort((a, b) => a.pri - b.pri || a.e.w - b.e.w)
	return out.slice(0, Math.max(0, view.cap | 0))
}

/**
 * Build this tick's `wv` for one viewer and update its state. → the message object or null (nothing to say).
 * @param {{ sent: Map, tickN: number }} vs
 * @param {Array<{ e, near }>} picked from selectInterest
 * @param {{ ts: number, tags: boolean, fx?: Array, wire: object }} o  wire = client/world-wire.js; fx = [[w, kind, ms, c]]
 */
function buildWv(vs, picked, o) {
	const { wire } = o
	const inSet = new Set(picked.map((x) => x.e.w))
	const gone = []
	for (const w of vs.sent.keys()) if (!inSet.has(w)) gone.push(w)
	for (const w of gone) vs.sent.delete(w)
	const add = []
	const e = []
	const undo = []
	let bytes = BASE_BYTES + JSON.stringify(gone).length
	for (const { e: ent, near } of picked) {
		if (e.length >= MAX_UPDATES) break
		const prev = vs.sent.get(ent.w)
		if (prev && !near && (vs.tickN + ent.w) % FAR_EVERY !== 0) continue
		const tup = wire.entTuple(ent.w, ent)
		const addT = [ent.w, ent.k, ent.g, ent.c, o.tags ? ent.n : '', ent.s]
		const ak = JSON.stringify(addT)
		const ek = JSON.stringify(tup)
		const needAdd = !prev || prev.a !== ak
		if (!needAdd && prev.e === ek) continue
		const cost = (needAdd ? ak.length + 1 : 0) + ek.length + 1
		if (bytes + cost > MAX_BYTES) break
		bytes += cost
		if (needAdd) add.push(addT)
		e.push(tup)
		undo.push([ent.w, prev])
		vs.sent.set(ent.w, { a: ak, e: ek })
	}
	const fx = []
	for (const f of o.fx || []) {
		if (!vs.sent.has(f[0])) continue
		const n = JSON.stringify(f).length + 1
		if (bytes + n > MAX_BYTES) break
		bytes += n
		fx.push(f)
	}
	vs.tickN++
	if (!add.length && !e.length && !gone.length && !fx.length) return null
	let msg = wire.encodeWv({ ts: o.ts, add, e, gone, fx })
	// belt and braces: the estimate above is generous, but the byte cap is a hard rule
	while (JSON.stringify(msg).length > MAX_BYTES && e.length) {
		const t = e.pop()
		const [w, prev] = undo.pop()
		const ai = add.findIndex((a) => a[0] === t[0])
		if (ai >= 0) add.splice(ai, 1)
		if (prev) vs.sent.set(w, prev)
		else vs.sent.delete(w)
		for (let i = fx.length - 1; i >= 0; i--) if (!vs.sent.has(fx[i][0])) fx.splice(i, 1)
		msg = wire.encodeWv({ ts: o.ts, add, e, gone, fx })
	}
	return msg
}

module.exports = {
	selectInterest,
	buildWv,
	capFor,
	qualityCap,
	WEIGHT,
	RADIUS,
	SK_AIR,
	SPECTATOR_NEAR,
	DEFAULT_CAP,
	MAX_CAP,
	WORLD_CAP,
	MAX_UPDATES,
	MAX_BYTES,
	FAR_EVERY,
}

'use strict'

/**
 * WO-1101 — Game World entities: the hub's world-id map and the Ent cleaner (work/notes/game-world-contract.md §0.2,
 * §1). PURE (the clock is passed in). A game's own ids never leak across: (g, k, id) → w (a positive int), kept 30 s
 * after the entity was last seen so a car that blinks out and back keeps its w; w is never reused.
 * Per game the hub keeps at most: 10 cars, 10 soldiers, 30 vegetables (newest), 20 slings, 3 avatars, 12 splats
 * (newest) — the adapters cap too; this is the hub's own guard.
 */

const { requireWire } = require('./world-wire-load')

const KIND_CAP = Object.freeze({ car: 10, soldier: 10, veg: 30, sling: 20, av: 3, splat: 12 })
const NEWEST = new Set(['veg', 'splat'])
const ID_TTL = 30000
const COLOR = /^#[0-9a-f]{6}$/i

function createIdMap(ttl = ID_TTL) {
	const map = new Map() // `${g}|${k}|${id}` → { w, seen }
	let next = 1
	return {
		idFor(g, k, id, t) {
			const key = `${g}|${k}|${id}`
			let x = map.get(key)
			if (!x) {
				x = { w: next++, seen: t }
				if (next >= 2 ** 31) next = 1
				map.set(key, x)
			}
			x.seen = t
			return x.w
		},
		lookup: (g, k, id) => map.get(`${g}|${k}|${id}`)?.w ?? null,
		gc(t) {
			for (const [k, x] of map) if (x.seen < t - ttl) map.delete(k)
		},
		clear: () => map.clear(),
		size: () => map.size,
	}
}

const fin = (x) => typeof x === 'number' && Number.isFinite(x)

/** One raw Ent of game g → the hub's clean Ent (+ w) or null. `v` is kept only for `veg` (the wire says so). */
function normEnt(g, e, ids, t) {
	const wire = requireWire()
	if (!e || typeof e !== 'object' || !wire.KINDS.includes(e.k)) return null
	if (!(typeof e.id === 'string' || typeof e.id === 'number')) return null
	const p = e.p
	if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1]) || !fin(p[2])) return null
	if (Math.abs(p[0]) > wire.LIMITS.coord || Math.abs(p[1]) > wire.LIMITS.coord || Math.abs(p[2]) > wire.LIMITS.coord) return null
	const out = {
		w: ids.idFor(g, e.k, e.id, t),
		g,
		k: e.k,
		id: e.id,
		p: [p[0], p[1], p[2]],
		yaw: fin(e.yaw) ? Math.atan2(Math.sin(e.yaw), Math.cos(e.yaw)) : 0, // wrapped: the decoder refuses |yaw| > 100
		c: typeof e.c === 'string' && COLOR.test(e.c) ? e.c.toLowerCase() : '#cccccc',
		n: wire.cleanName(e.n),
		f: Number.isInteger(e.f) && e.f >= 0 && e.f < 65536 ? e.f : 0,
		s: wire.cleanSub(e.s),
	}
	if (e.k === 'veg' && Array.isArray(e.v) && e.v.length >= 3 && e.v.every((x, i) => i > 2 || (fin(x) && Math.abs(x) <= wire.LIMITS.speed))) out.v = [e.v[0], e.v[1], e.v[2]]
	else if (e.k === 'veg') out.v = [0, 0, 0]
	if (fin(e.spd)) out.spd = e.spd
	if (e.bot) out.bot = true
	return out
}

/** A game's entity list → clean Ents within the per-kind caps (vegetables / splats: the newest = the last ones). */
function collectGame(g, list, ids, t) {
	if (!Array.isArray(list)) return []
	const byKind = {}
	for (const raw of list) {
		const k = raw && raw.k
		if (!KIND_CAP[k]) continue
		;(byKind[k] ||= []).push(raw)
	}
	const out = []
	for (const k of Object.keys(byKind)) {
		const a = byKind[k]
		const pick = NEWEST.has(k) ? a.slice(-KIND_CAP[k]) : a.slice(0, KIND_CAP[k])
		for (const raw of pick) {
			const e = normEnt(g, raw, ids, t)
			if (e) out.push(e)
		}
	}
	return out
}

module.exports = { createIdMap, normEnt, collectGame, KIND_CAP, ID_TTL }

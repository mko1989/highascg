/**
 * WO-1101 — the Game World wire format, version 1 (work/notes/game-world-contract.md §1). Pure, no imports: the browser
 * decodes with it, the server encodes with it (require() of this ES module), and the smokes prove the round trip.
 *
 *   wst  { t: 'wst', v: 1, on, client, models: { kind: url }, scale, safe, affect, games: [{ id, title, phase }] }
 *   wv   { t: 'wv', v: 1, ts, add: [[w, k, g, c, n, s]], e: [[w, x, y, z, yaw, f, vx?, vy?, vz?]], gone: [w], fx: [[w, kind, ms, c]] }
 *
 * decode*() never throws: anything malformed is dropped tuple by tuple; a whole message of the wrong version → null.
 */

export const WIRE_V = 1
export const KINDS = Object.freeze(['car', 'soldier', 'veg', 'sling', 'av', 'splat'])
export const GAMES = /^[a-z][a-z0-9-]{0,15}$/
export const FX_KINDS = Object.freeze(['splat', 'sparks', 'stun', 'hop', 'scatter', 'bonk'])
export const LIMITS = Object.freeze({ coord: 500, speed: 60, maxUpdates: 32, maxBytes: 2560, name: 16, sub: 12, maxFxMs: 10000 })

const KIND_SET = new Set(KINDS)
const FX_SET = new Set(FX_KINDS)
const COLOR = /^#[0-9a-f]{6}$/i
const SUB = /^[a-z0-9_-]{0,12}$/
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g

export const r3 = (x) => Math.round(x * 1000) / 1000 + 0
const fin = (x) => typeof x === 'number' && Number.isFinite(x)
const isW = (w) => Number.isInteger(w) && w > 0 && w < 2 ** 31
const coord = (x) => fin(x) && Math.abs(x) <= LIMITS.coord
const vel = (x) => fin(x) && Math.abs(x) <= LIMITS.speed

/** A display name: string, control / bidi characters removed, trimmed, ≤ 16 chars ('' otherwise). */
export function cleanName(n) {
	if (typeof n !== 'string') return ''
	return n.replace(CTRL, '').trim().slice(0, LIMITS.name)
}

/** `s` (sub): a short id string or a small integer; anything else → ''. */
export function cleanSub(s) {
	if (Number.isInteger(s) && Math.abs(s) < 1e6) return s
	return typeof s === 'string' && SUB.test(s) ? s : ''
}

function cleanAdd(a) {
	if (!Array.isArray(a) || a.length < 4) return null
	const [w, k, g, c, n, s] = a
	if (!isW(w) || !KIND_SET.has(k) || typeof g !== 'string' || !GAMES.test(g)) return null
	return [w, k, g, typeof c === 'string' && COLOR.test(c) ? c.toLowerCase() : '#cccccc', cleanName(n), cleanSub(s)]
}

function cleanE(e) {
	if (!Array.isArray(e) || e.length < 6) return null
	const [w, x, y, z, yaw, f] = e
	if (!isW(w) || !coord(x) || !coord(y) || !coord(z) || !fin(yaw) || Math.abs(yaw) > 100) return null
	const out = [w, r3(x), r3(y), r3(z), r3(yaw), Number.isInteger(f) && f >= 0 && f < 65536 ? f : 0]
	if (e.length >= 9) {
		if (!vel(e[6]) || !vel(e[7]) || !vel(e[8])) return null
		out.push(r3(e[6]), r3(e[7]), r3(e[8]))
	}
	return out
}

function cleanFx(x) {
	if (!Array.isArray(x) || x.length < 3) return null
	const [w, kind, ms, c] = x
	if (!isW(w) || !FX_SET.has(kind) || !Number.isInteger(ms) || ms < 0 || ms > LIMITS.maxFxMs) return null
	return [w, kind, ms, typeof c === 'string' && COLOR.test(c) ? c.toLowerCase() : '']
}

const list = (a, clean, max) => (Array.isArray(a) ? a.slice(0, max).map(clean).filter(Boolean) : [])

/** A `wv` message (object) → { ts, add, e, gone, fx } of clean tuples, or null when it is not a v1 `wv`. */
export function decodeWv(m) {
	if (!m || typeof m !== 'object' || m.t !== 'wv' || m.v !== WIRE_V) return null
	return {
		ts: fin(m.ts) ? m.ts : 0,
		add: list(m.add, cleanAdd, 64),
		e: list(m.e, cleanE, 64),
		gone: Array.isArray(m.gone) ? m.gone.slice(0, 256).filter(isW) : [],
		fx: list(m.fx, cleanFx, 32),
	}
}

/** Build a `wv` message from clean parts (empty lists are left out). The exact inverse of decodeWv on clean input. */
export function encodeWv({ ts, add = [], e = [], gone = [], fx = [] }) {
	const m = { t: 'wv', v: WIRE_V, ts: Math.round(ts) }
	if (add.length) m.add = add
	if (e.length) m.e = e
	if (gone.length) m.gone = gone
	if (fx.length) m.fx = fx
	return m
}

/** One update tuple from an entity ({ p, yaw, f, v? }) — rounded as the wire says. */
export function entTuple(w, ent) {
	const t = [w, r3(ent.p[0]), r3(ent.p[1]), r3(ent.p[2]), r3(ent.yaw || 0), ent.f | 0]
	if (ent.v) t.push(r3(ent.v[0]), r3(ent.v[1]), r3(ent.v[2]))
	return t
}

/** A model URL from the server: same-origin game path only. */
export const okModelUrl = (u) => typeof u === 'string' && u.startsWith('/game/') && !u.includes('..') && !u.includes('//') && u.length < 120

/** A `wst` message → { on, client, models, scale, safe, affect, games } or null. */
export function decodeWst(m) {
	if (!m || typeof m !== 'object' || m.t !== 'wst' || m.v !== WIRE_V) return null
	if (m.on !== true) return { on: false }
	const models = {}
	if (m.models && typeof m.models === 'object') for (const k of KINDS) if (okModelUrl(m.models[k])) models[k] = m.models[k]
	const games = Array.isArray(m.games)
		? m.games.slice(0, 8).filter((g) => g && typeof g.id === 'string' && GAMES.test(g.id))
			.map((g) => ({ id: g.id, title: cleanName(g.title), phase: typeof g.phase === 'string' ? g.phase.slice(0, 16) : '' }))
		: []
	return {
		on: true,
		client: okModelUrl(m.client) ? m.client : null,
		models,
		scale: fin(m.scale) && m.scale > 0 && m.scale <= 1 ? m.scale : 1,
		safe: m.safe === true,
		affect: m.affect === 'soft' || m.affect === 'off' ? m.affect : 'on',
		games,
	}
}

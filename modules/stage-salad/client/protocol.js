/**
 * Wire format of the Stage Salad socket (WO-1089, work/notes/stage-salad-contract.md §9) — pure, node-testable.
 * Builders return plain objects with EXACTLY the contract's keys (angles in radians, power / pull 0…1); `encode` makes
 * the JSON text frame. `decode` validates every server frame defensively and returns a cleaned copy, or null for
 * anything unknown or malformed (a bad tuple inside `w` is dropped, the rest kept).
 */
import { vegOf } from './veggies.js'

export const MAX_NAME = 16
export const PHASES = Object.freeze(['lobby', 'countdown', 'round', 'results'])
export const AIM_INTERVAL_MS = 100 // `aim` ≤ 10/s while pulling
export const AV = Object.freeze({ WALK: 1, LOST: 2, STANDIN: 4, UMBRELLA: 8 })
export const END_KINDS = Object.freeze(['hit', 'land', 'out'])
export const PARTS = Object.freeze(['head', 'body', 'legs'])

/** Name ≤ 16 characters, control characters stripped, never empty. */
export function sanitizeName(s, fallback = 'Player') {
	const clean = Array.from(String(s ?? ''))
		.filter((ch) => {
			const c = ch.codePointAt(0)
			return c > 0x1f && !(c >= 0x7f && c <= 0x9f)
		})
		.join('')
		.trim()
	return Array.from(clean).slice(0, MAX_NAME).join('').trim() || fallback
}

/** `#rrggbb` lower-case, or null. */
export function validColor(c) {
	const t = String(c ?? '').trim()
	return /^#[0-9a-fA-F]{6}$/.test(t) ? t.toLowerCase() : null
}

export function round(v, d) {
	const k = 10 ** d
	return Math.round((Number(v) || 0) * k) / k + 0
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0))

export function joinMsg(name, color, spectator = false) {
	return { t: 'join', name: sanitizeName(name), color: validColor(color) || '#ffffff', spectator: !!spectator }
}

/** The band being pulled: others see it stretch. */
export function aimMsg(yaw, pitch, pull) {
	return { t: 'aim', a: [round(yaw, 4), round(pitch, 4)], p: round(clamp01(pull), 3) }
}

/** A shot: n = the client's increasing counter, power 0.15…1 (the caller clamps; the server refuses, never clamps). */
export function fireMsg(n, veg, yaw, pitch, power) {
	return { t: 'fire', n: Math.max(0, Math.floor(Number(n) || 0)), veg: String(veg), a: [round(yaw, 4), round(pitch, 4)], p: round(power, 4) }
}

export function pingMsg(c) {
	return { t: 'ping', c }
}

export function videoMsg(on) {
	return { t: 'video', on: !!on }
}

export function encode(msg) {
	return JSON.stringify(msg)
}

const num = (v) => typeof v === 'number' && Number.isFinite(v)
const vec = (p, n) => Array.isArray(p) && p.length === n && p.every(num)
const obj = (o) => !!o && typeof o === 'object' && !Array.isArray(o)
const id = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 64) || (Number.isInteger(v) && v >= 0)
const optNum = (v, d = null) => (num(v) ? v : d)

/** One `w.av` tuple [tid, x, y, z, yaw, height, flags] → { tid, x, y, z, yaw, height, f } or null. */
export function decodeAvatar(t) {
	if (!Array.isArray(t) || t.length < 7 || !id(t[0])) return null
	const [tid, x, y, z, yaw, height, f] = t
	if (![x, y, z, yaw, height].every(num) || !(height > 0.3 && height < 4)) return null
	return { tid, x, y, z, yaw, height, f: num(f) ? f & 15 : 0 }
}

/** One `w.sl` tuple [pid, yaw, pitch, pull] → { id, yaw, pitch, pull } or null. */
export function decodeSling(t) {
	if (!Array.isArray(t) || t.length < 4 || !id(t[0]) || ![t[1], t[2], t[3]].every(num)) return null
	return { id: t[0], yaw: t[1], pitch: t[2], pull: clamp01(t[3]) }
}

function decodeShot(m) {
	const veg = vegOf(m.veg)
	if (!id(m.id) || !veg || !vec(m.o, 3) || !vec(m.a, 2) || !num(m.p) || !num(m.ts)) return null
	return { t: 'shot', id: m.id, n: optNum(m.n), veg: veg.id, o: m.o.slice(), a: m.a.slice(), p: m.p, ts: m.ts, seed: num(m.seed) ? m.seed >>> 0 : 0 }
}

function decodeEnd(m) {
	if (!id(m.id) || !num(m.n) || !END_KINDS.includes(m.k) || !vec(m.p, 3) || !num(m.at)) return null
	const out = { t: 'end', id: m.id, n: m.n, i: Number.isInteger(m.i) && m.i >= 0 && m.i < 16 ? m.i : 0, k: m.k, p: m.p.slice(), at: m.at }
	if (typeof m.tag === 'string' && m.tag.length <= 24) out.tag = m.tag
	if (id(m.tid)) out.tid = m.tid
	if (m.k === 'hit') {
		if (!PARTS.includes(m.part)) return null
		out.part = m.part
	}
	if (num(m.pts)) out.pts = Math.round(m.pts)
	if (num(m.streak)) out.streak = Math.max(0, Math.floor(m.streak))
	if (m.bank === true || (num(m.bank) && m.bank > 1)) out.bank = true
	return out
}

function decodeResults(m) {
	if (!Array.isArray(m.order)) return null
	const order = m.order
		.filter((r) => obj(r) && id(r.id))
		.map((r) => ({
			id: r.id,
			name: String(r.name ?? ''),
			team: r.team === 1 ? 1 : 0,
			score: optNum(r.score, 0),
			hits: optNum(r.hits, 0),
			shots: optNum(r.shots, 0),
			best: optNum(r.best, 0),
		}))
	const teams = vec(m.teams, 2) ? m.teams.slice() : null
	let winner = null
	if (obj(m.winner) && id(m.winner.id)) winner = { id: m.winner.id }
	else if (obj(m.winner) && (m.winner.team === 0 || m.winner.team === 1)) winner = { team: m.winner.team }
	return { t: 'results', order, teams, winner }
}

/**
 * @param {string} text a server text frame
 * @returns {object|null} the cleaned message or null
 */
export function decode(text) {
	let m
	try {
		m = JSON.parse(String(text))
	} catch {
		return null
	}
	if (!obj(m) || typeof m.t !== 'string') return null
	switch (m.t) {
		case 'welcome':
			if (!id(m.id) || !obj(m.state)) return null
			return { t: 'welcome', id: m.id, you: obj(m.you) ? m.you : {}, state: m.state, // WO-1106 B34: the resume token
				...(typeof m.resume === 'string' ? { resume: m.resume } : {}), ...(m.resumed === true ? { resumed: true } : {}) }
		case 'full':
		case 'off':
			return { t: m.t }
		case 'state':
			return obj(m.state) ? { t: 'state', state: m.state } : null
		case 'w':
			if (!num(m.ts)) return null
			return {
				t: 'w',
				ts: m.ts,
				av: Array.isArray(m.av) ? m.av.map(decodeAvatar).filter(Boolean) : null,
				sl: Array.isArray(m.sl) ? m.sl.map(decodeSling).filter(Boolean) : [],
			}
		case 'shot':
			return decodeShot(m)
		case 'end':
			return decodeEnd(m)
		case 'dodge':
			if (!id(m.tid) || (m.kind !== 'duck' && m.kind !== 'step') || !num(m.from) || !num(m.until) || !(m.until > m.from)) return null
			return { t: 'dodge', tid: m.tid, kind: m.kind, from: m.from, until: m.until, dx: vec(m.dx, 2) ? m.dx.slice() : [0, 0] }
		case 'umbrella':
			if (!id(m.tid) || !num(m.from) || !num(m.until) || !(m.until > m.from)) return null
			return { t: 'umbrella', tid: m.tid, from: m.from, until: m.until }
		case 'me':
			if (!num(m.ready)) return null
			return { t: 'me', ready: m.ready, streak: num(m.streak) ? Math.max(0, Math.floor(m.streak)) : 0, score: optNum(m.score, 0) }
		case 'countdown':
			return num(m.startAt) ? { t: 'countdown', startAt: m.startAt } : null
		case 'results':
			return decodeResults(m)
		case 'pong':
			return num(m.s) ? { t: 'pong', c: m.c, s: m.s } : null
		case 'lx':
		case 'lxfull':
			// RC §2.6 live lights (the kit's stage-fx validates the entries); `lxfull` may also be { on: false }
			return Array.isArray(m.f) || (m.t === 'lxfull' && (m.on === false || Array.isArray(m.lights))) ? m : null
		case 'ctl': // WO-1125 §3: a refusal of a player control ({ ok:false, error })
			return { t: 'ctl', ok: m.ok !== false, error: typeof m.error === 'string' ? m.error.slice(0, 12) : null }
		default:
			return decodeWorld(m)
	}
}

/** A phase name from a state (unknown → lobby). */
export function phaseOf(state) {
	return PHASES.includes(state?.phase) ? state.phase : 'lobby'
}

/** May a shot leave now? (phase lobby / round, not presenter-safe) */
export function canFire(state) {
	const ph = phaseOf(state)
	return (ph === 'lobby' || ph === 'round') && !state?.safe
}

/** Streak count → the score multiplier shown (contract §7: 1 + 0.25 × (n − 1), max 2). */
export function streakMult(n) {
	return n > 1 ? Math.min(2, 1 + 0.25 * (n - 1)) : 1
}

/* WO-1101 / WO-1102 Game World (sent only while the world module is on; world-join.js uses them) */
const WORLD_FX = ['hop', 'bump', 'boost', 'wobble', 'stun', 'scatter', 'step']
const fin3 = (p) => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x))
const short = (s) => String(s ?? '').slice(0, 16)

/** wst / wv (the visitors renderer validates them), xfx, xbonus, xb → the message or null. */
export function decodeWorld(m) {
	const fin = (v) => typeof v === 'number' && Number.isFinite(v)
	switch (m.t) {
		case 'wst':
		case 'wv':
			return m.v === 1 ? m : null
		case 'xfx':
			if (m.id == null || !WORLD_FX.includes(m.k) || !fin(m.dur)) return null
			return { t: 'xfx', id: m.id, k: m.k, dur: Math.max(0, Math.min(2, m.dur)), dir: Array.isArray(m.dir) && fin(m.dir[0]) && fin(m.dir[1]) ? [m.dir[0], m.dir[1]] : null,
				soft: m.soft === true, by: m.by && typeof m.by === 'object' ? { g: short(m.by.g), n: short(m.by.n) } : null }
		case 'xbonus':
			return { t: 'xbonus', kind: short(m.kind), pts: fin(m.pts) ? m.pts : 0 }
		case 'xb':
			return m.id != null && fin(m.n) && fin(m.i) && fin3(m.p) && fin3(m.v) && fin(m.at) ? { t: 'xb', id: m.id, n: m.n, i: m.i, p: m.p.slice(0, 3), v: m.v.slice(0, 3), at: m.at } : null
		default:
			return null
	}
}

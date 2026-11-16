/**
 * Wire format of the Stage Skirmish socket (WO-1081, work/notes/skirmish-game-contract.md §7) — pure. Builders return
 * plain objects with EXACTLY the contract's keys; `encode` makes the JSON text frame. `decode` validates server frames
 * and returns null for anything unknown or malformed. Positions are world metres rounded to 1 mm or finer so they keep
 * ≥ 3 significant digits of a u at the toy scale (RC contract §3: 1 mm at scale 0.1).
 */
import { isWeapon, PHASES, MODES } from './sk-const.js'

export const MAX_NAME = 16
export const SEND_INTERVAL_MS = 55 // ≈ 18 Hz, under the server's 20 Hz limit
export const KEEPALIVE_MS = 1000 // a soldier standing still still reports once a second

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

/** Decimals for a position at scale s: 1 mm (3) at scale ≥ 0.1, one more per decade below. */
export function posDecimals(s = 1) {
	const k = Number(s) > 0 ? Number(s) : 1
	return Math.max(3, 3 + Math.ceil(-Math.log10(k) - 1 - 1e-9))
}

export function round(v, d) {
	const k = 10 ** d
	return Math.round((Number(v) || 0) * k) / k
}

const pos = (p, s) => {
	const d = posDecimals(s)
	return [round(p[0], d), round(p[1], d)]
}

export function joinMsg(name, color, spectator = false) {
	return { t: 'join', name: sanitizeName(name), color: validColor(color) || '#ffffff', spectator: !!spectator }
}

/** Own soldier: p = [x, z], yaw = aim, mv 0/1, w = the held weapon shown. */
export function stateMsg(x, z, yaw, moving, w, s = 1) {
	return { t: 's', p: pos([x, z], s), yaw: round(yaw, 3), mv: moving ? 1 : 0, w: isWeapon(w) ? w : 'pea' }
}

export function fireMsg(w, n, p, yaw, s = 1) {
	return { t: 'fire', w: String(w), n: n | 0, p: pos(p, s), yaw: round(yaw, 4) }
}

/** Shot n hit player id with k pellets (1–8). */
export function hitMsg(n, id, k = 1) {
	return { t: 'hit', n: n | 0, id, k: Math.max(1, Math.min(8, k | 0)) }
}

export function boomMsg(n, p, s = 1) {
	return { t: 'boom', n: n | 0, p: pos(p, s) }
}

export function pickMsg(id) {
	return { t: 'pick', id }
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
const vec2 = (p) => Array.isArray(p) && p.length >= 2 && num(p[0]) && num(p[1])
const obj = (o) => !!o && typeof o === 'object' && !Array.isArray(o)

/**
 * One `w` tuple [id, x, z, yaw, flags] → { id, x, z, yaw, f, w } or null. An optional 6th element = the held weapon
 * (not in the contract's tuple yet; without it the weapon drawn is the one of the soldier's last `shot`).
 */
export function decodeSoldier(t) {
	if (!Array.isArray(t) || t.length < 4 || t[0] == null) return null
	const [id, x, z, yaw, f, w] = t
	if (![x, z, yaw].every(num)) return null
	return { id, x, z, yaw, f: num(f) ? f | 0 : 0, w: isWeapon(w) ? w : null }
}

/** `me.w` → { weapon: ammo } with only known weapons and numeric ammo (−1 = infinite). */
export function decodeAmmo(w) {
	const out = {}
	if (!obj(w)) return out
	for (const [k, v] of Object.entries(w)) if (isWeapon(k) && num(v)) out[k] = v < 0 ? -1 : Math.floor(v)
	return out
}

/** `pk: [[id, until]]` → the same, malformed rows dropped. */
export function decodePk(list) {
	if (!Array.isArray(list)) return []
	return list.filter((r) => Array.isArray(r) && r.length >= 2 && r[0] != null && num(r[1])).map((r) => [r[0], r[1]])
}

/**
 * @param {string} text a server text frame
 * @returns {object|null} the message (w → `a` as objects, p as [x, z]) or null
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
			return m.id != null && obj(m.state) ? m : null
		case 'full':
		case 'off':
			return { t: m.t }
		case 'state':
			return obj(m.state) ? m : null
		case 'w':
			if (!num(m.ts) || !Array.isArray(m.a)) return null
			return { t: 'w', ts: m.ts, a: m.a.map(decodeSoldier).filter(Boolean) }
		case 'shot':
			if (m.id == null || !isWeapon(m.w) || !vec2(m.p) || !num(m.yaw)) return null
			return {
				t: 'shot',
				id: m.id,
				w: m.w,
				n: num(m.n) ? m.n : null,
				p: [m.p[0], m.p[1]],
				yaw: m.yaw,
				ts: num(m.ts) ? m.ts : null,
				seed: num(m.seed) ? m.seed >>> 0 : 0,
			}
		case 'dmg':
			if (m.id == null || !num(m.hp)) return null
			return { t: 'dmg', id: m.id, by: m.by ?? null, w: String(m.w || ''), hp: m.hp, ar: num(m.ar) ? m.ar : 0 }
		case 'kill':
			if (m.id == null) return null
			return { t: 'kill', id: m.id, by: m.by ?? m.id, w: String(m.w || ''), at: num(m.at) ? m.at : null }
		case 'spawn':
			if (m.id == null || !vec2(m.p)) return null
			return {
				t: 'spawn',
				id: m.id,
				p: [m.p[0], m.p[1]],
				yaw: num(m.yaw) ? m.yaw : 0,
				until: num(m.until) ? m.until : 0,
			}
		case 'boom':
			if (!vec2(m.p)) return null
			return { t: 'boom', by: m.by ?? null, n: num(m.n) ? m.n : null, p: [m.p[0], m.p[1]], ts: num(m.ts) ? m.ts : null }
		case 'me':
			if (!num(m.hp)) return null
			return { t: 'me', hp: m.hp, ar: num(m.ar) ? m.ar : 0, w: decodeAmmo(m.w), surge: num(m.surge) ? m.surge : 0 }
		case 'pk':
			return m.id != null && num(m.until) ? { t: 'pk', id: m.id, by: m.by ?? null, until: m.until } : null
		case 'countdown':
			return num(m.startAt) ? { t: 'countdown', startAt: m.startAt } : null
		case 'results':
			if (!Array.isArray(m.order)) return null
			return {
				t: 'results',
				mode: MODES.includes(m.mode) ? m.mode : 'dm',
				order: m.order.filter(obj),
				teams: Array.isArray(m.teams) ? m.teams.map((v) => (num(v) ? v : 0)) : null,
				final: m.final !== false,
			}
		case 'pong':
			return num(m.s) ? m : null
		case 'lx':
		case 'lxfull':
			// RC §2.6 live lights (the kit's stage-fx validates the entries); `lxfull` may also be { on: false }
			return Array.isArray(m.f) || (m.t === 'lxfull' && (m.on === false || Array.isArray(m.lights))) ? m : null
		default:
			return decodeWorld(m)
	}
}

/** A phase name from a state (unknown → lobby). */
export function phaseOf(state) {
	return PHASES.includes(state?.phase) ? state.phase : 'lobby'
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

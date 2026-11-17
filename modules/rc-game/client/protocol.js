/**
 * Wire format of the RC game WebSocket (WO-1074, work/notes/rc-game-contract.md, v2 §2.4) — pure.
 * Builders return plain objects with EXACTLY the contract's keys; `encode` turns them into the JSON text frame.
 * `decode` validates server frames and returns null for anything unknown or malformed (unknown types are ignored).
 */

import { wireDecimals } from './scale.js'

export const MAX_NAME = 16
export const SEND_INTERVAL_MS = 60 // ≈ 16.7 Hz, safely under the server's 20 Hz drop limit
export const KEEPALIVE_MS = 1000 // a parked car still reports once a second (server drops silent players after 10 s)

/** Name ≤ 16 characters, control characters stripped, never empty. */
export function sanitizeName(s, fallback = 'Player') {
	const clean = Array.from(String(s ?? ''))
		.filter((ch) => {
			const c = ch.codePointAt(0)
			return c > 0x1f && !(c >= 0x7f && c <= 0x9f)
		})
		.join('')
		.trim()
	const chars = Array.from(clean).slice(0, MAX_NAME).join('').trim()
	return chars || fallback
}

/** `#rrggbb` lower-case, or null. */
export function validColor(c) {
	const s = String(c ?? '').trim()
	return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null
}

function r(v, d) {
	const k = 10 ** d
	return Math.round((Number(v) || 0) * k) / k
}

export function joinMsg(name, color, spectator = false) {
	return { t: 'join', name: sanitizeName(name), color: validColor(color) || '#ffffff', spectator: !!spectator }
}

export function readyMsg(ready) {
	return { t: 'ready', ready: !!ready }
}

/**
 * Own car state → `s` (v2: + `fx` bit flags, see drive-rules.js FX). §3: positions to 1 mm, the speed to ≥ 3 significant
 * digits at the toy scale `s` (1 cm/s at scale 1, 1 mm/s at 0.1 — scale.js wireDecimals).
 */
export function stateMsg(car, v, cp, lap, fx = 0, s = 1) {
	return {
		t: 's',
		p: [r(car.x, 3), r(car.y, 3), r(car.z, 3)],
		yaw: r(car.yaw, 3),
		v: r(v, wireDecimals(2, s)),
		st: r(car.st, 2),
		cp: cp | 0,
		lap: lap | 0,
		fx: fx | 0,
	}
}

/** I drove through box `id`. */
export function boxMsg(id) {
	return { t: 'box', id }
}

/** I used my held item at p = [x, y, z] facing yaw (1 mm; finer below scale 0.1). */
export function useMsg(item, p, yaw, s = 1) {
	const d = wireDecimals(3, s * 10)
	return { t: 'use', item: String(item), p: [r(p[0], d), r(p[1], d), r(p[2], d)], yaw: r(yaw, 3) }
}

/** Hazard `hid` hit me. */
export function hitHazMsg(hid) {
	return { t: 'hit', hid }
}

/** Player `by`'s one-shot `item` (pulse) hit me. */
export function hitByMsg(by, item) {
	return { t: 'hit', by, item: String(item) }
}

export const ITEM_KINDS = ['turbo', 'slick', 'rocket', 'pulse', 'shield']
export const HAZ_KINDS = ['slick', 'rocket']
export const FX_KINDS = ['pulse', 'turbo', 'shield', 'spin']

export function pingMsg(c) {
	return { t: 'ping', c }
}

export function encode(msg) {
	return JSON.stringify(msg)
}

const num = (v) => typeof v === 'number' && Number.isFinite(v)

const vec3 = (p) => Array.isArray(p) && p.length >= 3 && num(p[0]) && num(p[1]) && num(p[2])

/** One `w` car tuple [id, x, y, z, yaw, v, st, fx] → object, or null (v1 tuples without fx → fx 0). */
export function decodeCar(tuple) {
	if (!Array.isArray(tuple) || tuple.length < 7) return null
	const [id, x, y, z, yaw, v, st, fx] = tuple
	if (![x, y, z, yaw, v, st].every(num) || id == null) return null
	return { id, x, y, z, yaw, v, st, fx: num(fx) ? fx | 0 : 0 }
}

/** A `haz` (also inside welcome / state `hazards`) → normalized object, or null. */
export function decodeHaz(m) {
	if (!m || typeof m !== 'object' || m.hid == null || !HAZ_KINDS.includes(m.kind) || !vec3(m.p) || !num(m.ts))
		return null
	return {
		t: 'haz',
		hid: m.hid,
		kind: m.kind,
		by: m.by ?? null,
		p: [m.p[0], m.p[1], m.p[2]],
		yaw: num(m.yaw) ? m.yaw : 0,
		ts: m.ts,
		until: num(m.until) ? m.until : null,
	}
}

/** `boxes: [[id, until]]` → [[id, until]] (malformed rows dropped). */
export function decodeBoxes(list) {
	if (!Array.isArray(list)) return []
	return list.filter((b) => Array.isArray(b) && b.length >= 2 && b[0] != null && num(b[1])).map((b) => [b[0], b[1]])
}

/**
 * @param {string} text a server text frame
 * @returns {object|null} the message; `w` gets `cars` as objects
 */
export function decode(text) {
	let m
	try {
		m = JSON.parse(String(text))
	} catch {
		return null
	}
	if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null
	switch (m.t) {
		case 'welcome':
			return m.id != null && m.state && typeof m.state === 'object' ? m : null
		case 'full':
		case 'off':
			return { t: m.t }
		case 'state':
			return m.state && typeof m.state === 'object' ? m : null
		case 'w': {
			if (!num(m.ts) || !Array.isArray(m.cars)) return null
			return { t: 'w', ts: m.ts, cars: m.cars.map(decodeCar).filter(Boolean) }
		}
		case 'countdown':
			return num(m.startAt) ? m : null
		case 'lap':
			return m.id != null && num(m.lap) ? m : null
		case 'results':
			return Array.isArray(m.order) ? m : null
		case 'pong':
			return num(m.s) ? m : null
		case 'box':
			return m.id != null && num(m.until) ? { t: 'box', id: m.id, by: m.by ?? null, until: m.until } : null
		case 'item':
			return ITEM_KINDS.includes(m.item) ? { t: 'item', item: m.item } : null
		case 'haz':
			return decodeHaz(m)
		case 'hazgone':
			return m.hid != null ? { t: 'hazgone', hid: m.hid, hit: m.hit ?? null } : null
		case 'fx':
			if (m.id == null || !FX_KINDS.includes(m.k)) return null
			return { t: 'fx', id: m.id, k: m.k, p: vec3(m.p) ? [m.p[0], m.p[1], m.p[2]] : null, ts: num(m.ts) ? m.ts : null }
		case 'lx':
		case 'lxfull':
			return Array.isArray(m.f) ? m : null // §2.6 live lights (stage-fx.js validates the entries)
		case 'ctl': // WO-1125 §3: a refusal of a player control ({ ok:false, error })
			return { t: 'ctl', ok: m.ok !== false, error: typeof m.error === 'string' ? m.error.slice(0, 12) : null }
		default:
			return decodeWorld(m)
	}
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

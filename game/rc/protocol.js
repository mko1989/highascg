/**
 * Wire format of the RC game WebSocket (WO-1074, work/notes/rc-game-contract.md) — pure.
 * Builders return plain objects with EXACTLY the contract's keys; `encode` turns them into the JSON text frame.
 * `decode` validates server frames and returns null for anything unknown or malformed.
 */

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

/** Own car state → `s`. */
export function stateMsg(car, v, cp, lap) {
	return {
		t: 's',
		p: [r(car.x, 3), r(car.y, 3), r(car.z, 3)],
		yaw: r(car.yaw, 3),
		v: r(v, 2),
		st: r(car.st, 2),
		cp: cp | 0,
		lap: lap | 0,
	}
}

export function pingMsg(c) {
	return { t: 'ping', c }
}

export function encode(msg) {
	return JSON.stringify(msg)
}

const num = (v) => typeof v === 'number' && Number.isFinite(v)

/** One `w` car tuple [id, x, y, z, yaw, v, st] → object, or null. */
export function decodeCar(tuple) {
	if (!Array.isArray(tuple) || tuple.length < 7) return null
	const [id, x, y, z, yaw, v, st] = tuple
	if (![x, y, z, yaw, v, st].every(num) || id == null) return null
	return { id, x, y, z, yaw, v, st }
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
		default:
			return null
	}
}

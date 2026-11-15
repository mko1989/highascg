'use strict'

/**
 * WO-1089 — Stage Salad: everything a guest's browser sends is bounded here before the room uses it (contract §9).
 * ≤ 2 KB of JSON text (the kit's cap), an object with a known `t`; anything else → null (the socket's bad counter).
 * Per type, strict types — a malformed field drops the whole message; ranges the referee checks are NOT clamped here
 * (an out-of-range power or angle is refused by the room, never quietly made legal):
 *   aim   { a: [yaw, pitch], p }        finite radians (|v| ≤ 100), p 0…1 (clamped: it only draws the band)
 *   fire  { n, veg, a: [yaw, pitch], p } n integer 0…2^31−1, veg a known id, a finite, p finite
 *   join  { name, color, spectator }     names / colours cleaned by the room with the kit's cleaners
 */

const { kit, shared } = require('./salad-kit')

const TYPES = new Set(['join', 'aim', 'fire', 'ping', 'video'])
const MAX_N = 2 ** 31 - 1
const fin = (v) => typeof v === 'number' && Number.isFinite(v)
const r4 = (v) => Math.round(v * 1e4) / 1e4 + 0

function angles(a) {
	if (!Array.isArray(a) || a.length !== 2 || !a.every((v) => fin(v) && Math.abs(v) <= 100)) return null
	return [r4(a[0]), r4(a[1])]
}

function cleanAim(m) {
	const a = angles(m?.a)
	if (!a || !fin(m.p)) return null
	return { a, p: Math.max(0, Math.min(1, r4(m.p))) }
}

function cleanFire(m) {
	const a = angles(m?.a)
	const veg = shared().veggies.vegOf(m?.veg)
	if (!a || !veg || !fin(m.p) || !Number.isInteger(m.n) || m.n < 0 || m.n > MAX_N) return null
	return { n: m.n, veg: veg.id, a, p: m.p }
}

/** Raw socket data → a message object or null. */
function parseMessage(raw, isBinary) {
	if (isBinary) return null
	const buf = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(String(raw))
	if (buf.length > kit().MAX_MESSAGE_BYTES) return null
	let m
	try {
		m = JSON.parse(buf.toString('utf8'))
	} catch {
		return null
	}
	return m && typeof m === 'object' && !Array.isArray(m) && TYPES.has(m.t) ? m : null
}

module.exports = { parseMessage, cleanAim, cleanFire }

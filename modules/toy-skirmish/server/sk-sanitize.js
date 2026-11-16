'use strict'

/**
 * WO-1081 — Stage Skirmish: everything a guest's browser sends is bounded here before the room uses it (contract §7).
 * Messages: ≤ 2 KB of JSON text (the RC cap, through the kit), an object with a known `t`; anything else → null and the
 * socket's bad-message counter. Per type, strict types and clamps — a malformed field drops the whole message:
 *   s     { p: [x, z], yaw, mv, w }   p finite (|v| ≤ 10 km), yaw wrapped to (−π, π], mv 0/1, w a weapon id or null
 *   fire  { w, n, p, yaw }            w a weapon id, n the client's shot counter (integer 0 … 2^31 − 1)
 *   hit   { n, id, k }                id a player id (integer ≥ 1), k pellets 1–8 (absent → 1)
 *   boom  { n, p }   · pick { id }    pickup id 0–63
 *   join  { name, color, spectator }  names / colours cleaned by the room with the kit's cleanName / cleanColor
 * Positions keep 0.1 mm (a soldier is 3.6 cm wide at the live scale), yaws 1 mrad.
 */

const { kit } = require('./sk-kit')
const { WEAPONS } = require('./sk-rules')

const TYPES = new Set(['join', 's', 'fire', 'hit', 'boom', 'pick', 'ping', 'video', 'wq']) // wq: WO-1101 Game World visitor cap
const MAX_N = 2 ** 31 - 1

const fin = (v) => typeof v === 'number' && Number.isFinite(v)
const r4 = (v) => Math.round(v * 1e4) / 1e4 + 0
const r3 = (v) => Math.round(v * 1e3) / 1e3 + 0
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
const weapon = (w) => (typeof w === 'string' && Object.prototype.hasOwnProperty.call(WEAPONS, w) ? w : null)

/** [x, z] → rounded copy or null. */
function point(p) {
	if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => fin(v) && Math.abs(v) <= 10000)) return null
	return [r4(p[0]), r4(p[1])]
}

/** Any finite yaw → (−π, π], 1 mrad. */
function cleanYaw(y) {
	if (!fin(y) || Math.abs(y) > 1e6) return null
	let a = y % (2 * Math.PI)
	if (a > Math.PI) a -= 2 * Math.PI
	if (a <= -Math.PI) a += 2 * Math.PI
	return r3(a)
}

function cleanMove(m) {
	const p = point(m?.p)
	const yaw = cleanYaw(m?.yaw)
	if (!p || yaw == null) return null
	return { p, yaw, mv: m.mv === 1 || m.mv === true ? 1 : 0, w: weapon(m.w) }
}

function cleanFire(m) {
	const w = weapon(m?.w)
	const p = point(m?.p)
	const yaw = cleanYaw(m?.yaw)
	if (!w || !p || yaw == null || !int(m.n, 0, MAX_N)) return null
	return { w, n: m.n, p, yaw }
}

function cleanHit(m) {
	const k = m?.k === undefined ? 1 : m.k
	if (!int(m?.n, 0, MAX_N) || !int(m.id, 1, MAX_N) || !int(k, 1, 8)) return null
	return { n: m.n, id: m.id, k }
}

function cleanBoom(m) {
	const p = point(m?.p)
	if (!p || !int(m.n, 0, MAX_N)) return null
	return { n: m.n, p }
}

const cleanPick = (m) => (int(m?.id, 0, 63) ? { id: m.id } : null)

/** Raw socket data → a message object or null (too big, binary, not JSON, not an object with a known `t`). */
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

module.exports = { parseMessage, cleanMove, cleanFire, cleanHit, cleanBoom, cleanPick, cleanYaw }

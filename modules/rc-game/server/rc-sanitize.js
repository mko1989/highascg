'use strict'

/**
 * WO-1074 — RC car game: everything a guest's browser sends is bounded here before the room uses it. Names: ≤ 16
 * characters, no control / format characters (bidi overrides), no markup characters, whitespace collapsed. Colours:
 * `#rrggbb` or a palette colour. Car states: finite numbers only, positions inside the scene bounds + 5 m, speed and
 * steering clamped. Messages: ≤ 2 KB of JSON text, an object with a known `t`. §3 toy scale: the speed cap is × the
 * scene's scale (2.4 m/s at 0.1); the bounds slack stays 5 m (it is a margin round the room, which keeps its size);
 * positions keep 1 mm (3 significant digits of a toy car's 6 cm).
 */

const MAX_MESSAGE_BYTES = 2048
const MAX_NAME = 16
const MAX_SPEED = 24 // v2: hard cap (boosting tops out at 18)
const BOUNDS_SLACK = 5
const PALETTE = ['#ff5533', '#33aaff', '#ffcc22', '#44dd66', '#cc55ff', '#ff66aa', '#22dddd', '#ff9933', '#aaaaaa', '#88ff22']
const TYPES = new Set(['join', 'ready', 's', 'ping', 'box', 'use', 'hit', 'video', 'wq']) // video: §2.6 wall pictures on / off; wq: WO-1101 Game World visitor cap
const FX_BITS = 31 // 1 boosting, 2 drifting, 4 spinning, 8 shielded, 16 airborne

/** A display name, or `fallback`. */
function cleanName(v, fallback) {
	if (typeof v !== 'string') return fallback
	const s = v.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>&"'`\\]/gu, '').replace(/\s+/g, ' ').trim()
	const out = Array.from(s).slice(0, MAX_NAME).join('').trim()
	return out || fallback
}

/** `#rrggbb` (lower case) or the palette colour for `slot`. */
function cleanColor(v, slot = 0) {
	return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : PALETTE[Math.abs(slot | 0) % PALETTE.length]
}

const fin = (v) => typeof v === 'number' && Number.isFinite(v)
const r3 = (v) => Math.round(v * 1000) / 1000
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * A `s` message → { x, y, z, yaw, v, st, cp, lap, fx } or null (malformed, or outside bounds + 5 m). cp / lap are null when
 * absent or out of range (the position still counts). `scale` (§3, default 1): the speed cap is MAX_SPEED × scale.
 */
function cleanCar(m, bounds, checkpoints, laps, scale = 1) {
	const vMax = MAX_SPEED * scale
	const p = m?.p
	if (!Array.isArray(p) || p.length !== 3 || !p.every(fin) || !fin(m.yaw)) return null
	if (bounds && Array.isArray(bounds.min) && Array.isArray(bounds.max)) {
		for (let k = 0; k < 3; k++) if (p[k] < bounds.min[k] - BOUNDS_SLACK || p[k] > bounds.max[k] + BOUNDS_SLACK) return null
	} else if (p.some((v) => Math.abs(v) > 1000)) return null
	let yaw = m.yaw % (2 * Math.PI)
	if (yaw > Math.PI) yaw -= 2 * Math.PI
	if (yaw < -Math.PI) yaw += 2 * Math.PI
	const okInt = (v, hi) => Number.isInteger(v) && v >= 0 && v <= hi
	return {
		x: r3(p[0]), y: r3(p[1]), z: r3(p[2]), yaw: r3(yaw),
		v: r3(fin(m.v) ? clamp(m.v, -vMax, vMax) : 0), st: r3(fin(m.st) ? clamp(m.st, -1, 1) : 0),
		cp: checkpoints > 0 && okInt(m.cp, checkpoints - 1) ? m.cp : null,
		lap: okInt(m.lap, laps) ? m.lap : null,
		fx: okInt(m.fx, FX_BITS) ? m.fx : 0,
	}
}

/** Raw socket data → a message object or null (too big, binary, not JSON, not an object with a known `t`). */
function parseMessage(raw, isBinary) {
	if (isBinary) return null
	const len = Buffer.isBuffer(raw) ? raw.length : Array.isArray(raw) ? raw.reduce((s, b) => s + b.length, 0) : Buffer.byteLength(String(raw))
	if (len > MAX_MESSAGE_BYTES) return null
	let m
	try {
		m = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : String(raw))
	} catch {
		return null
	}
	return m && typeof m === 'object' && !Array.isArray(m) && TYPES.has(m.t) ? m : null
}

module.exports = { MAX_MESSAGE_BYTES, MAX_SPEED, PALETTE, cleanName, cleanColor, cleanCar, parseMessage }

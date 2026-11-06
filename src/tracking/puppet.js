'use strict'

/**
 * WO-978 — the test puppet: a simulated tracked person the server writes into the marker hub like any other source
 * (source "puppet"), so the real output path runs end to end — hub → follow service → PSN trackers → the desk
 * (MagicQ / grandMA3) — with nobody on stage and no client open. Owner, 06.11: "i need a puppet marker, and psn to
 * chamsys".
 *
 * Patterns walk a closed path at a constant `speed` (m/s along the path), in the hub frame (metres, X stage left,
 * Y upstage, Z up), centred on (x, y) at height z:
 *   hold     stands still at (x, y)
 *   circle   radius `size`, counter-clockwise seen from above (stage left first, then upstage)
 *   figure8  a figure of eight `size` wide each side of the centre (x ± size, y ± size/2)
 *   line     ping-pong along X between x − size (stage right) and x + size (stage left)
 *   walk     a 2·size square: from downstage right up to upstage right, across to upstage left, down, back
 * The hub derives speed from successive writes, so the PSN tracker's speed is the puppet's real one; `velocityAt` is
 * the analytic value for status and tests.
 *
 * Safety (a forgotten puppet must not drive a real rig at a show): it is off at every server start (in-memory only,
 * nothing persisted), it switches itself off after `ttl_min` minutes, it is named "Puppet" on the desk, and it refuses
 * to take over a marker id that another source keeps live. Stopping removes its marker from the hub.
 *
 * HTTP (routed by register.js): GET /api/tracking/puppet → status · POST /api/tracking/puppet {enabled?, pattern?, x?,
 * y?, z?, size?, speed?, id?, name?, hz?, ttl_min?} → merged config, start / stop, status.
 */

const { JSON_HEADERS, parseBodyStrict } = require('../api/response')

const PATTERNS = ['hold', 'circle', 'figure8', 'line', 'walk']
const DEFAULTS = { pattern: 'circle', x: 0, y: 2, z: 1.7, size: 2, speed: 1, id: 1, name: 'Puppet', hz: 50, ttl_min: 120 }
const LIMITS = { x: [-50, 50], y: [-50, 50], z: [0, 5], size: [0.1, 20], speed: [0.05, 5], hz: [30, 60], ttl_min: [1, 720] }
const SEGMENTS = 720 // path polyline resolution (arc-length table)
const PATH = '/api/tracking/puppet'

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v))
const round = (v) => Math.round(v * 1e4) / 1e4

/** Raw config (or a partial update over `prev`) → a complete, clamped config. Unknown / bad values keep `prev`. */
function normalizeConfig(src = {}, prev = DEFAULTS) {
	const out = { ...DEFAULTS, ...prev }
	if (PATTERNS.includes(src.pattern)) out.pattern = src.pattern
	for (const k of Object.keys(LIMITS)) {
		const v = Number(src[k])
		if (src[k] != null && src[k] !== '' && Number.isFinite(v)) out[k] = round(clamp(v, LIMITS[k]))
	}
	out.hz = Math.round(out.hz)
	const id = Number(src.id)
	if (Number.isInteger(id) && id >= 1 && id <= 65535) out.id = id
	if (typeof src.name === 'string' && src.name.trim()) out.name = src.name.trim().slice(0, 32)
	return out
}

/** The pattern's closed path as a function of t ∈ [0, 1) → [dx, dy] around the centre (unit = size). */
function shape(pattern) {
	const TAU = Math.PI * 2
	switch (pattern) {
		case 'circle':
			return (t) => [Math.cos(TAU * t), Math.sin(TAU * t)]
		case 'figure8':
			return (t) => [Math.sin(TAU * t), Math.sin(TAU * t) * Math.cos(TAU * t)]
		case 'line':
			return (t) => [t < 0.5 ? -1 + 4 * t : 3 - 4 * t, 0]
		case 'walk': {
			const c = [[-1, -1], [-1, 1], [1, 1], [1, -1]] // downstage right → upstage right → upstage left → downstage left
			return (t) => {
				const k = Math.min(3, Math.floor(t * 4)), f = t * 4 - k
				const a = c[k], b = c[(k + 1) % 4]
				return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
			}
		}
		default:
			return () => [0, 0]
	}
}

/** Polyline + cumulative arc length of one lap (metres) for `pattern` at `size`. */
function buildPath(pattern, size) {
	const f = shape(pattern)
	const pts = []
	for (let i = 0; i <= SEGMENTS; i++) {
		const [u, v] = f(i / SEGMENTS === 1 ? 0 : i / SEGMENTS)
		pts.push([u * size, v * size])
	}
	const cum = [0]
	for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
	return { pts, cum, length: cum[cum.length - 1] }
}

/** Position (hub frame) and analytic velocity after `s` metres along the path of config `cfg` (`path` = buildPath). */
function sampleAt(cfg, path, s) {
	if (cfg.pattern === 'hold' || !(path.length > 0)) return { x: cfg.x, y: cfg.y, z: cfg.z, vx: 0, vy: 0, vz: 0 }
	const d = ((s % path.length) + path.length) % path.length
	let lo = 0, hi = path.cum.length - 1
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1
		if (path.cum[mid] <= d) lo = mid
		else hi = mid
	}
	const a = path.pts[lo], b = path.pts[hi]
	const seg = path.cum[hi] - path.cum[lo] || 1
	const f = (d - path.cum[lo]) / seg
	const dx = (b[0] - a[0]) / seg, dy = (b[1] - a[1]) / seg
	return { x: round(cfg.x + a[0] + (b[0] - a[0]) * f), y: round(cfg.y + a[1] + (b[1] - a[1]) * f), z: cfg.z,
		vx: round(dx * cfg.speed), vy: round(dy * cfg.speed), vz: 0 }
}

/**
 * @param {{ hub: import('./marker-hub').MarkerHub, now?: () => number, timers?: { setInterval: Function, clearInterval: Function },
 *           log?: Function, onWrite?: Function }} deps
 */
function createPuppet({ hub, now = Date.now, timers = { setInterval, clearInterval }, log = () => {}, onWrite = () => {} }) {
	let cfg = { ...DEFAULTS }
	let path = buildPath(cfg.pattern, cfg.size)
	let timer = null
	let s = 0 // metres travelled along the path
	let last = 0
	let startedAt = 0
	let ticks = 0
	let stopReason = null
	let pos = sampleAt(cfg, path, 0)

	const live = () => timer !== null

	function write() {
		const r = hub.set({ id: cfg.id, x: pos.x, y: pos.y, z: pos.z, name: cfg.name, source: 'puppet', status: 1 })
		if (r.ok) {
			ticks++
			onWrite()
		}
		return r
	}

	function tick() {
		const t = now()
		if (t - startedAt >= cfg.ttl_min * 60000) return stop('ttl')
		s += (cfg.speed * Math.max(0, t - last)) / 1000
		if (path.length > 0) s %= path.length
		last = t
		pos = sampleAt(cfg, path, s)
		write()
	}

	/** A marker id another source keeps live → its source name, else null. */
	function claimedBy(id) {
		const m = hub.list().find((q) => q.id === id)
		return m && !m.stale && m.source !== 'puppet' ? m.source : null
	}

	function start() {
		const other = claimedBy(cfg.id)
		if (other) return { ok: false, error: `marker ${cfg.id} is live from "${other}" — pick another puppet id` }
		if (timer) timers.clearInterval(timer)
		startedAt = last = now()
		stopReason = null
		pos = sampleAt(cfg, path, s)
		write()
		timer = timers.setInterval(tick, Math.round(1000 / cfg.hz))
		timer?.unref?.()
		log('info', `[puppet] ON — marker ${cfg.id} "${cfg.name}" ${cfg.pattern} at ${cfg.speed} m/s, ${cfg.hz} Hz (WO-978)`)
		return { ok: true }
	}

	function stop(reason = 'api') {
		if (!timer) return
		timers.clearInterval(timer)
		timer = null
		stopReason = reason
		hub.remove(cfg.id)
		onWrite()
		log('info', `[puppet] off (${reason}) — marker ${cfg.id} removed`)
	}

	/** Partial update (+ enabled) → { ok, error? }. A change while running restarts it with the new config. */
	function configure(body = {}) {
		const next = normalizeConfig(body, cfg)
		const was = live()
		const want = body.enabled == null ? was : body.enabled === true
		if (was && (next.id !== cfg.id || !want)) stop(want ? 'id change' : 'api')
		const shapeChanged = next.pattern !== cfg.pattern || next.size !== cfg.size
		cfg = next
		if (shapeChanged) {
			path = buildPath(cfg.pattern, cfg.size)
			s = 0
		}
		if (want && live() && timer) {
			timers.clearInterval(timer) // new rate / config: same lap position
			timer = timers.setInterval(tick, Math.round(1000 / cfg.hz))
			timer?.unref?.()
			return { ok: true }
		}
		return want ? start() : { ok: true }
	}

	function status() {
		const t = now()
		return { enabled: live(), ...cfg, patterns: PATTERNS, lap_m: round(path.length), position: pos, writes: ticks,
			started_at: live() ? new Date(startedAt).toISOString() : null,
			ends_in_s: live() ? Math.max(0, Math.round((startedAt + cfg.ttl_min * 60000 - t) / 1000)) : null,
			stopped: live() ? null : stopReason }
	}

	const reply = (code, obj) => ({ status: code, headers: JSON_HEADERS, body: JSON.stringify(obj) })

	/** Route: GET / POST /api/tracking/puppet → reply, anything else → null. */
	function handle(method, p, body) {
		if (p !== PATH) return null
		if (method === 'GET') return reply(200, status())
		if (method !== 'POST') return reply(405, { error: 'GET or POST' })
		const parsed = parseBodyStrict(body)
		if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) return reply(400, { error: 'body must be a JSON object' })
		const r = configure(parsed.value)
		return reply(r.ok ? 200 : 409, r.ok ? status() : { ...status(), error: r.error })
	}

	return { configure, start, stop, status, handle, tick, get live() { return live() } }
}

module.exports = { createPuppet, normalizeConfig, buildPath, sampleAt, PATTERNS, DEFAULTS, LIMITS }

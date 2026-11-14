/**
 * WO-1074 §2.6 — pure maths of the live stage effects (stage-fx.js): beam length to the floor, pool ellipse, smoothing,
 * LED wall strip geometry, the binary frame header. No three.js, no DOM — the smokes import this in node.
 * Frame: Godot / three.js (x stage left, y up, z towards the audience), metres.
 */

export const CAP_M = 25 // longest beam
export const SMOOTH_S = 0.08 // ≈ 80 ms: 10 Hz updates glide instead of stepping
export const SCREEN_OFFSET_M = 0.02 // the picture lies 2 cm in front of the baked wall body

/**
 * Where a beam from `o` along unit `d` first meets a floor below it (scene JSON `floors`: { y, rect [minX, minZ, maxX,
 * maxZ] }). No floors at all → the plane y = 0. → { len, hit: [x, y, z] | null } (len capped at CAP_M).
 */
export function floorHit(o, d, floors, cap = CAP_M) {
	const list = Array.isArray(floors) && floors.length ? floors : [{ y: 0, rect: null }]
	let best = cap
	let hit = null
	if (!(d[1] < -1e-4)) return { len: cap, hit: null }
	for (const f of list) {
		const y = Number(f?.y)
		if (!Number.isFinite(y) || y > o[1] - 0.05) continue
		const t = (o[1] - y) / -d[1]
		if (!(t > 0) || t >= best) continue
		const x = o[0] + d[0] * t
		const z = o[2] + d[2] * t
		const r = Array.isArray(f.rect) && f.rect.length === 4 ? f.rect : null
		if (r && (x < r[0] || x > r[2] || z < r[1] || z > r[3])) continue
		best = t
		hit = [x, y, z]
	}
	return { len: best, hit }
}

/** Half the beam angle in radians, clamped to what reads as a beam (1°…120° full). */
export function halfAngle(zoomDeg) {
	const z = Number.isFinite(zoomDeg) ? zoomDeg : 25
	return (Math.max(1, Math.min(120, z)) * Math.PI) / 360
}

/**
 * The pool a beam of length `len` and full angle `zoomDeg` lays on a horizontal floor: a disc of the cone's radius there,
 * stretched along the beam's horizontal heading by 1 / |dy| (at most 4×). → { r, major, minor, yaw } (yaw about +Y of
 * the major axis, three.js convention: a +X axis turned by yaw).
 */
export function poolShape(d, len, zoomDeg) {
	const r = Math.max(0.05, len * Math.tan(halfAngle(zoomDeg)))
	const dy = Math.max(0.25, Math.abs(d[1]))
	const h = Math.hypot(d[0], d[2])
	const major = h > 1e-4 ? Math.min(4 * r, r / dy) : r
	const yaw = h > 1e-4 ? Math.atan2(-d[2], d[0]) : 0
	return { r, major, minor: r, yaw }
}

/** Exponential smoothing factor for a step of `dt` seconds. */
export function smoothK(dt, tau = SMOOTH_S) {
	return dt > 0 ? 1 - Math.exp(-dt / tau) : 0
}

/** One light's smoothing step: cur ← tgt by k (direction renormalised). → true while it still moves. */
export function stepLight(cur, tgt, k) {
	let moving = false
	const go = (a, b) => {
		const v = a + (b - a) * k
		if (Math.abs(b - v) > 1e-3) moving = true
		return Math.abs(b - v) > 1e-4 ? v : b
	}
	for (let n = 0; n < 3; n++) {
		cur.d[n] = go(cur.d[n], tgt.d[n])
		cur.c[n] = go(cur.c[n], tgt.c[n])
	}
	const l = Math.hypot(cur.d[0], cur.d[1], cur.d[2]) || 1
	for (let n = 0; n < 3; n++) cur.d[n] /= l
	cur.a = go(cur.a, tgt.a)
	cur.z = go(cur.z, tgt.z)
	if (!moving) {
		// settled: land exactly on the target (a light faded out is exactly dark)
		for (let n = 0; n < 3; n++) ((cur.d[n] = tgt.d[n]), (cur.c[n] = tgt.c[n]))
		cur.a = tgt.a
		cur.z = tgt.z
	}
	return moving
}

/** An lx / lxfull entry [i, dx, dy, dz, r, g, b, a, zoom] → { i, d, c, a, z } or null when malformed. */
export function parseEntry(e) {
	if (!Array.isArray(e) || e.length < 9 || !e.every((x) => typeof x === 'number' && Number.isFinite(x))) return null
	const l = Math.hypot(e[1], e[2], e[3])
	return {
		i: e[0] | 0,
		d: l > 1e-6 ? [e[1] / l, e[2] / l, e[3] / l] : [0, -1, 0],
		c: [e[4], e[5], e[6]].map((x) => Math.max(0, Math.min(1, x))),
		a: Math.max(0, Math.min(1, e[7])),
		z: Math.max(0.5, Math.min(170, e[8])),
	}
}

/**
 * A binary game frame `[u8 n][n bytes role, ASCII][JPEG]` (Uint8Array / ArrayBuffer) → { role, jpeg: Uint8Array } or null.
 */
export function parseFrame(data) {
	const u8 = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : null
	if (!u8 || u8.length < 4) return null
	const n = u8[0]
	if (n < 1 || u8.length < 1 + n + 2) return null
	let role = ''
	for (let k = 1; k <= n; k++) role += String.fromCharCode(u8[k])
	if (!/^[A-Za-z0-9_-]{1,32}$/.test(role)) return null
	const jpeg = u8.subarray(1 + n)
	return jpeg[0] === 0xff && jpeg[1] === 0xd8 ? { role, jpeg } : null
}

/**
 * Column edges of a wall in its own XZ plane (godot stage_objects.gd column_edges): cols + 1 points left → right,
 * centred on x = 0; curveDeg = the angle between neighbouring panels, > 0 bends the ends towards +Z.
 */
export function columnEdges(cols, width, curveDeg) {
	const n = Math.max(1, Math.round(cols) || 1)
	const pw = width / n
	const c = ((Number(curveDeg) || 0) * Math.PI) / 180
	const out = []
	if (Math.abs(c) < 1e-6) {
		for (let j = 0; j <= n; j++) out.push([(j - n / 2) * pw, 0])
		return out
	}
	const r = pw / 2 / Math.sin(Math.abs(c) / 2)
	const sgn = Math.sign(c)
	for (let j = 0; j <= n; j++) {
		const phi = (j - n / 2) * Math.abs(c)
		out.push([r * Math.sin(phi), sgn * r * (1 - Math.cos(phi))])
	}
	return out
}

/**
 * The picture strip of one scene `screens` entry in the screen's own frame (origin = picture centre, facing +Z, pushed
 * SCREEN_OFFSET_M along each column's normal): { positions: Float32Array, uvs: Float32Array, indices: Uint16Array|Uint32Array }.
 * UVs map the screen's `uv` crop with v DOWN (the texture is uploaded with flipY false: v 0 = the picture's top row).
 */
export function screenStrip(s, offset = SCREEN_OFFSET_M) {
	const [w, h] = Array.isArray(s?.size) ? s.size : [1, 1]
	const uv = Array.isArray(s?.uv) && s.uv.length === 4 ? s.uv : [0, 0, 1, 1]
	const curved = Math.abs(Number(s?.curveDeg) || 0) > 1e-6
	const cols = curved ? Math.max(1, Math.min(200, Math.round(Number(s?.cols) || 1))) : 1
	const edges = columnEdges(cols, w, curved ? s.curveDeg : 0)
	const pos = []
	const uvs = []
	const idx = []
	for (let j = 0; j < cols; j++) {
		const [x0, z0] = edges[j]
		const [x1, z1] = edges[j + 1]
		const len = Math.hypot(x1 - x0, z1 - z0) || 1
		const nx = -(z1 - z0) / len
		const nz = (x1 - x0) / len
		const u0 = uv[0] + ((uv[2] - uv[0]) * j) / cols
		const u1 = uv[0] + ((uv[2] - uv[0]) * (j + 1)) / cols
		const base = pos.length / 3
		// top-left, top-right, bottom-right, bottom-left
		pos.push(x0 + nx * offset, h / 2, z0 + nz * offset, x1 + nx * offset, h / 2, z1 + nz * offset)
		pos.push(x1 + nx * offset, -h / 2, z1 + nz * offset, x0 + nx * offset, -h / 2, z0 + nz * offset)
		uvs.push(u0, uv[1], u1, uv[1], u1, uv[3], u0, uv[3])
		idx.push(base, base + 3, base + 2, base, base + 2, base + 1)
	}
	const n = pos.length / 3
	return {
		positions: new Float32Array(pos),
		uvs: new Float32Array(uvs),
		indices: n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
	}
}

/** Visual weights per light kind: cone gain (0 = no cone), lens glow size (m), pool gain. */
export function kindStyle(kind) {
	switch (kind) {
		case 'spot':
			return { cone: 1, glow: 0.4, pool: 1 }
		case 'bar':
			return { cone: 0, glow: 0.55, pool: 0.6 }
		case 'strobe':
			return { cone: 0, glow: 0.9, pool: 0.7 }
		default:
			return { cone: 0.6, glow: 0.5, pool: 0.8 }
	}
}

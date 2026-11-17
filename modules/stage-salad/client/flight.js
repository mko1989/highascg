/**
 * Stage Salad (WO-1089) — the flight model (work/notes/stage-salad-contract.md §5). Pure and deterministic, shared:
 * the server referee and its bots run it with the avatar test, the browser runs the same steps for its own prediction
 * and for everyone else's vegetables (venue only; the server's `end` says where a flight really stopped).
 *
 *   dirOf(yaw, pitch)                         unit launch direction (yaw 0 looks along −Z, pitch up)
 *   launches(veg, origin, yaw, pitch, power, seed) → [{ i, p, v }]   one per projectile (5 for the pea burst)
 *   createFlight(veg, launch) → flight state   ·   stepFlight(f, venue, opts) → advances DT, sets f.end when it ends
 *   simulate(veg, launch, venue, opts) → { k, p, t, tag, bounces, part?, tid?, path? }   a whole flight
 * Fixed step DT = 1/120 s, split into sub-steps of ≤ SUB_LEN m so nothing tunnels through a 12 cm LED wall.
 * `opts.hitTest(p0, p1, r, t)` (server): → { u (0…1 along the sub-step), part, tid, p } or null — the avatar.
 */
import { launchSpeed } from './veggies.js'

export const DT = 1 / 120
export const MAX_T = 4
export const GRAVITY = 9.81
export const FRICTION = 0.7 // tangential speed kept at a contact
export const REST_SPEED = 1.2 // m/s — slower after a contact = lying still
export const SUB_LEN = 0.06 // m — longest sub-step

const DEG = Math.PI / 180

export function dirOf(yaw, pitch) {
	const cp = Math.cos(pitch)
	return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp]
}

/** Seeded uniform 0…1 (the contract's mulberry32). */
export function mulberry32(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** Every projectile of one shot (yaw / pitch in radians). Peas get seeded offsets of ± spreadDeg each. */
export function launches(veg, origin, yaw, pitch, power, seed = 0) {
	const speed = launchSpeed(veg, power)
	const out = []
	const rnd = mulberry32(seed)
	for (let i = 0; i < (veg.n || 1); i++) {
		let y = yaw, p = pitch
		if (veg.n > 1) {
			const s = (veg.spreadDeg || 0) * DEG
			y += (rnd() * 2 - 1) * s
			p += (rnd() * 2 - 1) * s
		}
		const d = dirOf(y, p)
		out.push({ i, p: origin.slice(), v: d.map((c) => c * speed) })
	}
	return out
}

export function createFlight(veg, launch) {
	return { veg, i: launch.i || 0, p: launch.p.slice(), v: launch.v.slice(), t: 0, bounces: 0, end: null, lastTag: null, lastW: null }
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** Closest point of segment a–b to c. */
export function closestOnSegment(a, b, c) {
	const ab = sub(b, a)
	const L = dot(ab, ab)
	const t = L > 0 ? clamp(dot(sub(c, a), ab) / L, 0, 1) : 0
	return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]
}

function sphereContact(c, r, q, R) {
	const d = sub(c, q)
	const L = Math.hypot(d[0], d[1], d[2])
	if (!(L < r + R)) return null // WO-1106 B63: NaN (a broken collider / position) is no contact
	return L > 1e-9 ? { n: d.map((x) => x / L), depth: r + R - L } : { n: [0, 1, 0], depth: r + R }
}

/** Sphere (c, r) against an axis-aligned box in its own coordinates → { n, depth } | null. */
function boxLocal(l, r, h) {
	const q = [clamp(l[0], -h[0], h[0]), clamp(l[1], -h[1], h[1]), clamp(l[2], -h[2], h[2])]
	const inside = q[0] === l[0] && q[1] === l[1] && q[2] === l[2]
	if (!inside) return sphereContact(l, r, q, 0)
	let best = 0, depth = Infinity, sign = 1
	for (let k = 0; k < 3; k++) {
		const d = h[k] - Math.abs(l[k])
		if (d < depth) (depth = d), (best = k), (sign = l[k] >= 0 ? 1 : -1)
	}
	const n = [0, 0, 0]
	n[best] = sign
	return { n, depth: depth + r }
}

/** One collider vs a sphere → { n, depth } | null (WO-1106 B63: null unless depth and normal are finite). */
export function contact(col, c, r) {
	const k = contactOf(col, c, r)
	return k && Number.isFinite(k.depth) && k.n.every(Number.isFinite) ? k : null
}

function contactOf(col, c, r) {
	switch (col.k) {
		case 'plane': {
			const dist = dot(col.n, c) - col.d
			return dist < r ? { n: col.n, depth: r - dist } : null
		}
		case 'box': {
			const ctr = [(col.min[0] + col.max[0]) / 2, (col.min[1] + col.max[1]) / 2, (col.min[2] + col.max[2]) / 2]
			const h = [(col.max[0] - col.min[0]) / 2, (col.max[1] - col.min[1]) / 2, (col.max[2] - col.min[2]) / 2]
			return boxLocal(sub(c, ctr), r, h)
		}
		case 'obox': {
			const d = sub(c, col.c)
			const l = [dot(d, col.ax[0]), dot(d, col.ax[1]), dot(d, col.ax[2])]
			const k = boxLocal(l, r, col.h)
			if (!k) return null
			const n = [0, 1, 2].map((j) => col.ax[0][j] * k.n[0] + col.ax[1][j] * k.n[1] + col.ax[2][j] * k.n[2])
			return { n, depth: k.depth }
		}
		case 'cap':
			return sphereContact(c, r, closestOnSegment(col.a, col.b, c), col.r)
		case 'sph':
			return sphereContact(c, r, col.c, col.r)
		default:
			return null
	}
}

function inPlay(play, p) {
	return p[0] >= play.min[0] && p[0] <= play.max[0] && p[1] >= play.min[1] && p[1] <= play.max[1] && p[2] >= play.min[2] && p[2] <= play.max[2]
}

/**
 * Advance one DT. venue: { colliders, play }. opts.hitTest (avatar), opts.extra (more colliders, e.g. umbrellas:
 * entries with a `tag`). Sets f.end = { k: 'hit'|'land'|'out', p, t, tag?, part?, tid?, bounced } once.
 */
export function stepFlight(f, venue, opts = {}) {
	if (f.end) return f
	const veg = f.veg
	const speed0 = Math.hypot(f.v[0], f.v[1], f.v[2])
	if (!Number.isFinite(speed0) || !f.p.every(Number.isFinite) || !Number.isFinite(f.t)) {
		// WO-1106 B63: a NaN / infinite launch would never advance f.t (simulate() looping forever) — it ends here
		f.end = { k: 'out', p: f.p.map((x) => (Number.isFinite(x) ? x : 0)), t: Number.isFinite(f.t) ? f.t : 0, bounced: false }
		return f
	}
	const n = Math.max(1, Math.ceil((speed0 * DT) / SUB_LEN))
	const h = DT / n
	const cols = opts.extra && opts.extra.length ? venue.colliders.concat(opts.extra) : venue.colliders
	for (let s = 0; s < n; s++) {
		const sp = Math.hypot(f.v[0], f.v[1], f.v[2])
		const kd = veg.k * sp
		f.v[0] += -kd * f.v[0] * h
		f.v[1] += (-GRAVITY - kd * f.v[1]) * h
		f.v[2] += -kd * f.v[2] * h
		const p0 = f.p.slice()
		f.p[0] += f.v[0] * h
		f.p[1] += f.v[1] * h
		f.p[2] += f.v[2] * h
		f.t += h
		if (opts.hitTest) {
			const hit = opts.hitTest(p0, f.p, veg.r, f.t - h, h)
			if (hit) {
				f.p = hit.p.slice()
				f.end = { k: 'hit', p: hit.p.slice(), t: f.t - h + hit.u * h, part: hit.part, tid: hit.tid, bounced: f.bounces > 0 }
				return f
			}
		}
		let touched = null
		for (const col of cols) {
			const k = contact(col, f.p, veg.r)
			if (!k) continue
			f.p[0] += k.n[0] * k.depth
			f.p[1] += k.n[1] * k.depth
			f.p[2] += k.n[2] * k.depth
			const vn = dot(f.v, k.n)
			if (vn < 0) {
				for (let j = 0; j < 3; j++) f.v[j] = (f.v[j] - vn * k.n[j]) * FRICTION - veg.e * vn * k.n[j]
			}
			touched = touched || { col, n: k.n }
		}
		if (touched) {
			const fresh = touched.col.tag !== f.lastTag || f.lastContactT == null || f.t - f.lastContactT > 0.05
			f.lastTag = touched.col.tag
			f.lastW = touched.col.w ?? null // WO-1106 A2: the world hub's collider id — hub.contact finds its target by it
			f.lastContactT = f.t
			if (fresh) f.bounces++
			const surf = [f.p[0] - touched.n[0] * veg.r, f.p[1] - touched.n[1] * veg.r, f.p[2] - touched.n[2] * veg.r]
			const slow = Math.hypot(f.v[0], f.v[1], f.v[2]) < REST_SPEED
			if (veg.splat || f.bounces > veg.bounces || slow) {
				f.end = { k: 'land', p: surf, t: f.t, tag: touched.col.tag, n: touched.n, bounced: f.bounces > 1 }
				return f
			}
		}
		if (!inPlay(venue.play, f.p) || f.t >= MAX_T) {
			f.end = { k: 'out', p: f.p.slice(), t: f.t, bounced: f.bounces > 0 }
			return f
		}
	}
	return f
}

/** A whole flight. opts: hitTest, extra, record (keep every n-th step's position in `path`), maxT. */
export function simulate(veg, launch, venue, opts = {}) {
	const f = createFlight(veg, launch)
	const path = opts.record ? [f.p.slice()] : null
	const maxT = Math.min(MAX_T, opts.maxT ?? MAX_T)
	let k = 0
	while (!f.end && f.t < maxT - 1e-9) {
		stepFlight(f, venue, opts)
		if (path && ++k % opts.record === 0) path.push(f.p.slice())
	}
	const end = f.end || { k: 'open', p: f.p.slice(), t: f.t }
	if (path && f.end) path.push(end.p.slice())
	return { ...end, bounces: f.bounces, path, v: f.v.slice() }
}

/**
 * WO-1101 — the pure part of the Game World visitors (work/notes/game-world-contract.md §2): no three.js, no DOM, time
 * always passed in, so the node smokes test it directly.
 *
 *   toWorldMsg(m)            a raw message (JSON text or object) or an already decoded wst / wv → { t, d } | null
 *   createTrack(kind)        one visitor's snapshot buffer; pushSnap(track, ts, e) · sampleTrack(track, serverNow)
 *   fadeOf(track, serverNow) 1 → 0 for a flying VEGETABLE not updated for FADE_AFTER ms (every other kind is held)
 *   tierOf(q, view)          { q, cap, tags } of a quality tier; tagsFor(kind, tier, on)
 *   pickDrawn(list, cam, cap) the w of the visitors to draw (priority dist / weight, as the hub)
 *   cutMode(kind, bottomY, cutY)  'draw' | 'shadow' | 'clip' | 'hide' (Skirmish's cut-away)
 *   shadowRadius(h, size)    the floor shadow's radius: grows as the object comes down
 *   boundsOf(kind, sub, scale)  { cy, r } a visitor's bounding sphere in its own frame (camera-inside test)
 *   insideSphere(p, c, r)    the chase camera inside a cabbage → hide that visitor this frame
 */
import { decodeWst, decodeWv, encodeWv, WIRE_V } from './world-wire.js'

export const INTERP_MS = 100 // drawn this far behind the newest server time (as each game does natively)
export const VEG_EXTRAP_MS = 300 // a vegetable flies on ballistically this long past its last update, then holds
export const LIN_EXTRAP_MS = 200 // cars / soldiers / the avatar: short linear extrapolation (as RC's interp.js), then hold
export const FADE_AFTER_MS = 2000
export const FADE_MS = 500
export const G = 9.81
export const MAX_SNAPS = 8
export const SPLAT_LIFE_MS = 8000 // §6 R2: a slick patch lives 8 s
export const MOVING_EPS = 0.02 // m/s: slower than this counts as parked (not repeated by the hub → never faded)
export const WEIGHT = Object.freeze({ av: 6, veg: 4, car: 2, soldier: 2, splat: 1.5, sling: 1 })
export const CAPS = Object.freeze({ low: 6, medium: 12, high: 20, world: 80 })
export const SPLAT_CAP = 12
export const TAG_KINDS = Object.freeze(['car', 'soldier', 'sling'])
/** Real radii of the Salad vegetables (veggies.js r, m) — drawn VIS × this, as projectiles.js does. */
export const VEG_R = Object.freeze({ tomato: 0.045, potato: 0.05, carrot: 0.03, cabbage: 0.11, onion: 0.045, peas: 0.018 })
export const VEG_VIS = 1.6

const fin = (x) => typeof x === 'number' && Number.isFinite(x)
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))

/**
 * Anything a game may hand to visitors.ingest(): a JSON string, a raw `{ t: 'wst' | 'wv', v: 1, … }` or the result of
 * decodeWst / decodeWv. Everything is run through world-wire.js again, so nothing unsanitised gets in. Never throws.
 * @returns {{ t: 'wst' | 'wv', d: object } | null}
 */
export function toWorldMsg(m) {
	try {
		if (typeof m === 'string') {
			if (m.length > 65536) return null
			m = JSON.parse(m)
		}
		if (!m || typeof m !== 'object' || Array.isArray(m)) return null
		if (m.t === 'wst') {
			const d = decodeWst(m)
			return d ? { t: 'wst', d } : null
		}
		if (m.t === 'wv') {
			const d = decodeWv(m)
			return d ? { t: 'wv', d } : null
		}
		if (m.t !== undefined) return null
		if (typeof m.on === 'boolean') {
			const d = decodeWst({ ...m, t: 'wst', v: WIRE_V })
			return d ? { t: 'wst', d } : null
		}
		if (Array.isArray(m.add) || Array.isArray(m.e) || Array.isArray(m.gone) || Array.isArray(m.fx)) {
			const d = decodeWv({ ...encodeWv({ ts: fin(m.ts) ? m.ts : 0, add: arr(m.add), e: arr(m.e), gone: arr(m.gone), fx: arr(m.fx) }) })
			return d ? { t: 'wv', d } : null
		}
	} catch {
		/* malformed: dropped */
	}
	return null
}
const arr = (a) => (Array.isArray(a) ? a : [])

/* ---------------------------------------------------------------- snapshot buffers */

/** A visitor's buffer: the last MAX_SNAPS updates { ts, x, y, z, yaw, f, v: [vx, vy, vz] | null }. */
export function createTrack(kind) {
	return { kind, snaps: [], firstTs: null, lastTs: -Infinity, moving: false }
}

/** Add one clean `e` tuple at server time ts (older-than-newest is ignored; the same ts replaces). */
export function pushSnap(track, ts, e) {
	if (!Array.isArray(e) || !fin(ts)) return false
	const s = { ts, x: e[1], y: e[2], z: e[3], yaw: e[4], f: e[5] | 0, v: e.length >= 9 ? [e[6], e[7], e[8]] : null }
	const last = track.snaps[track.snaps.length - 1]
	if (last && ts < last.ts) return false
	if (last && ts === last.ts) track.snaps[track.snaps.length - 1] = s
	else track.snaps.push(s)
	if (track.snaps.length > MAX_SNAPS) track.snaps.shift()
	if (track.firstTs == null) track.firstTs = ts
	track.lastTs = ts
	track.moving = speedOf(track) > MOVING_EPS
	return true
}

/** Horizontal + vertical speed (m/s) of the newest data: the velocity for a vegetable, else the last two snapshots. */
export function speedOf(track) {
	const n = track.snaps.length
	if (!n) return 0
	const b = track.snaps[n - 1]
	if (b.v) return Math.hypot(b.v[0], b.v[1], b.v[2])
	if (n < 2) return 0
	const a = track.snaps[n - 2]
	const dt = (b.ts - a.ts) / 1000
	return dt > 0 ? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / dt : 0
}

/** Shortest-arc angle lerp. */
export function lerpAngle(a, b, t) {
	let d = b - a
	while (d > Math.PI) d -= 2 * Math.PI
	while (d < -Math.PI) d += 2 * Math.PI
	return a + d * t
}

/** A vegetable `ms` after snapshot s: ballistic from p, v (g 9.81), ms clamped to [0, VEG_EXTRAP_MS]. */
export function ballistic(s, ms) {
	const t = clamp(ms, 0, VEG_EXTRAP_MS) / 1000
	const v = s.v || [0, 0, 0]
	return [s.x + v[0] * t, s.y + v[1] * t - 0.5 * G * t * t, s.z + v[2] * t]
}

/**
 * The pose to draw at server time serverNow (render time = serverNow − INTERP_MS) → { x, y, z, yaw, f, extrap, held }
 * or null (no data yet). Vegetables: ballistic from the snapshot before the render time, its error to the next snapshot
 * blended out linearly; past the newest: ballistic ≤ VEG_EXTRAP_MS, then held. Others: lerp between snapshots, past the
 * newest a linear extrapolation ≤ LIN_EXTRAP_MS (sling / splat: none), then held.
 */
export function sampleTrack(track, serverNow, delay = INTERP_MS) {
	const sn = track.snaps
	const n = sn.length
	if (!n) return null
	const rt = serverNow - delay
	const veg = track.kind === 'veg'
	const last = sn[n - 1]
	if (rt <= sn[0].ts) return pose(sn[0], sn[0], false, false)
	if (rt >= last.ts) {
		const ms = rt - last.ts
		if (veg) {
			const p = ballistic(last, ms)
			return { x: p[0], y: p[1], z: p[2], yaw: last.yaw, f: last.f, extrap: ms > 0 && ms <= VEG_EXTRAP_MS, held: ms > VEG_EXTRAP_MS }
		}
		const lin = track.kind === 'car' || track.kind === 'soldier' || track.kind === 'av'
		if (!lin || n < 2 || ms <= 0) return pose(last, last, false, ms > 0)
		const a = sn[n - 2]
		const span = last.ts - a.ts
		if (span <= 0 || span > 1000) return pose(last, last, false, true)
		const k = Math.min(ms, LIN_EXTRAP_MS) / span
		return {
			x: last.x + (last.x - a.x) * k,
			y: last.y + (last.y - a.y) * k,
			z: last.z + (last.z - a.z) * k,
			yaw: lerpAngle(a.yaw, last.yaw, 1 + k),
			f: last.f,
			extrap: ms <= LIN_EXTRAP_MS,
			held: ms > LIN_EXTRAP_MS,
		}
	}
	let i = n - 2
	while (i > 0 && sn[i].ts > rt) i--
	const a = sn[i]
	const b = sn[i + 1]
	const t = (rt - a.ts) / (b.ts - a.ts || 1)
	if (veg && a.v) {
		const p = ballistic(a, rt - a.ts)
		const pb = ballistic(a, b.ts - a.ts)
		return {
			x: p[0] + (b.x - pb[0]) * t,
			y: p[1] + (b.y - pb[1]) * t,
			z: p[2] + (b.z - pb[2]) * t,
			yaw: lerpAngle(a.yaw, b.yaw, t),
			f: t < 0.5 ? a.f : b.f,
			extrap: false,
			held: false,
		}
	}
	return {
		x: a.x + (b.x - a.x) * t,
		y: a.y + (b.y - a.y) * t,
		z: a.z + (b.z - a.z) * t,
		yaw: lerpAngle(a.yaw, b.yaw, t),
		f: t < 0.5 ? a.f : b.f,
		extrap: false,
		held: false,
	}
}
const pose = (s, _b, extrap, held) => ({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, f: s.f, extrap, held })

/**
 * 1 (shown) … 0 (faded) — a vegetable whose last data says it was MOVING and that got no update for FADE_AFTER_MS fades
 * over FADE_MS. WO-1106 A1: the hub never repeats an unchanged entity (§1), so silence means unchanged — a car on a
 * countdown grid or a soldier in a lobby is held (whatever its last speed) until its `gone` or `wst` off.
 */
export function fadeOf(track, serverNow) {
	if (track.kind !== 'veg' || !track.moving || !fin(track.lastTs)) return 1
	const quiet = serverNow - track.lastTs
	if (quiet <= FADE_AFTER_MS) return 1
	return clamp(1 - (quiet - FADE_AFTER_MS) / FADE_MS, 0, 1)
}

/* ---------------------------------------------------------------- tiers, priority, cut */

/** 'low' | 'medium' | 'high' from anything a game calls its quality ('lo', 'med', 'hq', …; unknown → medium). */
export function normQuality(q) {
	const s = String(q || '').toLowerCase()
	if (s === 'low' || s === 'lo' || s === 'lq') return 'low'
	if (s === 'high' || s === 'hi' || s === 'hq' || s === 'ultra') return 'high'
	return 'medium'
}

/** The tier: cap of drawn visitors (the world spectator: 80) and whether tags are drawn at all. */
export function tierOf(q, view) {
	const nq = normQuality(q)
	return { q: nq, cap: view === 'world' ? CAPS.world : CAPS[nq], tags: nq !== 'low' }
}

/** A name tag for this kind at this tier (High / Medium, car / soldier / sling only, a name present, tags on). */
export function tagsFor(kind, tier, on = true, name = 'x') {
	return on !== false && tier.tags && TAG_KINDS.includes(kind) && !!name
}

/** The wq message for a tier (contract §1: Low 6, Medium 12, High 20). */
export const wqOf = (q) => ({ t: 'wq', n: CAPS[normQuality(q)] })

/**
 * Which visitors to draw: [{ w, kind, x, z }] → Set(w) of the `cap` with the lowest dist / weight (dist from the camera,
 * horizontal). Splats are not in this budget (SPLAT_CAP of their own).
 */
export function pickDrawn(list, cam, cap) {
	const cx = cam && fin(cam.x) ? cam.x : 0
	const cz = cam && fin(cam.z) ? cam.z : 0
	const scored = []
	for (const v of list) {
		const d = Math.hypot(v.x - cx, v.z - cz)
		scored.push([d / (WEIGHT[v.kind] || 1), v.w])
	}
	scored.sort((a, b) => a[0] - b[0] || a[1] - b[1])
	return new Set(scored.slice(0, Math.max(0, cap | 0)).map((s) => s[1]))
}

/**
 * Skirmish's cut-away (cutY = the cut height at the visitor's x, z, or null = no cut there):
 *   sling / av   → 'clip' (drawn with a clipping plane at cutY: only the base / feet show), 'draw' without a cut
 *   splat        → 'hide' when it lies above the cut (a table top), else 'draw'
 *   car / soldier / veg → 'shadow' when the object's bottom is above cutY (a shadow, + a ring for a veg), else 'draw'
 */
export function cutMode(kind, bottomY, cutY) {
	if (cutY == null || !fin(cutY)) return 'draw'
	if (kind === 'sling' || kind === 'av') return 'clip'
	if (!fin(bottomY) || bottomY <= cutY) return 'draw'
	return kind === 'splat' ? 'hide' : 'shadow'
}

/** The floor shadow of an object `h` m above the floor, `size` its radius: small high up, full size near the floor. */
export function shadowRadius(h, size) {
	const k = 1 - clamp((fin(h) ? h : 0) / 3, 0, 1)
	return Math.max(0.005, size * (0.6 + 1.4 * k))
}

/** Shadow opacity for the same height (fainter high up). */
export const shadowAlpha = (h) => 0.2 + 0.35 * (1 - clamp((fin(h) ? h : 0) / 3, 0, 1))

/** A visitor's bounding sphere in its own frame (origin = its wire `p`): { cy (centre height), r }. */
export function boundsOf(kind, sub, scale = 0.1) {
	const s = fin(scale) && scale > 0 ? scale : 0.1
	switch (kind) {
		case 'car':
			return { cy: 0.1 * 1.4 * s, r: 0.3 * 1.4 * s } // the 0.45 × 0.25 m buggy at VIS_SCALE 1.4 · s
		case 'soldier':
			return { cy: 0.28 * s, r: 0.32 * s } // H 0.55 u
		case 'veg': {
			const r = (VEG_R[sub] || VEG_R.tomato) * VEG_VIS
			return { cy: 0, r: sub === 'carrot' ? r * 3 : sub === 'peas' ? r * 3 : r * 1.15 }
		}
		case 'sling':
			return { cy: 0.8, r: 1.15 } // the 1.4 m Y-frame, its pallet and the crate beside it
		case 'av': {
			const h = fin(sub) && sub >= 100 && sub <= 250 ? sub / 100 : 1.75
			return { cy: h / 2, r: h * 0.55 }
		}
		default:
			return { cy: 0, r: 0.1 }
	}
}

/** Is point p inside the sphere (c, r)? (p, c: { x, y, z }) */
export function insideSphere(p, c, r) {
	if (!p || !c) return false
	return Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) < r
}

/** A splat entity's radius (m) from its `s` (mm); sane bounds. */
export const splatRadius = (s) => (fin(s) && s > 0 ? clamp(s / 1000, 0.01, 1.5) : 0.15)

/** The avatar's height (m) from its `s` (cm). */
export const avHeight = (s) => (fin(s) && s >= 100 && s <= 250 ? s / 100 : 1.75)

/** A slingshot's pull 0…1 from its `s` (pull × 100). */
export const slingPull = (s) => (fin(s) ? clamp(s / 100, 0, 1) : 0)

/** '#rrggbb' → [r, g, b] 0…255 (the Salad avatar's look traits). */
export function rgb255(c) {
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(c || ''))
	return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}

/** One slick patch for patches() from a splat visitor { p: {x,y,z}, s, f, firstTs }. Only flag 1 (slick) counts. */
export function patchOf(v) {
	if (!v || !(v.f & 1) || !v.p) return null
	return { x: v.p.x, y: v.p.y, z: v.p.z, r: splatRadius(v.s), until: (fin(v.firstTs) ? v.firstTs : 0) + SPLAT_LIFE_MS }
}

/** Splats to draw: the newest SPLAT_CAP (by first-seen order) of [{ w, order }]. */
export function pickSplats(list, cap = SPLAT_CAP) {
	return new Set([...list].sort((a, b) => b.order - a.order).slice(0, cap).map((s) => s.w))
}

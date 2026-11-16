/**
 * WO-1099 — house lights: the room's general light in the game world, a host SLIDER in all three games (`state.house`,
 * a level 0..1, default 1; a boolean from an older server = 1 / 0). Level 0 = a dark room lit only by the rig (stage-fx beams / pools / lens glows — additive, so they read on
 * the dark), the LED wall pictures and the games' own lights. The games' objects (cars, soldiers, slingshots, veggies,
 * projectiles, avatars) share the hemisphere + sun with the room, so the room is darkened on its OWN materials and the
 * two lights only drop to a readability floor: venue colours × HOUSE_VENUE (map / vertex colours included — they
 * multiply), every venue glow out (the scene GLB's emissive / emissiveMap: WO-1090 curtains, coffered ceiling,
 * chandeliers), lights × HOUSE_FLOOR, background near black. Lighting is linear and the screen sRGB: a linear 0.15 still
 * reads as ~42 % brightness (box screenshots), hence the room's extra factor — room ≈ 0.3 × 0.1 = 3 % linear (≈ 20 %
 * on screen: dark, the floor still faintly there), game objects 30 % linear (≈ 58 % on screen: readable).
 * Only the lights and the venue root handed in are touched (world.js: hemi + sun, world.statics = the scene GLB, the
 * ground plane, the plain arena) — never the rig, the walls or gameplay objects.
 * Pure (no three.js import): smokes drive it with stubs. Idempotent: the original values wait in userData and come back
 * exactly when the house is on again (world.js cheapMaterials builds its "low" Lambert copies from those originals).
 */

/** Share of today's hemisphere / sun light the dark room keeps: the readability floor of the games' objects. */
export const HOUSE_FLOOR = 0.3
/** The venue's own colours on top of that (the room ends at HOUSE_FLOOR × HOUSE_VENUE of today). */
export const HOUSE_VENUE = 0.1
/** The background / clear colour of the dark room (the lit one: world.js BG). */
export const HOUSE_BG_OFF = 0x030407

/** Perceptual exponent: lighting is linear, the screen sRGB, so 50 % reads about half as bright (0.5^2.2 ≈ 0.22 linear). */
export const HOUSE_GAMMA = 2.2

/** A server value (number 0..1, or a boolean of an older server) → a clamped level; anything else = lit. */
export function normHouse(v) {
	if (typeof v === 'boolean') return v ? 1 : 0
	if (typeof v === 'number' && !Number.isNaN(v)) return Math.min(1, Math.max(0, v))
	return 1
}

/** The linear weight of a level: 0 → 0, 1 → 1 exactly. */
export const houseCurve = (level) => Math.pow(normHouse(level), HOUSE_GAMMA)

/** 0xRRGGBB lerp per channel (t = 1 gives `b` exactly, t = 0 gives `a`). */
export function lerpHex(a, b, t) {
	if (t >= 1) return b
	if (t <= 0) return a
	const ch = (sh) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t)
	return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/**
 * The host slider's label click: lit → dark (remembering the level), dark → back to the last non-zero level (default 1).
 * @param {number} level current 0..1  @param {number} last last non-zero level before it went dark
 * @returns {{ level: number, last: number }}
 */
export function houseToggle(level, last = 1) {
	const cur = normHouse(level)
	if (cur > 0) return { level: 0, last: cur }
	return { level: last > 0 ? normHouse(last) : 1, last: last > 0 ? last : 1 }
}

/**
 * @param {{ lights?: Array<{ intensity: number, userData: object }>, venue?: { traverse: Function } | null,
 *   level?: number, on?: boolean, floor?: number, room?: number }} o  `on` (boolean) = level 1 / 0, for older callers
 */
export function applyHouse({ lights = [], venue = null, level, on = true, floor = HOUSE_FLOOR, room = HOUSE_VENUE } = {}) {
	const g = houseCurve(level === undefined ? on : level)
	const lk = g >= 1 ? 1 : floor + (1 - floor) * g
	const ck = g >= 1 ? 1 : room + (1 - room) * g
	for (const l of lights) {
		if (!l || !l.userData) continue
		if (!('houseBase' in l.userData)) l.userData.houseBase = l.intensity
		l.intensity = g >= 1 ? l.userData.houseBase : l.userData.houseBase * lk
	}
	venue?.traverse?.((o) => {
		if (!o.isMesh || !o.material) return
		for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
			if (!m || !m.userData) continue
			const u = m.userData
			if (m.color) {
				if (!('houseColor' in u)) u.houseColor = [m.color.r, m.color.g, m.color.b]
				m.color.r = u.houseColor[0] * ck
				m.color.g = u.houseColor[1] * ck
				m.color.b = u.houseColor[2] * ck
			}
			if (m.emissive) {
				if (!('houseGlow' in u)) u.houseGlow = m.emissiveIntensity ?? 1
				m.emissiveIntensity = g >= 1 ? u.houseGlow : u.houseGlow * g
			}
		}
	})
}

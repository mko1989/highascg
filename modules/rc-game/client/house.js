/**
 * WO-1099 — house lights: the room's general light in the game world, a host switch in all three games (`state.house`,
 * default on). Off = a dark room lit only by the rig (stage-fx beams / pools / lens glows — additive, so they read on
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

/**
 * @param {{ lights?: Array<{ intensity: number, userData: object }>, venue?: { traverse: Function } | null,
 *   on?: boolean, floor?: number, room?: number }} o
 */
export function applyHouse({ lights = [], venue = null, on = true, floor = HOUSE_FLOOR, room = HOUSE_VENUE } = {}) {
	for (const l of lights) {
		if (!l || !l.userData) continue
		if (!('houseBase' in l.userData)) l.userData.houseBase = l.intensity
		l.intensity = on ? l.userData.houseBase : l.userData.houseBase * floor
	}
	venue?.traverse?.((o) => {
		if (!o.isMesh || !o.material) return
		for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
			if (!m || !m.userData) continue
			const u = m.userData
			if (m.color) {
				if (!('houseColor' in u)) u.houseColor = [m.color.r, m.color.g, m.color.b]
				const k = on ? 1 : room
				m.color.r = u.houseColor[0] * k
				m.color.g = u.houseColor[1] * k
				m.color.b = u.houseColor[2] * k
			}
			if (m.emissive) {
				if (!('houseGlow' in u)) u.houseGlow = m.emissiveIntensity ?? 1
				m.emissiveIntensity = on ? u.houseGlow : 0
			}
		}
	})
}

/**
 * Toy scale (WO-1074, contract §3) — pure: THE one place the scene's `scale` becomes numbers. The room stays
 * life-size; the cars, the tracks and everything the game adds shrink by `scale` (the live scene sends 0.1; a scene
 * without `scale` is 1 = the v2 sizes). Rule: everything with a length scales (lengths, speeds, accelerations incl.
 * gravity), times, rates and angles do not — so a car at scale 0.1 drives exactly like the v2 car, ten times smaller.
 *
 * Consumers get the scale from the prepared track (`T.scale`, track-math.js prepareTrack) or the physics env
 * (`env.s`, `env.P` = physFor(s)); nothing else reads the scene's field.
 */
import { PHYS } from './phys-const.js'

/** PHYS keys that are lengths, speeds or accelerations (× scale). Every other key is a time, rate, angle or factor. */
export const PHYS_LENGTHS = Object.freeze([
	'TOP_ON',
	'TOP_OFF',
	'TOP_BOOST',
	'CAP',
	'REV_TOP',
	'ACCEL',
	'BOOST_ACCEL',
	'ACCEL_REV',
	'BRAKE',
	'COAST',
	'OVER_DECEL',
	'TURN_R',
	'DRIFT_MIN_V',
	'DRIFT_KEEP_V',
	'HOP_V',
	'HOP_MIN_V',
	'GRAVITY',
	'STICK',
	'VY_MAX',
	'LAND_V',
	'SPIN_DECEL',
	'CREEP_V',
	'RADIUS',
	'CAR_GAP',
	'CAR_H',
	'CAR_DY',
	'BUMP_KICK',
	'PROBE',
	'STEP_OUT',
	'PAD_LEN',
	'PAD_HALF_W',
	'PAD_DY',
	'UNSTICK_V',
	'UNSTICK_STEP',
	'UNSTICK_NEAR',
	'UNSTICK_FWD',
])

/** The scene's scale: a finite number in [0.01, 10], else 1 (missing / malformed = the v2 sizes). */
export function validScale(v) {
	const n = Number(v)
	if (v === null || v === undefined || v === '' || !Number.isFinite(n) || n <= 0) return 1
	return Math.min(10, Math.max(0.01, n))
}

/** Scale of a scene JSON (`scene.scale`). */
export function sceneScale(scene) {
	return validScale(scene?.scale)
}

const cache = new Map()

/** PHYS at scale s (frozen, cached; scale 1 → PHYS itself, so the v2 numbers stay bit-identical). */
export function physFor(s = 1) {
	const k = validScale(s)
	if (k === 1) return PHYS
	let P = cache.get(k)
	if (!P) {
		const o = { ...PHYS }
		for (const key of PHYS_LENGTHS) o[key] = PHYS[key] * k
		P = Object.freeze(o)
		cache.set(k, P)
	}
	return P
}

/** Wire precision: decimals that keep a speed / length at ≥ 3 significant digits at this scale (2 at scale 1). */
export function wireDecimals(base, s = 1) {
	const k = validScale(s)
	return k >= 1 ? base : base + Math.ceil(-Math.log10(k) - 1e-9)
}

/**
 * WO-1102 — Game World effects on this game's own car (work/notes/game-world-contract.md §6.2): the server's referee
 * decides, the car's own client (main loop or bot-brain.js) applies the physics here. Pure: no DOM, no clock — the
 * caller passes its own step. A game alone never receives an `xfx`, so nothing here ever runs then.
 *   applyWorldFx(car, m, P)    an `xfx` message for this car → true when it changed the car (soft: false, visual only)
 *   stepWorldFx(car, dt, P)    after every stepCar(): the wobble's steering jitter, the timers running down
 *   slickUnder(car, patches, sNow?)  R2: 1 when the car's centre is inside a slick splat (visitors.patches():
 *                              { x, y, z, r, until }), else 0; with sNow (server ms) a patch whose `until` is not after
 *                              it is over (WO-1106 A4: a stale patch never slows that spot for good)
 */
const HOP_MUL = 1.6 // × the drift hop's upward speed (P.HOP_V, toy scale already)
const HOP_KEEP = 0.6 // R1: speed × 0.6, steering kept
const BUMP_KEEP = 0.8 // R3: the car that bowled a soldier over
const WOBBLE_DEG = 8 // R4: steering jitter ± 8° for 0.25 s, speed × 0.95
const WOBBLE_KEEP = 0.95
const WOBBLE_HZ = 14
const MAX_DUR = 2

const dur = (m) => Math.max(0, Math.min(MAX_DUR, Number(m?.dur) || 0))

export function applyWorldFx(car, m, P) {
	if (!car || !m || m.soft) return false
	switch (m.k) {
		case 'hop':
			car.vx *= HOP_KEEP
			car.vz *= HOP_KEEP
			if (car.grounded) car.vy = Math.max(car.vy, (P?.HOP_V || 0.24) * HOP_MUL)
			car.grounded = false
			car.wfx = { k: 'hop', t: dur(m) }
			return true
		case 'bump':
			car.vx *= BUMP_KEEP
			car.vz *= BUMP_KEEP
			return true
		case 'boost':
			if (car.spin > 0) return false
			car.boost = Math.max(car.boost, dur(m) || 0.4)
			car.boostKind = car.boostKind || 'mini'
			return true
		case 'wobble':
			car.vx *= WOBBLE_KEEP
			car.vz *= WOBBLE_KEEP
			car.wfx = { k: 'wobble', t: dur(m) || 0.25, ph: 0 }
			return true
		default:
			return false
	}
}

export function stepWorldFx(car, dt) {
	const w = car?.wfx
	if (!w) return
	w.t -= dt
	if (w.k === 'wobble' && car.spin <= 0) {
		const before = w.ph
		w.ph += dt
		const j = (Math.sin(before * WOBBLE_HZ * 2 * Math.PI) - Math.sin(w.ph * WOBBLE_HZ * 2 * Math.PI)) * ((WOBBLE_DEG * Math.PI) / 180)
		car.yaw -= j
	}
	if (w.t <= 0) car.wfx = null
}

export function slickUnder(car, patches, sNow) {
	if (!car || !Array.isArray(patches)) return 0
	const live = Number.isFinite(sNow)
	for (const s of patches) {
		if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) continue
		if (live && Number.isFinite(s.until) && !(s.until > sNow)) continue
		const dx = car.x - s.x
		const dz = car.z - s.z
		if (dx * dx + dz * dz <= s.r * s.r && Math.abs(car.y - (s.y || 0)) < 0.2) return 1
	}
	return 0
}

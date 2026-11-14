/**
 * Arcade rules of the RC game (WO-1074, contract v2 §2.2–2.4) — pure: boosts, drift charge stages, start boost /
 * stall, spin-out + immunity + shield, catch-up by race position, and the `fx` bit flags others draw.
 */
import { PHYS } from './phys-const.js'

/** `fx` bit flags (contract §2.4). */
export const FX = Object.freeze({ BOOST: 1, DRIFT: 2, SPIN: 4, SHIELD: 8, AIR: 16 })

/** Flags of a car for `s` / drawing. */
export function fxFlags(car) {
	let f = 0
	if (car.boost > 0) f |= FX.BOOST
	if (car.drift) f |= FX.DRIFT
	if (car.spin > 0) f |= FX.SPIN
	if (car.shield > 0) f |= FX.SHIELD
	if (!car.grounded) f |= FX.AIR
	return f
}

/** Boost for `sec` seconds (never shortens a running one). */
export function giveBoost(car, sec, kind = 'boost') {
	if (car.spin > 0) return false
	car.boost = Math.max(car.boost, sec)
	car.boostKind = kind
	return true
}

/** Drift charge stage reached after `t` seconds of drifting: 0, 1 (0.7 s) or 2 (1.6 s). */
export function driftStage(t) {
	return t >= PHYS.DRIFT_T2 ? 2 : t >= PHYS.DRIFT_T1 ? 1 : 0
}

/** Mini-boost length for a released drift of `t` seconds (0 = none). */
export function miniBoostFor(t) {
	const st = driftStage(t)
	return st === 2 ? PHYS.MINI_2 : st === 1 ? PHYS.MINI_1 : 0
}

/**
 * Start launch: throttle press began at `pressAtMs` (server ms, null = not held at GO), lights out at `startAtMs`.
 * Within the last START_WINDOW s → 'boost'; earlier and still held → 'stall'; otherwise 'none'.
 */
export function launchResult(pressAtMs, startAtMs) {
	if (pressAtMs === null || pressAtMs === undefined || !Number.isFinite(pressAtMs) || !Number.isFinite(startAtMs))
		return 'none'
	const early = startAtMs - pressAtMs
	if (early < 0) return 'none'
	return early <= PHYS.START_WINDOW * 1000 ? 'boost' : 'stall'
}

export function applyLaunch(car, result) {
	if (result === 'boost') giveBoost(car, PHYS.START_BOOST, 'start')
	else if (result === 'stall') car.stall = PHYS.STALL
	return result
}

/** Catch-up: top speed + 0…8 % by race position (1 = leader gets nothing, last gets the most). */
export function catchupFor(pos, total) {
	if (!(total > 1) || !(pos > 1)) return 0
	return (PHYS.CATCHUP_MAX * Math.min(pos - 1, total - 1)) / (total - 1)
}

/**
 * Hit by an item. Immune or already spinning → 'immune'; a shield absorbs it → 'shield'; else the car spins out
 * (1.2 s, speed × 0.3, no control, then 2 s immunity) → 'spin'.
 */
export function spinOut(car) {
	if (car.immune > 0 || car.spin > 0) return 'immune'
	if (car.shield > 0) {
		car.shield = 0
		car.immune = 0.5
		return 'shield'
	}
	car.spin = PHYS.SPIN
	car.spinYaw = car.yaw - (car.slip || 0)
	car.vx *= PHYS.SPIN_KEEP
	car.vz *= PHYS.SPIN_KEEP
	car.drift = 0
	car.driftT = 0
	car.slip = 0
	car.boost = 0
	car.ev?.push({ k: 'spin' })
	return 'spin'
}

/** Visual nose angle during a spin: two whole turns, easing out, ending exactly where it started. */
export function spinAngle(remaining) {
	const p = Math.max(0, Math.min(1, 1 - remaining / PHYS.SPIN))
	return 4 * Math.PI * (1 - (1 - p) * (1 - p))
}

/** Shield on (8 s). */
export function giveShield(car) {
	car.shield = PHYS.SHIELD
}

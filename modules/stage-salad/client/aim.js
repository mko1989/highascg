/**
 * Stage Salad (WO-1089) — the aim solver (pure, shared): the server's bots aim with it (salad-bots.js adds their
 * humanlike error, contract §10) and the client's 127.0.0.1 dev hook uses it for scripted shots.
 *
 *   solveAim(veg, origin, target, opts) → { yaw, pitch, power, t } | null
 * Free flight (flight.js without colliders): yaw straight at the target, the vegetable's own pitch first (then steeper
 * ones), power bisected so the arc passes the target's height where it reaches the target's horizontal distance.
 * opts.vel [vx, vz] m/s: lead a walking target by the flight time (two passes).
 */
import { createFlight, stepFlight, dirOf } from './flight.js'
import { launchSpeed, POWER_MIN, POWER_MAX } from './veggies.js'

const DEG = Math.PI / 180
const OPEN = { colliders: [], play: { min: [-1e4, -1e4, -1e4], max: [1e4, 1e4, 1e4] } }

/** Height of the arc where it has travelled `d` m horizontally, and when (null = it fell 3 m below first). */
function heightAt(veg, origin, yaw, pitch, power, d) {
	const v = dirOf(yaw, pitch).map((c) => c * launchSpeed(veg, power))
	const f = createFlight(veg, { p: origin, v })
	let prev = { h: 0, y: origin[1], t: 0 }
	while (f.t < 4) {
		stepFlight(f, OPEN)
		const h = Math.hypot(f.p[0] - origin[0], f.p[2] - origin[2])
		if (h >= d) {
			const u = (d - prev.h) / Math.max(1e-9, h - prev.h)
			return { y: prev.y + (f.p[1] - prev.y) * u, t: prev.t + (f.t - prev.t) * u }
		}
		if (f.p[1] < origin[1] - 3 - d * 0.5) return null
		prev = { h, y: f.p[1], t: f.t }
	}
	return null
}

function solveStill(veg, origin, target) {
	const dx = target[0] - origin[0], dz = target[2] - origin[2]
	const d = Math.hypot(dx, dz)
	const yaw = Math.atan2(-dx, -dz)
	for (const extra of [0, 8, 16, 24, -6]) {
		const pitch = (veg.pitch + extra) * DEG
		const hi = heightAt(veg, origin, yaw, pitch, POWER_MAX, d)
		if (!hi || hi.y < target[1]) continue
		let lo = POWER_MIN, up = POWER_MAX, best = { p: POWER_MAX, t: hi.t }
		const low = heightAt(veg, origin, yaw, pitch, POWER_MIN, d)
		if (low && low.y >= target[1]) continue // even the softest shot flies over: try another pitch
		for (let k = 0; k < 22; k++) {
			const mid = (lo + up) / 2
			const r = heightAt(veg, origin, yaw, pitch, mid, d)
			if (r && r.y >= target[1]) (up = mid), (best = { p: mid, t: r.t })
			else lo = mid
		}
		return { yaw, pitch, power: best.p, t: best.t }
	}
	return null
}

export function solveAim(veg, origin, target, opts = {}) {
	let aim = solveStill(veg, origin, target)
	const vel = opts.vel
	if (!aim || !vel || !(Math.abs(vel[0]) + Math.abs(vel[1]) > 0)) return aim
	for (let pass = 0; pass < 2 && aim; pass++) {
		const lead = [target[0] + vel[0] * aim.t, target[1], target[2] + vel[1] * aim.t]
		aim = solveStill(veg, origin, lead) || aim
	}
	return aim
}

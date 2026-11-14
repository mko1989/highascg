/**
 * Camera maths (WO-1074) — pure: returns eye / target points (+ a field-of-view kick), the renderer applies them.
 * - chase: behind and above the car, looking ahead of it (further ahead and wider at speed / boost);
 * - top: high above the car, looking straight down (north = −Z up on screen);
 * - Director (spectator): follows the leader, cuts every few seconds to an overview, another car or a trackside shot,
 *   and jumps on the action — a car in the air or hit by an item gets the camera (notify()). §3.1: a car in a tunnel
 *   (tunnelAt) is watched from the tunnel's exit portal, or by the chase camera (which stays under the tube's ceiling).
 */
import { pointAt } from './track-math.js'
import { portalShot } from './tunnel.js'

export const FOV = 62
export const FOV_BOOST = 74

function damp(cur, target, rate, dt) {
	const k = 1 - Math.exp(-rate * dt)
	return cur + (target - cur) * k
}

/** The chase eye keeps this far under a deck overhead (§2.7: driving under a bridge). */
export const CEIL_GAP = 0.15

/**
 * Ideal chase pose for a car ({x, y, z, yaw}; yaw = the direction to look along, e.g. the travel heading).
 * ceilAt(x, z, y) (optional, physics ceilingOf): the underside of a deck overhead — the eye stays CEIL_GAP under it,
 * checked above the car and above the eye (a car under a bridge never gets a camera inside the slab).
 * §3 toy scale s: every distance and height × s, the speed read as speed / s (a toy at 1.3 m/s frames like v2's 13).
 * blockedAt(x, z, y) (optional, physics eyeBlockedOf): a table leg / wall cell of the occupancy grid — the eye is
 * pulled in along the car → eye line to just before the first blocked sample (never through a leg).
 */
export function chaseTarget(car, speed = 0, ceilAt = null, s = 1, blockedAt = null) {
	const fx = -Math.sin(car.yaw)
	const fz = -Math.cos(car.yaw)
	const v = speed / s
	const sp = Math.min(Math.abs(v), 24)
	let back = (2.1 + sp * 0.05) * s
	const ahead = (1.6 + Math.max(0, v) * 0.14) * s
	if (blockedAt) {
		for (let k = 1; k <= EYE_SAMPLES; k++) {
			const f = k / EYE_SAMPLES
			if (!blockedAt(car.x - fx * back * f, car.z - fz * back * f, car.y)) continue
			back *= Math.max(EYE_MIN_BACK, (k - 1) / EYE_SAMPLES)
			break
		}
	}
	const ex = car.x - fx * back
	const ez = car.z - fz * back
	let ey = car.y + (0.95 + sp * 0.02) * s
	let eyeMax = Infinity
	if (ceilAt) {
		eyeMax = Math.max(car.y + 0.35 * s, Math.min(ceilAt(car.x, car.z, car.y), ceilAt(ex, ez, car.y)) - CEIL_GAP * s)
		ey = Math.min(ey, eyeMax)
	}
	return {
		eye: [ex, ey, ez],
		target: [car.x + fx * ahead, car.y + 0.3 * s, car.z + fz * ahead],
		eyeMax, // smoothCam never lifts the eye above it (no lag into the slab)
	}
}

/** Chase-eye pull-in: samples along the car → eye line, and the shortest pull (fraction of the full distance). */
const EYE_SAMPLES = 8
const EYE_MIN_BACK = 0.3 // ≈ 0.6 m · s: still behind the (1.4× drawn) car

export function topTarget(car, height = 9, s = 1) {
	return { eye: [car.x, car.y + height, car.z + 0.01 * s], target: [car.x, car.y, car.z] }
}

/** Field of view for a speed: 62° up to the normal top, widening to 74° at boost speed (speed / s at toy scale). */
export function fovFor(speed, boosting = false, s = 1) {
	const k = Math.max(0, Math.min(1, (Math.abs(speed / s) - 12) / 6))
	return FOV + (FOV_BOOST - FOV) * Math.max(k, boosting ? 0.6 : 0)
}

/**
 * Smoothly move `cur` ({eye,target}) towards `want`; snaps when farther than `snap` (respawn / first frame; × scale at
 * toy scale); never above want.eyeMax.
 */
export function smoothCam(cur, want, dt, rate = 6, snap = 10) {
	if (!cur || Math.hypot(cur.eye[0] - want.eye[0], cur.eye[1] - want.eye[1], cur.eye[2] - want.eye[2]) > snap) {
		return { eye: [...want.eye], target: [...want.target] }
	}
	const eye = cur.eye.map((v, i) => damp(v, want.eye[i], i === 1 ? rate * 0.8 : rate, dt))
	if (Number.isFinite(want.eyeMax)) eye[1] = Math.min(eye[1], want.eyeMax)
	return { eye, target: cur.target.map((v, i) => damp(v, want.target[i], rate * 1.6, dt)) }
}

/** Small deterministic PRNG (mulberry32) so the director is testable. */
export function rng(seed = 1) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** Overview of a whole track: centre of its box, high and a little towards the audience. */
export function overviewTarget(T) {
	const b = T.box
	const cx = (b.minX + b.maxX) / 2
	const cz = (b.minZ + b.maxZ) / 2
	const y = Number.isFinite(b.minY) ? b.minY : T.y || 0
	const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 6)
	return { eye: [cx, y + span * 0.6, cz + span * 0.7], target: [cx, y, cz] }
}

export const SHOTS = ['leader', 'overview', 'car', 'trackside', 'action']

export class Director {
	constructor(seed = 7) {
		this.rand = rng(seed)
		/** §2.7: (x, z, y) → the deck underside overhead (physics ceilingOf); set by the game once the env exists */
		this.ceilAt = null
		/** §3: (x, z, y) → the chase eye stands in a blocked occupancy cell (physics eyeBlockedOf) */
		this.blockedAt = null
		/** §3.1: (x, z, y) → the tunnel a car is in ({ tube }, physics tunnelOf) or null */
		this.tunnelAt = null
		this.shot = 'overview'
		this.carId = null
		this.until = 0
		this.side = null
		this.cur = null
		this.cutAt = -Infinity
		this.hot = null
	}

	/** Something worth watching: kind 'jump' | 'hit' | 'pulse' for car `id` at time t (s). Hits beat jumps. */
	notify(kind, id, t) {
		if (id === null || id === undefined) return
		const prio = kind === 'jump' ? 1 : 2
		if (this.hot && t - this.hot.t < 1 && this.hot.prio > prio) return
		this.hot = { kind, id, t, prio }
	}

	_sideOf(T, c, ahead = 5) {
		const s = T.scale ?? 1
		const fx = -Math.sin(c.yaw)
		const fz = -Math.cos(c.yaw)
		const a = ahead * s
		/* §3: the side camera never stands in a table leg / wall cell — try the right, the left, then closer in;
		   all blocked → null (the shot falls back to the chase camera, which pulls in by itself) */
		for (const off of [T.half + 2 * s, -(T.half + 2 * s), T.half + 0.5 * s, -(T.half + 0.5 * s)]) {
			const side = [c.x + fx * a + fz * off, c.y + 1.3 * s, c.z + fz * a - fx * off]
			if (!Number.isFinite(side[0])) {
				const near = pointAt(T, 0)
				return [near.x, near.y + 1.5 * s, near.z]
			}
			if (!this.blockedAt?.(side[0], side[2], c.y)) return side
		}
		return null
	}

	/**
	 * @param {number} t seconds
	 * @param {object} T prepared track
	 * @param {any[]} order car ids in race order
	 * @param {(id: any) => ({x:number,y:number,z:number,yaw:number,v:number}|null)} carOf
	 */
	pick(t, T, order, carOf) {
		const h = this.hot
		if (h && t - h.t < 1.2 && t - this.cutAt >= 1.5 && carOf(h.id) && !(this.shot === 'action' && this.carId === h.id)) {
			this.hot = null
			this.shot = 'action'
			this.carId = h.id
			this.side = h.kind === 'jump' ? this._sideOf(T, carOf(h.id), 4) : null
			this.until = t + 3
			return
		}
		if (t < this.until && (this.shot === 'overview' || carOf(this.carId))) return
		const r = this.rand()
		const ids = order.filter((id) => carOf(id))
		if (!ids.length) {
			this.shot = 'overview'
			this.until = t + 6
			return
		}
		if (r < 0.45) {
			this.shot = 'leader'
			this.carId = ids[0]
		} else if (r < 0.6) this.shot = 'overview'
		else if (r < 0.8) {
			this.shot = 'car'
			this.carId = ids[Math.floor(this.rand() * ids.length)]
		} else {
			this.shot = 'trackside'
			this.carId = ids[Math.floor(this.rand() * Math.min(3, ids.length))]
			this.side = this._sideOf(T, carOf(this.carId))
		}
		this.until = t + 4 + this.rand() * 3
	}

	/** Camera pose for this frame. */
	update(t, dt, T, order, carOf) {
		this.pick(t, T, order, carOf)
		if (this.shot === 'leader' && order.length && carOf(order[0])) this.carId = order[0]
		const c = this.carId !== null ? carOf(this.carId) : null
		const s = T.scale ?? 1
		let want
		/* §3.1: a car in a tunnel is hidden from overview / trackside angles — look in from the exit portal instead
		   (its name tag stays visible through the table: car-model.js nameTag draws without a depth test) */
		const lead = c || (order.length ? carOf(order[0]) : null)
		const tn =
			lead && this.tunnelAt && this.shot !== 'leader' && this.shot !== 'car' ? this.tunnelAt(lead.x, lead.z, lead.y) : null
		if (tn) want = { eye: portalShot(tn.tube, s).eye, target: [lead.x, lead.y + 0.2 * s, lead.z] }
		else if (this.shot === 'overview' || !c) want = overviewTarget(T)
		else if ((this.shot === 'trackside' || this.shot === 'action') && this.side)
			want = { eye: this.side, target: [c.x, c.y + 0.2 * s, c.z] }
		else {
			want = chaseTarget(c, c.v, this.ceilAt, s, this.blockedAt)
			/* a bit higher and further back than the player's chase cam: a TV angle (still under a deck overhead) */
			want.eye[1] = Math.min(want.eye[1] + (this.shot === 'action' ? 0.2 : 0.6) * s, want.eyeMax)
		}
		const cut = this._lastShot !== this.shot || this._lastId !== this.carId
		if (cut) this.cutAt = t
		this._lastShot = this.shot
		this._lastId = this.carId
		this.cur = cut ? { eye: [...want.eye], target: [...want.target] } : smoothCam(this.cur, want, dt, 4, 10 * s)
		return this.cur
	}
}

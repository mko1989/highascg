/**
 * Camera maths (WO-1074) — pure: returns eye / target points, the renderer applies them.
 * - chase: behind and above the car, looking ahead of it (further ahead at speed), exponentially smoothed;
 * - top: high above the car, looking straight down (north = −Z up on screen);
 * - Director (spectator): follows the leader, cuts every few seconds to an overview, another car or a trackside shot.
 */
import { pointAt } from './track-math.js'

function damp(cur, target, rate, dt) {
	const k = 1 - Math.exp(-rate * dt)
	return cur + (target - cur) * k
}

/** Ideal chase pose for a car. */
export function chaseTarget(car, speed = 0) {
	const fx = -Math.sin(car.yaw)
	const fz = -Math.cos(car.yaw)
	const back = 1.25 + Math.min(Math.abs(speed), 12) * 0.05
	const ahead = 0.8 + Math.max(0, speed) * 0.12
	return {
		eye: [car.x - fx * back, car.y + 0.55 + Math.abs(speed) * 0.015, car.z - fz * back],
		target: [car.x + fx * ahead, car.y + 0.12, car.z + fz * ahead],
	}
}

export function topTarget(car, height = 9) {
	return { eye: [car.x, car.y + height, car.z + 0.01], target: [car.x, car.y, car.z] }
}

/** Smoothly move `cur` ({eye,target}) towards `want`; snaps when far (respawn / first frame). */
export function smoothCam(cur, want, dt, rate = 6) {
	if (!cur || Math.hypot(cur.eye[0] - want.eye[0], cur.eye[2] - want.eye[2]) > 8) {
		return { eye: [...want.eye], target: [...want.target] }
	}
	return {
		eye: cur.eye.map((v, i) => damp(v, want.eye[i], rate, dt)),
		target: cur.target.map((v, i) => damp(v, want.target[i], rate * 1.6, dt)),
	}
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
	const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 6)
	return { eye: [cx, T.y + span * 0.75, cz + span * 0.75], target: [cx, T.y, cz] }
}

export const SHOTS = ['leader', 'overview', 'car', 'trackside']

export class Director {
	constructor(seed = 7) {
		this.rand = rng(seed)
		this.shot = 'overview'
		this.carId = null
		this.until = 0
		this.side = null
		this.cur = null
	}

	/**
	 * @param {number} t seconds
	 * @param {object} T prepared track
	 * @param {any[]} order car ids in race order
	 * @param {(id: any) => ({x:number,y:number,z:number,yaw:number,v:number}|null)} carOf
	 */
	pick(t, T, order, carOf) {
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
		} else if (r < 0.62) this.shot = 'overview'
		else if (r < 0.82) {
			this.shot = 'car'
			this.carId = ids[Math.floor(this.rand() * ids.length)]
		} else {
			this.shot = 'trackside'
			this.carId = ids[Math.floor(this.rand() * Math.min(3, ids.length))]
			const c = carOf(this.carId)
			/* a fixed point a few metres ahead of the car, beside the track */
			const near = pointAt(T, 0)
			const fx = -Math.sin(c.yaw)
			const fz = -Math.cos(c.yaw)
			this.side = [c.x + fx * 5 + fz * (T.half + 1.2), T.y + 0.9, c.z + fz * 5 - fx * (T.half + 1.2)]
			if (!Number.isFinite(this.side[0])) this.side = [near.x, T.y + 1, near.z]
		}
		this.until = t + 4 + this.rand() * 3
	}

	/** Camera pose for this frame. */
	update(t, dt, T, order, carOf) {
		this.pick(t, T, order, carOf)
		if (this.shot === 'leader' && order.length && carOf(order[0])) this.carId = order[0]
		const c = this.carId != null ? carOf(this.carId) : null
		let want
		if (this.shot === 'overview' || !c) want = overviewTarget(T)
		else if (this.shot === 'trackside') want = { eye: this.side, target: [c.x, c.y + 0.1, c.z] }
		else {
			want = chaseTarget(c, c.v)
			/* a bit higher and further back than the player's chase cam: a TV angle */
			want.eye[1] += 0.5
		}
		const cut = this._lastShot !== this.shot || this._lastId !== this.carId
		this._lastShot = this.shot
		this._lastId = this.carId
		this.cur = cut ? { eye: [...want.eye], target: [...want.target] } : smoothCam(this.cur, want, dt, 4)
		return this.cur
	}
}

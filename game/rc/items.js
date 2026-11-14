/**
 * Items of the RC game (WO-1074, contract v2 §2.3 / §2.4) — pure state machine, node-testable with a fake socket:
 * item boxes (taken until a server time), the 1 s roulette after a claim, the held item and Use, hazards (slick puddles
 * and rockets) with own-car hit tests, and the pulse radius check. Times are SERVER ms (the existing clock sync).
 *
 * Flow: drive through an available box → `box` (once; no claim while holding or rolling, so the box stays for others)
 * → server `box` {by: me} starts the roulette → server `item` names the result → the slot shows it 1 s after the
 * roulette started → Use sends `use` and applies turbo / shield locally at once (slick / rocket / pulse come back from
 * the server as `haz` / `fx` for everyone, the user included).
 */
import { boxMsg, useMsg, hitHazMsg, hitByMsg, decodeHaz, decodeBoxes, ITEM_KINDS } from './protocol.js'
import { rocketPath, rocketPose } from './rocket.js'
import { giveBoost, giveShield } from './drive-rules.js'
import { PHYS } from './phys-const.js'

export const ROULETTE_MS = 1000
export const BOX_RESPAWN_MS = 6000
export const BOX_R = 1.1 // plan distance car centre ↔ box centre for a pickup
export const SLICK_R = 1.0 // puddle radius (ours; the contract gives none)
export const ROCKET_R = 1.2
export const ROCKET_SAFE_MS = 500 // the owner is not hit by its own rocket in its first 0.5 s
export const OWN_SLICK_SAFE_MS = 1000 // nor by its own fresh puddle (in case it lands under the car)
export const PULSE_R = 7
export const PENDING_MS = 1500 // an unanswered claim may be retried after this
export const ROLL_GIVEUP_MS = 4000 // a claim the server never answered with an `item`
export const SLICK_BACK = 1.6 // the puddle is dropped this far behind the car
export const ROCKET_AHEAD = 0.8 // the rocket starts this far ahead of the car

export const ITEM_NAMES = Object.freeze({
	turbo: 'Turbo',
	slick: 'Slick',
	rocket: 'Rocket',
	pulse: 'Pulse',
	shield: 'Shield',
})

export class ItemState {
	constructor() {
		this.reset()
	}

	reset() {
		/** @type {Map<any, number>} box id → taken until (server ms) */
		this.boxes = new Map()
		/** @type {Map<any, number>} box id → when I claimed it */
		this.pending = new Map()
		/** @type {Map<any, object>} hid → hazard (+ cached rocket path) */
		this.hazards = new Map()
		this.held = null
		this.rollStart = null
		this.rollItem = null
		this.hitSent = new Set()
		this.trackKey = null
	}

	get rolling() {
		return this.rollStart !== null
	}

	/** welcome / state `boxes` (replaces). */
	setBoxes(list) {
		this.boxes = new Map(decodeBoxes(list))
		this.pending.clear()
	}

	/** welcome / state `hazards` (replaces). */
	setHazards(list) {
		this.hazards.clear()
		for (const h of Array.isArray(list) ? list : []) this.addHaz(decodeHaz(h))
	}

	addHaz(h) {
		if (h) this.hazards.set(h.hid, { ...h, path: null })
	}

	removeHaz(hid) {
		this.hazards.delete(hid)
	}

	boxTaken(id, now) {
		const u = this.boxes.get(id)
		return u !== undefined && u > now
	}

	/** Server `box`: gone until m.until; my claim won → the roulette starts. Returns true when it was mine. */
	onBox(m, meId, now) {
		this.boxes.set(m.id, m.until)
		this.pending.delete(m.id)
		const mine = meId !== null && meId !== undefined && m.by === meId
		if (mine && !this.held && this.rollStart === null) this.rollStart = now
		return mine
	}

	/** Server `item` (to the claimer only). */
	onItem(m, now) {
		if (!ITEM_KINDS.includes(m.item) || this.held) return false
		this.rollItem = m.item
		if (this.rollStart === null) this.rollStart = now
		return true
	}

	/** Advance the roulette; returns the item the moment it lands in the slot, else null. */
	tick(now) {
		if (this.rollStart === null) return null
		if (this.rollItem && now - this.rollStart >= ROULETTE_MS) {
			this.held = this.rollItem
			this.rollItem = null
			this.rollStart = null
			return this.held
		}
		if (!this.rollItem && now - this.rollStart > ROLL_GIVEUP_MS) this.rollStart = null
		return null
	}

	/** Drive-through test against the track's boxes → a `box` message for the nearest one in reach, or null. */
	pickup(T, car, now) {
		if (!T || this.held || this.rollStart !== null) return null
		/* one claim in flight at a time: the server answers it (box + item) within a round trip */
		for (const at of this.pending.values()) if (now - at < PENDING_MS) return null
		let best = null
		let bestD = BOX_R
		for (const b of T.boxes || []) {
			if (this.boxTaken(b.id, now)) continue
			const d = Math.hypot(car.x - b.x, car.z - b.z)
			if (d > bestD || Math.abs(car.y + 0.25 - b.y) > 1.2) continue
			best = b
			bestD = d
		}
		if (!best) return null
		this.pending.set(best.id, now)
		return boxMsg(best.id)
	}

	/** Use the held item → { msg, item } (the slot empties), or null. */
	use(car) {
		const item = this.held
		if (!item || this.rollStart !== null) return null
		this.held = null
		const fx = -Math.sin(car.yaw)
		const fz = -Math.cos(car.yaw)
		let p = [car.x, car.y, car.z]
		if (item === 'slick') p = [car.x - fx * SLICK_BACK, car.y, car.z - fz * SLICK_BACK]
		else if (item === 'rocket') p = [car.x + fx * ROCKET_AHEAD, car.y, car.z + fz * ROCKET_AHEAD]
		return { msg: useMsg(item, p, car.yaw), item }
	}

	/** Rocket pose with the launch path cached per hazard (and per track). */
	rocketOf(T, h, now) {
		const key = T?.id ?? ''
		if (this.trackKey !== key) {
			this.trackKey = key
			for (const x of this.hazards.values()) x.path = null
		}
		if (!h.path) h.path = rocketPath(T, h)
		return rocketPose(T, h, now, h.path)
	}

	/**
	 * Own-car hazard test → the hid that hit me (reported once), or null. Spinning / immune cars are not tested.
	 * @param {object} car physics car (x, y, z, grounded, spin, immune)
	 */
	hazardHit(T, car, meId, now) {
		if (car.spin > 0 || car.immune > 0) return null
		for (const h of this.hazards.values()) {
			if (this.hitSent.has(h.hid)) continue
			if (h.until !== null && now >= h.until) continue
			const mine = meId !== null && h.by === meId
			let hit = false
			if (h.kind === 'slick') {
				if (mine && now - h.ts < OWN_SLICK_SAFE_MS) continue
				hit = car.grounded && Math.hypot(car.x - h.p[0], car.z - h.p[2]) <= SLICK_R && Math.abs(car.y - h.p[1]) <= 0.6
			} else if (h.kind === 'rocket') {
				if (mine && now - h.ts < ROCKET_SAFE_MS) continue
				const r = T ? this.rocketOf(T, h, now) : null
				hit = !!r && Math.hypot(car.x - r.x, car.y + 0.2 - r.y, car.z - r.z) <= ROCKET_R
			}
			if (hit) {
				this.hitSent.add(h.hid)
				return h.hid
			}
		}
		return null
	}

	/** Pulse `fx` from player `fx.id` at fx.p: true when my car is within PULSE_R (never the user's own pulse). */
	pulseHits(fx, car, meId) {
		if (!fx.p || fx.id === meId || car.spin > 0 || car.immune > 0) return false
		return Math.hypot(car.x - fx.p[0], car.y - fx.p[1], car.z - fx.p[2]) <= PULSE_R
	}
}

/** Effects of my own Use that do not wait for the server: turbo boost, shield bubble. */
export function applyOwnUse(car, item) {
	if (item === 'turbo') return giveBoost(car, PHYS.TURBO, 'turbo')
	if (item === 'shield') {
		giveShield(car)
		return true
	}
	return false
}

export { hitHazMsg, hitByMsg }

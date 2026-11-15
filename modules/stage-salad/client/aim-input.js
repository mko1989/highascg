/**
 * The slingshot's aim as numbers (WO-1089 §11) — pure, node-testable; input.js feeds it DOM / keyboard / gamepad.
 *
 *   Drag (touch / mouse, anywhere): drag DOWN = pull (stretch = power), SIDEWAYS = yaw — pulling left aims right, like a
 *   real band. The yaw starts from the current aim, so a second drag refines it. Released with less than CANCEL_PX of
 *   pull = cancelled (no shot). Dragging back above the start also cancels.
 *   Keyboard: ←→ turn, ↑↓ / W S pitch, hold Space to pull (grows PULL_RATE / s), release fires.
 *   Gamepad: left stick turns / pitches, hold RT to pull, release fires.
 * Angles in radians. yaw = slotYaw + yawOff (±YAW_LIMIT, a hair inside the server's ±55°); pitch = the vegetable's own
 * pitch + pitchOff (PITCH_OFF), always inside −10°…70°; power = POWER_MIN + pull · (1 − POWER_MIN).
 */
import { POWER_MIN, POWER_MAX } from './veggies.js'

export const DEG = Math.PI / 180
export const YAW_LIMIT = 54 * DEG // the server refuses beyond 55°
export const PITCH_OFF = Object.freeze([-10 * DEG, 20 * DEG])
export const PITCH_ABS = Object.freeze([-10 * DEG, 70 * DEG])
export const CANCEL_PX = 22 // less pull than this at release = no shot
export const PULL_RATE = 0.9 // keyboard / pad pull per second
export const KEY_YAW_RATE = 28 * DEG // rad/s
export const KEY_PITCH_RATE = 18 * DEG
export const WHEEL_STEP = 2 * DEG

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** px of downward drag for a full pull, for a view height (css px). */
export function pullPx(viewH) {
	return clamp((Number(viewH) || 600) * 0.42, 110, 320)
}

/** px of sideways drag for the full ±YAW_LIMIT, for a view width. */
export function yawPx(viewW) {
	return clamp((Number(viewW) || 1000) * 0.6, 240, 900)
}

/** Smallest signed difference b − a. */
export function angDiff(a, b) {
	return Math.atan2(Math.sin(b - a), Math.cos(b - a))
}

/** Any yaw → within ±YAW_LIMIT of the slot's. */
export function clampYaw(yaw, slotYaw) {
	return slotYaw + clamp(angDiff(slotYaw, yaw), -YAW_LIMIT, YAW_LIMIT)
}

export const clampPitchOff = (off) => clamp(Number(off) || 0, PITCH_OFF[0], PITCH_OFF[1])

/** The launch pitch for a vegetable and an offset. */
export function pitchOf(veg, off) {
	return clamp((veg?.pitch ?? 20) * DEG + clampPitchOff(off), PITCH_ABS[0], PITCH_ABS[1])
}

/** Pull 0…1 → launch power POWER_MIN…POWER_MAX. */
export function powerOf(pull) {
	return clamp(POWER_MIN + clamp(Number(pull) || 0, 0, 1) * (POWER_MAX - POWER_MIN), POWER_MIN, POWER_MAX)
}

/**
 * A drag from its start: dx / dy css px since the press (dy > 0 = down), the yaw offset at the press, the view size.
 * → { yawOff, pull, cancel }
 */
export function dragAim(dx, dy, yawOff0, view) {
	const yawOff = clamp(yawOff0 + (dx / yawPx(view?.w)) * YAW_LIMIT, -YAW_LIMIT, YAW_LIMIT)
	const pull = clamp(dy / pullPx(view?.h), 0, 1)
	return { yawOff, pull, cancel: !(dy >= CANCEL_PX) }
}

/** The aim state one player edits; `source` = who is pulling now ('drag' | 'key' | 'pad' | null). */
export class AimState {
	constructor() {
		this.yawOff = 0
		this.pitchOff = 0
		this.pull = 0
		this.source = null
		this.cancel = true
		this.drag = null
	}

	reset() {
		this.yawOff = 0
		this.pitchOff = 0
		this.release(false)
	}

	press(x, y) {
		if (this.source) return false
		this.drag = { x, y, yawOff0: this.yawOff }
		this.source = 'drag'
		this.pull = 0
		this.cancel = true
		return true
	}

	move(x, y, view) {
		if (this.source !== 'drag' || !this.drag) return
		const r = dragAim(x - this.drag.x, y - this.drag.y, this.drag.yawOff0, view)
		this.yawOff = r.yawOff
		this.pull = r.pull
		this.cancel = r.cancel
	}

	/** End of a pull → { fire, pull } (fire false = cancelled). `fire` false forces a cancel. */
	release(fire = true) {
		const out = { fire: !!fire && !!this.source && !this.cancel && this.pull > 0, pull: this.pull }
		this.source = null
		this.drag = null
		this.pull = 0
		this.cancel = true
		return out
	}

	/** Keyboard / pad: turn (−1…1, + = left), pitch (−1…1, + = up) over dt seconds. */
	nudge(turn, pitch, dt) {
		if (this.source === 'drag') return
		if (turn) this.yawOff = clamp(this.yawOff + turn * KEY_YAW_RATE * dt, -YAW_LIMIT, YAW_LIMIT)
		if (pitch) this.pitchOff = clampPitchOff(this.pitchOff + pitch * KEY_PITCH_RATE * dt)
	}

	/** Wheel / slider: pitch steps (+ = up). */
	pitchStep(k) {
		this.pitchOff = clampPitchOff(this.pitchOff + k * WHEEL_STEP)
	}

	setPitchOff(off) {
		this.pitchOff = clampPitchOff(off)
	}

	/** Hold-to-pull (keyboard Space, pad RT): grows while held; pressing starts it. */
	hold(src, held, dt) {
		if (held) {
			if (!this.source) {
				this.source = src
				this.pull = 0
			}
			if (this.source === src) {
				this.pull = clamp(this.pull + PULL_RATE * dt, 0, 1)
				this.cancel = this.pull < 0.05
			}
			return null
		}
		return this.source === src ? this.release(true) : null
	}

	/** The world aim for a slot yaw and a vegetable. */
	aim(slotYaw, veg) {
		return { yaw: clampYaw(slotYaw + this.yawOff, slotYaw), pitch: pitchOf(veg, this.pitchOff), power: powerOf(this.pull), pull: this.pull }
	}
}

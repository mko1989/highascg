/**
 * The presenter avatar as data (WO-1089 §6) — pure, node-testable: the part list the three.js twin (avatar-model.js)
 * builds, read from the shared avatar-body.js MESH (itself a twin of godot/client/features/previs/tracking/
 * person_avatar.gd, WO-1086), plus the per-frame motion maths of person_avatar.gd step() (walk swing, bob, breathing)
 * and the helpers that put a splat on the figure's surface.
 *
 *   figureSpec(look, height) → { scale, parts: [{ group, pivot?, kind, at, s, r?, h?, path?, mat, color, emissive, unlit }] }
 *     group: 'legs' (hang from a leg pivot) | 'upper' (torso, head, face, arm pivots) | 'hair_short' | 'hair_long'
 *     kind: 'ball' (unit sphere × s) | 'cap' (Godot CapsuleMesh: r, h = total height) | 'tube' (path points, radius r)
 */
import { MESH, SMILE, smilePoint, scaleOf, lookFrom, SELF_LIGHT, HEAD_Y, HEAD_R, HIP_Y, ARM_OUT, WALK_MIN } from './avatar-body.js'

export const WALK_FULL = 1.4 // m/s — full stride (person_avatar_model.gd)
export const LIMB_RATE = 9
export const SMILE_SEGS = 16
const LOOK_MATS = ['top', 'bottom', 'skin', 'hair', 'shoes', 'blush']

/** The parts a figure is made of, coloured from a lookFrom() result (raw traits / null are run through lookFrom). */
export function figureSpec(look, height) {
	if (!look || !Array.isArray(look.shoes)) look = lookFrom(look)
	const colorOf = (mat) => (LOOK_MATS.includes(mat) ? look[mat] : MESH.fixed[mat])
	const part = (p, extra) => {
		const color = colorOf(p.mat).slice()
		const unlit = p.mat === 'glint'
		const lit = LOOK_MATS.includes(p.mat)
		return {
			kind: p.kind,
			at: (p.at || [0, 0, 0]).slice(),
			s: (p.s || [1, 1, 1]).slice(),
			r: p.r,
			h: p.h,
			mat: p.mat,
			color,
			emissive: lit ? color.map((c) => c * SELF_LIGHT) : [0, 0, 0],
			unlit,
			...extra,
		}
	}
	const parts = []
	for (const [pivot, at] of Object.entries(MESH.pivots)) {
		const kind = pivot.startsWith('leg') ? 'leg' : 'arm'
		for (const p of MESH.limbs[kind]) parts.push(part(p, { group: kind === 'leg' ? 'legs' : 'upper', pivot, pivotAt: at.slice() }))
	}
	for (const p of MESH.body) {
		const group = p.hair === 'short' ? 'hair_short' : p.hair === 'long' ? 'hair_long' : 'upper'
		if (p.kind === 'smile') {
			const path = []
			for (let i = 0; i <= SMILE_SEGS; i++) path.push(smilePoint(SMILE.from + ((SMILE.to - SMILE.from) * i) / SMILE_SEGS))
			parts.push(part({ ...p, kind: 'tube' }, { group, path, r: SMILE.tube }))
			for (const a of [SMILE.from, SMILE.to]) parts.push(part({ kind: 'ball', at: smilePoint(a), s: [SMILE.tube, SMILE.tube, SMILE.tube], mat: p.mat }, { group }))
			continue
		}
		parts.push(part(p, { group }))
	}
	return { scale: scaleOf(height), height, hair: look.hair_len, parts }
}

/** person_avatar_model.gd blend(): the share to move this frame for a rate (1/s). */
export function blend(dt, rate) {
	return 1 - Math.exp(-rate * Math.max(dt, 0))
}

/** person_avatar_model.gd stride(): [swing (rad), bob (unit m)] for a phase and a speed. */
export function stride(phase, speed) {
	const k = Math.max(0, Math.min(1, (speed - WALK_MIN) / (WALK_FULL - WALK_MIN)))
	return [Math.sin(phase) * 0.5 * k, Math.abs(Math.sin(phase)) * 0.025 * k]
}

/** The walk phase after dt at speed (m/s) for a person `height` tall (person_avatar.gd step()). */
export function advancePhase(phase, dt, speed, height) {
	return (phase + ((dt * speed) / Math.max(0.35 * height, 0.1)) * Math.PI) % (Math.PI * 2)
}

/** A limb's rest rotation [x, z] (radians) for a swing: Basis(RIGHT, swing) · Basis(BACK, out). */
export function limbAngles(pivot, swing) {
	const sign = pivot === 'arm_l' || pivot === 'leg_r' ? 1 : -1
	const out = pivot === 'arm_l' ? ARM_OUT : pivot === 'arm_r' ? -ARM_OUT : 0
	return [swing * sign, out]
}

/** Breathing: the upper body's y scale at clock t (s). */
export const breath = (t) => 1 + 0.006 * Math.sin(t * 2.2)

/** World point → the avatar's unit frame (inverse of avatar-body.js worldParts' transform). */
export function toUnit(pose, w) {
	const s = scaleOf(pose.height)
	const sy = Math.sin(pose.yaw || 0), cy = Math.cos(pose.yaw || 0)
	const dx = w[0] - pose.x - (pose.off ? pose.off[0] : 0)
	const dz = w[2] - pose.z - (pose.off ? pose.off[1] : 0)
	return [(dx * cy - dz * sy) / s, (w[1] - pose.y) / s, (dx * sy + dz * cy) / s]
}

const norm = (v) => {
	const L = Math.hypot(v[0], v[1], v[2])
	return L > 1e-9 ? v.map((c) => c / L) : [0, 0, 1]
}

/**
 * A unit-frame point near a hit part → { p, n } on the drawn surface (head ball, torso capsule squashed in z by 0.8,
 * the nearer leg), so a splat sits on the figure even when the drawn pose lags the server's a little.
 */
export function surfacePoint(part, u) {
	if (part === 'head') {
		const n = norm([u[0], u[1] - HEAD_Y, u[2]])
		if (n[2] < -0.3) n[2] = -0.3 // splats show on the visible (front / side) half
		const m = norm(n)
		return { p: [m[0] * HEAD_R, HEAD_Y + m[1] * HEAD_R, m[2] * HEAD_R], n: m }
	}
	if (part === 'legs') {
		const x = u[0] >= 0 ? 0.065 : -0.065
		const y = Math.max(0.03, Math.min(HIP_Y - 0.03, u[1]))
		const n = norm([u[0] - x, 0, u[2]])
		return { p: [x + n[0] * 0.058, y, n[2] * 0.058], n }
	}
	const y = Math.max(0.43, Math.min(0.53, u[1]))
	const n = norm([u[0], u[1] - y, u[2] / 0.8])
	return { p: [n[0] * 0.13, y + n[1] * 0.13, n[2] * 0.13 * 0.8], n }
}

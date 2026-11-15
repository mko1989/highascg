/**
 * Stage Salad (WO-1089) — the presenter's avatar, a twin of the previs "pebble person"
 * (godot/client/features/previs/tracking/person_avatar.gd + person_avatar_model.gd, WO-1086): the same unit frame (feet
 * at y 0, top of the hair at UNIT_TOP, front +Z, the person's left +X, uniform scale height / UNIT_TOP), the same part
 * sizes and places, the same colours from the same traits. `hair: 'short'` parts show for short AND long hair (the cap and the
 * back of the head), `hair: 'long'` only for long, none for bald. Pure, shared: the browser builds the figure from `MESH`, the
 * server referee tests vegetables against `HIT` (work/notes/stage-salad-contract.md §6).
 */

export const UNIT_TOP = 1.02
export const HIP_Y = 0.32
export const SHOULDER = [0.155, 0.6, 0]
export const HEAD_Y = 0.815
export const HEAD_R = 0.175
export const SELF_LIGHT = 0.3 // person_avatar.gdshader self_light (0.35 before the shader)
export const ARM_OUT = 0.12 // rad, arms a little away from the body
export const POS_RATE = 8 // 1/s — feet follow the tracked point (as the previs)
export const WALK_MIN = 0.35 // m/s
export const FACE_AFTER = 0.8 // s standing → turn to the audience (the one change from the previs)
export const FACE_RATE = 3 // rad/s
export const HEIGHT = { min: 1.2, max: 2.2, def: 1.75 }

/** person_avatar_model.gd NEUTRAL (0–1 RGB): before the sidecar has a look. */
export const NEUTRAL = Object.freeze({ top: [0.7, 0.73, 0.78], bottom: [0.4, 0.43, 0.5], skin: [0.87, 0.74, 0.63], hair: [0.32, 0.25, 0.2], hair_len: 'short' })
export const HAIR_LENS = ['short', 'long', 'bald']

/**
 * The figure in unit metres (person_avatar.gd _build / _meshes). kind: ball (unit sphere scaled by `s`), cap (capsule:
 * r, h = total height as Godot's CapsuleMesh), torus (Godot inner / outer radius). `limb` parts hang from that pivot.
 */
export const MESH = Object.freeze({
	pivots: {
		leg_l: [0.065, HIP_Y, 0],
		leg_r: [-0.065, HIP_Y, 0],
		arm_l: [SHOULDER[0], SHOULDER[1], 0],
		arm_r: [-SHOULDER[0], SHOULDER[1], 0],
	},
	limbs: {
		leg: [
			{ kind: 'cap', r: 0.058, h: 0.3, at: [0, -0.15, 0], mat: 'bottom' },
			{ kind: 'ball', at: [0, -HIP_Y + 0.045, 0.025], s: [0.075, 0.045, 0.11], mat: 'shoes' },
		],
		arm: [
			{ kind: 'cap', r: 0.042, h: 0.24, at: [0, -0.11, 0], mat: 'top' },
			{ kind: 'ball', at: [0, -0.245, 0], s: [0.05, 0.05, 0.05], mat: 'skin' },
		],
	},
	body: [
		{ kind: 'cap', r: 0.13, h: 0.36, at: [0, 0.48, 0], s: [1, 1, 0.8], mat: 'top' },
		{ kind: 'ball', at: [0, HEAD_Y, 0], s: [HEAD_R, HEAD_R, HEAD_R], mat: 'skin' },
		{ kind: 'ball', at: [0.058, 0.83, 0.161], s: [0.019, 0.025, 0.011], mat: 'eye' },
		{ kind: 'ball', at: [-0.058, 0.83, 0.161], s: [0.019, 0.025, 0.011], mat: 'eye' },
		{ kind: 'ball', at: [0.065, 0.838, 0.171], s: [0.0055, 0.0055, 0.0055], mat: 'glint' },
		{ kind: 'ball', at: [-0.051, 0.838, 0.171], s: [0.0055, 0.0055, 0.0055], mat: 'glint' },
		{ kind: 'ball', at: [0.1, 0.775, 0.137], s: [0.028, 0.017, 0.009], mat: 'blush' },
		{ kind: 'ball', at: [-0.1, 0.775, 0.137], s: [0.028, 0.017, 0.009], mat: 'blush' },
		{ kind: 'smile', mat: 'mouth' },
		{ kind: 'ball', at: [0, 0.86, -0.02], s: [0.185, 0.16, 0.185], mat: 'hair', hair: 'short' },
		{ kind: 'ball', at: [0, 0.8, -0.045], s: [0.18, 0.13, 0.16], mat: 'hair', hair: 'short' },
		{ kind: 'cap', r: 0.12, h: 0.34, at: [0, 0.72, -0.075], s: [1.6, 1, 0.65], mat: 'hair', hair: 'long' },
	],
	fixed: { eye: [0.11, 0.1, 0.14], glint: [1, 1, 1], mouth: [0.42, 0.14, 0.17] },
})

/** The smile (person_avatar.gd SMILE): a thin tube along the lower arc around (0, y) at radius r, laid on the face, with
 *  round ends (balls of radius `tube` at both ends). Angles in radians (205° … 335°: both ends turn up). */
export const SMILE = Object.freeze({ y: 0.79, r: 0.036, tube: 0.0085, from: 3.578, to: 5.847 })

/** A point of the smile's centre line (unit frame) at angle `a` (person_avatar.gd smile_point). */
export function smilePoint(a) {
	const x = SMILE.r * Math.cos(a)
	const y = SMILE.y + SMILE.r * Math.sin(a)
	const dy = y - HEAD_Y
	return [x, y, Math.sqrt(Math.max(HEAD_R * HEAD_R - x * x - dy * dy, 0)) + 0.002]
}

/** Hit parts in unit metres (contract §6), tested in this order (ties: the first). */
export const HIT = Object.freeze([
	{ part: 'head', kind: 'sph', c: [0, 0.82, 0], r: 0.19 },
	{ part: 'body', kind: 'cap', a: [0, 0.36, 0], b: [0, 0.6, 0], r: 0.17 },
	{ part: 'legs', kind: 'cap', a: [0, 0.03, 0], b: [0, 0.3, 0], r: 0.12 },
])
export const UMBRELLA = Object.freeze({ c: [0, 0.95, 0], r: 0.5, forward: 0.12 })
export const DUCK_DROP = 0.2 // unit metres the head and body sink in a duck
export const STEP_DX = 0.4 // m sideways in a step

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** [r, g, b] 0–255 → 0–1, or null. */
function rgb(v) {
	if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && x >= 0 && x <= 255)) return null
	return v.map((x) => Math.round(x) / 255)
}

/** Traits (the wire dict, maybe partial) → the avatar's colours (0–1), as person_avatar_model.gd look(). */
export function lookFrom(traits) {
	const out = { ...NEUTRAL, known: false }
	if (traits && typeof traits === 'object') {
		for (const k of ['top', 'bottom', 'skin', 'hair']) {
			const c = rgb(traits[k])
			if (c) (out[k] = c), (out.known = true)
		}
		if (HAIR_LENS.includes(traits.hair_len)) out.hair_len = traits.hair_len
	}
	out.shoes = out.bottom.map((c) => c * (1 - 0.55)) // Color.darkened(0.55)
	out.blush = out.skin.map((c, i) => c + ([1, 0.45, 0.5][i] - c) * 0.45)
	return out
}

/** Unit → metres for a person `height` m tall. */
export const scaleOf = (height) => height / UNIT_TOP

/** 0…1 how far a dodge window [from, until] (ms) is in at `t` (0.12 s ramps). */
export function dodgeAmount(d, t) {
	if (!d || t < d.from || t > d.until) return 0
	const ramp = 120
	return clamp01(Math.min((t - d.from) / ramp, (d.until - t) / ramp))
}

/**
 * The world-space hit parts of an avatar pose { x, y, z, yaw, height, duck (0…1), off: [dx, dz] (a step), umbrella }
 * → [{ part, kind, c | a, b, r }] (+ an `umbrella` sphere first when it is up).
 */
export function worldParts(pose) {
	const s = scaleOf(pose.height)
	const sy = Math.sin(pose.yaw || 0), cy = Math.cos(pose.yaw || 0)
	const ox = pose.x + (pose.off ? pose.off[0] : 0), oz = pose.z + (pose.off ? pose.off[1] : 0)
	const drop = (pose.duck || 0) * DUCK_DROP
	// Godot Basis(UP, yaw): local (x, z) → world (x·cos + z·sin, −x·sin + z·cos)
	const W = (p, sink) => [ox + (p[0] * cy + p[2] * sy) * s, pose.y + (p[1] - (sink ? drop : 0)) * s, oz + (-p[0] * sy + p[2] * cy) * s]
	const out = []
	if (pose.umbrella) {
		const f = pose.facing || [sy, cy]
		const c = W(UMBRELLA.c, false)
		out.push({ part: 'umbrella', kind: 'sph', c: [c[0] + f[0] * UMBRELLA.forward, c[1], c[2] + f[1] * UMBRELLA.forward], r: UMBRELLA.r * s })
	}
	for (const h of HIT) {
		const sink = h.part !== 'legs'
		if (h.kind === 'sph') out.push({ part: h.part, kind: 'sph', c: W(h.c, sink), r: h.r * s })
		else out.push({ part: h.part, kind: 'cap', a: W(h.a, sink), b: W(h.b, sink), r: h.r * s })
	}
	return out
}

function distTo(part, p) {
	if (part.kind === 'sph') return Math.hypot(p[0] - part.c[0], p[1] - part.c[1], p[2] - part.c[2])
	const a = part.a, b = part.b
	const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
	const L = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]
	let t = L > 0 ? ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / L : 0
	t = t < 0 ? 0 : t > 1 ? 1 : t
	return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t)
}

export const HIT_STEP = 0.02 // m — a moving vegetable is tested every 2 cm along its step

/** Swept sphere (p0 → p1, radius r) against parts → { u (0…1), part, p } of the first contact, or null. */
export function sweepParts(parts, p0, p1, r) {
	const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
	const n = Math.max(1, Math.ceil(L / HIT_STEP))
	for (let k = 0; k <= n; k++) {
		const u = k / n
		const p = [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u, p0[2] + (p1[2] - p0[2]) * u]
		for (const part of parts) if (distTo(part, p) <= part.r + r) return { u, part: part.part, p }
	}
	return null
}

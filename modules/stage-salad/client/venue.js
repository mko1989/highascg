/**
 * Stage Salad (WO-1089) — the play frame (work/notes/stage-salad-contract.md §3). Pure, shared: the server builds it
 * from the scene bake + the live screens / lights and puts it in the scene JSON as `salad`; the browser uses that copy.
 *
 *   buildVenue(scene, { screens, lights }) → { hall, stage, front, slots, colliders, play, ceiling, rev }
 *   pouch(slot) → the launch point of a slot's slingshot
 * Real metres in the Godot frame (the scene's toy `scale` is not used here).
 */

export const SLOT_ROWS = [9, 12.5] // m from the stage front's midpoint
export const SLOTS_PER_ROW = 10
export const SLOT_GAP = 1.7 // m along the arc
export const POUCH_H = 1.25 // m above the hall floor
export const HALL_INSET = 1
export const WALL_DEPTH = 0.12
export const TRUSS_R = 0.2
export const LIGHT_R = 0.22
export const MAX_LIGHT_SPHERES = 40

const r4 = (v) => Math.round(v * 1e4) / 1e4 + 0
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

function rectOf(f) {
	const r = Array.isArray(f?.rect) && f.rect.length === 4 ? f.rect.map((v) => num(v)) : null
	return r && r[2] > r[0] && r[3] > r[1] ? r : null
}

/** Godot rotation_degrees (order YXZ: Ry · Rx · Rz) → the three local axes as world vectors. */
export function axesYXZ(rotDeg) {
	const [x, y, z] = (rotDeg || [0, 0, 0]).map((d) => (num(d) * Math.PI) / 180)
	const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z)
	// R = Ry · Rx · Rz, columns = images of the unit axes
	const R = [
		[cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx],
		[cx * sz, cx * cz, -sx],
		[-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx],
	]
	return [0, 1, 2].map((j) => [R[0][j], R[1][j], R[2][j]])
}

/** The edge of the stage rect that faces the hall's centre. */
function frontOf(stage, hall) {
	const [x0, z0, x1, z1] = stage.rect
	const sc = [(x0 + x1) / 2, (z0 + z1) / 2]
	const hc = [(hall.rect[0] + hall.rect[2]) / 2, (hall.rect[1] + hall.rect[3]) / 2]
	let d = [hc[0] - sc[0], hc[1] - sc[1]]
	const L = Math.hypot(d[0], d[1])
	d = L > 0.5 ? [d[0] / L, d[1] / L] : [0, 1]
	const lenX = x1 - x0, lenZ = z1 - z0
	const edges = [
		{ f: [-1, 0], c: [x0, sc[1]], half: lenZ / 2, depth: lenX },
		{ f: [1, 0], c: [x1, sc[1]], half: lenZ / 2, depth: lenX },
		{ f: [0, -1], c: [sc[0], z0], half: lenX / 2, depth: lenZ },
		{ f: [0, 1], c: [sc[0], z1], half: lenX / 2, depth: lenZ },
	]
	const maxHalf = Math.max(lenX, lenZ) / 2
	let best = edges[0], score = -Infinity
	for (const e of edges) {
		const s = e.f[0] * d[0] + e.f[1] * d[1] + 0.01 * (e.half / maxHalf)
		if (s > score) (score = s), (best = e)
	}
	return { c: [r4(best.c[0]), stage.y, r4(best.c[1])], f: best.f, r: [best.f[1], -best.f[0]], half: r4(best.half), depth: r4(best.depth) }
}

function slotsOf(front, hall) {
	const out = []
	const [hx0, hz0, hx1, hz1] = hall.rect
	const ins = (v, lo, hi) => (hi - lo > 2 * HALL_INSET ? Math.max(lo + HALL_INSET, Math.min(hi - HALL_INSET, v)) : (lo + hi) / 2)
	const aim = [front.c[0] + front.f[0] * 0.0, front.c[2] + front.f[1] * 0.0]
	for (let row = 0; row < SLOT_ROWS.length; row++) {
		const R = SLOT_ROWS[row]
		const step = SLOT_GAP / R
		for (let j = 0; j < SLOTS_PER_ROW; j++) {
			const k = Math.floor(j / 2)
			const side = j % 2 === 0 ? 1 : -1
			const a = side * (k + 0.5) * step
			const fx = Math.cos(a), rx = Math.sin(a)
			const x = ins(front.c[0] + R * (fx * front.f[0] + rx * front.r[0]), hx0, hx1)
			const z = ins(front.c[2] + R * (fx * front.f[1] + rx * front.r[1]), hz0, hz1)
			const dx = aim[0] - x, dz = aim[1] - z
			const yaw = Math.atan2(-dx, -dz)
			const s = (x - front.c[0]) * front.r[0] + (z - front.c[2]) * front.r[1]
			out.push({ i: out.length, p: [r4(x), hall.y, r4(z)], yaw: r4(yaw), team: s < 0 ? 0 : 1, row })
		}
	}
	return out
}

function lightColliders(lights) {
	const pts = (Array.isArray(lights) ? lights : [])
		.map((l) => (Array.isArray(l?.p) && l.p.length === 3 && l.p.every((v) => Number.isFinite(Number(v))) ? l.p.map(Number) : null))
		.filter(Boolean)
		.sort((a, b) => a[1] - b[1])
	const out = []
	const groups = []
	for (const p of pts) {
		const g = groups.find((x) => Math.abs(x.y - p[1]) <= 0.4)
		if (g) g.pts.push(p)
		else groups.push({ y: p[1], pts: [p] })
	}
	for (const g of groups) {
		if (g.pts.length < 2) continue
		let a = g.pts[0], b = g.pts[1], best = -1
		for (let i = 0; i < g.pts.length; i++)
			for (let j = i + 1; j < g.pts.length; j++) {
				const d = Math.hypot(g.pts[i][0] - g.pts[j][0], g.pts[i][2] - g.pts[j][2])
				if (d > best) (best = d), (a = g.pts[i]), (b = g.pts[j])
			}
		const L = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1
		const u = [(b[0] - a[0]) / L, (b[2] - a[2]) / L]
		const y = Math.max(a[1], b[1]) + 0.3
		out.push({ k: 'cap', a: [r4(a[0] - u[0] * 0.4), r4(y), r4(a[2] - u[1] * 0.4)], b: [r4(b[0] + u[0] * 0.4), r4(y), r4(b[2] + u[1] * 0.4)], r: TRUSS_R, tag: 'truss' })
	}
	for (const p of pts.slice(0, MAX_LIGHT_SPHERES)) out.push({ k: 'sph', c: p.map(r4), r: LIGHT_R, tag: 'truss' })
	return out
}

function wallColliders(screens) {
	const out = []
	for (const s of Array.isArray(screens) ? screens : []) {
		if (!Array.isArray(s?.p) || !Array.isArray(s?.size)) continue
		const w = num(s.size[0]), h = num(s.size[1])
		if (!(w > 0.05 && h > 0.05)) continue
		const ax = axesYXZ(s.rot).map((v) => v.map(r4))
		const c = s.p.map((v, j) => r4(num(v) - ax[2][j] * (WALL_DEPTH / 2)))
		out.push({ k: 'obox', c, ax, h: [r4(w / 2), r4(h / 2), WALL_DEPTH / 2], tag: 'wall' })
	}
	return out
}

/** 32-bit FNV-1a of a string → 8 hex digits. */
export function fnv(s) {
	let h = 0x811c9dc5
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
	return h.toString(16).padStart(8, '0')
}

export function buildVenue(scene, live = {}) {
	const floors = Array.isArray(scene?.floors) ? scene.floors : []
	const hallF = floors.find((f) => f?.id === 'hall' && rectOf(f))
	const hall = hallF ? { y: num(hallF.y), rect: rectOf(hallF) } : { y: 0, rect: [-15, -10, 15, 10] }
	const stageF = floors.find((f) => f?.id === 'stage' && rectOf(f))
	let stage
	if (stageF && num(stageF.y) > hall.y - 0.5) stage = { y: num(stageF.y), rect: rectOf(stageF), synthetic: false }
	else {
		const cx = (hall.rect[0] + hall.rect[2]) / 2
		stage = { y: r4(hall.y + 0.4), rect: [cx - 4, hall.rect[1] + 0.5, cx + 4, hall.rect[1] + 3.5].map(r4), synthetic: true }
	}
	const front = frontOf(stage, hall)
	const bmax = Array.isArray(scene?.bounds?.max) ? num(scene.bounds.max[1], hall.y + 6) : hall.y + 6
	const ceiling = r4(Math.max(bmax, hall.y + 4))
	const [hx0, hz0, hx1, hz1] = hall.rect
	const colliders = [{ k: 'plane', n: [0, 1, 0], d: hall.y, tag: 'floor' }]
	if (stage.y > hall.y + 0.02) colliders.push({ k: 'box', min: [stage.rect[0], hall.y - 0.2, stage.rect[1]], max: [stage.rect[2], stage.y, stage.rect[3]], tag: 'stage' })
	colliders.push(...wallColliders(live.screens), ...lightColliders(live.lights))
	colliders.push(
		{ k: 'plane', n: [1, 0, 0], d: hx0, tag: 'room' },
		{ k: 'plane', n: [-1, 0, 0], d: -hx1, tag: 'room' },
		{ k: 'plane', n: [0, 0, 1], d: hz0, tag: 'room' },
		{ k: 'plane', n: [0, 0, -1], d: -hz1, tag: 'room' },
		{ k: 'plane', n: [0, -1, 0], d: -ceiling, tag: 'room' }
	)
	const play = { min: [hx0 - 0.5, hall.y - 0.5, hz0 - 0.5], max: [hx1 + 0.5, ceiling + 1, hz1 + 0.5] }
	const slots = slotsOf(front, hall)
	const v = { hall, stage, front, slots, colliders, play, ceiling }
	v.rev = fnv(JSON.stringify(v))
	return v
}

export function pouch(slot) {
	return [slot.p[0], slot.p[1] + POUCH_H, slot.p[2]]
}

/** Where the stand-in stands: the stage's middle, 0.6 m behind the front edge, on the stage floor. */
export function standInSpot(venue) {
	const f = venue.front
	return [f.c[0] - f.f[0] * 0.6, venue.stage.y, f.c[2] - f.f[1] * 0.6]
}

'use strict'

/**
 * WO-1074 — RC car game: pure scene geometry. Affine transforms in the MVR store's 12-number form (basis x, y, z
 * columns, then origin; Godot frame), the project's placement exactly as the previs applies it
 * (godot/client/features/previs/mvr_scene.gd: node = placement(place) · moved[uuid] · part.xform), the drivable floors
 * and the obstacle boxes at car height (an occupancy grid sampled from the drawn triangles, merged into rectangles).
 */

const { CAR_HEIGHT } = require('./rc-track-check')

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
const OBSTACLE_EPS = 0.05 // a surface this close above a floor is part of the floor (a mat, a cable ramp)
const MAX_OBSTACLES = 300
const DEFAULT_HALL = { w: 30, d: 20 }

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** 12 numbers → affine (identity when malformed or singular, like move_model.gd array_to_xf). */
function xf12(a) {
	if (!Array.isArray(a) || a.length !== 12) return IDENTITY
	const f = a.map(num)
	const det = f[0] * (f[4] * f[8] - f[5] * f[7]) - f[3] * (f[1] * f[8] - f[2] * f[7]) + f[6] * (f[1] * f[5] - f[2] * f[4])
	return Number.isFinite(det) && Math.abs(det) > 1e-6 ? f : IDENTITY
}

/** a ∘ b (apply b first). */
function compose(a, b) {
	const out = new Array(12)
	for (let c = 0; c < 3; c++) {
		for (let r = 0; r < 3; r++) out[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]
	}
	for (let r = 0; r < 3; r++) out[9 + r] = a[r] * b[9] + a[3 + r] * b[10] + a[6 + r] * b[11] + a[9 + r]
	return out
}

function apply(m, x, y, z) {
	return [m[0] * x + m[3] * y + m[6] * z + m[9], m[1] * x + m[4] * y + m[7] * z + m[10], m[2] * x + m[5] * y + m[8] * z + m[11]]
}

/** Largest axis scale of the basis (a template used at scale s needs a finer simplification cell). */
const scaleOf = (m) => Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[3], m[4], m[5]), Math.hypot(m[6], m[7], m[8]))

/** Rotation about +Y by `a` radians as a basis (Godot Basis(Vector3.UP, a)). */
function rotY(a) {
	const c = Math.cos(a), s = Math.sin(a)
	return [c, 0, -s, 0, 1, 0, s, 0, c, 0, 0, 0]
}
const rotX = (a) => [1, 0, 0, 0, Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a), 0, 0, 0]
const rotZ = (a) => [Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 1, 0, 0, 0]

/** project.previs.mvr.place → affine (mvr_model.gd placement: translation (x, z, −y), rotation Ry(−yaw°)); clamped like place_of. */
function placementOf(place) {
	const p = place && typeof place === 'object' ? place : {}
	const c = (v, lo, hi) => Math.max(lo, Math.min(hi, num(v)))
	const m = rotY(-(c(p.yaw, -360, 360) * Math.PI) / 180)
	m[9] = c(p.x, -500, 500)
	m[10] = c(p.z, -50, 200)
	m[11] = -c(p.y, -500, 500)
	return m
}

/** AABB of local box [min, max] under m → { min, max }. */
function boxUnder(m, min, max) {
	const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
	for (let i = 0; i < 8; i++) {
		const p = apply(m, i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2])
		for (let k = 0; k < 3; k++) {
			lo[k] = Math.min(lo[k], p[k])
			hi[k] = Math.max(hi[k], p[k])
		}
	}
	return { min: lo, max: hi }
}

/** "#rrggbb" (sRGB) → linear [r, g, b, 1] for a glTF baseColorFactor; anything else → null. */
function hexToLinear(hex) {
	const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''))
	if (!m) return null
	const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
	const v = parseInt(m[1], 16)
	return [lin(((v >> 16) & 255) / 255), lin(((v >> 8) & 255) / 255), lin((v & 255) / 255), 1]
}

/**
 * The visible MVR parts as the previs draws them. → [{ key, xf, layer, uuid, fixture, color }] (color = layer colour or
 * null = the mesh's own). Hidden layers and hidden objects are left out.
 */
function visibleParts(scene, cfg) {
	const c = cfg && typeof cfg === 'object' ? cfg : {}
	const hiddenLayers = new Set((Array.isArray(c.hidden_layers) ? c.hidden_layers : []).map(String))
	const hiddenObjects = new Set((Array.isArray(c.hidden_objects) ? c.hidden_objects : []).map((u) => String(u).toLowerCase()))
	const moved = {}
	if (c.moved && typeof c.moved === 'object') for (const [u, a] of Object.entries(c.moved)) moved[u.toLowerCase()] = xf12(a)
	const colors = c.layer_colors && typeof c.layer_colors === 'object' ? c.layer_colors : {}
	const P = placementOf(c.place)
	const out = []
	for (const o of scene?.objects || []) {
		const uuid = String(o?.uuid || '').toLowerCase()
		const layer = String(o?.layer || '')
		if (hiddenLayers.has(layer) || hiddenObjects.has(uuid)) continue
		const node = compose(P, moved[uuid] || IDENTITY)
		const fixture = !!o.fixture || o.kind === 'Fixture'
		for (const p of o.parts || []) {
			if (!p || typeof p.mesh !== 'string') continue
			out.push({ key: p.mesh, xf: compose(node, xf12(p.xform)), layer, uuid, fixture, color: hexToLinear(colors[layer]) })
		}
	}
	return out
}

/** Stage objects (LED walls, TVs, projection screens) as boxes: [{ name, xf (unit box → world), color }]. */
function stageObjectBoxes(objects) {
	const out = []
	for (const o of Array.isArray(objects) ? objects : []) {
		if (!o || typeof o !== 'object' || o.visible === false) continue
		const pos = Array.isArray(o.position) ? o.position.map(num) : [0, 0, 0]
		const rot = (Array.isArray(o.rotation) ? o.rotation.map(num) : [0, 0, 0]).map((d) => (d * Math.PI) / 180)
		let w = 1, h = 1, depth = Math.max(0.05, num(o.depth_m) || 0.06)
		if (o.type === 'led_wall' && Array.isArray(o.panels) && Array.isArray(o.panel_mm)) {
			w = (num(o.panel_mm[0]) * num(o.panels[0])) / 1000
			h = (num(o.panel_mm[1]) * num(o.panels[1])) / 1000
		} else if (o.type === 'tv') {
			const a = Array.isArray(o.aspect) && num(o.aspect[1]) ? num(o.aspect[0]) / num(o.aspect[1]) : 16 / 9
			const diag = (num(o.diagonal_in) || 65) * 0.0254
			h = diag / Math.sqrt(1 + a * a)
			w = a * h
			if (o.portrait) [w, h] = [h, w]
		} else if (o.type === 'projection' && Array.isArray(o.screen_m)) {
			w = num(o.screen_m[0])
			h = num(o.screen_m[1])
			depth = 0.03
		}
		if (!(w > 0.01 && h > 0.01) || w > 200 || h > 100) continue
		// Godot rotation_degrees, rotation order YXZ: basis = Ry · Rx · Rz. Object origin = bottom-centre of the picture,
		// the picture faces +Z, the cabinet is behind it.
		const R = compose(rotY(rot[1]), compose(rotX(rot[0]), rotZ(rot[2])))
		R[9] = pos[0]
		R[10] = pos[1]
		R[11] = pos[2]
		const body = compose(R, [w, 0, 0, 0, h, 0, 0, 0, depth, 0, h / 2, -depth / 2])
		const face = compose(R, [w, 0, 0, 0, h, 0, 0, 0, 0.01, 0, h / 2, 0.006])
		out.push({ name: String(o.name || o.id || o.type), xf: body, color: [0.02, 0.02, 0.025, 1] })
		out.push({ name: `${o.name || o.id} picture`, xf: face, color: [0.05, 0.09, 0.2, 1] })
	}
	return out
}

/** project.previs.tracking.grid (PSN: x stage left, y upstage, z up; centred rect) → the stage floor or null. */
function stageFloor(grid) {
	const g = grid && typeof grid === 'object' ? grid : null
	if (!g || !(num(g.width) > 0) || !(num(g.depth) > 0)) return null
	const w = num(g.width), d = num(g.depth), x = num(g.x_offset), y = num(g.y_offset)
	return { id: 'stage', y: round3(num(g.z_offset)), rect: [x - w / 2, -(y + d / 2), x + w / 2, -(y - d / 2)].map(round3) }
}

/**
 * The hall: the lowest large horizontal surface (parts ≤ 0.2 m thick, ≥ 4 m² each, ≥ 20 m² together at one level);
 * its rect = the bbox of those surfaces ∩ the scene's footprint. None → y 0 and the footprint (no geometry → 30 × 20 m
 * around the stage or the origin).
 */
function hallFloor(boxes, footprint, stage) {
	const flat = boxes.filter((b) => b.max[1] - b.min[1] <= 0.2 && (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]) >= 4 &&
		(!stage || b.max[1] < stage.y - 0.3))
	flat.sort((a, b) => a.max[1] - b.max[1])
	for (const f of flat) {
		const level = flat.filter((g) => Math.abs(g.max[1] - f.max[1]) <= 0.1)
		const area = level.reduce((s, g) => s + (g.max[0] - g.min[0]) * (g.max[2] - g.min[2]), 0)
		if (area < 20) continue
		const r = [Infinity, Infinity, -Infinity, -Infinity]
		for (const g of level) {
			r[0] = Math.min(r[0], g.min[0]); r[1] = Math.min(r[1], g.min[2])
			r[2] = Math.max(r[2], g.max[0]); r[3] = Math.max(r[3], g.max[2])
		}
		const fp = footprint || r
		const rect = [Math.max(r[0], fp[0]), Math.max(r[1], fp[1]), Math.min(r[2], fp[2]), Math.min(r[3], fp[3])]
		if (rect[2] - rect[0] >= 4 && rect[3] - rect[1] >= 4) return { id: 'hall', y: round3(f.max[1]), rect: rect.map(round3) }
	}
	if (footprint && footprint[2] - footprint[0] >= 4 && footprint[3] - footprint[1] >= 4) return { id: 'hall', y: 0, rect: footprint.map(round3) }
	const cx = stage ? (stage.rect[0] + stage.rect[2]) / 2 : 0, cz = stage ? (stage.rect[1] + stage.rect[3]) / 2 : 0
	const { w, d } = DEFAULT_HALL
	return { id: 'hall', y: 0, rect: [cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2].map(round3) }
}

const round3 = (v) => Math.round(v * 1000) / 1000

/**
 * Occupancy of one floor's car slab (floor.y + 0.05 … + 0.6 m), filled from world triangles; `rects()` merges the
 * cells into rectangles (row runs, then equal runs stacked).
 */
function slabGrid(floor, cell) {
	const r = floor.rect
	const x0 = r[0] - 1, z0 = r[1] - 1
	const nx = Math.max(1, Math.ceil((r[2] - r[0] + 2) / cell)), nz = Math.max(1, Math.ceil((r[3] - r[1] + 2) / cell))
	const occ = new Uint8Array(nx * nz)
	const lo = floor.y + OBSTACLE_EPS, hi = floor.y + CAR_HEIGHT
	const mark = (x, z) => {
		const i = Math.floor((x - x0) / cell), k = Math.floor((z - z0) / cell)
		if (i >= 0 && k >= 0 && i < nx && k < nz) occ[k * nx + i] = 1
	}
	return {
		cell,
		/** One triangle (9 world floats) — sampled at cell / 2 within the slab. */
		tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
			if (Math.max(ay, by, cy) <= lo || Math.min(ay, by, cy) >= hi) return
			if (Math.max(ax, bx, cx) < x0 || Math.min(ax, bx, cx) > x0 + nx * cell) return
			if (Math.max(az, bz, cz) < z0 || Math.min(az, bz, cz) > z0 + nz * cell) return
			const e = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz))
			const n = Math.min(400, Math.max(1, Math.ceil(e / (cell / 2))))
			for (let i = 0; i <= n; i++) {
				for (let j = 0; j <= n - i; j++) {
					const u = i / n, v = j / n, w = 1 - u - v
					const y = w * ay + u * by + v * cy
					if (y > lo && y < hi) mark(w * ax + u * bx + v * cx, w * az + u * bz + v * cz)
				}
			}
		},
		/** A solid box [min, max] (e.g. an elevated stage seen from the hall). */
		box(min, max) {
			if (max[1] <= lo || min[1] >= hi) return
			for (let x = min[0]; x <= max[0] + 1e-9; x += cell / 2) for (let z = min[2]; z <= max[2] + 1e-9; z += cell / 2) mark(x, z)
		},
		rects() {
			const out = []
			let open = new Map() // "i0,i1" → rect index (run continuing from the row above)
			for (let k = 0; k < nz; k++) {
				const next = new Map()
				let i = 0
				while (i < nx) {
					if (!occ[k * nx + i]) {
						i++
						continue
					}
					const s = i
					while (i < nx && occ[k * nx + i]) i++
					const key = `${s},${i}`
					const at = open.get(key)
					if (at != null) out[at][3] = z0 + (k + 1) * cell
					else out.push([x0 + s * cell, z0 + k * cell, x0 + i * cell, z0 + (k + 1) * cell])
					next.set(key, at != null ? at : out.length - 1)
				}
				open = next
			}
			return out
		},
	}
}

/** Merge rects that overlap or touch (within eps) until stable. */
function mergeRects(rects, eps) {
	let cur = rects.map((r) => [...r])
	for (let changed = true; changed; ) {
		changed = false
		const out = []
		for (const r of cur) {
			const hit = out.find((o) => r[0] <= o[2] + eps && o[0] <= r[2] + eps && r[1] <= o[3] + eps && o[1] <= r[3] + eps)
			if (hit) {
				hit[0] = Math.min(hit[0], r[0]); hit[1] = Math.min(hit[1], r[1])
				hit[2] = Math.max(hit[2], r[2]); hit[3] = Math.max(hit[3], r[3])
				changed = true
			} else out.push(r)
		}
		cur = out
	}
	return cur
}

/** Per-floor rects → obstacle boxes (≤ MAX_OBSTACLES: rects are merged with a growing gap until they fit). */
function obstaclesFrom(perFloor) {
	let eps = 0
	for (;;) {
		const out = []
		for (const { floor, rects } of perFloor) {
			for (const r of eps > 0 ? mergeRects(rects, eps) : rects) {
				out.push({ min: [round3(r[0]), round3(floor.y), round3(r[1])], max: [round3(r[2]), round3(floor.y + CAR_HEIGHT), round3(r[3])] })
			}
		}
		if (out.length <= MAX_OBSTACLES || eps > 50) return out.slice(0, MAX_OBSTACLES)
		eps = eps ? eps * 2 : 0.01
	}
}

module.exports = {
	IDENTITY,
	compose,
	apply,
	scaleOf,
	boxUnder,
	visibleParts,
	stageObjectBoxes,
	stageFloor,
	hallFloor,
	slabGrid,
	obstaclesFrom,
}

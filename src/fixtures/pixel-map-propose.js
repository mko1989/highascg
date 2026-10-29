'use strict'

/**
 * WO-807 — automatic edge proposal: every linear pixel fixture (a PixelLine bar) that stands next to an LED wall's edge
 * gets its colour pixels mapped to a strip of the wall's picture just inside that edge, so the bar continues the screen.
 * Pure: the caller (pixel-map-proposal.js) supplies the walls and the fixtures.
 *
 * Frames. Everything here is in the Godot stage frame (x stage left, y up, z towards the audience, metres) — the frame
 * of `project.previs.stage.objects` (stage_objects.gd). A fixture's pose is PSN (x, y upstage, z up); fixtureOf turns
 * it with gdtf-ik.js poseXf, the previs's own placement (fixtures_3d_model.gd pose_xform: Godot = (x, z, −y)).
 *
 * Wall (wallOf): an led_wall stage object. Its position is the bottom centre of the picture, its yaw (rotation[1])
 * turns it about up (Godot Vector3.rotated(UP, yaw): local x = (cos, 0, −sin)), its size is panels × panel_mm, and its
 * picture is `source.rect` of the channel it is bound to (role pgmN / prvN / chN → the Caspar channel; the whole raster
 * when the object has no rect). Raster x runs along local +x (left → right seen from the audience), raster y top → down.
 * Pitch / roll and curve are ignored (flat, upright) and reported.
 *
 * Fixture (fixtureOf): its colour-mixing pixels (pixel-map-model.js pixelsOf: a geometry with r g b or c m y channels;
 * the PixelLine's 16 RGB cells, not its 16 white segments) and, when the GDTF rig (gdtf-rig.js) is known, each pixel's
 * world position = pose · the rig's node transforms, at the mean of the pixel geometry's Beam nodes. "Linear" = at least
 * 4 such pixels on one line (each within 10 % of the first → last span from it); only linear fixtures are proposed.
 *
 * Rule (proposePixelMappings), per fixture:
 *  - edge: the nearest of the four edges of every wall — the 3-D distance from the fixture's centre (mean of its pixels,
 *    else the pose) to the edge segment. Beyond `threshold_m` (default 1.5 m) the fixture is not mapped (a warning).
 *  - spacing: GDTF positions → the fixture's own pixel pitch (first → last pixel distance / (n − 1)); the pixels are laid
 *    along the edge centred on the fixture's centre projected onto it, in the order the real pixels run along it.
 *    Unknown positions → length = the distance from the fixture's foot on the edge to that edge's nearest corner (the
 *    whole edge when the foot is on a corner), n cells of length / n centred on the foot.
 *  - rect: along the edge, the pixel's cell (spacing × the wall's px per metre along that edge, rounded, ≥ 1) centred on
 *    the pixel; across it, `depth_px` (default 40) starting `inset_px` (default 50) inside the edge. Clamped to the
 *    wall's rect (a pixel past the edge's end is counted in off_edge). Rects of neighbouring fixtures may overlap.
 */

const { pixelsOf } = require('./pixel-map-model')
const { poseXf } = require('./gdtf-ik')

const DEFAULTS = Object.freeze({ inset_px: 50, depth_px: 40, threshold_m: 1.5, mode: 'average' })
const EDGES = ['left', 'right', 'top', 'bottom']
const MIN_LINEAR_PIXELS = 4
const LINEAR_TOL = 0.1
const RAD = Math.PI / 180

const r3 = (v) => Math.round(v * 1000) / 1000
const r2 = (v) => Math.round(v * 100) / 100
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)

/** 12-number affine product (basis x, y, z columns, origin) — gdtf-ik.js / gdtf-rig.js layout. */
function mul(a, b) {
	const o = new Array(12)
	for (let c = 0; c < 4; c++) {
		for (let r = 0; r < 3; r++) {
			o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2] + (c === 3 ? a[9 + r] : 0)
		}
	}
	return o
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a) => Math.sqrt(dot(a, a))
const mean = (ps) => [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k], 0) / ps.length)

/** Options with defaults; numbers clamped to sane ranges. */
function normalizeOptions(o = {}) {
	return {
		inset_px: Math.round(Math.max(0, Math.min(4096, num(o.inset_px, DEFAULTS.inset_px)))),
		depth_px: Math.round(Math.max(1, Math.min(4096, num(o.depth_px, DEFAULTS.depth_px)))),
		threshold_m: Math.max(0.01, Math.min(50, num(o.threshold_m, DEFAULTS.threshold_m))),
		mode: o.mode === 'point' ? 'point' : 'average',
	}
}

/**
 * An led_wall stage object bound to channel `channelNo` (raster { w, h }) → the wall, or null.
 * @param {object} o project.previs.stage.objects entry
 * @param {{ channelNo: number, raster: { w: number, h: number } | null }} bind
 */
function wallOf(o, { channelNo, raster } = {}) {
	if (!o || o.type !== 'led_wall' || !(channelNo > 0) || !raster || !(raster.w > 0 && raster.h > 0)) return null
	const pmm = Array.isArray(o.panel_mm) ? o.panel_mm : [500, 500]
	const pn = Array.isArray(o.panels) ? o.panels : [1, 1]
	const W = (num(pmm[0], 500) * num(pn[0], 1)) / 1000
	const H = (num(pmm[1], 500) * num(pn[1], 1)) / 1000
	if (!(W > 0 && H > 0)) return null
	const s = o.source?.rect
	const x = Math.max(0, Math.round(num(s?.x, 0)))
	const y = Math.max(0, Math.round(num(s?.y, 0)))
	const rect = s ? { x, y, w: Math.min(raster.w - x, Math.round(num(s.w, raster.w))), h: Math.min(raster.h - y, Math.round(num(s.h, raster.h))) }
		: { x: 0, y: 0, w: raster.w, h: raster.h }
	if (!(rect.w > 0 && rect.h > 0)) return null
	const pos = Array.isArray(o.position) ? o.position.map((v) => num(v, 0)) : [0, 0, 0]
	const rot = Array.isArray(o.rotation) ? o.rotation.map((v) => num(v, 0)) : [0, 0, 0]
	const notes = []
	if (rot[0] || rot[2]) notes.push('pitch / roll ignored (treated as upright)')
	if (num(o.curve_deg, 0)) notes.push('curve ignored (treated as flat)')
	return { id: String(o.id || ''), name: String(o.name || o.id || 'LED wall'), channelNo, raster: { w: raster.w, h: raster.h },
		rect, position: pos, yaw: rot[1], size_m: [r3(W), r3(H)], notes }
}

/** Point (Godot frame) → the wall's local { u (along +x from the centre), v (up from the bottom), n (in front) }. */
function toLocal(wall, p) {
	const t = wall.yaw * RAD
	const d = sub(p, wall.position)
	return { u: d[0] * Math.cos(t) - d[2] * Math.sin(t), v: d[1], n: d[0] * Math.sin(t) + d[2] * Math.cos(t) }
}

/** 3-D distance from a local point to one edge segment of the wall. */
function edgeDistance(wall, edge, l) {
	const [W, H] = wall.size_m
	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
	const vertical = edge === 'left' || edge === 'right'
	const du = vertical ? l.u - (edge === 'left' ? -W / 2 : W / 2) : l.u - clamp(l.u, -W / 2, W / 2)
	const dv = vertical ? l.v - clamp(l.v, 0, H) : l.v - (edge === 'top' ? H : 0)
	return Math.sqrt(du * du + dv * dv + l.n * l.n)
}

/** Metres along the edge from its raster start (vertical edges: from the top down; horizontal: from the left). */
function alongEdge(wall, edge, l) {
	const [W, H] = wall.size_m
	return edge === 'left' || edge === 'right' ? H - l.v : l.u + W / 2
}

/** World (Godot) positions of the rig's nodes for a pose. */
function nodeWorld(rig, pose) {
	const base = poseXf(pose || {})
	const out = []
	for (const n of rig?.nodes || []) {
		const parent = n.parent >= 0 && out[n.parent] ? out[n.parent] : base
		out.push(Array.isArray(n.xf) && n.xf.length === 12 ? mul(parent, n.xf) : parent)
	}
	return out
}

/**
 * A normalized patch entry (follow-patch.js, with fx.gdtf from the type) and its GDTF rig (or null) → the fixture for
 * the proposal: { id, name, problem, centre, pixels: [{ pixel, geometry, pos | null }], linear, span_m }.
 */
function fixtureOf(fx, rig = null) {
	const colour = pixelsOf(fx)
	const mixes = (o) => ['r', 'g', 'b'].every((k) => o.includes(k)) || ['c', 'm', 'y'].every((k) => o.includes(k))
	const mixing = colour.filter((p) => mixes(p.order))
	const list = mixing.length ? mixing : colour
	const m = poseXf(fx?.pose || {})
	const origin = [m[9], m[10], m[11]]
	const pixels = list.map((p) => ({ pixel: p.pixel, geometry: p.geometry, pos: null }))
	if (rig?.nodes?.length) {
		const world = nodeWorld(rig, fx.pose)
		const index = new Map(rig.nodes.map((n, i) => [n.id, i]))
		const owner = (i) => {
			for (let j = i, guard = 0; j >= 0 && guard < 64; j = rig.nodes[j].parent, guard++) {
				const hit = pixels.find((p) => p.geometry === rig.nodes[j].id)
				if (hit) return hit
			}
			return null
		}
		const beams = new Map()
		rig.nodes.forEach((n, i) => {
			if (n.kind !== 'Beam') return
			const p = owner(i)
			if (!p) return
			if (!beams.has(p)) beams.set(p, [])
			beams.get(p).push([world[i][9], world[i][10], world[i][11]])
		})
		for (const p of pixels) {
			if (beams.has(p)) p.pos = mean(beams.get(p))
			else if (index.has(p.geometry)) {
				const w = world[index.get(p.geometry)]
				p.pos = [w[9], w[10], w[11]]
			}
		}
	}
	const placed = pixels.every((p) => p.pos)
	let linear = pixels.length >= MIN_LINEAR_PIXELS
	let span = 0
	if (linear && placed) {
		const a = pixels[0].pos
		const ab = sub(pixels[pixels.length - 1].pos, a)
		span = len(ab)
		linear = span >= 0.05 && pixels.every((p) => {
			const ap = sub(p.pos, a)
			const t = dot(ap, ab) / (span * span)
			return len(sub(ap, ab.map((k) => k * t))) <= LINEAR_TOL * span
		})
	}
	return { id: String(fx?.id || ''), name: String(fx?.name || fx?.id || ''), problem: fx?.problem || null,
		centre: placed && pixels.length ? mean(pixels.map((p) => p.pos)) : origin, pixels: placed ? pixels : pixels.map((p) => ({ ...p, pos: null })),
		linear, span_m: r3(span) }
}

/** The nearest wall edge to point p → { wall, edge, distance, local } or null (no walls). */
function nearestEdge(walls, p) {
	let best = null
	for (const wall of walls) {
		const l = toLocal(wall, p)
		for (const edge of EDGES) {
			const d = edgeDistance(wall, edge, l)
			if (!best || d < best.distance - 1e-9) best = { wall, edge, distance: d, local: l }
		}
	}
	return best
}

/** The pixel rects along `edge` of `wall` for along-edge positions ts (metres) and cell length cell_m. */
function rectsOnEdge(wall, edge, ts, cell_m, opts) {
	const vertical = edge === 'left' || edge === 'right'
	const { rect } = wall
	const [W, H] = wall.size_m
	const ppm = vertical ? rect.h / H : rect.w / W
	const start = vertical ? rect.y : rect.x
	const span = vertical ? rect.h : rect.w
	const across = vertical ? rect.w : rect.h
	const size = Math.max(1, Math.min(span, Math.round(cell_m * ppm)))
	const depth = Math.max(1, Math.min(opts.depth_px, across))
	const inset = Math.max(0, Math.min(opts.inset_px, across - depth))
	const near = edge === 'left' ? rect.x + inset : edge === 'top' ? rect.y + inset
		: edge === 'right' ? rect.x + rect.w - inset - depth : rect.y + rect.h - inset - depth
	let offEdge = 0
	const rects = ts.map((t) => {
		const c = start + t * ppm
		if (c < start || c > start + span) offEdge++
		const a = Math.max(start, Math.min(start + span - size, Math.round(c - size / 2)))
		return vertical ? { x: near, y: a, w: depth, h: size } : { x: a, y: near, w: size, h: depth }
	})
	return { rects, size, ppm, offEdge, inset, depth }
}

/**
 * @param {{ walls: object[], fixtures: object[] }} input walls from wallOf, fixtures from fixtureOf (linear ones)
 * @param {object} [options] { inset_px, depth_px, threshold_m, mode }
 * @returns {{ params, walls, mappings, fixtures, mapped, out_of_range, skipped }}
 */
function proposePixelMappings({ walls = [], fixtures = [] } = {}, options = {}) {
	const opts = normalizeOptions(options)
	const ws = walls.filter(Boolean)
	const mappings = []
	const summaries = []
	for (const f of fixtures) {
		const base = { fixtureId: f.id, name: f.name, pixels: f.pixels.length }
		if (f.problem) {
			summaries.push({ ...base, mapped: false, warning: `patch problem: ${f.problem} — not mapped` })
			continue
		}
		const hit = nearestEdge(ws, f.centre)
		if (!hit) {
			summaries.push({ ...base, mapped: false, warning: 'no LED wall bound to a running channel — not mapped' })
			continue
		}
		const where = { wall: hit.wall.id, wallName: hit.wall.name, channelNo: hit.wall.channelNo, edge: hit.edge, distance_m: r3(hit.distance) }
		if (hit.distance > opts.threshold_m) {
			summaries.push({ ...base, ...where, mapped: false,
				warning: `nearest edge (${hit.wall.name} ${hit.edge}) is ${r2(hit.distance)} m away, beyond ${opts.threshold_m} m — not mapped` })
			continue
		}
		const n = f.pixels.length
		const L = hit.edge === 'left' || hit.edge === 'right' ? hit.wall.size_m[1] : hit.wall.size_m[0]
		const tc = alongEdge(hit.wall, hit.edge, hit.local)
		let ts
		let cell
		let rule
		if (n >= 2 && f.pixels.every((p) => p.pos)) {
			cell = len(sub(f.pixels[n - 1].pos, f.pixels[0].pos)) / (n - 1)
			const run = alongEdge(hit.wall, hit.edge, toLocal(hit.wall, f.pixels[n - 1].pos)) - alongEdge(hit.wall, hit.edge, toLocal(hit.wall, f.pixels[0].pos))
			const dir = run < 0 ? -1 : 1
			ts = f.pixels.map((_, i) => tc + (i - (n - 1) / 2) * cell * dir)
			rule = 'gdtf'
		} else {
			const foot = Math.max(0, Math.min(L, tc))
			const length = Math.min(foot, L - foot) || L
			cell = length / n
			ts = f.pixels.map((_, i) => foot - length / 2 + (i + 0.5) * cell)
			rule = 'corner'
		}
		const r = rectsOnEdge(hit.wall, hit.edge, ts, cell, opts)
		f.pixels.forEach((p, i) => {
			mappings.push({ id: `auto-${f.id}-${p.pixel}`.slice(0, 64), enabled: true, fixtureId: f.id, pixel: p.pixel,
				channelNo: hit.wall.channelNo, rect: r.rects[i], mode: opts.mode, colourOrder: 'auto' })
		})
		summaries.push({ ...base, ...where, mapped: true, rule, spacing_m: r3(cell), spacing_px: r.size, spacing_px_exact: r2(cell * r.ppm),
			inset_px: r.inset, depth_px: r.depth, off_edge: r.offEdge, rects: r.rects,
			warning: r.offEdge ? `${r.offEdge} pixel(s) lie past the end of the ${hit.edge} edge — clamped to the wall` : null })
	}
	const mapped = summaries.filter((s) => s.mapped).length
	return { params: opts, walls: ws.map((w) => ({ id: w.id, name: w.name, channelNo: w.channelNo, rect: w.rect, size_m: w.size_m, notes: w.notes })),
		mappings, fixtures: summaries, mapped, out_of_range: summaries.length - mapped }
}

module.exports = { DEFAULTS, EDGES, normalizeOptions, wallOf, fixtureOf, toLocal, edgeDistance, nearestEdge, proposePixelMappings }

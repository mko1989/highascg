'use strict'

/**
 * WO-1074 §2.6 — the previs's fixture forward kinematics, server side, for the RC game's lights: where a patched GDTF
 * head points, in the Godot / three.js frame (x stage left, y up, z towards the audience). Pure.
 *
 * Same chain as godot/client/features/previs/fixtures/fixtures_3d.gd `_build` + `apply` (and gdtf-ik.js, its twin):
 *   root  = pose_xform(pose)           position (x, z, −y); Basis.from_euler(pitch, −yaw, roll) (YXZ); floor hang =
 *                                      an extra 180° about Z — reused from gdtf-ik.js `poseXf`
 *   node  = parent · xf                the gdtf-rig.js node transforms (already in Godot's frame)
 *         · Ry(deg)  (axis "pan")      fixtures_3d_model.gd axis_basis: pan about the node's UP,
 *         · Rx(deg)  (axis "tilt")     tilt about its RIGHT, by the decoded physical degrees (visual().axes[node id])
 *   beam  = the Beam node's −Y         (fixtures_3d.gd `_beam`: lens, cone and light hang along −Y)
 * A head with no Pan / Tilt (or no axes value yet) points along its mounted rest direction.
 *
 *   fk(rig, pose, axes)          → { beams: [{ id, o: [x,y,z], d: unit [x,y,z], driven, type, angle }], pivot: [x,y,z] }
 *   lightOf(fx, rig, typeName)   → the static scene entry { id, name, p, kind } (no `i`; the caller numbers them)
 *   headFrame(rig, pose, vis)    → [dx, dy, dz, r, g, b, a, zoomDeg] — one entry per head (mean colour of the lit beams
 *                                  weighted by intensity, max intensity, widest zoom, intensity-weighted mean direction)
 */

const { core } = require('./host')
const { poseXf } = core('src/fixtures/gdtf-ik')

const RAD = Math.PI / 180
const CELL_BEAMS = 4 // fixtures_3d_model.gd CELL_BEAMS: more beams than this and no Pan / Tilt = a bar / panel of cells

/** 12-number affine products (basis x, y, z columns, origin) — the gdtf-rig.js / gdtf-ik.js layout. */
function mul(a, b) {
	const o = new Array(12)
	for (let c = 0; c < 4; c++) {
		for (let r = 0; r < 3; r++) {
			o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2] + (c === 3 ? a[9 + r] : 0)
		}
	}
	return o
}

/** Godot Basis(Vector3.UP, θ) — x column (cos, 0, −sin). */
function rotY(deg) {
	const c = Math.cos(deg * RAD)
	const s = Math.sin(deg * RAD)
	return [c, 0, -s, 0, 1, 0, s, 0, c, 0, 0, 0]
}

/** Godot Basis(Vector3.RIGHT, θ) — y column (0, cos, sin). */
function rotX(deg) {
	const c = Math.cos(deg * RAD)
	const s = Math.sin(deg * RAD)
	return [1, 0, 0, 0, c, s, 0, -s, c, 0, 0, 0]
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]

function unit(v) {
	const n = Math.hypot(v[0], v[1], v[2])
	return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : [0, -1, 0]
}

const xfOf = (xf) => (Array.isArray(xf) && xf.length === 12 && xf.every(Number.isFinite) ? xf : IDENTITY)

/**
 * Forward kinematics of one rig (gdtf-store.js `visual(typeId, mode).rig`) at a pose and axis angles.
 * `pivot` = the origin of the deepest Pan / Tilt node above the first beam (the head's tilt pivot: it stays put while
 * the head pans and tilts, and the beam passes through it), else the mean beam origin, else the pose point.
 */
function fk(rig, pose, axes = {}) {
	const nodes = Array.isArray(rig?.nodes) ? rig.nodes : []
	const root = poseXf(pose || {})
	const world = new Array(nodes.length)
	const beams = []
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i] || {}
		const parent = Number.isInteger(n.parent) && n.parent >= 0 && n.parent < i ? world[n.parent] : root
		let m = mul(parent, xfOf(n.xf))
		const deg = Number(axes?.[n.id])
		if (n.axis === 'pan' && Number.isFinite(deg)) m = mul(m, rotY(deg))
		else if (n.axis === 'tilt' && Number.isFinite(deg)) m = mul(m, rotX(deg))
		world[i] = m
		if (n.kind === 'Beam') {
			beams.push({
				id: n.id,
				o: [m[9], m[10], m[11]],
				d: unit([-m[3], -m[4], -m[5]]),
				driven: n.beam?.driven !== false,
				type: String(n.beam?.beamType || 'Wash'),
				angle: Number(n.beam?.beamAngle) || 25,
			})
		}
	}
	let pivot = null
	const first = nodes.findIndex((n) => n?.kind === 'Beam')
	for (let j = first, guard = 0; j >= 0 && guard < 64; j = nodes[j].parent, guard++) {
		if (nodes[j].axis === 'pan' || nodes[j].axis === 'tilt') {
			pivot = [world[j][9], world[j][10], world[j][11]]
			break
		}
		if (!Number.isInteger(nodes[j].parent)) break
	}
	if (!pivot && beams.length) {
		pivot = [0, 1, 2].map((k) => beams.reduce((s, b) => s + b.o[k], 0) / beams.length)
	}
	if (!pivot) pivot = [root[9], root[10], root[11]]
	return { beams, pivot }
}

/** "spot" | "wash" | "bar" | "strobe" — what the game draws (cone width, glow shape). */
function kindOf(rig, typeName, fixtureName) {
	const nodes = Array.isArray(rig?.nodes) ? rig.nodes : []
	const moving = nodes.some((n) => n?.axis === 'pan' || n?.axis === 'tilt')
	const beams = nodes.filter((n) => n?.kind === 'Beam')
	if (!moving && /strobe/i.test(`${typeName} ${fixtureName}`)) return 'strobe'
	if (!moving && beams.length > CELL_BEAMS) return 'bar'
	const spot =
		beams.some((n) => n.beam?.beamType === 'Spot') ||
		(beams.length <= CELL_BEAMS && beams.some((n) => (n.beam?.beamAngle ?? 25) <= 20))
	return spot ? 'spot' : 'wash'
}

const r3 = (v) => Math.round(v * 1000) / 1000 || 0 // never −0 (JSON and deepEqual see it as a change)

/** The static scene entry for a patched typed fixture (normalised by follow-patch.js). */
function lightOf(fx, rig, typeName = '') {
	const { pivot } = fk(rig, fx.pose, {})
	return {
		id: String(fx.id),
		name: String(fx.name || fx.id).slice(0, 64),
		p: pivot.map(r3),
		kind: kindOf(rig, typeName, fx.name),
	}
}

/**
 * One head's realtime entry from its visual() record ({ axes, beams: { nodeId: { i, c, zoom } } }) or null (dark).
 * A beam the mode does not drive (beam.driven false) never counts. → [dx, dy, dz, r, g, b, a, zoom]
 */
function headFrame(rig, pose, vis) {
	const k = fk(rig, pose, vis?.axes || {})
	const beams = k.beams.filter((b) => b.driven)
	const list = beams.length ? beams : k.beams
	let a = 0
	let wsum = 0
	const col = [0, 0, 0]
	const dir = [0, 0, 0]
	let zoom = 0
	let zoomAll = 0
	for (const b of list) {
		const v = vis?.beams?.[b.id]
		const i = v && Number.isFinite(v.i) ? Math.max(0, Math.min(1, v.i)) : 0
		const c =
			v && Array.isArray(v.c) && v.c.length === 3 ? v.c.map((x) => Math.max(0, Math.min(1, Number(x) || 0))) : [1, 1, 1]
		const z = v && Number.isFinite(v.zoom) ? v.zoom : b.angle
		a = Math.max(a, i)
		zoomAll = Math.max(zoomAll, z)
		if (i > 0) zoom = Math.max(zoom, z)
		const w = i > 0 ? i : 1e-3
		wsum += w
		for (let n = 0; n < 3; n++) {
			col[n] += c[n] * w
			dir[n] += b.d[n] * w
		}
	}
	const d = list.length ? unit(dir) : [0, -1, 0]
	const c = wsum > 0 ? col.map((x) => x / wsum) : [1, 1, 1]
	return [
		r3(d[0]),
		r3(d[1]),
		r3(d[2]),
		r3(c[0]),
		r3(c[1]),
		r3(c[2]),
		r3(a),
		Math.round((zoom || zoomAll || 25) * 10) / 10,
	]
}

module.exports = { fk, kindOf, lightOf, headFrame, mul, rotX, rotY }

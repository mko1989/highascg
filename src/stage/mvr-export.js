'use strict'

/**
 * WO-612 T7 — the WO-614 stage (project.previs.stage.objects: LED walls, TVs, projection screens) → an MVR 1.6 archive
 * other tools (Capture, consoles, Perastage) open: one `VideoScreen` per object with a generated GLB, its picture source
 * as `Sources/Source type="CaptureDevice"` (`highascg:<role>`, the design's proposal) and its crop as an AUXData
 * `MappingDefinition` per role (the role's raster) + a per-object `Mapping` (ux/uy offset, ox/oy size, px).
 * Geometry is written in the object's own frame (glTF: Y-up metres, origin bottom-centre, picture facing +Z — the
 * Godot stage frame) and placed by the inverse of the importer's transform, so an export re-imports where it was.
 * UUIDs derive from the object ids: a re-export updates the same objects in the receiving tool. Pure.
 */

const crypto = require('crypto')
const { mul, MVR_FROM_GLTF, GODOT_FROM_MVR } = require('./mvr-math')
const { writeGlb } = require('./glb-write')
const { buildZipStore } = require('../support/zip-store')

const DARK = [0.03, 0.03, 0.035, 1]
const SCREEN = [0.08, 0.1, 0.14, 1]
const LIGHT = [0.85, 0.85, 0.85, 1]

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const vec = (v, n, d) => Array.from({ length: n }, (_, i) => num(Array.isArray(v) ? v[i] : undefined, d[i]))
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])
const r6 = (v) => Math.round(v * 1e6) / 1e6 || 0

/** Stable MVR uuid (uppercase 8-4-4-4-12) from a seed. */
function uuidOf(seed) {
	const h = crypto.createHash('sha1').update(String(seed)).digest('hex').toUpperCase()
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/** Picture size in metres — stage_objects.gd size_m (flat width for a curved wall). */
function sizeM(o) {
	if (o.type === 'tv') {
		const [aw, ah] = vec(o.aspect, 2, [16, 9])
		const a = aw / ah
		const h = (num(o.diagonal_in, 65) * 0.0254) / Math.sqrt(1 + a * a)
		return o.portrait === true ? [h, a * h] : [a * h, h]
	}
	if (o.type === 'projection') return vec(o.screen_m, 2, [4, 2.25])
	const [pw, ph] = vec(o.panel_mm, 2, [500, 500])
	const [cols, rows] = vec(o.panels, 2, [10, 6])
	return [(pw * cols) / 1000, (ph * rows) / 1000]
}

/** LED wall column edges (x, z) — stage_objects.gd column_edges (curve_deg between neighbouring panels). */
function columnEdges(o) {
	const cols = Math.max(1, Math.round(num(vec(o.panels, 2, [10, 6])[0], 10)))
	const pw = num(vec(o.panel_mm, 2, [500, 500])[0], 500) / 1000
	const curve = (num(o.curve_deg, 0) * Math.PI) / 180
	const out = []
	if (Math.abs(curve) < 1e-6) {
		for (let j = 0; j <= cols; j++) out.push([(j - cols / 2) * pw, 0])
		return out
	}
	const r = pw / 2 / Math.sin(Math.abs(curve) / 2)
	for (let j = 0; j <= cols; j++) {
		const phi = (j - cols / 2) * Math.abs(curve)
		out.push([r * Math.sin(phi), Math.sign(curve) * r * (1 - Math.cos(phi))])
	}
	return out
}

/** Vertical strip through the edges from y 0 → h, pushed back by `back` m (stage_builder.gd _strip), as a primitive. */
function strip(edges, h, back, color) {
	const pos = []
	const idx = []
	for (let j = 0; j + 1 < edges.length; j++) {
		const [x0, z0] = edges[j]
		const [x1, z1] = edges[j + 1]
		const l = Math.hypot(x1 - x0, z1 - z0) || 1
		const [nx, nz] = [-(z1 - z0) / l, (x1 - x0) / l]
		const b = pos.length / 3
		pos.push(x0 - nx * back, 0, z0 - nz * back, x1 - nx * back, 0, z1 - nz * back, x1 - nx * back, h, z1 - nz * back, x0 - nx * back, h, z0 - nz * back)
		idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
	}
	return { positions: new Float32Array(pos), indices: new Uint32Array(idx), color }
}

/** Axis-aligned box centred at c with size s. */
function box(c, s, color) {
	const [hx, hy, hz] = s.map((v) => v / 2)
	const pos = []
	for (const [x, y, z] of [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]) pos.push(c[0] + x * hx, c[1] + y * hy, c[2] + z * hz)
	const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 6, 2, 3, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]
	return { positions: new Float32Array(pos), indices: new Uint32Array(idx), color }
}

/** One object's geometry (object frame) → primitives. */
function primitives(o) {
	const [w, h] = sizeM(o)
	if (o.type === 'tv') {
		const b = num(o.bezel_mm, 10) / 1000
		const d = Math.max(0.01, num(o.depth_m, 0.06))
		return [strip([[-w / 2, 0], [w / 2, 0]], h, 0, SCREEN), box([0, h / 2, -d / 2 - 0.002], [w + 2 * b, h + 2 * b, d], DARK)]
	}
	if (o.type === 'projection') {
		const throwM = num(o.throw, 1.5) * w
		const p = [0, h * (0.5 + num(o.lens_shift_v, 0)), o.rear === true ? -throwM : throwM]
		return [strip([[-w / 2, 0], [w / 2, 0]], h, 0, LIGHT), box(p, [0.45, 0.18, 0.4], DARK)]
	}
	const edges = columnEdges(o)
	const out = [strip(edges, h, 0, SCREEN)]
	if (num(o.depth_m, 0.08) > 0) out.push(strip(edges, h, num(o.depth_m, 0.08), DARK))
	return out
}

/** Godot Node3D transform (position m, rotation_degrees, YXZ order) → column-major 4×4. */
function godotMatrix(o) {
	const [px, py, pz] = vec(o.position, 3, [0, 0, 0])
	const [rx, ry, rz] = vec(o.rotation, 3, [0, 0, 0]).map((d) => (d * Math.PI) / 180)
	const Rx = [1, 0, 0, 0, 0, Math.cos(rx), Math.sin(rx), 0, 0, -Math.sin(rx), Math.cos(rx), 0, 0, 0, 0, 1]
	const Ry = [Math.cos(ry), 0, -Math.sin(ry), 0, 0, 1, 0, 0, Math.sin(ry), 0, Math.cos(ry), 0, 0, 0, 0, 1]
	const Rz = [Math.cos(rz), Math.sin(rz), 0, 0, -Math.sin(rz), Math.cos(rz), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
	const m = mul(mul(Ry, Rx), Rz)
	m[12] = px
	m[13] = py
	m[14] = pz
	return m
}

/** MVR <Matrix> text: the importer's toGodot inverted (MVR_FROM_GODOT = MVR_FROM_GLTF, GLTF_FROM_MVR = GODOT_FROM_MVR). */
function mvrMatrixText(o) {
	const m = mul(mul(MVR_FROM_GLTF, godotMatrix(o)), GODOT_FROM_MVR)
	const col = (c, k = 1) => `{${[m[c * 4], m[c * 4 + 1], m[c * 4 + 2]].map((v) => r6(v * k)).join(',')}}`
	return `${col(0)}${col(1)}${col(2)}${col(3, 1000)}`
}

/**
 * @param {Array<object>} objects  project.previs.stage.objects
 * @param {{ name?: string, provider?: string, rasterFor?: (role: string) => ({ w: number, h: number } | null) }} [opts]
 * @returns {{ buffer: Buffer, report: { screens: number, skipped: number, roles: string[] } }}
 */
function buildStageMvr(objects, opts = {}) {
	const list = (Array.isArray(objects) ? objects : []).filter((o) => o && typeof o === 'object' && o.visible !== false)
	const files = {}
	const roles = new Map()
	const screens = []
	let skipped = 0
	for (const o of list) {
		const id = String(o.id || '').replace(/[^\w.-]/g, '_')
		if (!id || !['led_wall', 'tv', 'projection'].includes(o.type)) {
			skipped++
			continue
		}
		const file = `${id}.glb`
		files[file] = writeGlb([{ name: id, primitives: primitives(o) }])
		const role = String(o.source?.role || 'pgm1')
		const rect = o.source?.rect || {}
		const crop = { x: Math.max(0, Math.round(num(rect.x))), y: Math.max(0, Math.round(num(rect.y))), w: Math.max(1, Math.round(num(rect.w, 1))), h: Math.max(1, Math.round(num(rect.h, 1))) }
		const r = roles.get(role) || { w: 0, h: 0 }
		roles.set(role, { w: Math.max(r.w, crop.x + crop.w), h: Math.max(r.h, crop.y + crop.h) })
		screens.push({ o, id, file, role, crop })
	}
	const defs = [...roles].map(([role, bbox]) => {
		const raster = opts.rasterFor?.(role)
		const size = raster?.w > 0 && raster?.h > 0 ? raster : bbox
		return { role, uuid: uuidOf(`mapdef:${role}`), w: size.w, h: size.h }
	})
	const defOf = new Map(defs.map((d) => [d.role, d]))
	const xml = [
		'<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
		`<GeneralSceneDescription verMajor="1" verMinor="6" provider="${esc(opts.provider || 'HighAsCG')}" providerVersion="1">`,
		'  <Scene>',
		'    <AUXData>',
		...defs.map((d) => `      <MappingDefinition name="${esc(d.role)}" uuid="${d.uuid}"><SizeX>${d.w}</SizeX><SizeY>${d.h}</SizeY><Source linkedGeometry="" type="CaptureDevice">highascg:${esc(d.role)}</Source><ScaleHandeling>ScaleKeepRatio</ScaleHandeling></MappingDefinition>`),
		'    </AUXData>',
		'    <Layers>',
		`      <Layer name="${esc(opts.name || 'HighAsCG stage')}" uuid="${uuidOf(`layer:${opts.name || 'stage'}`)}">`,
		'        <ChildList>',
		...screens.map(({ o, id, file, role, crop }) => [
			`          <VideoScreen name="${esc(o.name || id)}" uuid="${uuidOf(`screen:${id}`)}">`,
			`            <Matrix>${mvrMatrixText(o)}</Matrix>`,
			`            <Geometries><Geometry3D fileName="${esc(file)}"/></Geometries>`,
			`            <Sources><Source linkedGeometry="${esc(id)}" type="CaptureDevice">highascg:${esc(role)}</Source></Sources>`,
			`            <Mappings><Mapping linkedDef="${defOf.get(role).uuid}"><ux>${crop.x}</ux><uy>${crop.y}</uy><ox>${crop.w}</ox><oy>${crop.h}</oy><rz>0</rz></Mapping></Mappings>`,
			'          </VideoScreen>',
		].join('\n')),
		'        </ChildList>',
		'      </Layer>',
		'    </Layers>',
		'  </Scene>',
		'</GeneralSceneDescription>',
		'',
	].join('\n')
	files['GeneralSceneDescription.xml'] = xml
	return { buffer: buildZipStore(files), report: { screens: screens.length, skipped, roles: [...roles.keys()] } }
}

module.exports = { buildStageMvr, godotMatrix, sizeM }

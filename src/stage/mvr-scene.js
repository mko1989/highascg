'use strict'

/**
 * WO-612 T3 — MVR GeneralSceneDescription.xml → a flat scene the Godot previs instantiates without knowing MVR:
 * objects (layer, kind, fixture patch) each with parts { mesh, xform } where xform is a Godot Transform3D (12 numbers,
 * Y-up metres) and mesh a key served as GLB by GET /api/stage/mvr/<id>/mesh:
 *   mvr:<archive file>  (.glb as-is; .3ds / no extension converted)  ·  gdtf:<gdtf file>:<path inside>  ·  prim:box
 * Walks Layers → ChildList (SceneObject, GroupObject, Fixture, Truss, Support, VideoScreen, Projector, FocusPoint)
 * with nested ChildLists, Geometries (Geometry3D, Symbol → AUXData Symdef, recursive) and fixtures through their GDTF
 * (`resolveGdtf`). A fixture whose GDTF is missing gets a 0.3 m box and a report line. Pure apart from the callbacks.
 */

const { mul, mvrMatrix, toGodot, scale } = require('./mvr-math')
const { parseXml, kids, attr } = require('./mvr-gdtf')

const OBJECTS = new Set(['SceneObject', 'GroupObject', 'Fixture', 'Truss', 'Support', 'VideoScreen', 'Projector', 'FocusPoint'])
/** WO-830a: geometry-node visits allowed per scene object / per whole scene (real rigs: tens per object). */
const MAX_GEOMETRY_VISITS = 4096
const MAX_SCENE_GEOMETRY_VISITS = 500000
const child = (node, name) => kids(node).find((n) => n['#name'] === name)
const text = (node, name) => {
	const c = child(node, name)
	return c ? String(c._ ?? '').trim() : ''
}

/** MVR Address text → absolute DMX address (universe 1 = 1…512): a number, or "Universe.Address" (MVR 1.5+). 0 = none. */
function absAddress(v) {
	const t = String(v ?? '').trim()
	const ua = /^(\d+)\.(\d+)$/.exec(t)
	if (ua) return Number(ua[1]) >= 1 && Number(ua[2]) >= 1 && Number(ua[2]) <= 512 ? (Number(ua[1]) - 1) * 512 + Number(ua[2]) : 0
	return /^\d+$/.test(t) ? Number(t) : 0
}

/** Archive member for a Geometry3D fileName ('' = none). No extension means 3DS (MVR spec). */
function resolveFile(fileName, has) {
	const f = String(fileName || '')
	for (const c of [f, `${f}.3ds`, `${f}.glb`]) if (c && has(c)) return c
	return ''
}

/**
 * @param {string} xmlText
 * @param {{ has: (file: string) => boolean, resolveGdtf: (spec: string, mode: string) => Promise<{ file: string,
 *   parts: { mesh: string, m: number[] }[] } | null> }} io
 */
/**
 * WO-612 T5 — a VideoScreen showing a HighAsCG surface: its Source (or its mapping definition's) is `highascg:<role>`
 * (what our export writes); the first Mapping gives the crop (ux/uy offset, ox/oy size, px) against the definition's
 * SizeX × SizeY raster. Other sources (NDI, File, CITP, capture cards) stay unbound → null.
 */
function screenBinding(sources, mappings, mapDefs) {
	const num = (node, name) => Number(text(node, name))
	const mp = kids(mappings).find((m) => m['#name'] === 'Mapping')
	const def = mp ? mapDefs.get(String(attr(mp, 'linkedDef')).toUpperCase()) : null
	const role = (v) => (/^highascg:([\w-]+)$/i.exec(String(v || '').trim()) || [])[1] || ''
	const r = role(sources.find((s) => role(s.value))?.value) || role(text(def, 'Source'))
	if (!r) return null
	const raster = def && num(def, 'SizeX') > 0 && num(def, 'SizeY') > 0 ? { w: num(def, 'SizeX'), h: num(def, 'SizeY') } : null
	const rect = mp && num(mp, 'ox') > 0 && num(mp, 'oy') > 0 ? { x: num(mp, 'ux') || 0, y: num(mp, 'uy') || 0, w: num(mp, 'ox'), h: num(mp, 'oy') } : null
	return { role: r.toLowerCase(), raster, rect }
}

async function parseScene(xmlText, { has, resolveGdtf }) {
	const root = await parseXml(xmlText)
	const scene = child(root, 'Scene')
	const symdefs = new Map()
	const mapDefs = new Map()
	for (const s of kids(child(scene, 'AUXData'))) {
		if (s['#name'] === 'Symdef') symdefs.set(String(attr(s, 'uuid')).toUpperCase(), s)
		if (s['#name'] === 'MappingDefinition') mapDefs.set(String(attr(s, 'uuid')).toUpperCase(), s)
	}
	const objects = []
	const meshes = new Set()
	const report = { objects: 0, fixtures: 0, parts: 0, missing_gdtf: new Set(), gdtf_no_model: new Set(), missing_files: new Set(), unsupported: new Set() }
	const gdtfCache = new Map()
	let sceneVisits = 0

	// WO-830a: a Symdef that (directly or through others) contains a Symbol of itself, or a fan-out of Symbols per level,
	// expanded 16 levels deep to 131k parts from a 420 B file (OOM). A symdef already open on the current path is a cycle
	// (skipped), and one object may visit at most MAX_GEOMETRY_VISITS nodes whatever the shape.
	const addGeometry = (parts, node, m, depth, open = new Set(), budget = { n: 0 }) => {
		if (depth > 16 || ++budget.n > MAX_GEOMETRY_VISITS || ++sceneVisits > MAX_SCENE_GEOMETRY_VISITS) return
		const at = mul(m, mvrMatrix(text(node, 'Matrix')))
		if (node['#name'] === 'Geometry3D') {
			const name = attr(node, 'fileName')
			const file = resolveFile(name, has)
			if (!file) report.missing_files.add(String(name))
			else if (/\.gltf$/i.test(file)) report.unsupported.add(file)
			else parts.push({ mesh: `mvr:${file}`, m: at })
		} else if (node['#name'] === 'Symbol') {
			const key = String(attr(node, 'symdef')).toUpperCase()
			const def = symdefs.get(key)
			if (open.has(key)) return
			open.add(key)
			for (const g of kids(child(def, 'ChildList'))) addGeometry(parts, g, at, depth + 1, open, budget)
			open.delete(key)
		}
	}

	const walk = async (list, parent, layer, depth) => {
		for (const node of kids(list)) {
			const kind = node['#name']
			if (!OBJECTS.has(kind) || depth > 32) continue
			const m = mul(parent, mvrMatrix(text(node, 'Matrix')))
			const parts = []
			const budget = { n: 0 }
			for (const g of kids(child(node, 'Geometries'))) addGeometry(parts, g, m, 0, new Set(), budget)
			const obj = { uuid: attr(node, 'uuid') || '', name: attr(node, 'name') || kind, kind, layer }
			if (kind === 'Fixture') {
				const spec = text(node, 'GDTFSpec')
				const mode = text(node, 'GDTFMode')
				const key = `${spec}\u0000${mode}`
				if (!gdtfCache.has(key)) gdtfCache.set(key, spec ? await resolveGdtf(spec, mode) : null)
				const g = gdtfCache.get(key)
				if (g) for (const p of g.parts) parts.push({ mesh: p.mesh === 'prim:box' ? 'prim:box' : `gdtf:${g.file}:${p.mesh}`, m: mul(m, p.m) })
				if (!g || !g.parts.length) {
					// Capture's GDTF export is a stub (one empty "Base" geometry, no model files): present, nothing to draw
					;(g ? report.gdtf_no_model : report.missing_gdtf).add(spec || '(none)')
					parts.push({ mesh: 'prim:box', m: mul(m, scale(0.3)) })
				}
				// WO-615 T10: `matrix` = the fixture's world transform (MVR frame, metres, column-major 4×4) for its patch pose.
				obj.fixture = { spec, mode, id: text(node, 'FixtureID'), unit: text(node, 'UnitNumber'),
					addresses: kids(child(node, 'Addresses')).map((a) => ({ break: Number(attr(a, 'break')) || 0, address: absAddress(a._) })),
					matrix: m.map((v) => Math.round(v * 1e6) / 1e6) }
				report.fixtures++
			}
			if (kind === 'VideoScreen') {
				obj.sources = kids(child(node, 'Sources')).map((s) => ({ type: attr(s, 'type') || '', linkedGeometry: attr(s, 'linkedGeometry') || '', value: String(s._ ?? '').trim() }))
				const screen = screenBinding(obj.sources, child(node, 'Mappings'), mapDefs)
				if (screen) obj.screen = screen
			}
			if (parts.length || obj.fixture || obj.sources) {
				obj.parts = parts.map((p) => {
					meshes.add(p.mesh)
					return { mesh: p.mesh, xform: toGodot(p.m) }
				})
				report.parts += parts.length
				report.objects++
				objects.push(obj)
			}
			await walk(child(node, 'ChildList'), m, layer, depth + 1)
		}
	}

	const layers = []
	for (const l of kids(child(scene, 'Layers'))) {
		if (l['#name'] !== 'Layer') continue
		const name = attr(l, 'name') || `Layer ${layers.length + 1}`
		layers.push({ uuid: attr(l, 'uuid') || '', name })
		await walk(child(l, 'ChildList'), mvrMatrix(text(l, 'Matrix')), name, 0)
	}
	return {
		version: `${attr(root, 'verMajor') || '?'}.${attr(root, 'verMinor') || '?'}`,
		provider: [attr(root, 'provider'), attr(root, 'providerVersion')].filter(Boolean).join(' '),
		layers,
		objects,
		meshes: [...meshes],
		report: { ...report, missing_gdtf: [...report.missing_gdtf], gdtf_no_model: [...report.gdtf_no_model], missing_files: [...report.missing_files], unsupported: [...report.unsupported] },
	}
}

module.exports = { parseScene, resolveFile, absAddress }

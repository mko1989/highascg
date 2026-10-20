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
const child = (node, name) => kids(node).find((n) => n['#name'] === name)
const text = (node, name) => {
	const c = child(node, name)
	return c ? String(c._ ?? '').trim() : ''
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
async function parseScene(xmlText, { has, resolveGdtf }) {
	const root = await parseXml(xmlText)
	const scene = child(root, 'Scene')
	const symdefs = new Map()
	for (const s of kids(child(scene, 'AUXData'))) if (s['#name'] === 'Symdef') symdefs.set(String(attr(s, 'uuid')).toUpperCase(), s)
	const objects = []
	const meshes = new Set()
	const report = { objects: 0, fixtures: 0, parts: 0, missing_gdtf: new Set(), missing_files: new Set(), unsupported: new Set() }
	const gdtfCache = new Map()

	const addGeometry = (parts, node, m, depth) => {
		if (depth > 16) return
		const at = mul(m, mvrMatrix(text(node, 'Matrix')))
		if (node['#name'] === 'Geometry3D') {
			const name = attr(node, 'fileName')
			const file = resolveFile(name, has)
			if (!file) report.missing_files.add(String(name))
			else if (/\.gltf$/i.test(file)) report.unsupported.add(file)
			else parts.push({ mesh: `mvr:${file}`, m: at })
		} else if (node['#name'] === 'Symbol') {
			const def = symdefs.get(String(attr(node, 'symdef')).toUpperCase())
			for (const g of kids(child(def, 'ChildList'))) addGeometry(parts, g, at, depth + 1)
		}
	}

	const walk = async (list, parent, layer, depth) => {
		for (const node of kids(list)) {
			const kind = node['#name']
			if (!OBJECTS.has(kind) || depth > 32) continue
			const m = mul(parent, mvrMatrix(text(node, 'Matrix')))
			const parts = []
			for (const g of kids(child(node, 'Geometries'))) addGeometry(parts, g, m, 0)
			const obj = { uuid: attr(node, 'uuid') || '', name: attr(node, 'name') || kind, kind, layer }
			if (kind === 'Fixture') {
				const spec = text(node, 'GDTFSpec')
				const mode = text(node, 'GDTFMode')
				const key = `${spec}\u0000${mode}`
				if (!gdtfCache.has(key)) gdtfCache.set(key, spec ? await resolveGdtf(spec, mode) : null)
				const g = gdtfCache.get(key)
				if (g) for (const p of g.parts) parts.push({ mesh: p.mesh === 'prim:box' ? 'prim:box' : `gdtf:${g.file}:${p.mesh}`, m: mul(m, p.m) })
				if (!g || !g.parts.length) {
					report.missing_gdtf.add(spec || '(none)')
					parts.push({ mesh: 'prim:box', m: mul(m, scale(0.3)) })
				}
				obj.fixture = { spec, mode, id: text(node, 'FixtureID'), unit: text(node, 'UnitNumber'),
					addresses: kids(child(node, 'Addresses')).map((a) => ({ break: Number(attr(a, 'break')) || 0, address: Number(a._) || 0 })) }
				report.fixtures++
			}
			if (kind === 'VideoScreen') {
				obj.sources = kids(child(node, 'Sources')).map((s) => ({ type: attr(s, 'type') || '', linkedGeometry: attr(s, 'linkedGeometry') || '', value: String(s._ ?? '').trim() }))
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
		report: { ...report, missing_gdtf: [...report.missing_gdtf], missing_files: [...report.missing_files], unsupported: [...report.unsupported] },
	}
}

module.exports = { parseScene, resolveFile }

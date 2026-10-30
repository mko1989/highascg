'use strict'

/**
 * WO-612 T4 — GDTF fixture geometry for the MVR importer (geometry only; DMX / beams are later work, WO-180).
 * description.xml: FixtureType → Models (Name → File, Length / Width / Height m) and Geometries: a tree of Geometry /
 * Axis / Display / … nodes, each with Position (4×4, m, Z-up) and an optional Model; GeometryReference places a
 * top-level geometry again. The DMX mode names the top-level geometry its fixture uses.
 * Mesh files: models/gltf/<File>.glb, else models/3ds/<File>.3ds. A model without a file becomes a box of its size,
 * so a fixture type with primitive models only (common for conventionals) is still visible. Pure.
 */

const xml2js = require('xml2js')
const { IDENTITY, mul, gdtfMatrix, scale } = require('./mvr-math')

// Internal / tiny nodes: no body to draw.
/** WO-830a: node / part budget for one fixture's geometry walk (real fixtures: a few dozen nodes). */
const MAX_GDTF_VISITS = 4096
const MAX_GDTF_PARTS = 512

const SKIP = new Set(['Beam', 'WiringObject', 'Inventory', 'Laser', 'Magnet', 'FilterBeam', 'FilterColor',
	'FilterGobo', 'FilterShaper', 'MediaServerCamera', 'MediaServerLayer', 'MediaServerMaster', 'Break'])

async function parseXml(text) {
	return xml2js.parseStringPromise(text, { explicitChildren: true, preserveChildrenOrder: true, explicitRoot: false })
}

const kids = (node) => (Array.isArray(node?.$$) ? node.$$ : [])
const attr = (node, k) => (node?.$ ? node.$[k] : undefined)

/**
 * @param {string} xmlText description.xml
 * @param {string} mode GDTFMode from the MVR fixture
 * @param {(path: string) => boolean} has whether the GDTF archive has a file
 * @returns {Promise<{ name: string, parts: { mesh: string, m: number[] }[], missing: string[] }>}
 *   mesh: an archive path inside the .gdtf (models/gltf/x.glb | models/3ds/x.3ds) or 'prim:box'
 */
async function gdtfParts(xmlText, mode, has) {
	const root = await parseXml(xmlText)
	const ft = kids(root).find((n) => n['#name'] === 'FixtureType') || root
	const section = (name) => kids(ft).find((n) => n['#name'] === name)
	const models = new Map()
	for (const m of kids(section('Models'))) {
		if (m['#name'] !== 'Model') continue
		models.set(attr(m, 'Name'), { file: attr(m, 'File') || '', type: attr(m, 'PrimitiveType') || '',
			size: ['Length', 'Width', 'Height'].map((k) => Number(attr(m, k)) || 0) })
	}
	const tops = kids(section('Geometries')).filter((n) => !SKIP.has(n['#name']))
	const byName = new Map(tops.map((n) => [attr(n, 'Name'), n]))
	const modes = kids(section('DMXModes')).filter((n) => n['#name'] === 'DMXMode')
	const dmx = modes.find((n) => attr(n, 'Name') === mode) || modes[0]
	const start = byName.get(attr(dmx, 'Geometry')) || tops[0]
	const parts = []
	const missing = new Set()
	const meshOf = (modelName) => {
		const md = models.get(modelName)
		if (!md) return null
		for (const p of [`models/gltf/${md.file}.glb`, `models/3ds/${md.file}.3ds`]) if (md.file && has(p)) return { mesh: p }
		if (md.file) missing.add(md.file)
		const [l, w, h] = md.size
		return md.type !== 'Pigtail' && l > 0.005 && w > 0.005 && h > 0.005 ? { mesh: 'prim:box', fit: [l, w, h] } : null
	}
	// WO-830a: GeometryReference → Geometry could loop (A refs B, B refs A) or fan out exponentially (each level refs the
	// next twice): a 420 B file made 131k parts. A reference target already open on this path is skipped, and the whole
	// fixture is capped at MAX_GDTF_VISITS nodes / MAX_GDTF_PARTS parts.
	const openRefs = new Set()
	let visits = 0
	const walk = (node, parent, depth) => {
		if (depth > 32 || SKIP.has(node['#name']) || ++visits > MAX_GDTF_VISITS || parts.length >= MAX_GDTF_PARTS) return
		const m = mul(parent, gdtfMatrix(attr(node, 'Position')))
		if (node['#name'] === 'GeometryReference') {
			const ref = byName.get(attr(node, 'Geometry'))
			if (ref && ref !== node && !openRefs.has(ref)) {
				openRefs.add(ref)
				walk(ref, m, depth + 1)
				openRefs.delete(ref)
			}
			return
		}
		const mesh = attr(node, 'Model') ? meshOf(attr(node, 'Model')) : null
		if (mesh) parts.push({ mesh: mesh.mesh, m: mesh.fit ? mul(m, scale(...mesh.fit)) : m })
		for (const c of kids(node)) walk(c, m, depth + 1)
	}
	if (start) {
		openRefs.add(start)
		walk(start, [...IDENTITY], 0)
	}
	return { name: attr(ft, 'Name') || '', parts, missing: [...missing] }
}

module.exports = { gdtfParts, parseXml, kids, attr }

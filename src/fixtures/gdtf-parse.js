'use strict'

/**
 * WO-615 T1 — a .gdtf (ZIP: description.xml + models/ + wheels/) → one normalized JSON fixture type:
 *
 *   { name, shortName, manufacturer, fixtureTypeId, dataVersion,
 *     modes: [{ name, geometry, breaks, footprint, channels[] }]   ← gdtf-dmx.js
 *     geometry: [{ type, name, model, m (4×4 column-major, m, Z-up), beam?, ref?, children[] }]
 *     models: { name: { file, type, size [l, w, h] } }, files: [archive paths]
 *     wheels: { name: [{ name, color [x, y, Y] | null, media }] }
 *     attributes: { name: { pretty, feature, unit } } }
 *
 * The geometry tree keeps Axis nodes (pan / tilt pivots the previs animates) and Beam nodes (lamp: beam / field
 * angle, flux, colour temperature, radius, type). GeometryReference stays a reference (`ref`: the template geometry
 * + its DMX breaks) — the viewer instances it. Pure apart from reading the archive buffer.
 */

const unzipper = require('unzipper')
const { parseXml, kids, attr } = require('../stage/mvr-gdtf')
const { gdtfMatrix } = require('../stage/mvr-math')
const { parseModes } = require('./gdtf-dmx')

const NOT_DRAWN = new Set(['WiringObject', 'Inventory', 'Break'])
const numOr = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v))

function beamOf(node) {
	return {
		lampType: attr(node, 'LampType') || 'Discharge',
		beamType: attr(node, 'BeamType') || 'Wash',
		beamAngle: numOr(attr(node, 'BeamAngle'), 25),
		fieldAngle: numOr(attr(node, 'FieldAngle'), 25),
		radius: numOr(attr(node, 'BeamRadius'), 0.05),
		flux: numOr(attr(node, 'LuminousFlux'), 10000),
		cct: numOr(attr(node, 'ColorTemperature'), 6000),
		power: numOr(attr(node, 'PowerConsumption'), 1000),
	}
}

function geometryTree(nodes, depth = 0) {
	const out = []
	if (depth > 48) return out
	for (const n of nodes) {
		const type = n['#name']
		if (!type || NOT_DRAWN.has(type)) continue
		const g = { type, name: attr(n, 'Name') || '', model: attr(n, 'Model') || '', m: gdtfMatrix(attr(n, 'Position')) }
		if (type === 'Beam') g.beam = beamOf(n)
		if (type === 'GeometryReference') {
			const breaks = {}
			for (const b of kids(n)) if (b['#name'] === 'Break') breaks[numOr(attr(b, 'DMXBreak'), 1)] = numOr(attr(b, 'DMXOffset'), 1)
			g.ref = { geometry: attr(n, 'Geometry') || '', breaks }
		} else {
			g.children = geometryTree(kids(n), depth + 1)
		}
		out.push(g)
	}
	return out
}

/** CIE "0.3127,0.3290,100.000" → [x, y, Y]. */
function cie(text) {
	const n = String(text || '').split(',').map(Number)
	return n.length === 3 && n.every(Number.isFinite) ? n : null
}

function wheelsOf(section) {
	const out = {}
	for (const w of kids(section)) {
		if (w['#name'] !== 'Wheel') continue
		out[attr(w, 'Name') || `Wheel ${Object.keys(out).length + 1}`] = kids(w)
			.filter((s) => s['#name'] === 'Slot')
			.map((s) => ({ name: attr(s, 'Name') || '', color: cie(attr(s, 'Color')), media: attr(s, 'MediaFileName') || '' }))
	}
	return out
}

function attributesOf(defs) {
	const out = {}
	const attrs = kids(defs).find((n) => n['#name'] === 'Attributes')
	for (const a of kids(attrs)) {
		if (a['#name'] !== 'Attribute') continue
		out[attr(a, 'Name')] = { pretty: attr(a, 'Pretty') || attr(a, 'Name'), feature: attr(a, 'Feature') || '',
			unit: attr(a, 'PhysicalUnit') || 'None' }
	}
	return out
}

/**
 * @param {string} xmlText description.xml
 * @param {string[]} [files] archive member paths
 */
async function parseDescription(xmlText, files = []) {
	const root = await parseXml(xmlText)
	const ft = kids(root).find((n) => n['#name'] === 'FixtureType')
	if (!ft) throw new Error('not a GDTF description (no FixtureType)')
	const section = (name) => kids(ft).find((n) => n['#name'] === name)
	const models = {}
	for (const m of kids(section('Models'))) {
		if (m['#name'] !== 'Model') continue
		models[attr(m, 'Name')] = { file: attr(m, 'File') || '', type: attr(m, 'PrimitiveType') || '',
			size: ['Length', 'Width', 'Height'].map((k) => numOr(attr(m, k), 0)) }
	}
	return {
		name: attr(ft, 'Name') || '',
		shortName: attr(ft, 'ShortName') || attr(ft, 'Name') || '',
		manufacturer: attr(ft, 'Manufacturer') || '',
		fixtureTypeId: attr(ft, 'FixtureTypeID') || '',
		dataVersion: attr(root, 'DataVersion') || '',
		modes: parseModes(ft),
		geometry: geometryTree(kids(section('Geometries'))),
		models,
		files,
		wheels: wheelsOf(section('Wheels')),
		attributes: attributesOf(section('AttributeDefinitions')),
	}
}

/** @param {Buffer} buf a .gdtf archive */
async function parseGdtf(buf) {
	let dir
	try {
		dir = await unzipper.Open.buffer(buf)
	} catch (e) {
		throw new Error('not a GDTF file (not a ZIP archive)', { cause: e })
	}
	const files = dir.files.filter((f) => f.type !== 'Directory').map((f) => f.path)
	const desc = dir.files.find((f) => f.path.toLowerCase() === 'description.xml')
	if (!desc) throw new Error('not a GDTF file (no description.xml)')
	return parseDescription((await desc.buffer()).toString('utf8'), files)
}

module.exports = { parseGdtf, parseDescription }

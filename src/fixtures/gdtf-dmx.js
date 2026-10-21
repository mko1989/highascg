'use strict'

/**
 * WO-615 T1 — the DMX half of a GDTF description.xml (DIN SPEC 15800): DMX modes → channels with absolute offsets,
 * resolution, attribute, default, channel functions (DMX range, physical range, wheel, mode master) and channel sets.
 *
 * Channels of a geometry that the mode's tree only reaches through GeometryReference (pixel fixtures: one template
 * "Main RGB" placed 40 times) are instanced per reference: offset + Break DMXOffset − 1, named after the reference.
 * A channel with Offset="" is virtual (no DMX slot; e.g. a per-pixel virtual dimmer) and keeps `offsets: []`.
 *
 * DMX values are "value/bytes" ("32768/2", "255/1"); everything here is scaled to the channel's own resolution
 * (bytes = offsets.length, 1 for virtual): shifted by whole bytes, except an all-ones value stays all-ones
 * (255/1 = 65535/2), the usual reading of the spec's byte mirroring. Pure.
 */

const { kids, attr } = require('../stage/mvr-gdtf')

const MAX_RES = 4

/** "32768/2" → { v: 32768, n: 2 }; "None" / junk → null. */
function dmxValue(text) {
	const m = /^\s*(\d+)\s*\/\s*(\d)\s*$/.exec(String(text ?? ''))
	if (!m) return null
	const n = Math.min(MAX_RES, Math.max(1, Number(m[2])))
	return { v: Math.min(Number(m[1]), 256 ** n - 1), n }
}

/** A DMX value at `res` bytes. */
function atRes(val, res) {
	if (!val) return null
	const max = 256 ** val.n - 1
	if (val.v === max && val.v > 0) return 256 ** res - 1
	return res >= val.n ? val.v * 256 ** (res - val.n) : Math.floor(val.v / 256 ** (val.n - res))
}

const numOr = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v))

/** Geometry name → node, over the whole Geometries tree (names are unique per fixture type). */
function indexGeometries(geometries) {
	const byName = new Map()
	const parentOf = new Map()
	const walk = (node, parent, depth) => {
		if (depth > 48) return
		const name = attr(node, 'Name')
		if (name && !byName.has(name)) {
			byName.set(name, node)
			parentOf.set(name, parent)
		}
		for (const c of kids(node)) walk(c, name, depth + 1)
	}
	for (const top of kids(geometries)) walk(top, null, 0)
	return { byName, parentOf }
}

/** The top-level geometry a named geometry belongs to. */
function topOf(name, parentOf) {
	let n = name
	for (let i = 0; i < 64 && parentOf.get(n); i++) n = parentOf.get(n)
	return n
}

/** GeometryReference nodes inside the subtree of `rootName`: [{ name, geometry, breaks: { break → offset } }]. */
function referencesUnder(rootName, byName) {
	const out = []
	const walk = (node, depth) => {
		if (depth > 48) return
		if (node['#name'] === 'GeometryReference') {
			const breaks = {}
			for (const b of kids(node)) {
				if (b['#name'] === 'Break') breaks[numOr(attr(b, 'DMXBreak'), 1)] = numOr(attr(b, 'DMXOffset'), 1)
			}
			out.push({ name: attr(node, 'Name') || '', geometry: attr(node, 'Geometry') || '', breaks })
			return
		}
		for (const c of kids(node)) walk(c, depth + 1)
	}
	const root = byName.get(rootName)
	if (root) walk(root, 0)
	return out
}

/** Channel functions of one DMXChannel (all its LogicalChannels), scaled to `res`. */
function channelFunctions(ch, res) {
	const max = 256 ** res - 1
	const fns = []
	for (const lc of kids(ch)) {
		if (lc['#name'] !== 'LogicalChannel') continue
		for (const cf of kids(lc)) {
			if (cf['#name'] !== 'ChannelFunction') continue
			const sets = kids(cf)
				.filter((s) => s['#name'] === 'ChannelSet')
				.map((s) => ({ name: attr(s, 'Name') || '', from: atRes(dmxValue(attr(s, 'DMXFrom')), res) ?? 0,
					slot: numOr(attr(s, 'WheelSlotIndex'), 0) }))
			const mm = attr(cf, 'ModeMaster')
			fns.push({
				name: attr(cf, 'Name') || '',
				lcName: attr(lc, 'Attribute') || '',
				attribute: attr(cf, 'Attribute') || attr(lc, 'Attribute') || 'NoFeature',
				from: atRes(dmxValue(attr(cf, 'DMXFrom')), res) ?? 0,
				default: atRes(dmxValue(attr(cf, 'Default')), res),
				physFrom: numOr(attr(cf, 'PhysicalFrom'), 0),
				physTo: numOr(attr(cf, 'PhysicalTo'), 1),
				wheel: attr(cf, 'Wheel') || '',
				modeMaster: mm || '',
				modeFrom: mm ? atRes(dmxValue(attr(cf, 'ModeFrom')), 2) ?? 0 : 0,
				modeTo: mm ? atRes(dmxValue(attr(cf, 'ModeTo')), 2) ?? 0 : 0,
				sets,
			})
		}
	}
	// A function ends where the next one of the same mode-master branch starts (Pan / "Pan 360 Shortcut" overlap).
	const key = (f) => `${f.modeMaster}|${f.modeFrom}|${f.modeTo}`
	for (const f of fns) {
		let to = max
		for (const g of fns) if (g !== f && key(g) === key(f) && g.from > f.from && g.from - 1 < to) to = g.from - 1
		f.to = to
		f.sets.sort((a, b) => a.from - b.from)
		f.sets.forEach((s, i) => (s.to = i + 1 < f.sets.length ? Math.max(s.from, f.sets[i + 1].from - 1) : to))
		if (f.default == null) f.default = f.from
	}
	return fns
}

/** "Yoke_Pan.Pan.Pan" → the function named by the last part (function names may hold dots). */
function initialIndex(text, fns) {
	const parts = String(text || '').split('.')
	const name = parts.length >= 3 ? parts.slice(2).join('.') : parts[parts.length - 1]
	const i = fns.findIndex((f) => f.name === name)
	return i >= 0 ? i : 0
}

function parseChannel(ch, geometry, shift, brk) {
	const raw = String(attr(ch, 'Offset') ?? '').trim()
	const offsets = raw ? raw.split(',').map((s) => Number(s.trim()) + shift).filter((n) => n >= 1) : []
	const res = Math.min(MAX_RES, Math.max(1, offsets.length))
	const functions = channelFunctions(ch, res)
	const initial = initialIndex(attr(ch, 'InitialFunction'), functions)
	const fn = functions[initial]
	return {
		geometry,
		break: brk,
		offsets,
		res,
		attribute: fn ? fn.attribute : functions[0]?.attribute || 'NoFeature',
		default: fn ? fn.default : 0,
		highlight: atRes(dmxValue(attr(ch, 'Highlight')), res),
		initial,
		functions,
	}
}

/**
 * @param {object} ft xml2js FixtureType node
 * @returns {{ name, geometry, breaks: number[], footprint: number, channels: object[] }[]}
 *   footprint = highest DMX offset on break 1 (the patch width)
 */
function parseModes(ft) {
	const section = (name) => kids(ft).find((n) => n['#name'] === name)
	const { byName, parentOf } = indexGeometries(section('Geometries'))
	const modes = []
	for (const m of kids(section('DMXModes'))) {
		if (m['#name'] !== 'DMXMode') continue
		const root = attr(m, 'Geometry') || ''
		const refs = referencesUnder(root, byName)
		const channels = []
		const dmxChannels = kids(kids(m).find((n) => n['#name'] === 'DMXChannels'))
		for (const ch of dmxChannels) {
			if (ch['#name'] !== 'DMXChannel') continue
			const geometry = attr(ch, 'Geometry') || ''
			const brk = numOr(attr(ch, 'DMXBreak'), 1)
			const inTree = topOf(geometry, parentOf) === root
			const instances = inTree ? [] : refs.filter((r) => r.geometry === geometry || topOf(geometry, parentOf) === r.geometry)
			if (instances.length === 0) {
				channels.push(parseChannel(ch, geometry, 0, brk))
				continue
			}
			for (const r of instances) {
				const shift = (r.breaks[brk] ?? r.breaks[1] ?? 1) - 1
				channels.push(parseChannel(ch, r.name, shift, brk))
			}
		}
		const breaks = [...new Set(channels.map((c) => c.break))].sort((a, b) => a - b)
		let footprint = 0
		for (const c of channels) if (c.break === 1) for (const o of c.offsets) footprint = Math.max(footprint, o)
		modes.push({ name: attr(m, 'Name') || '', geometry: root, breaks, footprint, channels })
	}
	return modes
}

module.exports = { parseModes, dmxValue, atRes }

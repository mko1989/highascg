'use strict'

/**
 * WO-615 T5 — what the Godot previs builds for one fixture type + DMX mode: the mode's geometry tree with every
 * GeometryReference already instanced (the same instancing gdtf-dmx.js applies to channels: a reference's node id is
 * the reference name, its template's children are "<reference>/<child>"), flattened parent-first.
 *
 *   { mode, footprint, nodes: [{ id, parent (index, −1 = root), kind (Geometry | Axis | Beam | …), xf, mesh?, mesh_xf?,
 *                                axis? "pan" | "tilt", beam? }], meshes: [archive paths] }
 *   WO-1006: beam.lens [x, z, round] = the emitting face (its primitive model, else its parent's flat plate), beam.layer =
 *   its depth rank among the beams (the client draws deeper lenses further out).
 *
 * Transforms are 12 numbers (basis x, y, z columns, origin) in Godot's frame: a node's local GDTF transform L
 * (Z-up, metres) conjugated, C·L·C⁻¹ with C = GODOT_FROM_MVR, so GDTF Z (pan) is Godot Y and GDTF X (tilt) is
 * Godot X with the same angle sign. mesh_xf places the mesh in its node: a glTF-frame file needs none (C·MVR_FROM_GLTF
 * = I), a box of the model's size is scaled to it — `mesh` is models/gltf/<File>.glb, else models/3ds/<File>.3ds, else
 * "prim:box" (as WO-612 mvr-gdtf.js). An Axis node carrying a Pan / Tilt channel of the mode is marked. Pure.
 */

const { IDENTITY, mul, scale, GODOT_FROM_MVR, MVR_FROM_GLTF } = require('../stage/mvr-math')

const MVR_FROM_GODOT = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
const MAX_NODES = 4096

const r6 = (v) => Math.round(v * 1e6) / 1e6
const twelve = (g) => [g[0], g[1], g[2], g[4], g[5], g[6], g[8], g[9], g[10], g[12], g[13], g[14]].map(r6)
const conj = (m) => twelve(mul(mul(GODOT_FROM_MVR, m), MVR_FROM_GODOT))

/** The attribute family a channel turns an axis by ("Pan" / "Tilt", any function of it). */
function axisKind(c) {
	for (const f of c.functions) {
		if (f.attribute === 'Pan' || f.attribute === 'Tilt') return f.attribute.toLowerCase()
	}
	return ''
}

/**
 * @param {object} type gdtf-parse.js result
 * @param {object} mode one of type.modes
 */
function buildRig(type, mode) {
	const files = new Set((type.files || []).map((f) => f.toLowerCase()))
	const tops = new Map((type.geometry || []).map((g) => [g.name, g]))
	const axes = new Map()
	for (const c of mode.channels) {
		const k = axisKind(c)
		if (k && !axes.has(c.geometry)) axes.set(c.geometry, k)
	}
	const meshes = new Set()
	const meshOf = (modelName) => {
		const md = type.models?.[modelName]
		if (!md) return null
		for (const p of [`models/gltf/${md.file}.glb`, `models/3ds/${md.file}.3ds`]) {
			if (md.file && files.has(p.toLowerCase())) {
				meshes.add(p)
				return { mesh: p, mesh_xf: twelve([...IDENTITY]) }
			}
		}
		const [l, w, h] = md.size || [0, 0, 0]
		if (md.type === 'Pigtail' || !(l > 0.005 && w > 0.005 && h > 0.005)) return null
		return { mesh: 'prim:box', mesh_xf: twelve(mul(mul(GODOT_FROM_MVR, scale(l, w, h)), MVR_FROM_GLTF)) }
	}
	// WO-1006: the emitting face of a beam — its own primitive model (the pixel's rectangle / disc), else a flat primitive
	// model of its parent it sits on unturned (Pixel Strobe ForeGround on the 160×470 mm "Beam" plate), in Godot's
	// node frame: [x, z, round]. `own` = the model is the lens, so no box is drawn for it as well.
	const plate = (name) => {
		const md = type.models?.[name]
		if (!md || md.file || md.type === 'Pigtail') return null
		const [l, w] = md.size || [0, 0]
		return l > 0.001 && w > 0.001 ? [r6(l), r6(w), /cylinder|sphere/i.test(md.type || '')] : null
	}
	const lensOf = (node, parentModelName, local) => {
		if (node.model) {
			const own = plate(node.model)
			return own ? { size: own, own: true } : null
		}
		const md = type.models?.[parentModelName]
		const unturned = [0, 1, 2].every((c) => [0, 1, 2].every((r) => Math.abs(local[c * 4 + r] - (c === r ? 1 : 0)) < 1e-6))
		return unturned && md && (md.size?.[2] ?? 1) <= 0.005 ? (plate(parentModelName) ? { size: plate(parentModelName) } : null) : null
	}
	const parentModel = []
	const depthOf = new Map()
	const nodes = []
	const add = (g, id, parent, m, depth, prefix) => {
		if (depth > 32 || nodes.length >= MAX_NODES) return
		let node = g
		let local = m
		if (g.type === 'GeometryReference') {
			const t = tops.get(g.ref?.geometry)
			if (!t || t.type === 'GeometryReference') return
			node = t
			local = mul(m, t.m)
		}
		const n = { id, parent, kind: node.type, xf: conj(local) }
		const lens = node.beam ? lensOf(node, parent >= 0 ? parentModel[parent] : '', local) : null
		const mesh = node.model && !lens?.own ? meshOf(node.model) : null
		if (mesh) Object.assign(n, mesh)
		if (axes.has(id)) n.axis = axes.get(id)
		if (node.beam) {
			n.beam = { ...node.beam }
			if (lens) n.beam.lens = lens.size
			depthOf.set(n, depth)
		}
		const at = nodes.push(n) - 1
		parentModel[at] = node.model || ''
		const under = g.type === 'GeometryReference' ? `${id}/` : prefix
		for (const c of node.children || []) add(c, under + c.name, at, c.m, depth + 1, under)
	}
	const root = tops.get(mode.geometry) || (type.geometry || [])[0]
	if (root) add(root, root.name, -1, root.m, 0, '')
	// WO-1006: lenses at different depths of the tree stack (a pixel in front of the plate it sits on), not coplanar
	const depths = [...new Set(depthOf.values())].sort((a, b) => a - b)
	for (const [n, d] of depthOf) n.beam.layer = depths.indexOf(d)
	return { mode: mode.name, footprint: mode.footprint, nodes, meshes: [...meshes] }
}

module.exports = { buildRig, conj }

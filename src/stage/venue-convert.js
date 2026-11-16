'use strict'

/**
 * WO-1098 — OBJ (+ MTL + pictures, loose / folder / zip, pictures also from a SketchUp .skp) → one venue .glb that the
 * previs "Venue model" (previs.mvr.venue_glb, WO-1003) and the game bake (WO-1082 / 1090) use like a Capture export.
 *
 *   convertVenue(src, opts, onProgress) → Promise<{ glb: Buffer, report }>
 *     src  = venue-sources.js gather() result
 *     opts = { obj?: rel, units?: 'm'|'in'|'mm'|'cm'|'ft', up?: 'y'|'z', budget?: triangles (default 250 000, 0 = none),
 *              textureBudget?: bytes (default 6 MB), maxEdge?: px (default 1024), place?: { x, y, z, yaw° } (root
 *              node matrix: the registration onto the show's frame), textures?: { "<material>" | "layer:<Layer>":
 *              { image: rel or file name, tile: [w, h] m } } (a picture for a material / layer, planar-mapped at that
 *              tile size — e.g. the real carpet on a floor exported untextured), planes?: [{ name, image, rect: [x0, z0,
 *              x1, z1], y, rotate?: 0|90|180|270, facing?: 'down'|'up', opacity? }] (a picture laid flat — a rigging
 *              plan under the ceiling — as a layer of its own), markers?: [{ name, points: [[x, z]…], y, radius?,
 *              color?: sRGB }] (flat discs, both faces — hang points as a layer), encode? (tests) }
 *     onProgress({ phase, done, total, text })
 *
 * The GLB: one root node "venue" (matrix = place) → one node per layer (per instance for Chandeliers), each a mesh with
 * one primitive per material × sidedness. Layers are named in extensions.HIGHASCG_venue (asset.layers + node
 * layer_identifier) — the same shape the WO-1003 reader takes from Capture's CAPTURE_model, so the previs lists them
 * with eyes. The import report rides along in asset.extras.highascg_import.
 */

const path = require('path')
const { createObjParser } = require('./obj-parse')
const { parseMtl, pbrOf, textureIndex, findTexture, toLinear } = require('./obj-mtl')
const { classify } = require('./venue-build')
const { weldBucket, fitBudget } = require('./venue-optimize')
const { writeGlb } = require('./glb-write')
const tex = require('../../modules/rc-game/server/rc-scene-tex')

const EXT = 'HIGHASCG_venue'
const DEFAULTS = { budget: 250000, textureBudget: 6 * 1024 * 1024, maxEdge: 1024 }
const PLACEHOLDER = /v-ray texture helper/i // a renderer's stand-in picture (SketchUp V-Ray), not the surface's look

/** Does a PNG have any see-through pixel? (an RGBA picture that is opaque everywhere stays OPAQUE: no sorting trouble) */
function seeThrough(png) {
	try {
		const { data } = require('pngjs').PNG.sync.read(png)
		for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true
		return false
	} catch {
		return true
	}
}

const layerId = (name) => `venue-layer-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

async function readObj(file, onProgress) {
	const p = createObjParser()
	const dec = new TextDecoder('utf-8')
	let got = 0, lastPct = -1
	await new Promise((resolve, reject) => {
		const s = file.stream()
		s.on('data', (d) => {
			got += d.length
			p.write(dec.decode(d, { stream: true }))
			const pct = file.size ? Math.floor((100 * got) / file.size) : 0
			if (pct !== lastPct) {
				lastPct = pct
				onProgress({ phase: 'reading', done: got, total: file.size, text: `Reading ${path.posix.basename(file.rel)} ${pct}%` })
			}
		})
		s.on('end', resolve)
		s.on('error', reject)
	})
	p.write(dec.decode())
	return p.end()
}

const byBase = (files, name) => {
	const n = path.posix.basename(String(name).replace(/\\/g, '/')).toLowerCase()
	return files.filter((f) => path.posix.basename(f.rel).toLowerCase() === n)
}

/** Planar UVs in metres / tile for a triangle corner (axis pair by the face's dominant normal). */
function planarUv(P, fn, t, vi, tile) {
	const ax = Math.abs(fn[3 * t]), ay = Math.abs(fn[3 * t + 1]), az = Math.abs(fn[3 * t + 2])
	const x = P[vi], y = P[vi + 1], z = P[vi + 2]
	const [a, b] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, -y] : [x, -y]
	return [a / tile[0], b / tile[1]]
}

function planeMesh(pl) {
	const [x0, z0, x1, z1] = pl.rect
	const y = Number(pl.y) || 0
	const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
	// image UV per corner: unrotated, u runs along +x and v along +z (image top at z0)
	const uv0 = [[0, 0], [1, 0], [1, 1], [0, 1]]
	const r = ((Number(pl.rotate) || 0) / 90) & 3
	const uvs = corners.map((_, i) => uv0[(i + r) % 4])
	const down = pl.facing !== 'up'
	return {
		positions: new Float32Array(corners.flatMap(([x, z]) => [x, y, z])),
		normals: new Float32Array([0, down ? -1 : 1, 0, 0, down ? -1 : 1, 0, 0, down ? -1 : 1, 0, 0, down ? -1 : 1, 0]),
		uvs: new Float32Array(uvs.flat()),
		indices: new Uint32Array(down ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]),
	}
}

/** Flat 12-gon discs (both faces) at height y — one mesh for all points. */
function discMesh(mk) {
	const r = Number(mk.radius) || 0.2
	const y = Number(mk.y) || 0
	const pos = [], nrm = [], idx = []
	for (const [x, z] of mk.points || []) {
		for (const s of [-1, 1]) {
			const c = pos.length / 3
			pos.push(x, y + s * 0.002, z)
			nrm.push(0, s, 0)
			for (let k = 0; k < 12; k++) {
				const a = (k * Math.PI) / 6
				pos.push(x + r * Math.cos(a), y + s * 0.002, z + r * Math.sin(a))
				nrm.push(0, s, 0)
			}
			for (let k = 0; k < 12; k++) {
				const a = c + 1 + k, b = c + 1 + ((k + 1) % 12)
				idx.push(...(s < 0 ? [c, a, b] : [c, b, a]))
			}
		}
	}
	return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) }
}

async function convertVenue(src, opts = {}, onProgress = () => {}) {
	const o = { ...DEFAULTS, ...opts }
	const t0 = Date.now()
	const warnings = [...(src.errors || [])]
	const objs = src.files.filter((f) => /\.obj$/i.test(f.rel)).sort((a, b) => b.size - a.size)
	const objFile = o.obj ? objs.find((f) => f.rel === o.obj || path.posix.basename(f.rel) === o.obj) : objs[0]
	if (!objFile) throw new Error(src.skps?.length && !objs.length
		? 'SketchUp files are used for their textures only; export OBJ for the geometry (File → Export → 3D Model → OBJ).'
		: 'No .obj file in the upload.')
	if (objs.length > 1) warnings.push(`${objs.length} OBJ files: converted the largest, ${objFile.rel}`)
	const obj = await readObj(objFile, onProgress)
	if (!obj.tris.mat.length) throw new Error(`${objFile.rel} holds no faces`)
	// materials
	const objDir = path.posix.dirname(objFile.rel) === '.' ? '' : path.posix.dirname(objFile.rel)
	const mtlFiles = []
	for (const lib of obj.mtllibs) {
		const near = src.files.find((f) => f.rel.toLowerCase() === (objDir ? `${objDir}/${lib}` : lib).toLowerCase())
		const any = near || byBase(src.files, lib)[0]
		if (any && !mtlFiles.includes(any)) mtlFiles.push(any)
		else if (!any) warnings.push(`material library ${lib} not in the upload`)
	}
	if (!mtlFiles.length) mtlFiles.push(...src.files.filter((f) => /\.mtl$/i.test(f.rel)))
	const mtl = new Map()
	const mtlDirOf = new Map()
	for (const f of mtlFiles) {
		const m = parseMtl((await f.read()).toString('utf8'))
		for (const [k, v] of m) if (!mtl.has(k)) {
			mtl.set(k, v)
			mtlDirOf.set(k, path.posix.dirname(f.rel) === '.' ? '' : path.posix.dirname(f.rel))
		}
	}
	onProgress({ phase: 'classifying', text: 'Sorting the room into floor, walls, ceiling, chandeliers…' })
	const cls = classify(obj, o)
	const index = textureIndex(src.files, src.skpMaterials || [])
	// textures per material (+ overrides)
	const texOf = new Map() // material index → { file, how, tileM?, planar? }
	const report = { textures: [], missing: [] }
	const overrideFor = (name, layer) => (o.textures || {})[`layer:${layer}`] || (o.textures || {})[name]
	obj.materials.forEach((name, i) => {
		const m = mtl.get(name)
		if (m?.mapKd) {
			const hit = findTexture(index, m.mapKd, name, mtlDirOf.get(name))
			if (hit && PLACEHOLDER.test(hit.file.rel)) report.textures.push({ material: name, file: hit.file.rel, how: 'placeholder (ignored)' })
			else if (hit) texOf.set(i, hit)
			else report.missing.push({ material: name, map: m.mapKd })
		}
	})
	const findImage = (spec) => src.files.find((f) => f.rel === spec) || byBase(src.files, spec)[0] || null
	// weld every bucket
	const items = []
	const B = cls.buckets
	for (let bi = 0; bi < B.length; bi++) {
		const b = B[bi]
		const name = obj.materials[b.mat]
		const ov = overrideFor(name, b.layer)
		let uvOf = null, matKey = name || '(none)'
		if (ov) {
			const f = findImage(ov.image)
			if (!f) warnings.push(`texture ${ov.image} for ${name || b.layer} not in the upload`)
			else {
				const tile = Array.isArray(ov.tile) ? ov.tile.map(Number) : [4, 4]
				matKey = `${name || b.layer} · ${path.posix.basename(f.rel)}`
				texOf.set(`ov:${matKey}`, { file: f, how: 'override', tileM: tile })
				uvOf = (t, k) => planarUv(cls.P, cls.fn, t, obj.tris.v[3 * t + k] * 3, tile)
			}
		} else if (texOf.has(b.mat)) {
			const VT = obj.vt
			uvOf = (t, k) => {
				const ti = obj.tris.vt[3 * t + k]
				return ti >= 0 ? [VT[2 * ti], 1 - VT[2 * ti + 1]] : [0, 0]
			}
		}
		const mesh = weldBucket(cls, obj, b, uvOf)
		items.push({ key: `${b.node}|${matKey}|${b.sided}`, group: b.layer === 'Chandeliers' ? `Chandeliers|${matKey}` : null, mesh, b, matKey,
			texKey: ov && uvOf ? `ov:${matKey}` : uvOf ? b.mat : null })
		if (bi % 4 === 0) onProgress({ phase: 'welding', done: bi + 1, total: B.length, text: `Welding ${bi + 1}/${B.length}` })
	}
	const welded = items.reduce((s, it) => s + it.mesh.indices.length / 3, 0)
	onProgress({ phase: 'simplifying', text: `Simplifying ${welded} triangles to ${o.budget || '∞'}…` })
	const fit = fitBudget(items.map((it) => ({ key: it.key, group: it.group, mesh: it.mesh })), Number(o.budget) || 0)
	// pictures: re-encoded ≤ maxEdge within the texture budget; left out → the material's mean colour
	onProgress({ phase: 'textures', text: 'Encoding pictures…' })
	const texKeys = [...new Set(items.map((it) => it.texKey).filter((k) => k != null))]
	const sources = await Promise.all(texKeys.map(async (k) => {
		const f = texOf.get(k).file
		const data = await f.read().catch(() => null)
		const png = data && data.length > 8 && data.readUInt32BE(0) === 0x89504e47
		return data ? { data, mime: png ? 'image/png' : 'image/jpeg' } : null
	}))
	const planes = (o.planes || []).map((pl) => ({ pl, f: findImage(pl.image) }))
	const planeSrc = await Promise.all(planes.map(async ({ f }) => (f ? { data: await f.read(), mime: /\.png$/i.test(f.rel) ? 'image/png' : 'image/jpeg' } : null)))
	const shrunk = await tex.shrinkImages([...sources, ...planeSrc], { budget: o.textureBudget, maxEdge: o.maxEdge, ...(o.encode ? { encode: o.encode } : {}) })
	const image = new Map(texKeys.map((k, i) => [k, shrunk[i]]))
	// materials
	const materials = new Map()
	for (const it of items) {
		const name = obj.materials[it.b.mat]
		const m = mtl.get(name) || { kd: [0.8, 0.8, 0.8], ks: [0, 0, 0], ns: null, d: 1 }
		const img = it.texKey != null ? image.get(it.texKey) : null
		const key = `${it.matKey}${it.b.sided === 2 ? ' (2-sided)' : ''}`
		if (!materials.has(key)) {
			let color = [...m.kd.map(toLinear), m.d]
			if (it.texKey != null && !img) {
				const src0 = sources[texKeys.indexOf(it.texKey)]
				const mean = src0 ? await (o.meanColor || tex.ffmpegMeanColor)(src0).catch(() => null) : null
				if (mean) color = [...mean, m.d]
			}
			const alpha = m.d < 0.999 || (img?.mime === 'image/png' && seeThrough(img.data)) ? 'BLEND' : undefined
			materials.set(key, { color: img ? [1, 1, 1, m.d] : color, image: img || undefined, doubleSided: it.b.sided === 2, alpha, ...pbrOf(m) })
		}
		it.mat = key
	}
	for (const k of texKeys) {
		const t = texOf.get(k), im = image.get(k)
		report.textures.push({ material: typeof k === 'string' ? k.slice(3) : obj.materials[k], file: t.file.rel, how: t.how, ...(t.tileM ? { tileM: t.tileM.map((v) => Math.round(v * 1000) / 1000) } : {}),
			...(im ? { bytes: im.data.length, edge: im.edge } : { leftOut: 'mean colour (texture budget)' }) })
	}
	// nodes: one per layer / chandelier, primitives per material
	const nodes = new Map()
	items.forEach((it, i) => {
		const m = fit.meshes[i]
		if (!m.indices.length) return
		const n = nodes.get(it.b.node) || nodes.set(it.b.node, { layer: it.b.layer, prims: [] }).get(it.b.node)
		n.prims.push({ positions: m.positions, normals: m.normals, uvs: m.uvs || undefined, indices: m.indices, material: it.mat })
	})
	planes.forEach(({ pl, f }, i) => {
		const im = shrunk[texKeys.length + i]
		if (!f) return warnings.push(`plane ${pl.name}: picture ${pl.image} not in the upload`)
		const key = `${pl.name || 'Plan'} · ${path.posix.basename(f.rel)}`
		materials.set(key, { color: [1, 1, 1, pl.opacity ?? 1], image: im || undefined, doubleSided: false, alpha: (pl.opacity ?? 1) < 1 ? 'BLEND' : undefined, roughness: 0.9, metallic: 0 })
		nodes.set(pl.name || 'Plan', { layer: pl.name || 'Plan', prims: [{ ...planeMesh(pl), material: key }] })
		report.textures.push({ material: key, file: f.rel, how: 'plane', ...(im ? { bytes: im.data.length, edge: im.edge } : { leftOut: 'texture budget' }) })
	})
	for (const mk of o.markers || []) {
		if (!mk.points?.length) continue
		const key = `${mk.name || 'Markers'} · marker`
		materials.set(key, { color: [...(mk.color || [0.9, 0.1, 0.15]).map(toLinear), 1], doubleSided: false, roughness: 0.6, metallic: 0 })
		const n = nodes.get(mk.name || 'Markers') || nodes.set(mk.name || 'Markers', { layer: mk.name || 'Markers', prims: [] }).get(mk.name || 'Markers')
		n.prims.push({ ...discMesh(mk), material: key })
	}
	const layerNames = [...new Set([...nodes.values()].map((n) => n.layer))]
	const meshes = [...nodes.entries()].map(([name, n]) => ({ name, primitives: n.prims,
		node: { extensions: { [EXT]: { layer_identifier: layerId(n.layer) } } } }))
	const place = o.place || null
	const yaw = ((Number(place?.yaw) || 0) * Math.PI) / 180
	const matrix = place ? [Math.cos(yaw), 0, -Math.sin(yaw), 0, 0, 1, 0, 0, Math.sin(yaw), 0, Math.cos(yaw), 0, Number(place.x) || 0, Number(place.y) || 0, Number(place.z) || 0, 1] : null
	const triOut = fit.after + planes.filter((p) => p.f).length * 2 + (o.markers || []).reduce((a, mk) => a + (mk.points?.length || 0) * 24, 0)
	const r3 = (v) => Math.round(v * 1000) / 1000
	const rep = {
		source: { obj: objFile.rel, bytes: objFile.size, generator: obj.generator || '', mtl: mtlFiles.map((f) => f.rel), skp: src.skps || [], zip: src.zips || [] },
		units: cls.units, up: cls.up,
		bounds: { min: cls.bounds.min.map(r3), max: cls.bounds.max.map(r3), size: cls.bounds.max.map((v, k) => r3(v - cls.bounds.min[k])) },
		floorY: r3(cls.floorY), ceilingY: r3(cls.ceilingY), place,
		faces: obj.faces, ngons: obj.ngons, concave: obj.concave, skippedFaces: obj.skipped,
		triangles: { in: obj.tris.mat.length, welded, out: triOut, budget: Number(o.budget) || 0 },
		dropped: { degenerate: items.reduce((s, it) => s + it.mesh.degenerate, 0), duplicate: items.reduce((s, it) => s + it.mesh.duplicate, 0) },
		nodes: { in: obj.groups.length - 1, out: nodes.size },
		layers: Object.fromEntries(layerNames.map((l) => [l, [...nodes.values()].filter((n) => n.layer === l).reduce((s, n) => s + n.prims.reduce((a, p) => a + p.indices.length / 3, 0), 0)])),
		materials: { in: obj.materials.filter(Boolean).length, out: materials.size },
		textures: report.textures, missingTextures: report.missing, decimated: fit.decimated, warnings,
	}
	onProgress({ phase: 'writing', text: 'Writing the .glb…' })
	const asset = { extensions: { [EXT]: { layers: layerNames.map((l) => ({ identifier: layerId(l), name: l })) } } }
	rep.ms = Date.now() - t0
	const glb = writeGlb(meshes, { materials, root: { name: 'venue', ...(matrix ? { matrix } : {}) }, asset: { ...asset, extras: { highascg_import: rep } }, extensionsUsed: [EXT] })
	return { glb, report: { ...rep, glbBytes: glb.length } }
}

module.exports = { convertVenue, layerId, EXT, DEFAULTS }

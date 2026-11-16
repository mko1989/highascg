'use strict'

/**
 * WO-1082 — the venue model in the game scene: the project's venue .glb (project.previs.mvr.venue_glb, WO-1003) drawn
 * through the MVR scene exactly as the previs draws it (godot/client/features/previs/mvr_venue.gd `apply`):
 *   - an MVR object that is not a fixture and not a bound video screen draws the .glb meshes of its uuid
 *     (extensions.CAPTURE_model.identifier) instead of its own MVR parts, on its MVR layer;
 *   - a fixture (and a bound screen) keeps the MVR's parts; its .glb model is dropped;
 *   - a .glb mesh no MVR object owns is an object of its Capture layer (a node without a uuid is keyed `glb:<index>`);
 *   - a .glb mesh keeps its own materials (a layer colour never repaints it — mvr_venue.gd `no_tint`), textures and UVs.
 * Every part is placed as the previs places it: placement(place) · moved[uuid] · the node's world matrix in the file
 * (Capture writes the .glb in the frame the server converts the MVR into — the MVR's (x, z, −y) in metres).
 * Pure apart from `pause` (yields between meshes): parseVenue(buf) → venue; venueParts(scene, cfg, venue) → parts.
 */

const { core } = require('./host')
const { readGlb } = core('src/stage/glb-write')
const G = require('./rc-scene-geom')
const { accessor, nodeXf } = require('./rc-scene-mesh')

const KEY = 'venue:' // template keys of venue meshes: venue:<glTF mesh index>

// WO-1098: the OBJ importer's venue .glb names its layers the same way under its own extension name
const ext = (o) => {
	const e = o && typeof o === 'object' ? o.extensions?.CAPTURE_model || o.extensions?.HIGHASCG_venue : null
	return e && typeof e === 'object' ? e : {}
}

/** KHR_texture_transform (offset, rotation, scale) of a texture info → (u, v) → [u, v] baked into the UVs; null = none. */
function uvTransform(info) {
	const t = info?.extensions?.KHR_texture_transform
	if (!t || typeof t !== 'object') return null
	const [ox, oy] = Array.isArray(t.offset) ? t.offset.map(Number) : [0, 0]
	const [sx, sy] = Array.isArray(t.scale) ? t.scale.map(Number) : [1, 1]
	const r = Number(t.rotation) || 0
	if (!ox && !oy && sx === 1 && sy === 1 && !r) return null
	const c = Math.cos(r), s = Math.sin(r)
	return (u, v) => [c * sx * u + s * sy * v + ox, -s * sx * u + c * sy * v + oy]
}

/**
 * The venue .glb → { capture, nodes: [{ uuid, layer, mesh, xf }], materials: [{ name, color, image, uvXf }],
 * images: [{ data, mime }], template(meshIndex) → template | null (cached), meshes }. Throws on a file that is not a GLB.
 */
function parseVenue(buf) {
	const { json, bin } = readGlb(buf)
	const nodes = Array.isArray(json.nodes) ? json.nodes : []
	const layerNames = new Map()
	for (const l of Array.isArray(ext(json.asset).layers) ? ext(json.asset).layers : []) layerNames.set(String(l.identifier || '').toLowerCase(), String(l.name || ''))
	const parent = new Map()
	nodes.forEach((n, i) => (Array.isArray(n?.children) ? n.children : []).forEach((c) => parent.set(c, i)))
	const out = []
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i]
		if (n?.mesh == null || !json.meshes?.[n.mesh]) continue
		let xf = G.IDENTITY, layer = '', at = i
		for (let guard = 0; at != null && guard < 64; guard++) {
			xf = G.compose(nodeXf(nodes[at] || {}), xf)
			if (!layer) layer = layerNames.get(String(ext(nodes[at]).layer_identifier || '').toLowerCase()) || ''
			at = parent.get(at)
		}
		const uuid = String(ext(n).identifier || '').toLowerCase() || `glb:${i}`
		out.push({ uuid, layer, mesh: n.mesh, xf })
	}
	const textures = Array.isArray(json.textures) ? json.textures : []
	const images = (Array.isArray(json.images) ? json.images : []).map((im) => {
		const v = im?.bufferView != null ? json.bufferViews?.[im.bufferView] : null
		if (!v) return null
		const data = Buffer.from(bin.buffer, bin.byteOffset + (v.byteOffset || 0), v.byteLength)
		const png = data.length > 8 && data.readUInt32BE(0) === 0x89504e47
		return { data, mime: im.mimeType || (png ? 'image/png' : 'image/jpeg') }
	})
	const materials = (Array.isArray(json.materials) ? json.materials : []).map((m) => {
		const pbr = m?.pbrMetallicRoughness || {}
		const f = Array.isArray(pbr.baseColorFactor) ? pbr.baseColorFactor.map(Number) : [1, 1, 1, 1]
		const ti = pbr.baseColorTexture
		const src = ti && textures[ti.index] ? textures[ti.index].source : null
		const image = src != null && images[src] ? src : null
		const ei = m?.emissiveTexture
		const esrc = ei && textures[ei.index] ? textures[ei.index].source : null
		const e = Array.isArray(m?.emissiveFactor) ? m.emissiveFactor.slice(0, 3).map(Number) : null
		return { name: String(m?.name || ''), color: [f[0], f[1], f[2], 1], image, uvSet: Number(ti?.texCoord) || 0, uvXf: image != null ? uvTransform(ti) : null,
			flat: null, // flat = [r, g, b] (linear): drawn in its picture's mean colour, no UVs (heavyTextures)
			// the rest of the material, for MVR-archive meshes drawn with their own materials (rc-scene-rich.js)
			emissive: e && e.some((v) => v > 0) ? e : null, emissiveImage: esrc != null && images[esrc] ? esrc : null,
			doubleSided: m?.doubleSided === true, roughness: Number.isFinite(pbr.roughnessFactor) ? pbr.roughnessFactor : 1,
			metallic: Number.isFinite(pbr.metallicFactor) ? pbr.metallicFactor : 1 }
	})
	const primsOf = (mi) => (Array.isArray(json.meshes?.[mi]?.primitives) ? json.meshes[mi].primitives : [])
	const cache = new Map()
	function template(mi) {
		if (cache.has(mi)) return cache.get(mi)
		const prims = []
		for (const p of primsOf(mi)) {
			if ((p.mode ?? 4) !== 4 || p.attributes?.POSITION == null) continue
			const pos = accessor(json, bin, p.attributes.POSITION)
			if (!pos || pos.length < 9) continue
			const idx = p.indices != null ? accessor(json, bin, p.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i)
			if (!idx || idx.length < 3) continue
			const mat = materials[p.material]
			let uv = null
			if (mat?.image != null && !mat.flat) {
				const raw = accessor(json, bin, p.attributes[`TEXCOORD_${mat.uvSet}`])
				if (raw && raw.length === (pos.length / 3) * 2) {
					uv = raw instanceof Float32Array ? raw : Float32Array.from(raw)
					if (mat.uvXf) for (let k = 0; k < uv.length; k += 2) [uv[k], uv[k + 1]] = mat.uvXf(uv[k], uv[k + 1])
				}
			}
			const color = mat ? (mat.flat ? mat.flat.map((v, k) => v * mat.color[k]).concat(1) : mat.color) : null
			prims.push({ pos, idx: idx.subarray(0, idx.length - (idx.length % 3)), color, ...(uv ? { uv, mat: p.material } : {}), mi: p.material ?? null })
		}
		let t = null
		if (prims.length) {
			const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
			let tris = 0
			for (const p of prims) {
				tris += p.idx.length / 3
				for (let i = 0; i < p.pos.length; i += 3) {
					for (let k = 0; k < 3; k++) {
						if (p.pos[i + k] < min[k]) min[k] = p.pos[i + k]
						if (p.pos[i + k] > max[k]) max[k] = p.pos[i + k]
					}
				}
			}
			t = { prims, tris, bounds: { min, max }, simple: new Map() }
		}
		cache.set(mi, t)
		return t
	}
	/** Mesh mi's line primitives (LINES / LINE_LOOP / LINE_STRIP) → [{ seg: Float32Array (pairs of points), color }]. */
	function lines(mi) {
		const out = []
		for (const p of primsOf(mi)) {
			const mode = p.mode ?? 4
			if (mode < 1 || mode > 3 || p.attributes?.POSITION == null) continue
			const pos = accessor(json, bin, p.attributes.POSITION)
			if (!pos) continue
			const n = pos.length / 3
			const idx = p.indices != null ? accessor(json, bin, p.indices) : Uint32Array.from({ length: n }, (_, i) => i)
			if (!idx || idx.length < 2) continue
			const pairs = []
			if (mode === 1) for (let i = 0; i + 1 < idx.length; i += 2) pairs.push(idx[i], idx[i + 1])
			else {
				for (let i = 0; i + 1 < idx.length; i++) pairs.push(idx[i], idx[i + 1])
				if (mode === 2) pairs.push(idx[idx.length - 1], idx[0])
			}
			const seg = new Float32Array(pairs.length * 3)
			pairs.forEach((v, k) => seg.set(pos.subarray(v * 3, v * 3 + 3), k * 3))
			out.push({ seg, color: materials[p.material]?.color || null })
		}
		return out
	}
	const hasMode = (mi, test) => primsOf(mi).some((p) => test(p.mode ?? 4))
	/** Triangles per material over meshes `mis` (from the accessor counts; nothing decoded). */
	function trisByMaterial(mis) {
		const out = new Map()
		for (const mi of mis) {
			for (const p of primsOf(mi)) {
				if ((p.mode ?? 4) !== 4 || p.material == null) continue
				const a = json.accessors?.[p.indices != null ? p.indices : p.attributes?.POSITION]
				out.set(p.material, (out.get(p.material) || 0) + Math.floor((a?.count || 0) / 3))
			}
		}
		return out
	}
	const capture = (Array.isArray(json.extensionsUsed) && json.extensionsUsed.includes('CAPTURE_model')) || out.some((n) => !n.uuid.startsWith('glb:'))
	return { capture, nodes: out, materials, images, template, lines, trisByMaterial, meshes: out.length,
		hasTris: (mi) => hasMode(mi, (m) => m === 4), hasLines: (mi) => hasMode(mi, (m) => m >= 1 && m <= 3) }
}

/**
 * The visible parts of the MVR scene merged with the venue (the WO-1003 rules above) →
 * { parts: [{ key, xf, layer, uuid, fixture, color }], swapped, extra, layers: { name: extra objects } }.
 * Same shape as G.visibleParts; a venue part's key is `venue:<mesh>` (its template from venue.template) and color null.
 */
function venueParts(scene, cfg, venue) {
	const c = cfg && typeof cfg === 'object' ? cfg : {}
	const hiddenLayers = new Set((Array.isArray(c.hidden_layers) ? c.hidden_layers : []).map(String))
	const hiddenObjects = new Set((Array.isArray(c.hidden_objects) ? c.hidden_objects : []).map((u) => String(u).toLowerCase()))
	const moved = {}
	if (c.moved && typeof c.moved === 'object') for (const [u, a] of Object.entries(c.moved)) moved[u.toLowerCase()] = G.xf12(a)
	const colors = c.layer_colors && typeof c.layer_colors === 'object' ? c.layer_colors : {}
	const P = G.placementOf(c.place)
	const by = new Map()
	for (const n of venue.nodes) {
		if (!by.has(n.uuid)) by.set(n.uuid, [])
		by.get(n.uuid).push(n)
	}
	const parts = []
	let swapped = 0
	const layers = {}
	const glbPart = (n, uuid, layer, node) => parts.push({ key: KEY + n.mesh, xf: G.compose(node, n.xf), layer, uuid, fixture: false, color: null })
	for (const o of scene?.objects || []) {
		const uuid = String(o?.uuid || '').toLowerCase()
		const layer = String(o?.layer || '')
		const mine = by.get(uuid)
		by.delete(uuid) // an MVR object owns its .glb meshes (a fixture's are dropped, a hidden object's too)
		if (hiddenLayers.has(layer) || hiddenObjects.has(uuid)) continue
		const node = G.compose(P, moved[uuid] || G.IDENTITY)
		const fixture = !!o.fixture || o.kind === 'Fixture'
		const screen = !!(o.screen && typeof o.screen === 'object' && String(o.screen.role || ''))
		if (mine && !fixture && !screen) {
			for (const n of mine) glbPart(n, uuid, layer, node)
			swapped++
			continue
		}
		for (const p of o.parts || []) {
			if (!p || typeof p.mesh !== 'string') continue
			parts.push({ key: p.mesh, xf: G.compose(node, G.xf12(p.xform)), layer, uuid, fixture, color: G.hexToLinear(colors[layer]) })
		}
	}
	let extra = 0
	for (const [uuid, list] of by) {
		const layer = list[0].layer
		if (hiddenLayers.has(layer) || hiddenObjects.has(uuid)) continue
		const node = G.compose(P, moved[uuid] || G.IDENTITY)
		for (const n of list) glbPart(n, uuid, layer, node)
		extra++
		layers[layer] = (layers[layer] || 0) + 1
	}
	return { parts, swapped, extra, layers }
}

const TEX_MAX_TRIS = 8000 // a textured material drawn on more triangles than this is drawn flat (its picture's mean colour)

/**
 * Textures that would cost more than they show: Capture writes unshared vertices with per-face UVs, so a textured mesh
 * cannot be welded by the simplifier (Narvil: the 75 k-triangle tablecloths "Obrus" alone came to 4.9 MB). Every material
 * used on more than TEX_MAX_TRIS triangles of `parts` gets `flat` = its picture's mean colour (meanColor(image) →
 * linear [r, g, b] or null = its factor alone). Call before the templates are built. → the names made flat.
 */
async function flattenHeavyTextures(model, parts, meanColor) {
	const mis = new Set(parts.filter((p) => p.key.startsWith(KEY)).map((p) => Number(p.key.slice(KEY.length))))
	const out = []
	for (const [mi, tris] of model.trisByMaterial(mis)) {
		const m = model.materials[mi]
		if (!m || m.image == null || tris <= TEX_MAX_TRIS) continue
		const c = meanColor ? await meanColor(model.images[m.image]).catch(() => null) : null
		m.flat = Array.isArray(c) && c.length >= 3 ? c.slice(0, 3) : [1, 1, 1]
		out.push(m.name)
	}
	return out
}

/**
 * The line work of the venue parts (Capture writes 853 of Narvil's objects — LED-strip outlines, truss lacing — as glTF
 * LINES), placed, welded at `cell` (m) and de-duplicated → [{ positions, indices, color, mode: 1 }] (one per colour).
 */
function venueLines(parts, model, cell) {
	const buckets = new Map()
	for (const p of parts) {
		for (const l of model.lines(Number(p.key.slice(KEY.length)))) {
			const color = l.color || [0.8, 0.8, 0.8, 1]
			const key = color.slice(0, 3).map((v) => Math.round(v * 64)).join(',')
			if (!buckets.has(key)) buckets.set(key, { color, verts: new Map(), pos: [], segs: new Set(), idx: [] })
			const b = buckets.get(key)
			const vert = (x, y, z) => {
				const q = G.apply(p.xf, x, y, z)
				const k = `${Math.round(q[0] / cell)},${Math.round(q[1] / cell)},${Math.round(q[2] / cell)}`
				if (!b.verts.has(k)) {
					b.verts.set(k, b.pos.length / 3)
					b.pos.push(q[0], q[1], q[2])
				}
				return b.verts.get(k)
			}
			for (let i = 0; i + 5 < l.seg.length; i += 6) {
				const a = vert(l.seg[i], l.seg[i + 1], l.seg[i + 2]), c = vert(l.seg[i + 3], l.seg[i + 4], l.seg[i + 5])
				const s = a < c ? `${a},${c}` : `${c},${a}`
				if (a === c || b.segs.has(s)) continue
				b.segs.add(s)
				b.idx.push(a, c)
			}
		}
	}
	return [...buckets.values()].filter((b) => b.idx.length).map((b) => ({ positions: new Float32Array(b.pos), indices: new Uint32Array(b.idx), color: b.color, mode: 1 }))
}

module.exports = { KEY, TEX_MAX_TRIS, parseVenue, venueParts, flattenHeavyTextures, venueLines }

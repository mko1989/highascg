'use strict'

/**
 * WO-1090 — MVR-archive meshes drawn with their own materials, as the previs draws them (GET /api/stage/mvr/<id>/mesh
 * serves the archive's .glb as authored). A mesh file is "rich" when one of its materials has a picture (base colour or
 * emissive) or glows: Hilton Wawer's room skins (carpet, walls, wood panelling, curtains, coffered ceiling, chandeliers)
 * are one SceneObject each, a JPEG tiled over UVs in world metres (REPEAT). Everything else keeps the flat path
 * (rc-scene-mesh.js readTemplate: positions + base colour), so a show without pictures bakes byte for byte as before.
 *
 * A rich file is read with the venue reader (rc-scene-venue.js parseVenue: UVs, KHR_texture_transform, images) and its
 * nodes flattened into one template whose prims carry `rich` = "<mesh key>#<material>" — the key of the material record
 * in `mats` (name, color, image / emissiveImage { data, mime }, emissive, doubleSided, roughness, metallic).
 * The venue's rules apply: a material drawn on more than TEX_MAX_TRIS triangles (counting every instance) is drawn in
 * its picture's mean colour, and the pictures share the venue's budget (rc-scene-tex.js shrinkImages).
 *
 *   isRich(buf) → boolean
 *   createRich() → { add(key, buf) → boolean, flatten(parts, meanColor) → names, template(key) → template | null,
 *                    material(richKey) → record | null, has(key) }
 */

const { core } = require('./host')
const { readGlb } = core('src/stage/glb-write')
const V = require('./rc-scene-venue')
const { apply } = require('./rc-scene-geom')

function isRich(buf) {
	let json
	try {
		;({ json } = readGlb(buf))
	} catch {
		return false
	}
	return (Array.isArray(json.materials) ? json.materials : []).some((m) => m && (m.pbrMetallicRoughness?.baseColorTexture || m.emissiveTexture
		|| (Array.isArray(m.emissiveFactor) && m.emissiveFactor.some((v) => Number(v) > 0))))
}

const det3 = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[3] * (m[1] * m[8] - m[2] * m[7]) + m[6] * (m[1] * m[5] - m[2] * m[4])

function createRich() {
	const models = new Map() // mesh key → parseVenue model

	function add(key, buf) {
		if (!isRich(buf)) return false
		const model = V.parseVenue(buf)
		if (!model.meshes) return false
		models.set(key, model)
		return true
	}

	/** Heavy pictures → mean colour (venue rule, every instance counted). Call before template(). → material names. */
	async function flatten(parts, meanColor) {
		const uses = new Map()
		for (const p of parts) if (models.has(p.key)) uses.set(p.key, (uses.get(p.key) || 0) + 1)
		const out = []
		for (const [key, n] of uses) {
			const model = models.get(key)
			for (const [mi, tris] of model.trisByMaterial(new Set(model.nodes.map((x) => x.mesh)))) {
				const m = model.materials[mi]
				if (!m || m.image == null || tris * n <= V.TEX_MAX_TRIS) continue
				const c = meanColor ? await meanColor(model.images[m.image]).catch(() => null) : null
				m.flat = Array.isArray(c) && c.length >= 3 ? c.slice(0, 3) : [1, 1, 1]
				out.push(m.name)
			}
		}
		return out
	}

	/** The file's meshes at their node transforms → one template (bounds, tris) whose prims carry `rich`. */
	function template(key) {
		const model = models.get(key)
		if (!model) return null
		const prims = []
		for (const n of model.nodes) {
			const t = model.template(n.mesh)
			if (!t) continue
			const flip = det3(n.xf) < 0
			for (const p of t.prims) {
				const pos = new Float32Array(p.pos.length)
				for (let i = 0; i < pos.length; i += 3) pos.set(apply(n.xf, p.pos[i], p.pos[i + 1], p.pos[i + 2]), i)
				let idx = p.idx
				if (flip) {
					idx = Uint32Array.from(p.idx)
					for (let i = 0; i + 2 < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]
				}
				prims.push({ pos, idx, color: p.color, ...(p.uv ? { uv: p.uv } : {}), ...(p.mi != null ? { rich: `${key}#${p.mi}` } : {}) })
			}
		}
		if (!prims.length) return null
		const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
		let tris = 0
		for (const p of prims) {
			tris += p.idx.length / 3
			for (let i = 0; i < p.pos.length; i++) {
				if (p.pos[i] < min[i % 3]) min[i % 3] = p.pos[i]
				if (p.pos[i] > max[i % 3]) max[i % 3] = p.pos[i]
			}
		}
		return { prims, tris, bounds: { min, max }, simple: new Map() }
	}

	/** "<key>#<material>" → { name, color, image, emissiveImage, emissive, doubleSided, roughness, metallic } | null. */
	function material(richKey) {
		const s = String(richKey)
		const cut = s.lastIndexOf('#')
		const model = cut > 0 ? models.get(s.slice(0, cut)) : null
		const m = model?.materials[Number(s.slice(cut + 1))]
		if (!m) return null
		const img = (i) => (i != null && !m.flat ? model.images[i] || null : null)
		return { name: m.name, color: m.color, image: img(m.image), emissiveImage: img(m.emissiveImage), emissive: m.emissive,
			doubleSided: m.doubleSided, roughness: m.roughness, metallic: m.metallic }
	}

	return { add, flatten, template, material, has: (key) => models.has(key) }
}

module.exports = { isRich, createRich }

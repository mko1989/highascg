'use strict'

/**
 * WO-1104 — stage drapes (project.previs.stage.objects type "drape") in the games' bake (rc-scene.js; Skirmish and
 * Salad reuse it): each visible drape is a template of its own pleats — src/stage/drape-geometry.js, the previs's shape,
 * sampled at the Low level — placed like the previs places it (rc-scene-geom.js objectXf) and drawn in its colour, black
 * lifted to a dark grey the game's lights can still shape. Its triangles cross the car / soldier band like any wall's,
 * so the occupancy and obstacle grids block it (a skirt is ≥ 5 cm tall — far above FLAT_DECOR). Pure.
 *
 *   drapeParts(objects) → { templates: Map key → template (rc-scene-mesh.js shape, exact), parts: [{ key, xf, color,
 *     fixture: false, uuid }] }
 */

const { core } = require('./host')
const G = require('./rc-scene-geom')

const KEY = 'game:drape:'
const MIN_LINEAR = 0.012 // the darkest a drape is drawn in the games (linear; #151515 is 0.0075)

function drapeParts(objects) {
	const Drape = core('src/stage/drape-geometry')
	const templates = new Map()
	const parts = []
	for (const o of Array.isArray(objects) ? objects : []) {
		if (!o || typeof o !== 'object' || o.type !== 'drape' || o.visible === false) continue
		const key = `${KEY}${String(o.id || parts.length)}`
		if (templates.has(key)) continue
		const m = Drape.mesh(o, Drape.SAMPLES[0])
		const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
		for (let i = 0; i < m.positions.length; i++) {
			min[i % 3] = Math.min(min[i % 3], m.positions[i])
			max[i % 3] = Math.max(max[i % 3], m.positions[i])
		}
		templates.set(key, { prims: [{ pos: m.positions, idx: m.indices, color: null }], tris: m.tris, bounds: { min, max }, simple: new Map(), exact: true })
		const c = Drape.linearColor(o.color)
		parts.push({ key, xf: G.objectXf(o), color: [...c.slice(0, 3).map((v) => Math.max(MIN_LINEAR, v)), 1], fixture: false, uuid: String(o.name || o.id || 'drape') })
	}
	return { templates, parts }
}

module.exports = { drapeParts, KEY }

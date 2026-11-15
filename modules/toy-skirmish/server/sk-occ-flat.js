'use strict'

/**
 * WO-1083 — Stage Skirmish: flat decor does not block (pure). The RC bake's `occ` grid marks every cell where scene
 * geometry crosses the toy band (floor + 0.05 u … + 0.6 u) — a carpet, a cable mat or a dance-floor panel thicker than
 * 5 mm (0.05 u) counts there like a wall, and for a soldier 0.55 u tall that fires at 0.35 u it is not one. Before the
 * arenas are generated (and the client gets the scene), every blocked `occ` cell is checked against the scene's height
 * field (`heights`, 0.25 u bins): a cell stays solid only when geometry reaches the upper half of the band
 * (floor + FLAT_U … + 0.6 u) within the cell or the field cell next to it; anything lower is floor to walk and shoot
 * over. Conservative: cells the field does not cover, and every cell when the scene has no field, stay as baked.
 * The baked files are not touched (the RC game reads them unchanged); only the JSON this game serves is filtered.
 *
 *   clearFlatDecor(json) → { json, cleared: { [floor]: cells } }   (json unchanged when nothing was cleared)
 */

const { kit } = require('./sk-kit')

/** Lower than this above its floor (u) is flat decor: half a soldier's height, under the 0.35 u muzzle. */
const FLAT_U = 0.3
const BAND_TOP_U = 0.6

function clearFlatDecor(json) {
	const K = kit()
	const field = json && Array.isArray(json.occ) ? K.heightsFromJSON(json.heights) : null
	if (!field) return { json, cleared: {} }
	const u = typeof json.scale === 'number' && json.scale > 0 && json.scale <= 1 ? json.scale : 1
	const cleared = {}
	let any = false
	const occ = json.occ.map((o) => {
		const g = K.occFromJSON(o)
		if (!g || !Number.isFinite(o.y)) return o
		const bits = Uint8Array.from(g.bits)
		let n = 0
		for (let k = 0; k < g.h; k++) {
			for (let i = 0; i < g.w; i++) {
				const idx = k * g.w + i
				if (!bits[idx]) continue
				const x = g.x0 + (i + 0.5) * g.cell, z = g.z0 + (k + 0.5) * g.cell
				const fi = Math.floor((x - field.x0) / field.cell), fk = Math.floor((z - field.z0) / field.cell)
				if (fi < 0 || fk < 0 || fi >= field.nx || fk >= field.nz) continue // not covered: keep
				if (field.bandHit(x, z, g.cell / 2, o.y + FLAT_U * u, o.y + BAND_TOP_U * u)) continue
				bits[idx] = 0
				n++
			}
		}
		if (!n) return o
		any = true
		cleared[o.floor] = n
		const { rle: _rle, ...rest } = o
		return { ...rest, rle: K.occEncodeRle(bits) }
	})
	return { json: any ? { ...json, occ } : json, cleared }
}

module.exports = { clearFlatDecor, FLAT_U }

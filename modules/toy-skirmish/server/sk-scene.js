'use strict'

/**
 * WO-1081 — Stage Skirmish: the scene the game serves (contract §4) = the RC bake's JSON (rc-scene.js through the
 * kit: floors, `occ`, height field, GLB, `scale`, cached on disk under ~/.highascg/cache/rc-game/<rev>.* and shared with
 * the RC game) with `tracks` removed, `glb` pointing at /api/game/sk/scene.glb, and `arenas` added. The arenas are
 * generated once per rev (sk-arenas.js, yielding between arenas) and kept in memory with their decoded floor grids.
 * Flat decor (a carpet, a mat: nothing above 0.3 u) is taken out of `occ` first (WO-1083, sk-occ-flat.js), so the
 * arenas, the server's grid and the client's grid all treat it as floor.
 * The live `lights` / `screens` are spliced in by the service (withLiveScene), never stored here.
 *
 *   get() → Promise<{ rev, json, text, glb, gz, arenas, scale }>   (concurrent callers share one build)
 *   rev() → the bake's current rev (cheap; memoised by the baker)
 */

const { generateArenasAsync } = require('./sk-arenas')
const { clearFlatDecor } = require('./sk-occ-flat')

/**
 * @param {{ baker: { get: () => Promise<object>, rev: () => string }, log?: Function, pause?: () => Promise<void> }} deps
 */
function createSkScene(deps) {
	const baker = deps.baker
	const log = deps.log || (() => {})
	let ready = null
	let building = null

	async function build(bake) {
		const t0 = Date.now()
		const flat = clearFlatDecor(bake.json)
		const { tracks: _tracks, ...rest } = flat.json
		const arenas = await generateArenasAsync(flat.json, { rev: bake.rev }, deps.pause)
		const json = { ...rest, glb: `/api/game/sk/scene.glb?rev=${bake.rev}`, arenas }
		const flatN = Object.entries(flat.cleared).map(([f, n]) => `${f} ${n}`).join(', ')
		if (flatN) log('info', `[toy-skirmish] scene ${bake.rev}: flat decor cells taken out of occ (${flatN})`)
		log('info', `[toy-skirmish] scene ${bake.rev}: ${arenas.length} arenas in ${Date.now() - t0} ms (${arenas.map((a) => a.id).join(', ')})`)
		return { rev: bake.rev, json, text: JSON.stringify(json), glb: bake.glb, gz: bake.gz, arenas, scale: json.scale ?? 1 }
	}

	function get() {
		return baker.get().then((bake) => {
			if (ready && ready.rev === bake.rev) return ready
			if (building && building.rev === bake.rev) return building.p
			const p = build(bake).then((out) => {
				ready = out
				return out
			}).finally(() => {
				if (building?.p === p) building = null
			})
			building = { rev: bake.rev, p }
			return p
		})
	}

	return { get, rev: () => baker.rev(), peek: () => ready }
}

module.exports = { createSkScene }

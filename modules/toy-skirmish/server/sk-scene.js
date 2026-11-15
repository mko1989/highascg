'use strict'

/**
 * WO-1081 — Stage Skirmish: the scene the game serves (contract §4) = the RC bake's JSON (rc-scene.js through the
 * kit: floors, `occ`, height field, GLB, `scale`, cached on disk under ~/.highascg/cache/rc-game/<rev>.* and shared with
 * the RC game) with `tracks` removed, `glb` pointing at /api/game/sk/scene.glb, and `arenas` added. The arenas are
 * generated once per rev (sk-arenas.js, yielding between arenas) and kept in memory with their decoded floor grids.
 * The live `lights` / `screens` are spliced in by the service (withLiveScene), never stored here.
 *
 *   get() → Promise<{ rev, json, text, glb, gz, arenas, scale }>   (concurrent callers share one build)
 *   rev() → the bake's current rev (cheap; memoised by the baker)
 */

const { generateArenasAsync } = require('./sk-arenas')

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
		const { tracks: _tracks, ...rest } = bake.json
		const arenas = await generateArenasAsync(bake.json, { rev: bake.rev }, deps.pause)
		const json = { ...rest, glb: `/api/game/sk/scene.glb?rev=${bake.rev}`, arenas }
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

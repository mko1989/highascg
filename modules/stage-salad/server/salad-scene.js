'use strict'

/**
 * WO-1089 — Stage Salad: the scene the game serves = the RC bake (rc-scene.js through the kit: the venue GLB + floors,
 * cached under ~/.highascg/cache/rc-game/<rev>.* and SHARED with the other games — no second bake) without what only
 * the toy games need (`tracks`, the toy-scale `occ` grid and height field), `glb` pointing at /api/game/salad/scene.glb.
 * The venue (`salad`: frame, slots, colliders) depends on the live screens / lights too and is added by the service.
 *
 *   get() → Promise<{ rev, json, glb, gz }>   (concurrent callers share one build)   ·   rev() → the bake's rev
 */

function createSaladScene({ baker }) {
	let ready = null
	let building = null

	function build(bake) {
		const { tracks: _t, occ: _o, heights: _h, ...rest } = bake.json
		return { rev: bake.rev, json: { ...rest, glb: `/api/game/salad/scene.glb?rev=${bake.rev}` }, glb: bake.glb, gz: bake.gz }
	}

	function get() {
		return baker.get().then((bake) => {
			if (ready && ready.rev === bake.rev) return ready
			if (building && building.rev === bake.rev) return building.p
			const p = Promise.resolve(build(bake)).then((out) => (ready = out)).finally(() => {
				if (building?.p === p) building = null
			})
			building = { rev: bake.rev, p }
			return p
		})
	}

	return { get, rev: () => baker.rev(), peek: () => ready }
}

module.exports = { createSaladScene }

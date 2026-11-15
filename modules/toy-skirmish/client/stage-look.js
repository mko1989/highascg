/**
 * How the live room reads in Stage Skirmish (WO-1081 §9): the kit's stage-fx draws the rig's beams, floor pools and
 * lens glows; seen from above the cones would wash over the arena, so they are kept faint and the pools / glows —
 * what tells the players the rig is live — are turned up. Only the shader gains of the kit's meshes change.
 */
export const GAIN = { cones: 0.07, pools: 0.95, glows: 1.15 }

/** @param {{ group: import('three').Object3D }} fx the kit's createStageFx() result */
export function tuneStageFx(fx) {
	const lights = fx?.group?.getObjectByName?.('stage-fx-lights')
	if (!lights) return false
	const [cones, pools, glows] = lights.children
	const set = (mesh, v) => {
		const u = mesh?.material?.uniforms?.uGain
		if (u) u.value = v
	}
	set(cones, GAIN.cones)
	set(pools, GAIN.pools)
	set(glows, GAIN.glows)
	return true
}

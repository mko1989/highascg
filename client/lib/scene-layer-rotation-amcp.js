/**
 * Look-layer rotation uses compose-style center pivot — Caspar MIXER ANCHOR must match.
 * @see src/engine/scene-layer-rotation-amcp.js (CommonJS mirror)
 */

export const SCENE_LAYER_ROTATION_ANCHOR_X = 0.5
export const SCENE_LAYER_ROTATION_ANCHOR_Y = 0.5

/**
 * Caspar FILL from scene state is top-left anchored (compose left/top %).
 * Center ANCHOR requires shifting FILL to the layer center so position stays correct.
 * @param {{ x?: number, y?: number, scaleX?: number, scaleY?: number }} fill
 * @param {number} rotationDegrees
 */
export function fillForSceneLayerRotationAnchor(fill, rotationDegrees) {
	const x = Number(fill?.x) || 0
	const y = Number(fill?.y) || 0
	const scaleX = Number(fill?.scaleX) || 1
	const scaleY = Number(fill?.scaleY) || 1
	const rot = Number(rotationDegrees) || 0
	if (!rot) return { x, y, scaleX, scaleY }
	return { x: x + scaleX / 2, y: y + scaleY / 2, scaleX, scaleY }
}

/**
 * @param {string} cl — e.g. `2-10`
 * @param {number} rotationDegrees
 * @param {{ rotationTail?: string, deferRotation?: boolean, anchorDefer?: boolean }} [opts]
 * @returns {string[]}
 */
export function sceneLayerRotationMixerLines(cl, rotationDegrees, opts = {}) {
	const rot = Number(rotationDegrees) || 0
	const rotTail = opts.rotationTail != null ? String(opts.rotationTail) : ' 0'
	const anchorDefer = opts.anchorDefer ? ' DEFER' : ''
	const rotDefer = opts.deferRotation ? ' DEFER' : ''
	if (!rot) {
		return [
			`MIXER ${cl} ANCHOR 0 0 0${anchorDefer}`,
			`MIXER ${cl} ROTATION 0${rotTail}${rotDefer}`,
		]
	}
	return [
		`MIXER ${cl} ANCHOR ${SCENE_LAYER_ROTATION_ANCHOR_X} ${SCENE_LAYER_ROTATION_ANCHOR_Y} 0${anchorDefer}`,
		`MIXER ${cl} ROTATION ${rot}${rotTail}${rotDefer}`,
	]
}

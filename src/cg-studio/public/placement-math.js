/**
 * WO-267 — pure placement math for the CG Studio canvas drag overlay.
 * UMD-ish: browser global `StudioPlacement` for public/app.js, CommonJS export for smokes.
 */
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory()
	else root.StudioPlacement = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
	'use strict'

	const STAGE_W = 1920
	const STAGE_H = 1080

	/**
	 * Map a dragged graphic rect (stage pixels, 1920×1080 space) to template placement params.
	 * The horizontal anchor snaps by which third of the stage holds the graphic's center;
	 * marginX measures from the anchored edge (ignored for center), marginY from the bottom.
	 * @param {{ left: number, top: number, width: number, height: number }} rect
	 * @returns {{ position: 'left'|'center'|'right', marginX: number, marginY: number }}
	 */
	function placementFromDrag(rect) {
		const cx = rect.left + rect.width / 2
		const position = cx < STAGE_W / 3 ? 'left' : cx > (STAGE_W * 2) / 3 ? 'right' : 'center'
		let marginX = 0
		if (position === 'left') marginX = Math.round(rect.left)
		else if (position === 'right') marginX = Math.round(STAGE_W - (rect.left + rect.width))
		const marginY = Math.round(STAGE_H - (rect.top + rect.height))
		return {
			position,
			marginX: Math.max(0, marginX),
			marginY: Math.max(0, marginY),
		}
	}

	/**
	 * Overlay pixel coords → stage coords, given the preview scale/offset from scalePreview.
	 * @param {{ x: number, y: number }} pt - overlay-local pixels
	 * @param {{ scale: number, ox: number, oy: number }} view
	 * @returns {{ x: number, y: number }}
	 */
	function stageFromOverlay(pt, view) {
		const s = view.scale > 0 ? view.scale : 1
		return { x: (pt.x - view.ox) / s, y: (pt.y - view.oy) / s }
	}

	/**
	 * Centered fit of the 1920×1080 stage inside an arbitrary wrap box.
	 * @param {{ width: number, height: number }} box
	 * @returns {{ scale: number, ox: number, oy: number }}
	 */
	function fitStage(box) {
		const scale = Math.min((box.width || 1) / STAGE_W, (box.height || 1) / STAGE_H)
		return {
			scale,
			ox: (box.width - STAGE_W * scale) / 2,
			oy: (box.height - STAGE_H * scale) / 2,
		}
	}

	return { STAGE_W, STAGE_H, placementFromDrag, stageFromOverlay, fitStage }
})

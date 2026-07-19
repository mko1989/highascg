/**
 * Shared outer-rect -> inner "hole" rect geometry (todos19.07.26 release refactor). Single home
 * for the border-inset math previously duplicated between:
 *  - client/components/operator-compose-tiles.js `tileBodyRectFromOuter` (chrome ring: borderW on
 *    all 4 sides plus headerH above / footerH below the video hole), and
 *  - client/components/multiview-editor.js `reportMvRect` (per-cell blend holes: fixed viewport-px
 *    insets keeping the canvas-drawn editor chrome outside each hole).
 * Both feed the operator-GUI shaped-video pipeline (WO-255/WO-263): the returned rect is the
 * region punched out of the Firefox window shape, so chrome must sit strictly OUTSIDE it.
 *
 * Plain ESM with no top-level DOM/browser-global access — safe to `require()` directly under
 * node:test (Node's require(esm) support), same convention as client/lib/screen-timer-create.js.
 */

/**
 * Pure geometry: inset an outer px rect by per-side amounts, clamping so a hole can never have a
 * negative size (an over-inset rect collapses to zero width/height at its inset origin — callers
 * that skip too-small holes see 0 exactly like they saw the old negative values).
 * @param {{ left: number, top: number, width: number, height: number }} outer
 * @param {{ top: number, right: number, bottom: number, left: number }} insets - px reserved per side
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
export function holeRectFromOuter(outer, insets) {
	const { top, right, bottom, left } = insets
	return {
		left: outer.left + left,
		top: outer.top + top,
		width: Math.max(0, outer.width - left - right),
		height: Math.max(0, outer.height - top - bottom),
	}
}

/**
 * Adapter for operator-compose-tiles-style chrome ({@link holeRectFromOuter} insets from a
 * `TILE_CHROME`-shaped object): the border ring is reserved on all 4 sides, header/footer are
 * additional top/bottom reservations. Keeps `tileBodyRectFromOuter(outer, chrome)` expressible as
 * `holeRectFromOuter(outer, chromeInsets(chrome))`.
 * @param {{ headerH: number, footerH: number, borderW: number }} chrome
 * @returns {{ top: number, right: number, bottom: number, left: number }}
 */
export function chromeInsets({ headerH, footerH, borderW }) {
	return { top: borderW + headerH, right: borderW, bottom: borderW + footerH, left: borderW }
}

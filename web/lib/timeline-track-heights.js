/**
 * Per-layer row heights on the timeline canvas (px).
 * Persisted on the timeline object as `layerHeights: number[]`.
 */

export const DEFAULT_LAYER_H = 54
export const MIN_LAYER_H = 28
export const MAX_LAYER_H = 120

/**
 * @param {object} tl
 */
export function ensureLayerHeights(tl) {
	if (!tl?.layers) return
	const n = tl.layers.length
	if (!Array.isArray(tl.layerHeights)) tl.layerHeights = []
	while (tl.layerHeights.length < n) tl.layerHeights.push(DEFAULT_LAYER_H)
	if (tl.layerHeights.length > n) tl.layerHeights.length = n
	for (let i = 0; i < n; i++) {
		const h = Number(tl.layerHeights[i])
		if (!Number.isFinite(h) || h < MIN_LAYER_H) tl.layerHeights[i] = DEFAULT_LAYER_H
		else tl.layerHeights[i] = Math.min(MAX_LAYER_H, Math.max(MIN_LAYER_H, Math.round(h)))
	}
}

/**
 * @param {object} tl
 * @param {number} li
 * @param {number} scrollY
 * @param {number} rulerH
 * @returns {number} Canvas Y of top of layer row (before scroll)
 */
export function trackTopForLayer(tl, li, scrollY, rulerH) {
	ensureLayerHeights(tl)
	let y = rulerH
	for (let i = 0; i < li; i++) y += tl.layerHeights[i] ?? DEFAULT_LAYER_H
	return y - scrollY
}

/**
 * @param {object} tl
 * @param {number} li
 */
export function layerHeightAt(tl, li) {
	ensureLayerHeights(tl)
	return tl.layerHeights[li] ?? DEFAULT_LAYER_H
}

/**
 * Sum of all layer row heights.
 * @param {object} tl
 */
export function totalTracksHeight(tl) {
	ensureLayerHeights(tl)
	let s = 0
	for (let i = 0; i < (tl.layers?.length || 0); i++) s += tl.layerHeights[i] ?? DEFAULT_LAYER_H
	return s
}

/**
 * @param {object} tl
 * @param {number} canvasY
 * @param {number} scrollY
 * @param {number} rulerH
 * @returns {number} Layer index
 */
export function layerIndexAtCanvasY(tl, canvasY, scrollY, rulerH) {
	ensureLayerHeights(tl)
	let y = rulerH - scrollY
	const n = tl.layers?.length || 0
	for (let i = 0; i < n; i++) {
		const th = tl.layerHeights[i] ?? DEFAULT_LAYER_H
		if (canvasY >= y && canvasY < y + th) return i
		y += th
	}
	if (n <= 0) return 0
	// Below all tracks (e.g. "+ drop here" zone) → index n for add-layer drop
	if (canvasY >= y) return n
	return n - 1
}

/**
 * Hit-test horizontal divider between layer i and i+1 (full canvas width).
 * @returns {number | null} divider index i (0 .. layers.length-2)
 */
export function hitLayerDivider(cy, tl, scrollY, rulerH, hitPx = 5) {
	if (cy < rulerH) return null
	ensureLayerHeights(tl)
	const n = tl.layers?.length || 0
	if (n < 2) return null
	let y = rulerH - scrollY
	for (let i = 0; i < n - 1; i++) {
		y += tl.layerHeights[i] ?? DEFAULT_LAYER_H
		if (Math.abs(cy - y) <= hitPx) return i
	}
	return null
}

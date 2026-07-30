/**
 * Layer crop geometry — single source of truth for MIXER CROP math (WO-158 T158.1).
 *
 * CasparCG `MIXER <ch>-<layer> CROP left top right bottom` takes **fractions of the
 * layer's own image**: left/top are the start edges and right/bottom the end edges,
 * all measured from the layer's top-left origin (right = 1 means "full width", i.e.
 * uncropped). The crop cuts INTO the layer's fill rect — the layer rect itself is
 * unchanged, the cropped-away area simply becomes transparent. So the visible region
 * of a layer is:
 *
 *   visible = fillRect ∩ (left..right, top..bottom of fillRect itself)
 *
 * and any thumbnail/image drawn with the full fill-rect mapping is windowed
 * identically (clipping the destination to `cropAdjustedRect` is equivalent to
 * cropping the image source rect).
 *
 * Pure math only — no DOM, no imports. Must stay in sync with the CJS mirror
 * `src/engine/layer-crop.js` (take-path PIP border placement), same convention as
 * program-layer-bank.js.
 */

const IDENTITY_EPS = 1e-6

function clamp01(v) {
	const n = Number(v)
	if (!Number.isFinite(n)) return null
	return Math.max(0, Math.min(1, n))
}

/**
 * Clamp crop params to a sane crop: 0 ≤ left ≤ right ≤ 1, 0 ≤ top ≤ bottom ≤ 1.
 * Missing / non-finite values fall back to the identity edges (0,0,1,1).
 * @param {{ left?: number, top?: number, right?: number, bottom?: number } | null | undefined} params
 * @returns {{ left: number, top: number, right: number, bottom: number }}
 */
export function normalizeCrop(params) {
	const left = clamp01(params?.left) ?? 0
	const top = clamp01(params?.top) ?? 0
	let right = clamp01(params?.right) ?? 1
	let bottom = clamp01(params?.bottom) ?? 1
	if (right < left) right = left
	if (bottom < top) bottom = top
	return { left, top, right, bottom }
}

/**
 * @param {{ left: number, top: number, right: number, bottom: number } | null | undefined} crop
 * @returns {boolean} true when the crop shows the full layer (0,0,1,1)
 */
export function isIdentityCrop(crop) {
	if (!crop) return true
	return (
		Math.abs(crop.left) < IDENTITY_EPS &&
		Math.abs(crop.top) < IDENTITY_EPS &&
		Math.abs(crop.right - 1) < IDENTITY_EPS &&
		Math.abs(crop.bottom - 1) < IDENTITY_EPS
	)
}

/**
 * Crop fractions from a scene layer's (or timeline clip's) `effects` array.
 * @param {{ effects?: Array<{ type: string, params?: object }> } | null | undefined} layer
 * @returns {{ left: number, top: number, right: number, bottom: number } | null}
 *   Normalized crop, or null when there is no crop effect / the crop is identity.
 */
export function cropFromLayer(layer) {
	const fx = Array.isArray(layer?.effects) ? layer.effects.find((f) => f?.type === 'crop') : null
	if (!fx) return null
	const crop = normalizeCrop(fx.params)
	return isIdentityCrop(crop) ? null : crop
}

/**
 * Intersect a pixel rect (fill rect on some canvas) with its own crop fractions.
 * Shape matches `fillToPixelRect` (fill-math.js): `{ x, y, w, h }`.
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @param {{ left: number, top: number, right: number, bottom: number } | null | undefined} crop
 * @returns {{ x: number, y: number, w: number, h: number }} visible sub-rect (copy when crop is null/identity)
 */
export function cropAdjustedRect(rect, crop) {
	if (!crop || isIdentityCrop(crop)) {
		return { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
	}
	const c = normalizeCrop(crop)
	return {
		x: rect.x + c.left * rect.w,
		y: rect.y + c.top * rect.h,
		w: (c.right - c.left) * rect.w,
		h: (c.bottom - c.top) * rect.h,
	}
}

/**
 * Same intersection in channel-normalized MIXER FILL space `{ x, y, scaleX, scaleY }`.
 * Identity / null crop returns the fill object **unchanged** (byte-identical AMCP downstream).
 * @param {{ x: number, y: number, scaleX: number, scaleY: number }} fill
 * @param {{ left: number, top: number, right: number, bottom: number } | null | undefined} crop
 */
export function cropAdjustedFill(fill, crop) {
	if (!crop || isIdentityCrop(crop)) return fill
	const c = normalizeCrop(crop)
	const x = fill.x ?? 0
	const y = fill.y ?? 0
	const sx = fill.scaleX ?? 1
	const sy = fill.scaleY ?? 1
	return {
		x: x + c.left * sx,
		y: y + c.top * sy,
		scaleX: (c.right - c.left) * sx,
		scaleY: (c.bottom - c.top) * sy,
	}
}

/**
 * Convenience: crop-adjust a resolved MIXER FILL by the layer's crop effect.
 * Use ONLY for overlay/border placement — the video layer's own MIXER FILL must
 * stay uncropped (Caspar applies CROP separately on the same layer).
 * @param {{ x: number, y: number, scaleX: number, scaleY: number }} fill
 * @param {{ effects?: Array<{ type: string, params?: object }> } | null | undefined} layer
 */
export function cropAdjustedFillForLayer(fill, layer) {
	return cropAdjustedFill(fill, cropFromLayer(layer))
}

/** Smallest visible fraction we will divide by, so a fully-collapsed crop cannot produce Infinity. */
const MIN_VISIBLE_FRACTION = 1e-6

/**
 * Inverse of {@link cropAdjustedRect}: given the **visible (cropped)** pixel rect the operator sees
 * and edits, return the FULL layer rect that produces it. WO-388B — the inspector's X/Y/W/H boxes
 * report and accept visible geometry ("when its cropped the layer width and/or height is cropped
 * too"), but MIXER FILL still needs the uncropped rect.
 *
 * visible.w = (right-left) * layer.w  →  layer.w = visible.w / (right-left)
 * visible.x = layer.x + left*layer.w  →  layer.x = visible.x - left*layer.w
 *
 * Identity / null crop returns a copy of the input, so uncropped layers round-trip unchanged.
 * A degenerate crop (zero visible extent) is floored at {@link MIN_VISIBLE_FRACTION} rather than
 * dividing by zero — the operator gets a very large layer rect, not NaN geometry on air.
 *
 * @param {{ x: number, y: number, w: number, h: number }} visible
 * @param {{ left: number, top: number, right: number, bottom: number } | null | undefined} crop
 * @returns {{ x: number, y: number, w: number, h: number }} the full layer rect
 */
export function layerRectFromVisibleRect(visible, crop) {
	if (!crop || isIdentityCrop(crop)) {
		return { x: visible.x, y: visible.y, w: visible.w, h: visible.h }
	}
	const c = normalizeCrop(crop)
	const fw = Math.max(MIN_VISIBLE_FRACTION, c.right - c.left)
	const fh = Math.max(MIN_VISIBLE_FRACTION, c.bottom - c.top)
	const w = visible.w / fw
	const h = visible.h / fh
	return { x: visible.x - c.left * w, y: visible.y - c.top * h, w, h }
}

/** Convenience: {@link layerRectFromVisibleRect} driven by the layer's own crop effect. */
export function layerRectFromVisibleRectForLayer(visible, layer) {
	return layerRectFromVisibleRect(visible, cropFromLayer(layer))
}

/** Convenience: visible pixel rect for a layer, from its own crop effect. */
export function visibleRectForLayer(rect, layer) {
	return cropAdjustedRect(rect, cropFromLayer(layer))
}

/**
 * Align a layer's fill so its **visible (cropped) rect** lands on the canvas edge/center —
 * WO-388, correcting WO-238's inverted reading of todos15 "adjust to doesn't count the crop
 * values in". The owner's rule: a cropped layer's effective width/height IS the cropped
 * width/height, so "align left" puts the visible left edge at x=0, not the layer's uncropped
 * origin (which would leave the cropped-away strip as a gap).
 *
 * Math: the visible rect in fill space is `cropAdjustedFill` — origin `f.x + left*scaleX`,
 * extent `(right-left)*scaleX`. We align THAT rect, then convert back to the layer origin the
 * MIXER FILL needs by subtracting the same `left*scaleX` offset.
 *
 * Identity / absent crop reduces exactly to the old full-rect math (`left=0, right=1` →
 * offset 0, extent `scaleX`), so uncropped layers are byte-identical.
 *
 * @param {{ x?: number, y?: number, scaleX?: number, scaleY?: number }} fill
 * @param {{ left: number, top: number, right: number, bottom: number } | null | undefined} crop
 * @param {'left'|'right'|'top'|'bottom'|'center-h'|'center-v'|'center'} mode
 * @returns {{ x: number, y: number, scaleX: number, scaleY: number }} fill with x/y aligned
 */
export function alignFillForCrop(fill, crop, mode) {
	const c = crop && !isIdentityCrop(crop) ? normalizeCrop(crop) : { left: 0, top: 0, right: 1, bottom: 1 }
	const sx = fill?.scaleX ?? 0
	const sy = fill?.scaleY ?? 0
	const offX = c.left * sx
	const offY = c.top * sy
	/* Visible extent — the cropped width/height the owner wants alignment to respect. */
	const visW = (c.right - c.left) * sx
	const visH = (c.bottom - c.top) * sy
	/* Current visible-rect origin, so untouched axes keep their exact position. */
	let visX = (fill?.x ?? 0) + offX
	let visY = (fill?.y ?? 0) + offY

	if (mode === 'left') visX = 0
	else if (mode === 'right') visX = 1 - visW
	else if (mode === 'top') visY = 0
	else if (mode === 'bottom') visY = 1 - visH
	else if (mode === 'center-h') visX = (1 - visW) / 2
	else if (mode === 'center-v') visY = (1 - visH) / 2
	else if (mode === 'center') {
		visX = (1 - visW) / 2
		visY = (1 - visH) / 2
	}

	return { x: visX - offX, y: visY - offY, scaleX: sx, scaleY: sy }
}

/**
 * Convenience: crop-aware align driven by the layer's own crop effect.
 * @param {{ x?: number, y?: number, scaleX?: number, scaleY?: number }} fill
 * @param {{ effects?: Array<{ type: string, params?: object }> } | null | undefined} layer
 * @param {'left'|'right'|'top'|'bottom'|'center-h'|'center-v'|'center'} mode
 */
export function alignFillForLayer(fill, layer, mode) {
	return alignFillForCrop(fill, cropFromLayer(layer), mode)
}

/**
 * One crop fraction → pixels of the layer's content resolution dimension.
 * `right`/`bottom` stay measured from the left/top edge (right = width px means uncropped).
 * @param {number} frac 0–1
 * @param {number} dim content width or height in px
 */
export function cropFractionToPx(frac, dim) {
	const d = dim > 0 ? dim : 1920
	return (clamp01(frac) ?? 0) * d
}

/**
 * Pixels (from the left/top edge) → crop fraction, clamped to 0–1.
 * @param {number} px
 * @param {number} dim content width or height in px
 */
export function cropPxToFraction(px, dim) {
	const d = dim > 0 ? dim : 1920
	const n = Number(px)
	return clamp01((Number.isFinite(n) ? n : 0) / d) ?? 0
}

/**
 * All four crop params → pixel positions for a content resolution.
 * @param {{ left?: number, top?: number, right?: number, bottom?: number }} params
 * @param {{ w: number, h: number }} res content resolution (fallback: channel resolution)
 */
export function cropParamsToPixels(params, res) {
	const c = normalizeCrop(params)
	return {
		left: cropFractionToPx(c.left, res?.w),
		top: cropFractionToPx(c.top, res?.h),
		right: cropFractionToPx(c.right, res?.w),
		bottom: cropFractionToPx(c.bottom, res?.h),
	}
}

/**
 * Pixel positions → 0–1 crop params (inverse of cropParamsToPixels).
 * @param {{ left: number, top: number, right: number, bottom: number }} px
 * @param {{ w: number, h: number }} res
 */
export function cropPixelsToParams(px, res) {
	return normalizeCrop({
		left: cropPxToFraction(px?.left, res?.w),
		top: cropPxToFraction(px?.top, res?.h),
		right: cropPxToFraction(px?.right, res?.w),
		bottom: cropPxToFraction(px?.bottom, res?.h),
	})
}

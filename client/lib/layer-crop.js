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

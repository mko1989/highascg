/**
 * Layer crop geometry — CJS mirror of client/lib/layer-crop.js (WO-158 T158.1/T158.5).
 * Must match the client module — same convention as program-layer-bank.js.
 *
 * CasparCG `MIXER CROP left top right bottom` fractions are of the LAYER's own image
 * (right/bottom measured from the top-left origin; 1 = full width/height). The crop
 * cuts INTO the layer's fill rect — the layer rect is unchanged, cropped areas become
 * transparent. Visible region = fillRect ∩ (left..right, top..bottom of itself).
 *
 * Used by the take-path PIP overlay pipelines so borders hug the visible (cropped)
 * content. The video layer's own MIXER FILL must stay UNcropped — Caspar applies
 * CROP separately on the same layer.
 */

'use strict'

const IDENTITY_EPS = 1e-6

function clamp01OrNull(v) {
	const n = Number(v)
	if (!Number.isFinite(n)) return null
	return Math.max(0, Math.min(1, n))
}

/** @see client/lib/layer-crop.js normalizeCrop */
function normalizeCrop(params) {
	const left = clamp01OrNull(params?.left) ?? 0
	const top = clamp01OrNull(params?.top) ?? 0
	let right = clamp01OrNull(params?.right) ?? 1
	let bottom = clamp01OrNull(params?.bottom) ?? 1
	if (right < left) right = left
	if (bottom < top) bottom = top
	return { left, top, right, bottom }
}

/** @see client/lib/layer-crop.js isIdentityCrop */
function isIdentityCrop(crop) {
	if (!crop) return true
	return (
		Math.abs(crop.left) < IDENTITY_EPS &&
		Math.abs(crop.top) < IDENTITY_EPS &&
		Math.abs(crop.right - 1) < IDENTITY_EPS &&
		Math.abs(crop.bottom - 1) < IDENTITY_EPS
	)
}

/** @see client/lib/layer-crop.js cropFromLayer — null when no crop effect or identity */
function cropFromLayer(layer) {
	const fx = Array.isArray(layer?.effects) ? layer.effects.find((f) => f?.type === 'crop') : null
	if (!fx) return null
	const crop = normalizeCrop(fx.params)
	return isIdentityCrop(crop) ? null : crop
}

/** @see client/lib/layer-crop.js cropAdjustedRect — pixel rect { x, y, w, h } */
function cropAdjustedRect(rect, crop) {
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
 * @see client/lib/layer-crop.js cropAdjustedFill — normalized { x, y, scaleX, scaleY }.
 * Identity / null crop returns the fill object unchanged (byte-identical AMCP downstream).
 */
function cropAdjustedFill(fill, crop) {
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

/** Crop-adjust a resolved MIXER FILL by the layer's crop effect (overlay placement only). */
function cropAdjustedFillForLayer(fill, layer) {
	return cropAdjustedFill(fill, cropFromLayer(layer))
}

/** @see client/lib/layer-crop.js MIN_VISIBLE_FRACTION */
const MIN_VISIBLE_FRACTION = 1e-6

/** @see client/lib/layer-crop.js layerRectFromVisibleRect — inverse of cropAdjustedRect (WO-388B) */
function layerRectFromVisibleRect(visible, crop) {
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

/** @see client/lib/layer-crop.js layerRectFromVisibleRectForLayer */
function layerRectFromVisibleRectForLayer(visible, layer) {
	return layerRectFromVisibleRect(visible, cropFromLayer(layer))
}

/** @see client/lib/layer-crop.js visibleRectForLayer */
function visibleRectForLayer(rect, layer) {
	return cropAdjustedRect(rect, cropFromLayer(layer))
}

/** @see client/lib/layer-crop.js alignFillForCrop — align the VISIBLE (cropped) rect (WO-388) */
function alignFillForCrop(fill, crop, mode) {
	const c = crop && !isIdentityCrop(crop) ? normalizeCrop(crop) : { left: 0, top: 0, right: 1, bottom: 1 }
	const sx = fill?.scaleX ?? 0
	const sy = fill?.scaleY ?? 0
	const offX = c.left * sx
	const offY = c.top * sy
	const visW = (c.right - c.left) * sx
	const visH = (c.bottom - c.top) * sy
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

/** @see client/lib/layer-crop.js alignFillForLayer */
function alignFillForLayer(fill, layer, mode) {
	return alignFillForCrop(fill, cropFromLayer(layer), mode)
}

module.exports = {
	normalizeCrop,
	isIdentityCrop,
	cropFromLayer,
	cropAdjustedRect,
	cropAdjustedFill,
	cropAdjustedFillForLayer,
	alignFillForCrop,
	alignFillForLayer,
	layerRectFromVisibleRect,
	layerRectFromVisibleRectForLayer,
	visibleRectForLayer,
}

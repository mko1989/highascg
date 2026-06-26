/**
 * Normalized canvas coordinates (0–1) for scene layer FILL — see docs/scene-system-plan.md
 */

/**
 * @param {{ width: number, height: number }} canvas
 */
export function nativeFill(contentW, contentH, canvas) {
	const w = canvas?.width > 0 ? canvas.width : 1920
	const h = canvas?.height > 0 ? canvas.height : 1080
	if (!(contentW > 0 && contentH > 0)) {
		return { x: 0, y: 0, scaleX: 1, scaleY: 1 }
	}
	/** Uniform scale (contain / letterbox) — same aspect as content, centered on channel. */
	const s = Math.min(w / contentW, h / contentH)
	const scaleX = (contentW * s) / w
	const scaleY = (contentH * s) / h
	const x = (1 - scaleX) / 2
	const y = (1 - scaleY) / 2
	return { x, y, scaleX, scaleY }
}

export function fullFill() {
	return { x: 0, y: 0, scaleX: 1, scaleY: 1 }
}

/**
 * @param {{ width: number, height: number }} canvas
 */
export function pixelRegionFill(px, py, pw, ph, canvas) {
	const w = canvas?.width > 0 ? canvas.width : 1920
	const h = canvas?.height > 0 ? canvas.height : 1080
	return {
		x: px / w,
		y: py / h,
		scaleX: pw / w,
		scaleY: ph / h,
	}
}

/**
 * @param {{ x: number, y: number, scaleX: number, scaleY: number }} fill
 * @param {{ width: number, height: number }} canvas
 */
export function fillToPixelRect(fill, canvas) {
	const w = canvas?.width > 0 ? canvas.width : 1920
	const h = canvas?.height > 0 ? canvas.height : 1080
	return {
		x: fill.x * w,
		y: fill.y * h,
		w: fill.scaleX * w,
		h: fill.scaleY * h,
	}
}

/**
 * @param {{ x: number, y: number, w: number, h: number }} rect - pixel rect on canvas
 * @param {{ width: number, height: number }} canvas
 */
export function pixelRectToFill(rect, canvas) {
	const w = canvas?.width > 0 ? canvas.width : 1920
	const h = canvas?.height > 0 ? canvas.height : 1080
	return {
		x: rect.x / w,
		y: rect.y / h,
		scaleX: rect.w / w,
		scaleY: rect.h / h,
	}
}

/**
 * Layer box in canvas pixels for scene content-fit modes (drop + inspector).
 * @param {number} cw
 * @param {number} ch
 * @param {number} mediaW
 * @param {number} mediaH
 * @param {'native' | 'fill-canvas' | 'horizontal' | 'vertical' | 'stretch'} contentFit
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function sceneLayerPixelRectForContentFit(cw, ch, mediaW, mediaH, contentFit) {
	const cw0 = Math.max(1, cw)
	const ch0 = Math.max(1, ch)
	if (!(mediaW > 0 && mediaH > 0)) {
		return { x: 0, y: 0, w: cw0, h: ch0 }
	}
	const ar = mediaW / mediaH

	/** One source pixel maps to one program pixel; layer box is media size, centered. */
	if (contentFit === 'native') {
		const w = Math.max(1, Math.round(mediaW))
		const h = Math.max(1, Math.round(mediaH))
		const x = Math.round((cw0 - w) / 2)
		const y = Math.round((ch0 - h) / 2)
		return { x, y, w, h }
	}

	if (contentFit === 'stretch') {
		return { x: 0, y: 0, w: cw0, h: ch0 }
	}
	if (contentFit === 'horizontal') {
		const w = cw0
		const h = Math.max(1, Math.round(w / ar))
		const y = Math.round((ch0 - h) / 2)
		return { x: 0, y: y, w, h }
	}
	if (contentFit === 'vertical') {
		const h = ch0
		const w = Math.max(1, Math.round(h * ar))
		const x = Math.round((cw0 - w) / 2)
		return { x, y: 0, w, h }
	}
	/** fill-canvas — uniform scale to fit inside canvas (letterbox / pillarbox), centered */
	const s = Math.min(cw0 / mediaW, ch0 / mediaH)
	const w = Math.max(1, Math.round(mediaW * s))
	const h = Math.max(1, Math.round(mediaH * s))
	const x = Math.round((cw0 - w) / 2)
	const y = Math.round((ch0 - h) / 2)
	return { x, y, w, h }
}

/**
 * @param {number} val - pixel value
 * @param {number} total - canvas dimension
 */
export function pixelsToNormalized(val, total) {
	const t = total > 0 ? total : 1920
	return val / t
}

/**
 * @param {number} val - 0-1 normalized value
 * @param {number} total - canvas dimension
 */
export function normalizedToPixels(val, total) {
	const t = total > 0 ? total : 1920
	return val * t
}

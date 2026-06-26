/**
 * Layer position UI: top-left (stored Caspar fill) vs center offset from canvas center.
 * Stored project / playout data always remains top-left normalized fill or pixel rect.
 */
import { settingsState } from './settings-state.js'

export function isCenterOrigin() {
	const o = settingsState.getSettings()?.editorDefaults?.coordinateOrigin
	return o === 'center'
}

/**
 * @param {{ width?: number, height?: number, w?: number, h?: number }} canvas
 */
function canvasDims(canvas) {
	return {
		w: canvas?.w > 0 ? canvas.w : canvas?.width > 0 ? canvas.width : 1920,
		h: canvas?.h > 0 ? canvas.h : canvas?.height > 0 ? canvas.height : 1080,
	}
}

/**
 * @param {{ x: number, y: number, w: number, h: number }} pxRect — top-left box on canvas (px)
 * @param {{ width?: number, height?: number, w?: number, h?: number }} canvas
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function displayPositionFromStoredPx(pxRect, canvas) {
	const { w: cw, h: ch } = canvasDims(canvas)
	if (!isCenterOrigin()) return { x: pxRect.x, y: pxRect.y, w: pxRect.w, h: pxRect.h }
	return {
		x: pxRect.x + pxRect.w / 2 - cw / 2,
		y: pxRect.y + pxRect.h / 2 - ch / 2,
		w: pxRect.w,
		h: pxRect.h,
	}
}

/**
 * @param {{ x: number, y: number, w: number, h: number }} display — center-offset x/y when center mode
 * @param {{ width?: number, height?: number, w?: number, h?: number }} canvas
 * @returns {{ x: number, y: number, w: number, h: number }} top-left stored rect
 */
export function storedPxFromDisplayPosition(display, canvas) {
	const { w: cw, h: ch } = canvasDims(canvas)
	if (!isCenterOrigin()) {
		return { x: display.x, y: display.y, w: display.w, h: display.h }
	}
	return {
		x: display.x + cw / 2 - display.w / 2,
		y: display.y + ch / 2 - display.h / 2,
		w: display.w,
		h: display.h,
	}
}

/**
 * Apply inspector drag-input patch (x/y may be display coords in center mode).
 * @param {{ x: number, y: number, w: number, h: number }} storedRect
 * @param {{ x?: number, y?: number, w?: number, h?: number }} partial
 * @param {{ width?: number, height?: number, w?: number, h?: number }} canvas
 */
export function applyFillPxPatch(storedRect, partial, canvas) {
	let next = { ...storedRect }
	if (partial.w != null) next.w = partial.w
	if (partial.h != null) next.h = partial.h
	if (partial.x != null || partial.y != null) {
		const disp = displayPositionFromStoredPx(next, canvas)
		if (partial.x != null) disp.x = partial.x
		if (partial.y != null) disp.y = partial.y
		const merged = storedPxFromDisplayPosition(disp, canvas)
		next.x = merged.x
		next.y = merged.y
	}
	return next
}

/** Labels for position fields in inspector. */
export function fillInspectorPositionMeta() {
	if (isCenterOrigin()) {
		return {
			title: 'Position / size (canvas px)',
			subtitle: 'X/Y: layer center offset from screen center (0,0 = centered)',
			xLabel: 'X (center)',
			yLabel: 'Y (center)',
		}
	}
	return {
		title: 'Position / size (canvas px)',
		subtitle: '',
		xLabel: 'X',
		yLabel: 'Y',
	}
}

/**
 * Compose drag: delta in normalized canvas fractions.
 * @param {{ x: number, y: number, scaleX: number, scaleY: number }} startFill
 * @param {number} dx
 * @param {number} dy
 */
export function applyDragDeltaToFill(startFill, dx, dy) {
	const sx = startFill.scaleX ?? 0
	const sy = startFill.scaleY ?? 0
	if (!isCenterOrigin()) {
		return {
			...startFill,
			x: Math.max(-5, Math.min(5, startFill.x + dx)),
			y: Math.max(-5, Math.min(5, startFill.y + dy)),
		}
	}
	const cx = (startFill.x ?? 0) + sx / 2
	const cy = (startFill.y ?? 0) + sy / 2
	const ncx = cx + dx
	const ncy = cy + dy
	return {
		...startFill,
		x: Math.max(-5, Math.min(5, ncx - sx / 2)),
		y: Math.max(-5, Math.min(5, ncy - sy / 2)),
	}
}

/**
 * Timeline keyframes: normalized top-left → display px (center offset when enabled).
 */
export function displayPxFromStoredNorm(fill_x, fill_y, rectW, rectH, W, H) {
	const px = { x: fill_x * W, y: fill_y * H, w: rectW, h: rectH }
	const d = displayPositionFromStoredPx(px, { w: W, h: H })
	return { x: d.x, y: d.y }
}

/**
 * Display px (center offset when enabled) → normalized top-left for keyframe storage.
 */
export function storedNormFromDisplayPx(displayX, displayY, rectW, rectH, W, H) {
	const stored = storedPxFromDisplayPosition(
		{ x: displayX, y: displayY, w: rectW, h: rectH },
		{ w: W, h: H },
	)
	return { fill_x: stored.x / W, fill_y: stored.y / H }
}

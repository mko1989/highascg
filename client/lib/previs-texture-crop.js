/**
 * Map a virtual-canvas pixel rect onto a Three.js texture via `offset` + `repeat`.
 *
 * Assumes mesh UVs stay 0..1 and the PGM video is treated as covering the logical
 * virtual canvas (same basis as `previs-uv-mapper.computeScreenUV`).
 *
 * @param {{ width: number, height: number }} virtualCanvas
 * @param {{ canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number }} region
 * @returns {{ canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number }}
 */
export function clampCanvasRegion(region, virtualCanvas) {
	const vcW = virtualCanvas.width
	const vcH = virtualCanvas.height
	if (!region || vcW <= 0 || vcH <= 0) {
		return { canvasX: 0, canvasY: 0, canvasWidth: Math.max(1, vcW), canvasHeight: Math.max(1, vcH) }
	}
	let x = Math.max(0, Math.min(region.canvasX, vcW - 1))
	let y = Math.max(0, Math.min(region.canvasY, vcH - 1))
	let w = Math.max(1, Math.min(region.canvasWidth, vcW - x))
	let h = Math.max(1, Math.min(region.canvasHeight, vcH - y))
	return { canvasX: x, canvasY: y, canvasWidth: w, canvasHeight: h }
}

/**
 * @param {{ canvasRegion?: { canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number } } | null | undefined} tag
 * @param {{ width: number, height: number }} virtualCanvas
 * @returns {{ canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number }}
 */
export function resolveCanvasRegionFromTag(tag, virtualCanvas) {
	const vcW = virtualCanvas.width
	const vcH = virtualCanvas.height
	if (!vcW || !vcH) return { canvasX: 0, canvasY: 0, canvasWidth: 1, canvasHeight: 1 }
	const r = tag && tag.canvasRegion
	if (r && r.canvasWidth > 0 && r.canvasHeight > 0) {
		return clampCanvasRegion(
			{
				canvasX: r.canvasX,
				canvasY: r.canvasY,
				canvasWidth: r.canvasWidth,
				canvasHeight: r.canvasHeight,
			},
			virtualCanvas,
		)
	}
	return { canvasX: 0, canvasY: 0, canvasWidth: vcW, canvasHeight: vcH }
}

/**
 * @param {any} texture  THREE.Texture with `.offset` / `.repeat` (Vector2-like)
 * @param {{ width: number, height: number }} virtualCanvas
 * @param {{ canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number } | null | undefined} region
 */
export function applyVirtualCanvasRegionToTexture(texture, virtualCanvas, region) {
	if (!texture || !virtualCanvas || virtualCanvas.width <= 0 || virtualCanvas.height <= 0) return
	const vcW = virtualCanvas.width
	const vcH = virtualCanvas.height
	const eff = region ? clampCanvasRegion(region, virtualCanvas) : { canvasX: 0, canvasY: 0, canvasWidth: vcW, canvasHeight: vcH }
	const full =
		eff.canvasX <= 0 &&
		eff.canvasY <= 0 &&
		Math.abs(eff.canvasWidth - vcW) < 0.5 &&
		Math.abs(eff.canvasHeight - vcH) < 0.5
	if (full) {
		texture.repeat.set(1, 1)
		texture.offset.set(0, 0)
		texture.needsUpdate = true
		return
	}
	const rx = eff.canvasWidth / vcW
	const ry = eff.canvasHeight / vcH
	const ox = eff.canvasX / vcW
	const oy = eff.canvasY / vcH
	texture.repeat.set(rx, ry)
	// Virtual canvas: Y down. Three.js `flipY` (default true on VideoTexture) flips how
	// image rows map to GL v; CanvasTexture from `drawImage` often uses `flipY=false`.
	const flipY = texture.flipY !== false
	if (flipY) {
		texture.offset.set(ox, 1 - oy - ry)
	} else {
		texture.offset.set(ox, oy)
	}
	texture.needsUpdate = true
}

/**
 * Interpolate timeline clip keyframed properties at local time (ms inside clip).
 * Mirrors server `timeline-playback.js` `_interpProp` / `_lerp`.
 */

import { sceneLayerPixelRectForContentFit } from './fill-math.js'
import { getContentResolution } from './mixer-fill.js'

/**
 * @param {object} clip
 * @param {number} localMs
 * @param {string} prop
 * @param {number} defVal
 * @returns {number}
 */
export function interpClipProp(clip, localMs, prop, defVal) {
	const kfs = (clip.keyframes || []).filter((k) => k.property === prop).sort((a, b) => a.time - b.time)
	if (!kfs.length) return defVal
	if (localMs <= kfs[0].time) return kfs[0].value
	const last = kfs[kfs.length - 1]
	if (localMs >= last.time) return last.value
	for (let i = 0; i < kfs.length - 1; i++) {
		const a = kfs[i]
		const b = kfs[i + 1]
		if (localMs >= a.time && localMs <= b.time) {
			return a.value + ((b.value - a.value) * (localMs - a.time)) / (b.time - a.time)
		}
	}
	return defVal
}

/**
 * Base layer rect in output pixels — explicit fillPx, else from content fit + source resolution (look editor rules).
 * @param {object} clip
 * @param {number} W
 * @param {number} H
 * @param {import('./state-store.js').StateStore} [stateStore]
 * @param {number} [screenIdx]
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function getClipBasePixelRect(clip, W, H, stateStore, screenIdx) {
	const w = W > 0 ? W : 1920
	const h = H > 0 ? H : 1080
	const fp = clip.fillPx
	if (fp && fp.w > 0 && fp.h > 0) {
		return { x: fp.x, y: fp.y, w: fp.w, h: fp.h }
	}
	if (stateStore) {
		const idx = screenIdx ?? 0
		const cr = clip.source ? getContentResolution(clip.source, stateStore, idx) : null
		const cf = clip.contentFit || 'horizontal'
		if (cr && cr.w > 0 && cr.h > 0) {
			return sceneLayerPixelRectForContentFit(w, h, cr.w, cr.h, cf)
		}
	}
	return { x: 0, y: 0, w, h }
}

/**
 * Layer rectangle in program pixels — base from clip.fillPx or content-fit sizing, optional fill keyframes on top.
 * @param {object} clip
 * @param {number} localMs
 * @param {number} W
 * @param {number} H
 * @param {import('./state-store.js').StateStore} [stateStore]
 * @param {number} [screenIdx]
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function clipPixelRectAtLocalTime(clip, localMs, W, H, stateStore, screenIdx) {
	const w = W > 0 ? W : 1920
	const h = H > 0 ? H : 1080
	const base = getClipBasePixelRect(clip, w, h, stateStore, screenIdx)
	const fx = interpClipProp(clip, localMs, 'fill_x', base.x / w)
	const fy = interpClipProp(clip, localMs, 'fill_y', base.y / h)
	const sx = interpClipProp(clip, localMs, 'scale_x', base.w / w)
	const sy = interpClipProp(clip, localMs, 'scale_y', base.h / h)
	return { x: fx * w, y: fy * h, w: sx * w, h: sy * h }
}

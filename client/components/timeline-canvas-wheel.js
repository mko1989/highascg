/**
 * Timeline canvas wheel pan/zoom and drag-drop.
 */

import { getWheelDelta } from '../lib/wheel-delta.js'

export const MIN_PX_MS = 0.0001
export const MAX_PX_MS = 5.0
export const ZOOM_FACTOR = 1.18
export const WHEEL_ZOOM_STEP = 1.1
export const WHEEL_ZOOM_ACCUM_THRESHOLD = 50

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} api — mutable view state + callbacks from initTimelineCanvas
 */
export function attachTimelineWheelAndDrop(canvas, api) {
	const {
		HEADER_W,
		getTimeline,
		msAt,
		maxScrollY,
		schedDraw,
		onDropSource,
		layerAt,
	} = api

	canvas.addEventListener('wheel', (e) => {
		e.preventDefault()
		const rect = canvas.getBoundingClientRect()
		const cx = e.clientX - rect.left
		const tl = getTimeline()
		const { dx, dy } = getWheelDelta(e)

		if (e.altKey && Math.abs(dy) >= Math.abs(dx)) {
			api.wheelZoomAccum = 0
			api.wheelZoomLastSign = 0
			const maxY = maxScrollY(tl)
			api.scrollY = Math.max(0, Math.min(maxY, api.scrollY + dy * 0.5))
			schedDraw()
			return
		}

		if (e.shiftKey && !e.altKey && Math.abs(dy) >= Math.abs(dx)) {
			api.wheelZoomAccum = 0
			api.wheelZoomLastSign = 0
			api.scrollX = Math.max(0, api.scrollX + (dy / api.pxPerMs) * 0.5)
			schedDraw()
			return
		}

		if (Math.abs(dx) > Math.abs(dy)) {
			api.wheelZoomAccum = 0
			api.wheelZoomLastSign = 0
			api.scrollX = Math.max(0, api.scrollX + (dx / api.pxPerMs) * 0.5)
			schedDraw()
			return
		}

		const dyNorm = e.deltaMode === 1 ? dy * 16 : e.deltaMode === 2 ? dy * 400 : dy
		const sign = Math.sign(dyNorm)
		if (sign !== 0 && sign !== api.wheelZoomLastSign) api.wheelZoomAccum = 0
		api.wheelZoomLastSign = sign || api.wheelZoomLastSign
		api.wheelZoomAccum += dyNorm
		if (Math.abs(api.wheelZoomAccum) < WHEEL_ZOOM_ACCUM_THRESHOLD) {
			schedDraw()
			return
		}
		api.wheelZoomAccum = 0
		const msUnder = msAt(cx)
		const factor = dyNorm > 0 ? 1 / WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP
		api.pxPerMs = Math.max(MIN_PX_MS, Math.min(MAX_PX_MS, api.pxPerMs * factor))
		api.scrollX = Math.max(0, msUnder - (cx - HEADER_W) / api.pxPerMs)
		schedDraw()
	}, { passive: false })

	canvas.addEventListener('dragover', (e) => {
		e.preventDefault()
		e.dataTransfer.dropEffect = 'copy'
	})

	canvas.addEventListener('drop', (e) => {
		e.preventDefault()
		const rect = canvas.getBoundingClientRect()
		const cx = e.clientX - rect.left
		const cy = e.clientY - rect.top
		let source = null
		try {
			source = JSON.parse(e.dataTransfer.getData('application/json'))
		} catch {
			return
		}
		if (!source?.value) return
		const ms = Math.max(0, msAt(cx))
		const tl = getTimeline()
		const li = tl ? Math.max(0, Math.min(layerAt(cy, tl), tl.layers.length)) : 0
		onDropSource(source, li, ms)
		schedDraw()
	})
}

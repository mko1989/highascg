'use strict'

import { fillToPixelRect } from '../lib/fill-math.js'

/**
 * @param {object} sceneState
 * @param {() => void} schedulePreviewPush
 */
export function createComposeDragHandlers(sceneState, schedulePreviewPush) {
	function startDrag(e, layerIndex, scene, aspectEl, el) {
		const rect = aspectEl.getBoundingClientRect()
		const layer = scene.layers[layerIndex]
		const startFill = { ...(layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }) }
		const sx = e.clientX
		const sy = e.clientY
		sceneState.isInteracting = true

		function onMove(ev) {
			const currentRect = !aspectEl.isConnected ? document.querySelector('.scenes-compose')?.getBoundingClientRect() || rect : aspectEl.getBoundingClientRect()
			const rw = Math.max(10, currentRect.width)
			const rh = Math.max(10, currentRect.height)
			const dx = (ev.clientX - sx) / rw
			const dy = (ev.clientY - sy) / rh
			const nx = Math.max(-5, Math.min(5, startFill.x + dx))
			const ny = Math.max(-5, Math.min(5, startFill.y + dy))
			
			// Direct DOM update for instant feedback
			el.style.left = `${nx * 100}%`
			el.style.top = `${ny * 100}%`
			
			sceneState.patchLayer(scene.id, layerIndex, {
				fill: { ...startFill, x: nx, y: ny },
			})
			schedulePreviewPush()
		}
		function onUp() {
			document.removeEventListener('pointermove', onMove)
			document.removeEventListener('pointerup', onUp)
			setTimeout(() => {
				sceneState.isInteracting = false
				if (typeof sceneState._emit === 'function') sceneState._emit('change')
			}, 10)
		}
		document.addEventListener('pointermove', onMove)
		document.addEventListener('pointerup', onUp)
	}

	function startRotate(e, layerIndex, scene, aspectEl, el) {
		const rect = aspectEl.getBoundingClientRect()
		const layer = scene.layers[layerIndex]
		const fill = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
		const rw = Math.max(1, rect.width)
		const rh = Math.max(1, rect.height)
		const pr = fillToPixelRect(fill, { width: rw, height: rh })
		const cx = rect.left + pr.x + pr.w / 2
		const cy = rect.top + pr.y + pr.h / 2
		const startAngle = layer.rotation || 0
		const a0 = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI)
		sceneState.isInteracting = true

		function onMove(ev) {
			const a1 = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI)
			let d = a1 - a0
			while (d > 180) d -= 360
			while (d < -180) d += 360
			const finalAngle = startAngle + d
			
			// Direct DOM update
			el.style.transform = `rotate(${finalAngle}deg)`
			
			sceneState.patchLayer(scene.id, layerIndex, { rotation: finalAngle })
			schedulePreviewPush()
		}
		function onUp() {
			document.removeEventListener('pointermove', onMove)
			document.removeEventListener('pointerup', onUp)
			setTimeout(() => {
				sceneState.isInteracting = false
				sceneState.emit('change')
			}, 10)
		}
		document.addEventListener('pointermove', onMove)
		document.addEventListener('pointerup', onUp)
	}

	function startScale(e, layerIndex, scene, aspectEl, el) {
		const rect = aspectEl.getBoundingClientRect()
		const layer = scene.layers[layerIndex]
		const startFill = { ...(layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }) }
		const rw = Math.max(1, rect.width)
		const rh = Math.max(1, rect.height)
		const cx = (startFill.x + startFill.scaleX / 2) * rw + rect.left
		const cy = (startFill.y + startFill.scaleY / 2) * rh + rect.top
		const r0 = Math.hypot(e.clientX - cx, e.clientY - cy)
		sceneState.isInteracting = true

		function onMove(ev) {
			const r1 = Math.hypot(ev.clientX - cx, ev.clientY - cy)
			const k = r0 > 1e-6 ? r1 / r0 : 1
			const nsx = Math.max(0.02, Math.min(4, startFill.scaleX * k))
			const nsy = Math.max(0.02, Math.min(4, startFill.scaleY * k))
			const dx = (startFill.scaleX - nsx) / 2
			const dy = (startFill.scaleY - nsy) / 2
			const nx = startFill.x + dx
			const ny = startFill.y + dy

			// Direct DOM update
			el.style.left = `${nx * 100}%`
			el.style.top = `${ny * 100}%`
			el.style.width = `${nsx * 100}%`
			el.style.height = `${nsy * 100}%`

			sceneState.patchLayer(scene.id, layerIndex, {
				fill: {
					...startFill,
					scaleX: nsx,
					scaleY: nsy,
					x: nx,
					y: ny,
				},
			})
			schedulePreviewPush()
		}
		function onUp() {
			document.removeEventListener('pointermove', onMove)
			document.removeEventListener('pointerup', onUp)
			setTimeout(() => {
				sceneState.isInteracting = false
				sceneState.emit('change')
			}, 10)
		}
		document.addEventListener('pointermove', onMove)
		document.addEventListener('pointerup', onUp)
	}

	/**
	 * @param {'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'} edge
	 */
	function startEdgeResize(edge, e, layerIndex, scene, aspectEl, el) {
		const rect = aspectEl.getBoundingClientRect()
		const layer = scene.layers[layerIndex]
		const startFill = { ...(layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }) }
		const sx0 = e.clientX
		const sy0 = e.clientY
		const minS = 0.02
		sceneState.isInteracting = true

		function onMove(ev) {
			const rw = Math.max(1, rect.width)
			const rh = Math.max(1, rect.height)
			const dx = (ev.clientX - sx0) / rw
			const dy = (ev.clientY - sy0) / rh
			let x = startFill.x
			let y = startFill.y
			let sx = startFill.scaleX
			let sy = startFill.scaleY

			if (edge.includes('e')) sx = startFill.scaleX + dx
			if (edge.includes('w')) {
				x = startFill.x + dx
				sx = startFill.scaleX - dx
			}
			if (edge.includes('s')) sy = startFill.scaleY + dy
			if (edge.includes('n')) {
				y = startFill.y + dy
				sy = startFill.scaleY - dy
			}

			sx = Math.max(minS, sx)
			sy = Math.max(minS, sy)

			// Direct DOM update
			el.style.left = `${x * 100}%`
			el.style.top = `${y * 100}%`
			el.style.width = `${sx * 100}%`
			el.style.height = `${sy * 100}%`

			sceneState.patchLayer(scene.id, layerIndex, {
				fill: { ...startFill, x, y, scaleX: sx, scaleY: sy },
			})
			schedulePreviewPush()
		}
		function onUp() {
			document.removeEventListener('pointermove', onMove)
			document.removeEventListener('pointerup', onUp)
			setTimeout(() => {
				sceneState.isInteracting = false
				sceneState.emit('change')
			}, 10)
		}
		document.addEventListener('pointermove', onMove)
		document.addEventListener('pointerup', onUp)
	}

	return { startDrag, startRotate, startScale, startEdgeResize }
}

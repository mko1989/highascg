'use strict'

import { fillToPixelRect } from '../lib/fill-math.js'
import { applyDragDeltaToFill } from '../lib/coordinate-origin.js'

function snapValue(val, candidates, threshold) {
	let bestDiff = threshold
	let bestCandidate = val
	for (const c of candidates) {
		const diff = Math.abs(val - c)
		if (diff < bestDiff) {
			bestDiff = diff
			bestCandidate = c
		}
	}
	return bestCandidate
}

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
			const nextFill = applyDragDeltaToFill(startFill, dx, dy)

			const xCandidates = [0, 1]
			const yCandidates = [0, 1]
			const layers = sceneState.getScene(scene.id)?.layers || scene.layers || []
			for (let i = 0; i < layers.length; i++) {
				if (i === layerIndex) continue
				const l = layers[i]
				if (l && l.fill) {
					xCandidates.push(l.fill.x, l.fill.x + l.fill.scaleX)
					yCandidates.push(l.fill.y, l.fill.y + l.fill.scaleY)
				}
			}

			const snapThresholdX = 10 / rw
			const snapThresholdY = 10 / rh

			let nx = nextFill.x
			let ny = nextFill.y
			const sxVal = nextFill.scaleX
			const syVal = nextFill.scaleY

			const snapNx1 = snapValue(nx, xCandidates, snapThresholdX)
			const snapNx2 = snapValue(nx + sxVal, xCandidates, snapThresholdX) - sxVal
			if (Math.abs(snapNx1 - nx) <= Math.abs(snapNx2 - nx)) {
				if (Math.abs(snapNx1 - nx) < snapThresholdX) nx = snapNx1
			} else {
				if (Math.abs(snapNx2 - nx) < snapThresholdX) nx = snapNx2
			}

			const snapNy1 = snapValue(ny, yCandidates, snapThresholdY)
			const snapNy2 = snapValue(ny + syVal, yCandidates, snapThresholdY) - syVal
			if (Math.abs(snapNy1 - ny) <= Math.abs(snapNy2 - ny)) {
				if (Math.abs(snapNy1 - ny) < snapThresholdY) ny = snapNy1
			} else {
				if (Math.abs(snapNy2 - ny) < snapThresholdY) ny = snapNy2
			}

			const snappedFill = { ...nextFill, x: nx, y: ny }

			// Direct DOM update for instant feedback
			el.style.left = `${snappedFill.x * 100}%`
			el.style.top = `${snappedFill.y * 100}%`

			sceneState.patchLayer(scene.id, layerIndex, {
				fill: snappedFill,
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
			const currentRect = !aspectEl.isConnected ? document.querySelector('.scenes-compose')?.getBoundingClientRect() || rect : aspectEl.getBoundingClientRect()
			const rw = Math.max(10, currentRect.width)
			const rh = Math.max(10, currentRect.height)
			const dx = (ev.clientX - sx0) / rw
			const dy = (ev.clientY - sy0) / rh

			const xCandidates = [0, 1]
			const yCandidates = [0, 1]
			const layers = sceneState.getScene(scene.id)?.layers || scene.layers || []
			for (let i = 0; i < layers.length; i++) {
				if (i === layerIndex) continue
				const l = layers[i]
				if (l && l.fill) {
					xCandidates.push(l.fill.x, l.fill.x + l.fill.scaleX)
					yCandidates.push(l.fill.y, l.fill.y + l.fill.scaleY)
				}
			}

			const snapThresholdX = 10 / rw
			const snapThresholdY = 10 / rh

			let x = startFill.x
			let y = startFill.y
			let sx = startFill.scaleX
			let sy = startFill.scaleY

			if (edge.includes('e')) {
				const rawRight = startFill.x + startFill.scaleX + dx
				const snappedRight = snapValue(rawRight, xCandidates, snapThresholdX)
				sx = snappedRight - x
			}
			if (edge.includes('w')) {
				const rawLeft = startFill.x + dx
				const snappedLeft = snapValue(rawLeft, xCandidates, snapThresholdX)
				x = snappedLeft
				sx = (startFill.x + startFill.scaleX) - snappedLeft
			}
			if (edge.includes('s')) {
				const rawBottom = startFill.y + startFill.scaleY + dy
				const snappedBottom = snapValue(rawBottom, yCandidates, snapThresholdY)
				sy = snappedBottom - y
			}
			if (edge.includes('n')) {
				const rawTop = startFill.y + dy
				const snappedTop = snapValue(rawTop, yCandidates, snapThresholdY)
				y = snappedTop
				sy = (startFill.y + startFill.scaleY) - snappedTop
			}

			if (sx < minS) {
				if (edge.includes('w')) {
					x = startFill.x + startFill.scaleX - minS
				}
				sx = minS
			}
			if (sy < minS) {
				if (edge.includes('n')) {
					y = startFill.y + startFill.scaleY - minS
				}
				sy = minS
			}

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

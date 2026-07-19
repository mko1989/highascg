'use strict'

import { fillToPixelRect } from '../lib/fill-math.js'
import { applyDragDeltaToFill } from '../lib/coordinate-origin.js'
import { normalizeCrop, isIdentityCrop } from '../lib/layer-crop.js'

function clamp01(v) {
	return Math.max(0, Math.min(1, v))
}

/**
 * Pure delta→crop-params math (WO-158 T158.3), split out from `startCropResize` so it can be
 * unit-tested without DOM/pointer-event mocks. `dxFrac`/`dyFrac` are the pointer delta expressed
 * as a fraction of the layer's own on-screen fill-rect size (not the full canvas) — the crop
 * handles live on the cropped-content outline, a sub-rect of the layer's box.
 * @param {'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'} edge
 * @param {{ left: number, top: number, right: number, bottom: number }} startCrop - normalized (0-1) crop at drag start
 * @param {number} dxFrac
 * @param {number} dyFrac
 * @param {number} [minFrac] - minimum crop window width/height (fraction), mirrors `minS` in startEdgeResize
 * @returns {{ left: number, top: number, right: number, bottom: number }}
 */
export function cropDeltaToParams(edge, startCrop, dxFrac, dyFrac, minFrac = 0.02) {
	const start = normalizeCrop(startCrop)
	let { left, top, right, bottom } = start

	if (edge.includes('e')) right = clamp01(right + dxFrac)
	if (edge.includes('w')) left = clamp01(left + dxFrac)
	if (edge.includes('s')) bottom = clamp01(bottom + dyFrac)
	if (edge.includes('n')) top = clamp01(top + dyFrac)

	if ((edge.includes('e') || edge.includes('w')) && right - left < minFrac) {
		if (edge.includes('e')) right = Math.min(1, left + minFrac)
		if (edge.includes('w')) left = Math.max(0, right - minFrac)
	}
	if ((edge.includes('n') || edge.includes('s')) && bottom - top < minFrac) {
		if (edge.includes('s')) bottom = Math.min(1, top + minFrac)
		if (edge.includes('n')) top = Math.max(0, bottom - minFrac)
	}

	return normalizeCrop({ left, top, right, bottom })
}

/**
 * Pure delta→fill math for border/corner resize (todos19.07.26), split out of `startEdgeResize`
 * so aspect-lock behaviour is unit-testable without DOM/pointer mocks (same pattern as
 * `cropDeltaToParams` above). `dx`/`dy` are the pointer delta as a fraction of the compose
 * canvas ("fill space"); the canvas aspect is fixed, so preserving the scaleX:scaleY ratio
 * preserves the on-screen aspect ratio.
 *
 * Behaviour with `lockAspect` (layer default):
 * - corner drags resize both axes; the axis the pointer changed more (relative to start) drives,
 *   the other is derived from the start ratio. The opposite corner stays anchored.
 * - edge drags resize the dragged axis (opposite edge anchored); the perpendicular axis is
 *   derived proportionally and grows/shrinks around its own centre.
 * - snapping (WO-158 border awareness) applies to the dragged edge(s) BEFORE the ratio is
 *   derived, so the dragged edge still lands on canvas/neighbour borders; the derived axis
 *   follows the ratio exactly.
 * With `lockAspect: false` (layer unlocked in the inspector, or Shift held) each axis resizes
 * freely — the pre-todos19 behaviour.
 *
 * @param {'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'} edge
 * @param {{ x: number, y: number, scaleX: number, scaleY: number }} startFill
 * @param {number} dx
 * @param {number} dy
 * @param {{ lockAspect?: boolean, minS?: number, snapX?: (v: number) => number, snapY?: (v: number) => number }} [opts]
 * @returns {{ x: number, y: number, scaleX: number, scaleY: number }}
 */
export function edgeResizeDeltaToFill(edge, startFill, dx, dy, opts = {}) {
	const { lockAspect = true, minS = 0.02, snapX = (v) => v, snapY = (v) => v } = opts
	const start = {
		x: startFill?.x || 0,
		y: startFill?.y || 0,
		scaleX: startFill?.scaleX || 1,
		scaleY: startFill?.scaleY || 1,
	}
	const right0 = start.x + start.scaleX
	const bottom0 = start.y + start.scaleY
	const hasE = edge.includes('e')
	const hasW = edge.includes('w')
	const hasS = edge.includes('s')
	const hasN = edge.includes('n')

	let x = start.x
	let y = start.y
	let sx = start.scaleX
	let sy = start.scaleY

	if (hasE) sx = snapX(right0 + dx) - x
	if (hasW) {
		const left = snapX(start.x + dx)
		x = left
		sx = right0 - left
	}
	if (hasS) sy = snapY(bottom0 + dy) - y
	if (hasN) {
		const top = snapY(start.y + dy)
		y = top
		sy = bottom0 - top
	}

	if (lockAspect) {
		const ratio = start.scaleY > 1e-6 ? start.scaleX / start.scaleY : 1
		// Both final sizes must stay >= minS while keeping sx = ratio * sy (also swallows
		// negative sizes from dragging past the opposite edge).
		const sxFloor = Math.max(minS, minS * ratio)
		const horizontal = hasE || hasW
		const vertical = hasN || hasS
		let driveX = horizontal
		if (horizontal && vertical) {
			const relX = Math.abs(sx / Math.max(1e-6, start.scaleX) - 1)
			const relY = Math.abs(sy / Math.max(1e-6, start.scaleY) - 1)
			driveX = relX >= relY
		}
		if (driveX) {
			sx = Math.max(sx, sxFloor)
			sy = sx / Math.max(1e-6, ratio)
		} else {
			sy = Math.max(sy, sxFloor / Math.max(1e-6, ratio))
			sx = sy * ratio
		}
		// Re-anchor: a dragged edge keeps its opposite edge fixed; the derived axis of a
		// non-corner drag is centred on where it started.
		x = hasW ? right0 - sx : hasE ? start.x : start.x + (start.scaleX - sx) / 2
		y = hasN ? bottom0 - sy : hasS ? start.y : start.y + (start.scaleY - sy) / 2
	} else {
		if (sx < minS) {
			if (hasW) x = right0 - minS
			sx = minS
		}
		if (sy < minS) {
			if (hasN) y = bottom0 - minS
			sy = minS
		}
	}

	return { ...startFill, x, y, scaleX: sx, scaleY: sy }
}

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

	/* todos19.07.26: startRotate/startScale are no longer wired to any compose-canvas DOM (the
	 * rotate/scale dots were removed; border grab bands call startEdgeResize instead, rotation is
	 * inspector-only). Kept exported because scenes-editor.js still destructures and passes them
	 * through renderComposeScene's opts — renderComposeScene simply ignores them now. */
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
	 * Border/corner resize (todos19.07.26: the only resize affordance — the scale dot is gone).
	 * Honours the layer's aspect lock (`aspectLocked`, default ON) from EVERY edge/corner;
	 * holding Shift during the drag resizes freely, as does unlocking aspect in the inspector.
	 * Delta→fill math lives in the pure `edgeResizeDeltaToFill` above.
	 * @param {'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'} edge
	 */
	function startEdgeResize(edge, e, layerIndex, scene, aspectEl, el) {
		const rect = aspectEl.getBoundingClientRect()
		const layer = scene.layers[layerIndex]
		const startFill = { ...(layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }) }
		const aspectLocked = layer.aspectLocked !== false
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

			const next = edgeResizeDeltaToFill(edge, startFill, dx, dy, {
				lockAspect: aspectLocked && !ev.shiftKey,
				minS,
				snapX: (v) => snapValue(v, xCandidates, snapThresholdX),
				snapY: (v) => snapValue(v, yCandidates, snapThresholdY),
			})

			// Direct DOM update
			el.style.left = `${next.x * 100}%`
			el.style.top = `${next.y * 100}%`
			el.style.width = `${next.scaleX * 100}%`
			el.style.height = `${next.scaleY * 100}%`

			sceneState.patchLayer(scene.id, layerIndex, {
				fill: next,
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
	 * WO-158 T158.3: 8 crop drag zones, modeled on `startEdgeResize` but writing normalized crop
	 * fractions (relative to the layer's own fill rect) into the layer's `crop` effect instead of
	 * `fill`, through the same `sceneState.patchLayer(..., { effects })` path the inspector uses
	 * (`inspector-scene-layer.js`) so live-apply / preview-push fire exactly as for inspector edits.
	 * Creates the crop effect entry (identity params) if the layer doesn't have one yet.
	 * @param {'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'} edge
	 * @param {HTMLElement} cropHandlesEl - the `.scenes-layer__crop-handles` container (repositioned live)
	 * @param {HTMLElement} contentEl - the `.scenes-layer__content` wrapper (clip-path updated live)
	 */
	function startCropResize(edge, e, layerIndex, scene, aspectEl, el, cropHandlesEl, contentEl) {
		const rect = aspectEl.getBoundingClientRect()
		const layer = scene.layers[layerIndex]
		const fill = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
		const existingCropFx = Array.isArray(layer.effects) ? layer.effects.find((fx) => fx?.type === 'crop') : null
		const startCrop = normalizeCrop(existingCropFx?.params)
		const sx0 = e.clientX
		const sy0 = e.clientY
		sceneState.isInteracting = true

		function onMove(ev) {
			const currentRect = !aspectEl.isConnected ? document.querySelector('.scenes-compose')?.getBoundingClientRect() || rect : aspectEl.getBoundingClientRect()
			// Delta is a fraction of THIS layer's own on-screen box (canvas rect × its fill scale),
			// not the full canvas — the crop handles live on the cropped-content outline, a sub-rect
			// of the layer's own box.
			const rw = Math.max(10, currentRect.width) * Math.max(1e-6, fill.scaleX || 1)
			const rh = Math.max(10, currentRect.height) * Math.max(1e-6, fill.scaleY || 1)
			const dx = (ev.clientX - sx0) / rw
			const dy = (ev.clientY - sy0) / rh
			const nextCrop = cropDeltaToParams(edge, startCrop, dx, dy)

			// Direct DOM update for instant feedback (mirrors the other handlers)
			cropHandlesEl.style.left = `${nextCrop.left * 100}%`
			cropHandlesEl.style.top = `${nextCrop.top * 100}%`
			cropHandlesEl.style.right = `${(1 - nextCrop.right) * 100}%`
			cropHandlesEl.style.bottom = `${(1 - nextCrop.bottom) * 100}%`
			if (isIdentityCrop(nextCrop)) {
				contentEl.style.clipPath = ''
			} else {
				contentEl.style.clipPath = `inset(${nextCrop.top * 100}% ${(1 - nextCrop.right) * 100}% ${(1 - nextCrop.bottom) * 100}% ${nextCrop.left * 100}%)`
			}

			const nextEffects = Array.isArray(layer.effects) ? layer.effects.slice() : []
			const idx = nextEffects.findIndex((fx) => fx?.type === 'crop')
			const fxEntry = { type: 'crop', params: nextCrop }
			if (idx >= 0) nextEffects[idx] = fxEntry
			else nextEffects.push(fxEntry)

			sceneState.patchLayer(scene.id, layerIndex, { effects: nextEffects })
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

	return { startDrag, startRotate, startScale, startEdgeResize, startCropResize }
}

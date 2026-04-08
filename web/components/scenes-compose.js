/**
 * Compose frame: layer stack DOM, drag/rotate/scale, media drop.
 */

import { fillToPixelRect, pixelRectToFill, sceneLayerPixelRectForContentFit } from '../lib/fill-math.js'
import { fetchMediaContentResolution } from '../lib/mixer-fill.js'
import { api, getApiBase } from '../lib/api-client.js'
import { isMediaOrFileSource } from './scenes-shared.js'

/**
 * Build source object for fill math (drag payload may include `resolution` from media list / ffprobe).
 * @param {{ type?: string, value?: string, label?: string, resolution?: string }} data
 */
function sourcePayloadForFill(data) {
	return {
		type: data.type || 'media',
		value: data.value,
		label: data.label,
		resolution: data.resolution,
	}
}

/**
 * @param {{ sceneState: object, getCanvas: () => object, stateStore: object }} opts
 * @returns {(layerIndex: number, data: { type?: string, value?: string, label?: string, resolution?: string }) => Promise<void>}
 */
export function createApplyNativeFillForSource(opts) {
	const { sceneState, getCanvas, stateStore } = opts
	return async function applyNativeFillForSource(layerIndex, data) {
		const scene = sceneState.getScene(sceneState.editingSceneId)
		if (!scene?.layers[layerIndex] || !data?.value) return
		const canvas = getCanvas()
		const source = sourcePayloadForFill(data)
		const layer = scene.layers[layerIndex]
		const contentFit = layer.contentFit || 'horizontal'
		const contentRes = await fetchMediaContentResolution(source, stateStore, sceneState.activeScreenIndex, () =>
			api.get('/api/media'),
		)
		if (contentRes?.w > 0 && contentRes?.h > 0) {
			const cw = canvas.width > 0 ? canvas.width : 1920
			const ch = canvas.height > 0 ? canvas.height : 1080
			const rect = sceneLayerPixelRectForContentFit(cw, ch, contentRes.w, contentRes.h, contentFit)
			const fill = pixelRectToFill(rect, canvas)
			sceneState.patchLayer(scene.id, layerIndex, { fill })
		}
	}
}

/**
 * @param {object} sceneState
 * @param {() => void} schedulePreviewPush
 */
export function createComposeDragHandlers(sceneState, schedulePreviewPush) {
	function startDrag(e, layerIndex, scene, aspectEl) {
		const rect = aspectEl.getBoundingClientRect()
		const layer = scene.layers[layerIndex]
		const startFill = { ...(layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }) }
		const sx = e.clientX
		const sy = e.clientY

		function onMove(ev) {
			const dx = (ev.clientX - sx) / rect.width
			const dy = (ev.clientY - sy) / rect.height
			sceneState.patchLayer(scene.id, layerIndex, {
				fill: { ...startFill, x: startFill.x + dx, y: startFill.y + dy },
			})
			schedulePreviewPush()
		}
		function onUp() {
			document.removeEventListener('pointermove', onMove)
			document.removeEventListener('pointerup', onUp)
		}
		document.addEventListener('pointermove', onMove)
		document.addEventListener('pointerup', onUp)
	}

	function startRotate(e, layerIndex, scene, aspectEl) {
		const rect = aspectEl.getBoundingClientRect()
		const layer = scene.layers[layerIndex]
		const fill = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
		const pr = fillToPixelRect(fill, { width: rect.width, height: rect.height })
		const cx = rect.left + pr.x + pr.w / 2
		const cy = rect.top + pr.y + pr.h / 2
		const startAngle = layer.rotation || 0
		const a0 = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI)

		function onMove(ev) {
			const a1 = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI)
			let d = a1 - a0
			while (d > 180) d -= 360
			while (d < -180) d += 360
			sceneState.patchLayer(scene.id, layerIndex, { rotation: startAngle + d })
			schedulePreviewPush()
		}
		function onUp() {
			document.removeEventListener('pointermove', onMove)
			document.removeEventListener('pointerup', onUp)
		}
		document.addEventListener('pointermove', onMove)
		document.addEventListener('pointerup', onUp)
	}

	function startScale(e, layerIndex, scene, aspectEl) {
		const rect = aspectEl.getBoundingClientRect()
		const layer = scene.layers[layerIndex]
		const startFill = { ...(layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }) }
		const cx = (startFill.x + startFill.scaleX / 2) * rect.width + rect.left
		const cy = (startFill.y + startFill.scaleY / 2) * rect.height + rect.top
		const r0 = Math.hypot(e.clientX - cx, e.clientY - cy)

		function onMove(ev) {
			const r1 = Math.hypot(ev.clientX - cx, ev.clientY - cy)
			const k = r0 > 1e-6 ? r1 / r0 : 1
			const nsx = Math.max(0.02, Math.min(4, startFill.scaleX * k))
			const nsy = Math.max(0.02, Math.min(4, startFill.scaleY * k))
			const dx = (startFill.scaleX - nsx) / 2
			const dy = (startFill.scaleY - nsy) / 2
			sceneState.patchLayer(scene.id, layerIndex, {
				fill: {
					...startFill,
					scaleX: nsx,
					scaleY: nsy,
					x: startFill.x + dx,
					y: startFill.y + dy,
				},
			})
			schedulePreviewPush()
		}
		function onUp() {
			document.removeEventListener('pointermove', onMove)
			document.removeEventListener('pointerup', onUp)
		}
		document.addEventListener('pointermove', onMove)
		document.addEventListener('pointerup', onUp)
	}

	/**
	 * @param {'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'} edge
	 */
	function startEdgeResize(edge, e, layerIndex, scene, aspectEl) {
		const rect = aspectEl.getBoundingClientRect()
		const layer = scene.layers[layerIndex]
		const startFill = { ...(layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }) }
		const sx0 = e.clientX
		const sy0 = e.clientY
		const minS = 0.02

		function onMove(ev) {
			const dx = (ev.clientX - sx0) / rect.width
			const dy = (ev.clientY - sy0) / rect.height
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
			x = Math.max(0, Math.min(1 - sx, x))
			y = Math.max(0, Math.min(1 - sy, y))
			if (x + sx > 1) sx = 1 - x
			if (y + sy > 1) sy = 1 - y

			sceneState.patchLayer(scene.id, layerIndex, {
				fill: { ...startFill, x, y, scaleX: sx, scaleY: sy },
			})
			schedulePreviewPush()
		}
		function onUp() {
			document.removeEventListener('pointermove', onMove)
			document.removeEventListener('pointerup', onUp)
		}
		document.addEventListener('pointermove', onMove)
		document.addEventListener('pointerup', onUp)
	}

	return { startDrag, startRotate, startScale, startEdgeResize }
}

/** @param {object} scene @param {Record<string, unknown>} opts */
export function renderComposeScene(scene, opts) {
	const {
		sceneState,
		getResolution,
		selectedLayerIndex,
		dispatchLayerSelect,
		schedulePreviewPush,
		applyNativeFillForSource,
		SCENE_THUMB_MAX_W,
		startDrag,
		startRotate,
		startScale,
		startEdgeResize,
	} = opts

	const res = getResolution()
	const aspectRatio = res.h > 0 ? res.w / res.h : 1
	const wrap = document.createElement('div')
	wrap.className = 'scenes-compose-wrap' + (aspectRatio >= 2.2 ? ' scenes-compose-wrap--ultrawide' : '')

	const dropHint = document.createElement('p')
	dropHint.className = 'scenes-compose-hint'
	dropHint.textContent =
		'Drop media from the list onto the frame to add a layer, or onto a layer to replace it. Use the shaded margin when layers cover the full frame.'

	const pad = document.createElement('div')
	pad.className = 'scenes-compose-pad'

	const aspect = document.createElement('div')
	aspect.className = 'scenes-compose'
	aspect.style.aspectRatio = `${res.w} / ${res.h}`

	function parseDropData(e) {
		let data
		try {
			data = JSON.parse(e.dataTransfer.getData('application/json'))
		} catch {
			const val = e.dataTransfer.getData('text/plain')
			if (val) data = { type: 'media', value: val, label: val }
		}
		return data
	}

	async function addLayerFromMedia(data) {
		if (!data?.value || !sceneState.editingSceneId) return
		const idx = sceneState.addLayer(scene.id)
		if (idx < 0) return
		sceneState.setLayerSource(scene.id, idx, {
			type: data.type || 'media',
			value: data.value,
			label: data.label || data.value,
		})
		await applyNativeFillForSource(idx, sourcePayloadForFill(data))
		const updated = sceneState.getScene(scene.id)
		const layer = updated?.layers?.[idx]
		if (layer) dispatchLayerSelect({ sceneId: scene.id, layerIndex: idx, layer })
		schedulePreviewPush()
	}

	pad.addEventListener('dragover', (e) => {
		e.preventDefault()
		e.dataTransfer.dropEffect = 'copy'
		pad.classList.add('scenes-compose-pad--dropping')
	})
	pad.addEventListener('dragleave', (e) => {
		if (!e.relatedTarget || !pad.contains(e.relatedTarget)) pad.classList.remove('scenes-compose-pad--dropping')
	})
	pad.addEventListener('drop', (e) => {
		e.preventDefault()
		pad.classList.remove('scenes-compose-pad--dropping')
		if (e.target.closest('.scenes-compose')) return
		const data = parseDropData(e)
		if (data?.value) addLayerFromMedia(data)
	})

	aspect.addEventListener('dragover', (e) => {
		if (e.target.closest('.scenes-layer')) return
		e.preventDefault()
		e.stopPropagation()
		e.dataTransfer.dropEffect = 'copy'
	})
	aspect.addEventListener('drop', (e) => {
		if (e.target.closest('.scenes-layer')) return
		e.preventDefault()
		e.stopPropagation()
		const data = parseDropData(e)
		if (data?.value) addLayerFromMedia(data)
	})

	const sorted = [...scene.layers].sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))

	for (let ord = 0; ord < sorted.length; ord++) {
		const layer = sorted[ord]
		const realIdx = scene.layers.indexOf(layer)
		const f = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
		const el = document.createElement('div')
		el.className = 'scenes-layer' + (selectedLayerIndex === realIdx ? ' scenes-layer--selected' : '')
		el.dataset.layerIndex = String(realIdx)
		el.style.left = `${f.x * 100}%`
		el.style.top = `${f.y * 100}%`
		el.style.width = `${f.scaleX * 100}%`
		el.style.height = `${f.scaleY * 100}%`
		el.style.opacity = String(layer.opacity ?? 1)
		el.style.zIndex = String(10 + (layer.layerNumber || 0))
		el.style.transform = `rotate(${layer.rotation ?? 0}deg)`

		const inner = document.createElement('div')
		inner.className = 'scenes-layer__inner'

		if (isMediaOrFileSource(layer.source)) {
			const img = document.createElement('img')
			img.className = 'scenes-layer__thumb'
			img.alt = ''
			img.src = `${getApiBase()}/api/thumbnail/${encodeURIComponent(layer.source.value)}?w=${SCENE_THUMB_MAX_W}`
			img.draggable = false
			inner.appendChild(img)
		} else if (layer.source?.value) {
			const ph = document.createElement('div')
			ph.className = 'scenes-layer__placeholder'
			ph.textContent = (layer.source.label || layer.source.value || '').slice(0, 20)
			inner.appendChild(ph)
		} else {
			const ph = document.createElement('div')
			ph.className = 'scenes-layer__placeholder scenes-layer__placeholder--empty'
			ph.textContent = 'Drop source'
			inner.appendChild(ph)
		}

		const handles = document.createElement('div')
		handles.className = 'scenes-layer__handles'
		handles.innerHTML = `
				<button type="button" class="scenes-layer__handle scenes-layer__handle--rotate" title="Drag to rotate"></button>
				<button type="button" class="scenes-layer__handle scenes-layer__handle--scale" title="Drag to scale"></button>
			`
		inner.appendChild(handles)

		const edges = document.createElement('div')
		edges.className = 'scenes-layer__edges'
		edges.setAttribute('aria-hidden', 'true')
		edges.innerHTML = `
			<span class="scenes-layer__edge scenes-layer__edge--n" data-edge="n" title="Resize"></span>
			<span class="scenes-layer__edge scenes-layer__edge--s" data-edge="s" title="Resize"></span>
			<span class="scenes-layer__edge scenes-layer__edge--e" data-edge="e" title="Resize"></span>
			<span class="scenes-layer__edge scenes-layer__edge--w" data-edge="w" title="Resize"></span>
			<span class="scenes-layer__edge scenes-layer__edge--ne" data-edge="ne" title="Resize"></span>
			<span class="scenes-layer__edge scenes-layer__edge--nw" data-edge="nw" title="Resize"></span>
			<span class="scenes-layer__edge scenes-layer__edge--se" data-edge="se" title="Resize"></span>
			<span class="scenes-layer__edge scenes-layer__edge--sw" data-edge="sw" title="Resize"></span>
		`

		el.appendChild(inner)
		el.appendChild(edges)

		edges.querySelectorAll('.scenes-layer__edge').forEach((zone) => {
			zone.addEventListener('pointerdown', (e) => {
				const ed = zone.getAttribute('data-edge')
				if (!ed) return
				e.stopPropagation()
				e.preventDefault()
				dispatchLayerSelect({ sceneId: scene.id, layerIndex: realIdx, layer })
				startEdgeResize(ed, e, realIdx, scene, aspect)
			})
		})

		el.addEventListener('pointerdown', (e) => {
			if (e.target.closest('.scenes-layer__handle')) return
			if (e.target.closest('.scenes-layer__edge')) return
			e.preventDefault()
			dispatchLayerSelect({ sceneId: scene.id, layerIndex: realIdx, layer })
			startDrag(e, realIdx, scene, aspect)
		})

		const rotBtn = handles.querySelector('.scenes-layer__handle--rotate')
		rotBtn.addEventListener('pointerdown', (e) => {
			e.stopPropagation()
			dispatchLayerSelect({ sceneId: scene.id, layerIndex: realIdx, layer })
			startRotate(e, realIdx, scene, aspect)
		})
		const scaleBtn = handles.querySelector('.scenes-layer__handle--scale')
		scaleBtn.addEventListener('pointerdown', (e) => {
			e.stopPropagation()
			dispatchLayerSelect({ sceneId: scene.id, layerIndex: realIdx, layer })
			startScale(e, realIdx, scene, aspect)
		})

		el.addEventListener('dragover', (e) => {
			e.preventDefault()
			e.stopPropagation()
			e.dataTransfer.dropEffect = 'copy'
			el.classList.add('scenes-layer--drag-over')
		})
		el.addEventListener('dragleave', () => el.classList.remove('scenes-layer--drag-over'))
		el.addEventListener('drop', (e) => {
			e.preventDefault()
			e.stopPropagation()
			el.classList.remove('scenes-layer--drag-over')
			let data
			try {
				data = JSON.parse(e.dataTransfer.getData('application/json'))
			} catch {
				const val = e.dataTransfer.getData('text/plain')
				if (val) data = { type: 'media', value: val, label: val }
			}
			if (data?.value) {
				sceneState.setLayerSource(scene.id, realIdx, {
					type: data.type || 'media',
					value: data.value,
					label: data.label || data.value,
				})
				void applyNativeFillForSource(realIdx, sourcePayloadForFill(data)).then(() => schedulePreviewPush())
			}
		})

		aspect.appendChild(el)
	}

	pad.appendChild(aspect)
	wrap.appendChild(dropHint)
	wrap.appendChild(pad)
	return wrap
}

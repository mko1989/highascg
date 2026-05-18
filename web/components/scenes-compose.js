/**
 * Compose frame: layer stack DOM, drag/rotate/scale, media drop.
 */


import { pixelRectToFill, sceneLayerPixelRectForContentFit } from '../lib/fill-math.js'
import { fetchMediaContentResolution } from '../lib/mixer-fill.js'
import { api } from '../lib/api-client.js'
import { getThumbnailUrl, getLiveThumbnailUrl, getLiveThumbnailChannelForSource } from '../lib/thumbnail-url.js'
import { isMediaOrFileSource, parseDraggableSourcesPayload, parseRouteChannelLayer } from './scenes-shared.js'
import { resolveLookStackChannelForBus } from '../lib/look-stack-amcp-channel.js'
import { invalidateThumbnailCache } from './preview-canvas-draw-base.js'
import { showScenesToast } from './scenes-editor-support.js'
export { createComposeDragHandlers } from './scenes-compose-handlers.js'

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
		isPlaceholder: data.isPlaceholder,
		template: data.template,
		browserAsCg: data.browserAsCg,
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
		const contentFit = layer.contentFit || 'native'
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


/** @param {object} scene @param {Record<string, unknown>} opts */
export function renderComposeScene(scene, opts) {
	const {
		sceneState,
		stateStore,
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
		onSourceDropped,
		getThumbUrlForLayerSource,
		getPreviewChannelForLiveThumb,
	} = opts

	/** Block `route://ch-L` on the same channel-layer the look stack uses for that layer (Caspar recursion). */
	function routeLayerDropAllowed(data, targetLayerNumber) {
		const parsed = parseRouteChannelLayer(data?.value)
		if (!parsed) return true
		const cm = stateStore?.getState?.()?.channelMap || {}
		const ch = resolveLookStackChannelForBus(cm, sceneState, scene, 'edit')
		if (ch == null) return true
		if (parsed.channel === ch && parsed.layer === Number(targetLayerNumber)) {
			showScenesToast('A layer cannot play a route to itself (same channel and layer).', 'warn')
			return false
		}
		return true
	}

	const res = getResolution()
	const aspectRatio = res.h > 0 ? res.w / res.h : 1
	const wrap = document.createElement('div')
	wrap.className = 'scenes-compose-wrap' + (aspectRatio >= 2.2 ? ' scenes-compose-wrap--ultrawide' : '')

	const dropHint = document.createElement('p')
	dropHint.className = 'scenes-compose-hint'
	dropHint.textContent =
		'Drop media or templates from Sources onto the frame to add a layer, or onto a layer to replace it. Use the shaded margin when layers cover the full frame.'

	const pad = document.createElement('div')
	pad.className = 'scenes-compose-pad'

	const aspect = document.createElement('div')
	aspect.className = 'scenes-compose'
	aspect.style.aspectRatio = `${res.w} / ${res.h}`

	async function addLayerFromMedia(data) {
		if (!data?.value || !sceneState.editingSceneId) return
		const idx = sceneState.addLayer(scene.id)
		if (idx < 0) return
		const added = sceneState.getScene(scene.id)?.layers?.[idx]
		const targetLn = added?.layerNumber
		if (targetLn != null && !routeLayerDropAllowed(data, targetLn)) {
			sceneState.removeLayer(scene.id, idx)
			return
		}
		sceneState.setLayerSource(scene.id, idx, {
			...data,
			type: data.type || 'media',
			value: data.value,
			label: data.label || data.value,
		})
		await applyNativeFillForSource(idx, sourcePayloadForFill(data))
		const updated = sceneState.getScene(scene.id)
		const layer = updated?.layers?.[idx]
		if (layer) dispatchLayerSelect({ sceneId: scene.id, layerIndex: idx, layer })
		schedulePreviewPush()
		if (typeof onSourceDropped === 'function') {
			try { await onSourceDropped(data) } catch {}
		}
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
		const items = parseDraggableSourcesPayload(e.dataTransfer)
		if (items.length > 1) {
			void (async () => {
				for (const item of items) {
					if (item?.value) await addLayerFromMedia(item)
				}
			})()
		} else if (items.length === 1) {
			addLayerFromMedia(items[0])
		}
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
		const items = parseDraggableSourcesPayload(e.dataTransfer)
		if (items.length > 1) {
			void (async () => {
				for (const item of items) {
					if (item?.value) await addLayerFromMedia(item)
				}
			})()
		} else if (items.length === 1) {
			addLayerFromMedia(items[0])
		}
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

		if (layer.source?.isPlaceholder) {
			const ph = document.createElement('div')
			ph.className = 'scenes-layer__placeholder scenes-layer__placeholder--pattern'
			const t = layer.source.template || 'color_grid'
			ph.dataset.template = t
			if (t === 'solid' && layer.source.value) {
				ph.style.backgroundColor = layer.source.value
			}
			ph.textContent = layer.source.label || layer.source.value
			inner.appendChild(ph)
		} else if (isMediaOrFileSource(layer.source)) {
			const img = document.createElement('img')
			img.className = 'scenes-layer__thumb'
			img.alt = ''
			img.src = getThumbnailUrl(layer.source.value, SCENE_THUMB_MAX_W, 0)
			img.draggable = false
			inner.appendChild(img)
		} else if (typeof getThumbUrlForLayerSource === 'function') {
			const liveUrl = getThumbUrlForLayerSource(layer.source)
			if (liveUrl) {
				const wrap = document.createElement('div')
				wrap.className = 'scenes-layer__live-thumb-wrap'
				const img = document.createElement('img')
				img.className = 'scenes-layer__thumb'
				img.alt = ''
				img.src = liveUrl
				img.draggable = false
				wrap.appendChild(img)
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = 'scenes-layer__live-refresh'
				btn.title = 'Refresh live still (Caspar PRINT → cached)'
				btn.setAttribute('aria-label', 'Refresh live thumbnail')
				btn.textContent = '↻'
				btn.addEventListener('click', async (e) => {
					e.stopPropagation()
					e.preventDefault()
					const fb = typeof getPreviewChannelForLiveThumb === 'function' ? getPreviewChannelForLiveThumb() : null
					const n = getLiveThumbnailChannelForSource(layer.source, fb)
					if (!Number.isFinite(n) || n <= 0) {
						const directNdi =
							layer.source?.useDirect === true &&
							String(layer.source?.value || '').trim().toLowerCase().startsWith('ndi://')
						showScenesToast(
							directNdi
								? 'Direct NDI has no Caspar-channel still — use Routed mode with a keyed channel or route:// preview.'
								: 'Cannot resolve Caspar channel for this source — set preview routing or use route:// / NDI channel hint.',
							'error',
						)
						return
					}
					btn.disabled = true
					try {
						await api.post('/api/thumbnail/live/capture', { channel: n, force: true })
						invalidateThumbnailCache(`/api/thumbnail/live/${n}`)
						img.src = getLiveThumbnailUrl(n, Date.now())
					} catch (err) {
						showScenesToast(err?.message || 'Live thumbnail capture failed', 'error')
					} finally {
						btn.disabled = false
					}
				})
				wrap.appendChild(btn)
				inner.appendChild(wrap)
			} else {
				const ph = document.createElement('div')
				ph.className = 'scenes-layer__placeholder scenes-layer__placeholder--empty'
				ph.textContent = 'Drop source'
				inner.appendChild(ph)
			}
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
				startEdgeResize(ed, e, realIdx, scene, aspect, el)
			})
		})

		el.addEventListener('pointerdown', (e) => {
			if (e.target.closest('.scenes-layer__handle')) return
			if (e.target.closest('.scenes-layer__edge')) return
			e.preventDefault()
			dispatchLayerSelect({ sceneId: scene.id, layerIndex: realIdx, layer })
			startDrag(e, realIdx, scene, aspect, el)
		})

		const rotBtn = handles.querySelector('.scenes-layer__handle--rotate')
		rotBtn.addEventListener('pointerdown', (e) => {
			e.stopPropagation()
			dispatchLayerSelect({ sceneId: scene.id, layerIndex: realIdx, layer })
			startRotate(e, realIdx, scene, aspect, el)
		})
		const scaleBtn = handles.querySelector('.scenes-layer__handle--scale')
		scaleBtn.addEventListener('pointerdown', (e) => {
			e.stopPropagation()
			dispatchLayerSelect({ sceneId: scene.id, layerIndex: realIdx, layer })
			startScale(e, realIdx, scene, aspect, el)
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
			const items = parseDraggableSourcesPayload(e.dataTransfer)
			if (items.length > 1) {
				void (async () => {
					const first = items[0]
					if (first?.value) {
						if (!routeLayerDropAllowed(first, layer.layerNumber)) return
						sceneState.setLayerSource(scene.id, realIdx, {
							...first,
							type: first.type || 'media',
							value: first.value,
							label: first.label || first.value,
						})
						await applyNativeFillForSource(realIdx, sourcePayloadForFill(first))
					}
					for (let i = 1; i < items.length; i++) {
						if (items[i]?.value) await addLayerFromMedia(items[i])
					}
					const updated = sceneState.getScene(scene.id)
					const layer = updated?.layers?.[realIdx]
					if (layer) dispatchLayerSelect({ sceneId: scene.id, layerIndex: realIdx, layer })
					schedulePreviewPush()
					if (first && typeof onSourceDropped === 'function') {
						try { await onSourceDropped(first) } catch {}
					}
				})()
			} else if (items.length === 1) {
				const data = items[0]
				if (!routeLayerDropAllowed(data, layer.layerNumber)) return
				sceneState.setLayerSource(scene.id, realIdx, {
					...data,
					type: data.type || 'media',
					value: data.value,
					label: data.label || data.value,
				})
				void applyNativeFillForSource(realIdx, sourcePayloadForFill(data)).then(() => {
					const updated = sceneState.getScene(scene.id)
					const layer = updated?.layers?.[realIdx]
					if (layer) dispatchLayerSelect({ sceneId: scene.id, layerIndex: realIdx, layer })
					schedulePreviewPush()
					if (typeof onSourceDropped === 'function') {
						void onSourceDropped(data).catch(() => {})
					}
				})
			}
		})

		aspect.appendChild(el)
	}

	pad.appendChild(aspect)
	wrap.appendChild(dropHint)
	wrap.appendChild(pad)
	return wrap
}

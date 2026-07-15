/**
 * Compose frame: layer stack DOM, drag/rotate/scale, media drop.
 */


import { pixelRectToFill, sceneLayerPixelRectForContentFit } from '../lib/fill-math.js'
import { fetchMediaContentResolution } from '../lib/mixer-fill.js'
import { api } from '../lib/api-client.js'
import { resolveSourceThumbnailUrl } from '../lib/thumbnail-url.js'
import { parseDraggableSourcesPayload, routeDropRejectionMessage } from './scenes-shared.js'
import { resolveLookStackChannelForBus } from '../lib/look-stack-amcp-channel.js'
import { showScenesToast } from './scenes-editor-support.js'
import { cropFromLayer, normalizeCrop } from '../lib/layer-crop.js'
import { createComposeDragHandlers } from './scenes-compose-handlers.js'
import { buildComposeLayerContent } from './scenes-compose-layer-thumb.js'
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
	const { sceneState, getResolution, stateStore } = opts
	return async function applyNativeFillForSource(layerIndex, data) {
		const scene = sceneState.getScene(sceneState.editingSceneId)
		if (!scene?.layers[layerIndex] || !data?.value) return
		const res = typeof getResolution === 'function' ? getResolution() : null
		const canvas = {
			width: res?.w > 0 ? res.w : stateStore?.getState?.()?.channelMap?.programResolutions?.[0]?.w || 1920,
			height: res?.h > 0 ? res.h : stateStore?.getState?.()?.channelMap?.programResolutions?.[0]?.h || 1080,
		}
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

	/*
	 * WO-158 T158.3: `startCropResize` is not threaded through scenes-editor.js's opts wiring
	 * (that file lists startDrag/startRotate/startScale/startEdgeResize explicitly and is out of
	 * scope for this change) — build a local handler set from the sceneState/schedulePreviewPush
	 * already in opts instead. Cheap (pure closures, no side effects) and keeps the other four
	 * handlers exactly as wired by the parent.
	 */
	const { startCropResize } = createComposeDragHandlers(sceneState, schedulePreviewPush)

	/**
	 * Block `route://ch-L` on the same channel-layer the look stack uses for that layer (Caspar
	 * recursion) and whole-channel `route://ch` routes to this screen's own PGM/PRV channel —
	 * a whole-channel self-route wedges the channel in CasparCG (WO-156).
	 */
	function routeLayerDropAllowed(data, targetLayerNumber) {
		const cm = stateStore?.getState?.()?.channelMap || {}
		const msg = routeDropRejectionMessage(data?.value, {
			editChannel: resolveLookStackChannelForBus(cm, sceneState, scene, 'edit'),
			pgmChannel: resolveLookStackChannelForBus(cm, sceneState, scene, 'pgm'),
			targetLayerNumber,
		})
		if (msg) {
			showScenesToast(msg, 'warn')
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
		const srcType = data.type || 'media'
		sceneState.setLayerSource(scene.id, idx, {
			...data,
			type: srcType,
			value: data.value,
			label: data.label || data.value,
		})
		if (srcType === 'live_audio') {
			sceneState.patchLayer(scene.id, idx, { opacity: 0 })
		}
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

		/* WO-158 T158.2: source content lives in its own clip wrapper so the crop rect can be
		 * clipped without also clipping the handle buttons (which are positioned outside the
		 * box via negative offsets and must stay visible). */
		const content = buildComposeLayerContent(layer, { SCENE_THUMB_MAX_W, getThumbUrlForLayerSource, getPreviewChannelForLiveThumb })

		/* WO-158 T158.2: clip the thumbnail to the crop rect (fractions of this layer's own fill
		 * rect, same convention as cropAdjustedRect). Identity/no crop → no style set at all. */
		const cropVisible = cropFromLayer(layer)
		if (cropVisible) {
			content.style.clipPath = `inset(${cropVisible.top * 100}% ${(1 - cropVisible.right) * 100}% ${(1 - cropVisible.bottom) * 100}% ${cropVisible.left * 100}%)`
		}
		inner.appendChild(content)

		const handles = document.createElement('div')
		handles.className = 'scenes-layer__handles'
		handles.innerHTML = `
				<button type="button" class="scenes-layer__handle scenes-layer__handle--rotate" title="Drag to rotate"></button>
				<button type="button" class="scenes-layer__handle scenes-layer__handle--scale" title="Drag to scale"></button>
				<button type="button" class="scenes-layer__handle scenes-layer__handle--crop" title="Toggle crop handles" aria-pressed="false"></button>
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

		/*
		 * WO-158 T158.3: 8 bracket-style crop drag zones, positioned on the cropped-content
		 * outline (a sub-rect of this layer's own box, expressed in % like the edge zones
		 * above). Auto-visible when the layer already has a crop effect (any params, so a
		 * freshly-toggled identity crop stays visible after the render that follows the first
		 * drag); otherwise hidden until the operator clicks the crop toggle button.
		 */
		const cropEffectEntry = Array.isArray(layer.effects) ? layer.effects.find((fx) => fx?.type === 'crop') : null
		const cropForHandles = cropEffectEntry ? normalizeCrop(cropEffectEntry.params) : { left: 0, top: 0, right: 1, bottom: 1 }
		const cropHandles = document.createElement('div')
		cropHandles.className = 'scenes-layer__crop-handles' + (cropEffectEntry ? ' scenes-layer__crop-handles--active' : '')
		cropHandles.setAttribute('aria-hidden', 'true')
		cropHandles.style.left = `${cropForHandles.left * 100}%`
		cropHandles.style.top = `${cropForHandles.top * 100}%`
		cropHandles.style.right = `${(1 - cropForHandles.right) * 100}%`
		cropHandles.style.bottom = `${(1 - cropForHandles.bottom) * 100}%`
		cropHandles.innerHTML = `
			<span class="scenes-layer__crop-handle scenes-layer__crop-handle--n" data-crop-edge="n" title="Drag to crop"></span>
			<span class="scenes-layer__crop-handle scenes-layer__crop-handle--s" data-crop-edge="s" title="Drag to crop"></span>
			<span class="scenes-layer__crop-handle scenes-layer__crop-handle--e" data-crop-edge="e" title="Drag to crop"></span>
			<span class="scenes-layer__crop-handle scenes-layer__crop-handle--w" data-crop-edge="w" title="Drag to crop"></span>
			<span class="scenes-layer__crop-handle scenes-layer__crop-handle--ne" data-crop-edge="ne" title="Drag to crop"></span>
			<span class="scenes-layer__crop-handle scenes-layer__crop-handle--nw" data-crop-edge="nw" title="Drag to crop"></span>
			<span class="scenes-layer__crop-handle scenes-layer__crop-handle--se" data-crop-edge="se" title="Drag to crop"></span>
			<span class="scenes-layer__crop-handle scenes-layer__crop-handle--sw" data-crop-edge="sw" title="Drag to crop"></span>
		`

		el.appendChild(inner)
		el.appendChild(edges)
		el.appendChild(cropHandles)

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

		cropHandles.querySelectorAll('.scenes-layer__crop-handle').forEach((zone) => {
			zone.addEventListener('pointerdown', (e) => {
				const ced = zone.getAttribute('data-crop-edge')
				if (!ced) return
				e.stopPropagation()
				e.preventDefault()
				dispatchLayerSelect({ sceneId: scene.id, layerIndex: realIdx, layer })
				startCropResize(ced, e, realIdx, scene, aspect, el, cropHandles, content)
			})
		})

		el.addEventListener('pointerdown', (e) => {
			if (e.target.closest('.scenes-layer__handle')) return
			if (e.target.closest('.scenes-layer__edge')) return
			if (e.target.closest('.scenes-layer__crop-handle')) return
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
		const cropToggleBtn = handles.querySelector('.scenes-layer__handle--crop')
		cropToggleBtn.addEventListener('pointerdown', (e) => e.stopPropagation())
		cropToggleBtn.addEventListener('click', (e) => {
			e.stopPropagation()
			dispatchLayerSelect({ sceneId: scene.id, layerIndex: realIdx, layer })
			const nowActive = cropHandles.classList.toggle('scenes-layer__crop-handles--active')
			cropToggleBtn.setAttribute('aria-pressed', String(nowActive))
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

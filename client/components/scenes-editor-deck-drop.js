/**
 * Scenes editor — drop media onto deck to create a new look.
 */

import { parseDraggableSourcesPayload } from './scenes-shared.js'

/**
 * @param {object} ctx
 */
export function createDeckMediaDropHandler(ctx) {
	const {
		sceneState,
		getScreenCount,
		ingestDeckDroppedFiles,
		dispatchLayerSelect,
		selectedLayerIndexRef,
		applyNativeFillForSource,
		captureOnDemandForDroppedSource,
		previewRuntime,
		scheduleRender,
	} = ctx

	return async function onDeckMediaDrop(mainCol, e) {
		const dt = e.dataTransfer
		let payloads = []
		if (dt?.files?.length) {
			payloads = (await ingestDeckDroppedFiles(dt.files)) || []
		} else {
			payloads = parseDraggableSourcesPayload(dt)
		}
		if (!payloads.length) return

		if (mainCol !== sceneState.activeScreenIndex) sceneState.switchScreen(mainCol)

		const nScreens = Math.max(1, getScreenCount())
		const mainScope = nScreens < 2 ? String(0) : String(mainCol)
		const id = sceneState.addScene(undefined, { mainScope })
		sceneState.setEditingScene(id)
		selectedLayerIndexRef.current = null
		dispatchLayerSelect(null)

		for (const data of payloads) {
			const idx = sceneState.addLayer(id)
			const src = {
				...data,
				type: data.type || 'media',
				value: data.value,
				label: data.label || data.value,
			}
			const th = Number(data.thumbnailChannel)
			if (Number.isFinite(th) && th > 0) src.thumbnailChannel = th
			if (
				data.useDirect != null &&
				!(String(data.value || '').trim().toLowerCase().startsWith('route://'))
			) {
				src.useDirect = data.useDirect === true || data.useDirect === 'true'
			}
			if (src.type === 'ndi' && String(src.value || '').trim().toLowerCase().startsWith('route://')) {
				delete src.useDirect
			}
			sceneState.setLayerSource(id, idx, src)
			await applyNativeFillForSource(idx, {
				type: data.type || 'media',
				value: data.value,
				label: data.label,
				resolution: data.resolution,
			})
			try {
				await captureOnDemandForDroppedSource(data)
			} catch {
				/* noop */
			}
		}

		const scene = sceneState.getScene(id)
		const lastIdx = (scene?.layers?.length ?? 1) - 1
		const lastLayer = scene?.layers?.[lastIdx]
		if (lastLayer) {
			dispatchLayerSelect({ sceneId: id, layerIndex: lastIdx, layer: lastLayer })
		}
		previewRuntime.schedulePreviewPush()
		scheduleRender()
	}
}

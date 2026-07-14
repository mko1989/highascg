/**
 * Scenes editor — drop media onto deck to create a new look.
 * (WO-208 timer-drop handling removed by WO-210: timers are panel-owned, not look inputs.)
 */

import { parseDraggableSourcesPayload, routeDropRejectionMessage } from './scenes-shared.js'
import { showScenesToast } from './scenes-editor-support.js'
import { nextLayerNumber } from '../lib/scene-state-helpers.js'

/**
 * @param {object} ctx
 */
export function createDeckMediaDropHandler(ctx) {
	const {
		sceneState,
		getChannelMap,
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

		// WO-156: drop route sources that would route this screen's own PGM/PRV channel into
		// itself (whole-channel self-route wedges the channel in CasparCG).
		const cm = typeof getChannelMap === 'function' ? getChannelMap() : {}
		const pgmCh = cm?.programChannels?.[mainCol] ?? null
		const prvCh = cm?.previewChannels?.[mainCol] ?? null
		payloads = payloads.filter((data) => {
			const msg = routeDropRejectionMessage(data?.value, { editChannel: prvCh, pgmChannel: pgmCh })
			if (msg) {
				showScenesToast(msg, 'warn')
				return false
			}
			return true
		})
		if (!payloads.length) return

		if (mainCol !== sceneState.activeScreenIndex) sceneState.switchScreen(mainCol)

		const nScreens = Math.max(1, getScreenCount())
		const mainScope = nScreens < 2 ? String(0) : String(mainCol)
		const id = sceneState.addScene(undefined, { mainScope })
		sceneState.setEditingScene(id)
		selectedLayerIndexRef.current = null
		dispatchLayerSelect(null)

		for (const data of payloads) {
			// Standard drop handling for templates/media
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

		const finalScene = sceneState.getScene(id)
		const lastIdx = (finalScene?.layers?.length ?? 1) - 1
		const lastLayer = finalScene?.layers?.[lastIdx]
		if (lastLayer) {
			dispatchLayerSelect({ sceneId: id, layerIndex: lastIdx, layer: lastLayer })
		}
		previewRuntime.schedulePreviewPush()
		scheduleRender()
	}
}

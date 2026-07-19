/**
 * Scenes editor — drop media onto deck to create a new look.
 * (WO-208 timer-drop handling removed by WO-210: timers are panel-owned, not look inputs.)
 *
 * WO-226 T226.2: dropping a countdown template (or a payload carrying a timerId — e.g. a future
 * draggable timer-instance row) onto a screen's looks column must NOT create a look. It routes to
 * POST /api/timers/assign for that screen instead, and the per-screen timer icon (scene-list-column.js)
 * picks up the change via the 'screen-timers-changed' event dispatched below.
 */

import { parseDraggableSourcesPayload, routeDropRejectionMessage } from './scenes-shared.js'
import { showScenesToast } from './scenes-editor-support.js'
import { nextLayerNumber } from '../lib/scene-state-helpers.js'
import { screenLabel } from '../lib/screen-label.js'
import { createTimerForScreen, newTimerId } from '../lib/screen-timer-create.js'

/**
 * Whether a dragged payload should be routed to the screen-timer assign API instead of
 * becoming a look layer: an explicit `timerId` on the payload, or a `template` source whose
 * value references the countdown template.
 * @param {object} data
 * @returns {boolean}
 */
function isTimerDropPayload(data) {
	if (!data) return false
	if (data.timerId) return true
	const ty = String(data.type || '').toLowerCase()
	if (ty !== 'template') return false
	return String(data.value || '').toLowerCase().includes('countdown')
}

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

		// WO-226 T226.2: countdown-template / timer-instance drops assign a screen timer
		// instead of creating a look. Peel them off before any look-creation logic runs.
		const timerPayloads = payloads.filter(isTimerDropPayload)
		payloads = payloads.filter((data) => !isTimerDropPayload(data))
		if (timerPayloads.length) {
			const cmForTimers = typeof getChannelMap === 'function' ? getChannelMap() : {}
			const label = screenLabel(cmForTimers, mainCol)
			for (const data of timerPayloads) {
				try {
					// createTimerForScreen dispatches 'screen-timers-changed' on success.
					await createTimerForScreen({
						timerId: data.timerId || newTimerId(),
						name: data.label || data.name || 'Timer',
						screenIdx: mainCol,
					})
					showScenesToast(`⏱ Timer assigned to ${label}`, 'info')
				} catch (err) {
					showScenesToast(`Timer assign failed: ${err?.message || err}`, 'error')
				}
			}
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

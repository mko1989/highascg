/** Inspector panel — selected item properties. @see main_plan.md Prompt 14 */

import { dashboardState, dashboardCasparLayer } from '../lib/dashboard-state.js'
import { sceneState } from '../lib/scene-state.js'
import { api } from '../lib/api-client.js'
import { multiviewState } from '../lib/multiview-state.js'
import { calcMixerFill, getContentResolution } from '../lib/mixer-fill.js'
import { scheduleSelectionSync } from '../lib/selection-sync.js'
import { renderTimelineLayerInspector } from './inspector-mixer.js'
import { settingsState } from '../lib/settings-state.js'
import { dmxState } from '../lib/dmx-state.js'
import { renderFixtureInspector } from './fixture-inspector.js'
import { timelineState } from '../lib/timeline-state.js'
import {
	syncTimelineToServer,
	renderTimelineFlagInspector,
	renderTimelineClipInspector,
} from './inspector-panel-timeline.js'
import {
	renderClipInspector,
	renderSceneLayerInspector,
	applyLayerSettings,
	renderLayerSettingsInspector,
	renderMultiviewInspector,
} from './inspector-panel-views.js'

/** @deprecated import from ../lib/mixer-fill.js */
export { calcMixerFill, getContentResolution }

function isPixelMapTabActive() {
	const t = document.querySelector('.workspace__tabs .tab[data-tab="pixelmap"]')
	return !!(t && t.classList.contains('active'))
}

function redrawDmxCanvas() {
	document.dispatchEvent(new CustomEvent('dmx-redraw'))
}

/**
 * @param {HTMLElement} root
 * @param {object} stateStore
 */
export function initInspectorPanel(root, stateStore) {
	let selection = null
	let _timelinePlaybackPos = 0
	stateStore.on('timeline.tick', (data) => {
		if (data?.position != null) _timelinePlaybackPos = data.position
		if (selection?.type === 'timelineClip') scheduleSelectionSync(stateStore, selection)
	})
	stateStore.on('timeline.playback', (pb) => {
		if (pb?.position != null) _timelinePlaybackPos = pb.position
		if (selection?.type === 'timelineClip') scheduleSelectionSync(stateStore, selection)
	})

	function getProgramChannel() {
		const s = dashboardState.activeScreenIndex
		return getProgramChannelForColumn(s)
	}

	function getProgramChannelForColumn(colIdx) {
		const state = stateStore.getState()
		const ch = state?.channelMap?.programChannels?.[colIdx]
		return ch != null ? ch : 1
	}

	function getResolution() {
		const s = dashboardState.activeScreenIndex
		return getResolutionForColumn(s)
	}

	function getResolutionForColumn(colIdx) {
		const state = stateStore.getState()
		return state?.channelMap?.programResolutions?.[colIdx] || { w: 1920, h: 1080 }
	}

	function isSelectedColumnActive() {
		if (!selection || selection.type !== 'dashboard') return false
		return dashboardState.getActiveColumnIndex() === selection.colIdx
	}

	async function sendAmcpIfActive(cb) {
		if (!selection || selection.type !== 'dashboard') return
		if (!isSelectedColumnActive()) return
		await cb(getProgramChannel(), dashboardCasparLayer(selection.layerIdx))
	}

	function renderEmpty() {
		if (isPixelMapTabActive()) {
			renderFixtureInspector(root, redrawDmxCanvas)
			return
		}
		root.innerHTML = '<p class="inspector-empty">Select an item</p>'
	}

	const clipInspectorDeps = { root, sendAmcpIfActive }

	const sceneLayerDeps = {
		root,
		stateStore,
		renderEmpty,
		rerenderSceneLayer(sel) {
			renderSceneLayerInspector(sceneLayerDeps, sel)
		},
	}

	const layerApplyDeps = { stateStore, getResolutionForColumn }

	async function applyLayerSettingsBound(layerIdx, ls) {
		return applyLayerSettings(layerApplyDeps, layerIdx, ls)
	}

	function renderLayerSettingsInspectorBound(layerIdx) {
		renderLayerSettingsInspector({
			root,
			getResolution,
			applyLayerSettings: applyLayerSettingsBound,
			stateStore,
			getSelection: () => selection,
		}, layerIdx)
	}

	const multiviewDeps = { root, renderEmpty }

	function update(data) {
		selection = data
		if (isPixelMapTabActive()) {
			renderFixtureInspector(root, redrawDmxCanvas)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (!data) {
			renderEmpty()
			scheduleSelectionSync(stateStore, null)
			return
		}
		if (data.type === 'sceneLayer' && data.sceneId && data.layerIndex != null) {
			renderSceneLayerInspector(sceneLayerDeps, data)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'dashboard' && data.colIdx != null && data.layerIdx != null) {
			const cell = dashboardState.getCell(data.colIdx, data.layerIdx)
			if (cell?.source?.value) {
				renderClipInspector(clipInspectorDeps, data.colIdx, data.layerIdx, cell)
				scheduleSelectionSync(stateStore, selection)
				return
			}
		}
		if (data.type === 'dashboardLayer' && data.layerIdx != null) {
			renderLayerSettingsInspectorBound(data.layerIdx)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'multiview' && data.cellId) {
			renderMultiviewInspector(multiviewDeps, data.cellId)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'timelineClip' && data.timelineId && data.layerIdx != null && data.clipId && data.clip) {
			renderTimelineClipInspector(
				{ root, stateStore, getTimelinePlaybackPos: () => _timelinePlaybackPos },
				data.timelineId,
				data.layerIdx,
				data.clipId,
				data.clip,
			)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'timelineLayer' && data.timelineId && data.layerIdx != null) {
			renderTimelineLayerInspector(root, {
				timelineId: data.timelineId,
				layerIdx: data.layerIdx,
				layer: data.layer,
				syncTimelineToServer,
				renderEmpty,
			})
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'timelineFlag' && data.timelineId && data.flagId) {
			renderTimelineFlagInspector(
				{ root, renderEmpty, onClearSelection: () => update(null) },
				data.timelineId,
				data.flagId,
			)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		renderEmpty()
		scheduleSelectionSync(stateStore, selection)
	}

	window.addEventListener('dashboard-select', (e) => {
		const d = e.detail
		if (d && typeof d.colIdx === 'number' && typeof d.layerIdx === 'number') {
			update({ type: 'dashboard', colIdx: d.colIdx, layerIdx: d.layerIdx })
		} else if (!d) {
			if (selection?.type === 'dashboard') update(null)
		}
	})

	window.addEventListener('timeline-flag-select', (e) => {
		const d = e.detail
		if (d?.timelineId && d?.flagId) {
			update({ type: 'timelineFlag', timelineId: d.timelineId, flagId: d.flagId })
		} else if (!d) {
			if (selection?.type === 'timelineFlag') update(null)
		}
	})

	window.addEventListener('timeline-clip-select', (e) => {
		const d = e.detail
		if (d && d.timelineId && typeof d.layerIdx === 'number' && d.clipId && d.clip) {
			update({ type: 'timelineClip', timelineId: d.timelineId, layerIdx: d.layerIdx, clipId: d.clipId, clip: d.clip })
		} else if (!d) {
			if (selection?.type === 'timelineClip') update(null)
		}
	})

	window.addEventListener('dashboard-layer-select', (e) => {
		const d = e.detail
		if (d && typeof d.layerIdx === 'number') {
			update({ type: 'dashboardLayer', layerIdx: d.layerIdx })
		}
	})

	window.addEventListener('scene-layer-select', (e) => {
		const d = e.detail
		if (d && d.sceneId != null && String(d.sceneId) !== '') {
			const raw = d.layerIndex
			if (raw != null && raw !== '') {
				const li = typeof raw === 'number' ? raw : Number(raw)
				if (Number.isFinite(li) && li >= 0) {
					update({
						type: 'sceneLayer',
						sceneId: d.sceneId,
						layerIndex: Math.floor(li),
						layer: d.layer,
					})
					return
				}
			}
		}
		if (d == null) {
			if (selection?.type === 'sceneLayer') update(null)
		}
	})

	window.addEventListener('timeline-layer-select', (e) => {
		const d = e.detail
		if (d && d.timelineId && typeof d.layerIdx === 'number') {
			update({ type: 'timelineLayer', timelineId: d.timelineId, layerIdx: d.layerIdx, layer: d.layer })
		}
	})

	function onMultiviewSelect(e) {
		const d = e?.detail
		if (d?.cellId) update({ type: 'multiview', cellId: d.cellId })
		else update(null)
	}
	window.addEventListener('multiview-select', onMultiviewSelect)
	document.addEventListener('multiview-select', onMultiviewSelect, true)

	multiviewState.on('change', () => {
		if (selection?.type === 'multiview' && selection.cellId) {
			renderMultiviewInspector(multiviewDeps, selection.cellId)
			scheduleSelectionSync(stateStore, selection)
		}
	})

	const timelineClipInspectorDeps = { root, stateStore, getTimelinePlaybackPos: () => _timelinePlaybackPos }

	timelineState.on('change', () => {
		if (selection?.type === 'timelineFlag') {
			const tl = timelineState.getTimeline(selection.timelineId)
			const f = tl?.flags?.find((x) => x.id === selection.flagId)
			if (f) {
				renderTimelineFlagInspector(
					{ root, renderEmpty, onClearSelection: () => update(null) },
					selection.timelineId,
					selection.flagId,
				)
			} else update(null)
		}
		if (selection?.type === 'timelineClip' && selection.timelineId && selection.clipId != null) {
			const tl = timelineState.getTimeline(selection.timelineId)
			const layer = tl?.layers?.[selection.layerIdx]
			const c = layer?.clips?.find((x) => x.id === selection.clipId)
			if (c) {
				renderTimelineClipInspector(
					timelineClipInspectorDeps,
					selection.timelineId,
					selection.layerIdx,
					selection.clipId,
					c,
				)
			} else update(null)
		}
	})

	dashboardState.on('change', () => {
		if (selection?.type === 'dashboard') {
			const cell = dashboardState.getCell(selection.colIdx, selection.layerIdx)
			if (cell?.source?.value) renderClipInspector(clipInspectorDeps, selection.colIdx, selection.layerIdx, cell)
		} else if (selection?.type === 'dashboardLayer') {
			renderLayerSettingsInspectorBound(selection.layerIdx)
		}
	})

	dashboardState.on('activeColumn', () => {
		if (selection?.type === 'dashboard') {
			const cell = dashboardState.getCell(selection.colIdx, selection.layerIdx)
			if (cell?.source?.value) renderClipInspector(clipInspectorDeps, selection.colIdx, selection.layerIdx, cell)
		}
	})

	dashboardState.on('layerSettingChange', (idx) => {
		if (selection?.type === 'dashboardLayer' && selection.layerIdx === idx) {
			renderLayerSettingsInspectorBound(idx)
			scheduleSelectionSync(stateStore, selection)
		}
	})

	let sceneInspectorRefreshTimer = null
	function refreshSceneLayerInspectorFromState() {
		if (selection?.type !== 'sceneLayer') return
		const L = sceneState.getScene(selection.sceneId)?.layers?.[selection.layerIndex]
		if (L) renderSceneLayerInspector(sceneLayerDeps, selection)
		else update(null)
	}
	function scheduleSceneLayerInspectorRefresh() {
		clearTimeout(sceneInspectorRefreshTimer)
		sceneInspectorRefreshTimer = setTimeout(() => {
			sceneInspectorRefreshTimer = null
			if (window.__hacgSuppressSceneLayerInspectorRefresh) return
			refreshSceneLayerInspectorFromState()
		}, 120)
	}
	sceneState.on('change', refreshSceneLayerInspectorFromState)
	sceneState.on('softChange', scheduleSceneLayerInspectorRefresh)

	function refreshInspectorAfterAudioSettings() {
		if (!selection) return
		if (selection.type === 'sceneLayer') refreshSceneLayerInspectorFromState()
		else if (selection.type === 'dashboardLayer') renderLayerSettingsInspectorBound(selection.layerIdx)
		else if (selection.type === 'timelineClip' && selection.timelineId && selection.clipId) {
			const tl = timelineState.getTimeline(selection.timelineId)
			const layer = tl?.layers?.[selection.layerIdx]
			const c = layer?.clips?.find((x) => x.id === selection.clipId)
			if (c) {
				renderTimelineClipInspector(
					timelineClipInspectorDeps,
					selection.timelineId,
					selection.layerIdx,
					selection.clipId,
					c,
				)
			}
		}
	}
	document.addEventListener('highascg-settings-applied', refreshInspectorAfterAudioSettings)
	settingsState.subscribe(() => refreshInspectorAfterAudioSettings())

	document.querySelectorAll('.workspace__tabs .tab').forEach((tab) => {
		tab.addEventListener('click', () => {
			requestAnimationFrame(() => {
				if (isPixelMapTabActive()) renderFixtureInspector(root, redrawDmxCanvas)
				else update(selection)
			})
		})
	})

	dmxState.on('selection', () => {
		if (isPixelMapTabActive()) renderFixtureInspector(root, redrawDmxCanvas)
	})

	renderEmpty()
	scheduleSelectionSync(stateStore, null)
}

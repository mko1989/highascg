/** Inspector panel — selected item properties. @see main_plan.md Prompt 14 */

import { sceneState } from '../lib/scene-state.js'
import { api } from '../lib/api-client.js'
import { multiviewState } from '../lib/multiview-state.js'
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
import { renderSceneLayerInspector, renderMultiviewInspector, renderSceneInspector, renderGlobalBorderInspector } from './inspector-panel-views.js'
import { renderLayerPresetsMode, renderLookPresetsMode } from './inspector-panel-presets-modes.js'
import { renderLiveAudioInputInspector } from './inspector-live-audio-input.js'
import { renderWebpageHostInspector } from './inspector-webpage-host.js'
import { renderPreservingFocus } from './device-view-ui-utils.js'

const INSPECTOR_MODE_STORAGE = 'hacg_inspector_panel_mode'
const INSPECTOR_MODES = new Set(['inspector', 'layerPresets', 'lookPresets'])

function readInspectorPanelMode() {
	try {
		const m = sessionStorage.getItem(INSPECTOR_MODE_STORAGE)
		if (m && INSPECTOR_MODES.has(m)) return m
	} catch {
		/* ignore */
	}
	return 'inspector'
}

function writeInspectorPanelMode(m) {
	try {
		sessionStorage.setItem(INSPECTOR_MODE_STORAGE, m)
	} catch {
		/* ignore */
	}
}

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
	let panelMode = readInspectorPanelMode()
	let _timelinePlaybackPos = 0
	stateStore.on('timeline.tick', (data) => {
		if (data?.position != null) _timelinePlaybackPos = data.position
		if (selection?.type === 'timelineClip') scheduleSelectionSync(stateStore, selection)
	})
	stateStore.on('timeline.playback', (pb) => {
		if (pb?.position != null) _timelinePlaybackPos = pb.position
		if (selection?.type === 'timelineClip') scheduleSelectionSync(stateStore, selection)
	})

	function renderEmpty() {
		if (isPixelMapTabActive()) {
			renderFixtureInspector(root, redrawDmxCanvas)
			return
		}
		root.innerHTML = '<p class="inspector-empty">Select an item</p>'
	}

	const sceneLayerDeps = {
		root,
		stateStore,
		renderEmpty,
		rerenderSceneLayer(sel) {
			renderSceneLayerInspector(sceneLayerDeps, sel)
		},
	}

	const multiviewDeps = { root, renderEmpty, stateStore }

	function syncInspectorModeTabs() {
		document.querySelectorAll('#panel-inspector [data-inspector-mode]').forEach((btn) => {
			const m = btn.getAttribute('data-inspector-mode')
			if (!m) return
			const on = m === panelMode
			btn.classList.toggle('panel-inspector-mode--active', on)
			btn.setAttribute('aria-selected', on ? 'true' : 'false')
		})
	}

	function inspectorSelectionKey(data) {
		if (!data) return ''
		switch (data.type) {
			case 'timelineClip':
				return `timelineClip:${data.timelineId}:${data.clipId}`
			case 'timelineLayer':
				return `timelineLayer:${data.timelineId}:${data.layerIdx}`
			case 'timelineFlag':
				return `timelineFlag:${data.timelineId}:${data.flagId}`
			case 'sceneLayer':
				return `sceneLayer:${data.sceneId}:${data.layerIndex}`
			case 'scene':
				return `scene:${data.sceneId}`
			case 'multiview':
				return `multiview:${data.cellId}`
			case 'globalBorder':
				return `globalBorder:${data.screenIndex}`
			case 'liveAudioInput':
				return `liveAudioInput:${data.slot}`
			case 'webpageHost':
				return `webpageHost:${data.sourceId || data.value || data.hostChannel || ''}`
			default:
				return String(data.type || '')
		}
	}

	let _lastInspectorSelectionKey = ''

	function renderSelectionInspector() {
		const data = selection
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
		if (data.type === 'scene' && data.sceneId) {
			renderSceneInspector(root, data.sceneId)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'sceneLayer' && data.sceneId && data.layerIndex != null) {
			renderSceneLayerInspector(sceneLayerDeps, data)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'multiview' && data.cellId) {
			renderMultiviewInspector(multiviewDeps, data.cellId)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'globalBorder' && data.screenIndex != null) {
			renderGlobalBorderInspector(root, data.screenIndex, stateStore)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'liveAudioInput' && data.slot != null) {
			renderLiveAudioInputInspector(root, stateStore, data, { onClearSelection: () => update(null) })
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'webpageHost') {
			renderWebpageHostInspector(root, stateStore, data)
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

		// Allow detachable optional modules to render their own inspectors
		const evt = new CustomEvent('highascg-inspector-render-external', { detail: { root, selection, handled: false } })
		window.dispatchEvent(evt)
		if (evt.detail.handled) {
			scheduleSelectionSync(stateStore, selection)
			return
		}

		renderEmpty()
		scheduleSelectionSync(stateStore, selection)
	}

	function redrawInspectorContent() {
		const selKey = inspectorSelectionKey(selection)
		const entityChanged = selKey !== _lastInspectorSelectionKey
		_lastInspectorSelectionKey = selKey

		const draw = () => {
			syncInspectorModeTabs()
			if (panelMode === 'layerPresets') {
				renderLayerPresetsMode(root, {
					getSelection: () => selection,
					onSceneRefresh: () => redrawInspectorContent(),
				})
				scheduleSelectionSync(stateStore, selection)
				return
			}
			if (panelMode === 'lookPresets') {
				renderLookPresetsMode(root, { onSceneRefresh: () => redrawInspectorContent() })
				scheduleSelectionSync(stateStore, selection)
				return
			}
			renderSelectionInspector()
		}

		if (entityChanged) {
			draw()
		} else {
			renderPreservingFocus(root, draw)
		}
	}

	function update(data) {
		selection = data
		// Any concrete selection should bring the panel back to Inspector mode.
		if (selection && panelMode !== 'inspector') {
			panelMode = 'inspector'
			writeInspectorPanelMode(panelMode)
		}
		redrawInspectorContent()
	}

	document.querySelectorAll('#panel-inspector [data-inspector-mode]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const m = btn.getAttribute('data-inspector-mode')
			if (!m || m === panelMode) return
			panelMode = m
			writeInspectorPanelMode(m)
			redrawInspectorContent()
		})
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
	
	window.addEventListener('scene-select', (e) => {
		const d = e.detail
		if (d && d.sceneId) {
			update({ type: 'scene', sceneId: d.sceneId })
		}
	})

	window.addEventListener('global-border-select', (e) => {
		const d = e.detail
		if (d && d.screenIndex != null) {
			update({ type: 'globalBorder', screenIndex: d.screenIndex })
		}
	})

	window.addEventListener('global-border-state-changed', () => {
		if (selection?.type === 'globalBorder' && selection.screenIndex != null) {
			renderGlobalBorderInspector(root, selection.screenIndex, stateStore)
		}
	})

	window.addEventListener('live-audio-input-select', (e) => {
		const d = e.detail
		if (d && d.slot != null) {
			const s = parseInt(String(d.slot), 10)
			if (Number.isFinite(s) && s >= 1) {
				update({ type: 'liveAudioInput', slot: Math.floor(s) })
				return
			}
		}
		if (d == null) {
			if (selection?.type === 'liveAudioInput') update(null)
		}
	})

	window.addEventListener('webpage-host-select', (e) => {
		const d = e.detail
		if (d && (d.sourceId || d.value || d.hostChannel != null)) {
			update({
				type: 'webpageHost',
				sourceId: d.sourceId,
				value: d.value,
				hostChannel: d.hostChannel,
			})
			return
		}
		if (d == null) {
			if (selection?.type === 'webpageHost') update(null)
		}
	})

	stateStore.on('extraLiveSources', () => {
		if (panelMode !== 'inspector' || selection?.type !== 'webpageHost') return
		if (root.querySelector('.inspector-webpage-host__url:focus')) return
		renderWebpageHostInspector(root, stateStore, selection)
	})

	// Art-Net live updates: throttled, no sceneState `change`, skip while typing in inspector.
	window.addEventListener('global-border-artnet', (e) => {
		if (selection?.type !== 'globalBorder' || selection.screenIndex == null) return
		const indices = e.detail?.screenIndices
		if (Array.isArray(indices) && !indices.includes(selection.screenIndex)) return
		if (root.querySelector('input:focus, select:focus, textarea:focus')) return
		renderGlobalBorderInspector(root, selection.screenIndex, stateStore)
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
		if (panelMode !== 'inspector') return
		if (selection?.type === 'multiview' && selection.cellId) {
			renderMultiviewInspector(multiviewDeps, selection.cellId)
			scheduleSelectionSync(stateStore, selection)
		}
	})

	const timelineClipInspectorDeps = { root, stateStore, getTimelinePlaybackPos: () => _timelinePlaybackPos }

	timelineState.on('change', () => {
		if (panelMode !== 'inspector') return
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

	let sceneInspectorRefreshTimer = null
	function scheduleSceneLayerInspectorRefresh() {
		clearTimeout(sceneInspectorRefreshTimer)
		sceneInspectorRefreshTimer = setTimeout(() => {
			sceneInspectorRefreshTimer = null
			if (window.__hacgSuppressSceneLayerInspectorRefresh) return
			if (panelMode !== 'inspector' || selection?.type !== 'sceneLayer') return
			if (root.querySelector('input:focus, select:focus, textarea:focus')) return
			const L = sceneState.getScene(selection.sceneId)?.layers?.[selection.layerIndex]
			if (L) renderSceneLayerInspector(sceneLayerDeps, selection)
			else update(null)
		}, 120)
	}
	sceneState.on('change', () => {
		if (panelMode === 'layerPresets' || panelMode === 'lookPresets') {
			redrawInspectorContent()
			return
		}
		if (selection?.type === 'sceneLayer') {
			if (root.querySelector('input:focus, select:focus, textarea:focus')) return
			const L = sceneState.getScene(selection.sceneId)?.layers?.[selection.layerIndex]
			if (L) renderSceneLayerInspector(sceneLayerDeps, selection)
			else update(null)
		}
	})
	sceneState.on('softChange', scheduleSceneLayerInspectorRefresh)

	function refreshInspectorAfterAudioSettings() {
		if (!selection) return
		if (panelMode !== 'inspector') return
		if (selection.type === 'sceneLayer') {
			const L = sceneState.getScene(selection.sceneId)?.layers?.[selection.layerIndex]
			if (L) renderSceneLayerInspector(sceneLayerDeps, selection)
		} else if (selection.type === 'timelineClip' && selection.timelineId && selection.clipId) {
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
	document.addEventListener('highascg-editor-defaults-changed', refreshInspectorAfterAudioSettings)
	settingsState.subscribe(() => refreshInspectorAfterAudioSettings())

	document.querySelectorAll('.workspace__tabs .tab').forEach((tab) => {
		tab.addEventListener('click', () => {
			requestAnimationFrame(() => {
				redrawInspectorContent()
			})
		})
	})

	window.addEventListener('highascg-inspector-redraw', () => {
		redrawInspectorContent()
	})

	window.addEventListener('highascg-workspace-tab-activated', () => {
		redrawInspectorContent()
	})

	dmxState.on('selection', () => {
		redrawInspectorContent()
	})

	redrawInspectorContent()
}

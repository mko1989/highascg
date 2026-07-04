/**
 * Inspector panel selection routing — which sub-inspector mounts for selection type.
 */

import { scheduleSelectionSync } from '../lib/selection-sync.js'
import { renderTimelineLayerInspector } from './inspector-mixer.js'
import {
	syncTimelineToServer,
	renderTimelineFlagInspector,
	renderTimelineClipInspector,
} from './inspector-panel-timeline.js'
import {
	renderSceneLayerInspector,
	renderMultiviewInspector,
	renderSceneInspector,
	renderGlobalBorderInspector,
} from './inspector-panel-views.js'
import { renderLiveAudioInputInspector } from './inspector-live-audio-input.js'
import { renderWebpageHostInspector } from './inspector-webpage-host.js'
import { renderFixtureInspector } from './fixture-inspector.js'

/**
 * @param {object} ctx
 * @param {() => object|null} ctx.getSelection
 * @param {object} ctx.stateStore
 * @param {HTMLElement} ctx.root
 * @param {() => void} ctx.renderEmpty
 * @param {object} ctx.sceneLayerDeps
 * @param {object} ctx.multiviewDeps
 * @param {() => number} ctx.getTimelinePlaybackPos
 * @param {(data: object|null) => void} ctx.onClearSelection
 * @param {() => void} ctx.redrawDmxCanvas
 */
export function renderInspectorSelection(ctx) {
	const {
		getSelection,
		stateStore,
		root,
		renderEmpty,
		sceneLayerDeps,
		multiviewDeps,
		getTimelinePlaybackPos,
		onClearSelection,
		isPixelMapTabActive,
		redrawDmxCanvas,
	} = ctx
	const data = getSelection()
	const selection = data

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
		renderLiveAudioInputInspector(root, stateStore, data, { onClearSelection })
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
			{ root, stateStore, getTimelinePlaybackPos },
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
			{ root, renderEmpty, onClearSelection },
			data.timelineId,
			data.flagId,
		)
		scheduleSelectionSync(stateStore, selection)
		return
	}

	const evt = new CustomEvent('highascg-inspector-render-external', { detail: { root, selection, handled: false } })
	window.dispatchEvent(evt)
	if (evt.detail.handled) {
		scheduleSelectionSync(stateStore, selection)
		return
	}

	renderEmpty()
	scheduleSelectionSync(stateStore, selection)
}

export function inspectorSelectionKey(data) {
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

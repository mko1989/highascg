/**
 * WebSocket event handlers for the main app.
 */
import { consumeSkipRemoteProjectSync } from './project-remote-sync.js'
import { loadDeferredCatalogOverWs } from './deferred-catalog-ws.js'
import { applyRemoteGlobalBordersArray } from './scene-state-global-border.js'
import {
	ingestArtnetGlobalBorderSync,
	ingestArtnetGlobalBordersArray,
} from './global-border-artnet-ws.js'
import {
	bootstrapStreamingChannelStatus,
	clearStreamingChannelStatus,
	ingestStreamingChannelChange,
	ingestStreamingChannelWsEvent,
} from './streaming-channel-state.js'
import {
	ingestComposePreviewWs,
	syncComposePreviewBlocklist,
	syncComposePreviewClientChannels,
	syncComposePreviewFromChannelMap,
} from '../components/preview-canvas-compose-snapshot.js'
import { resolveComposePreviewChannelsFromChannelMap } from './compose-preview-url.js'
import { applySharedLayoutBroadcast } from './operator-gui-mode.js'
import { invalidateCompanionFlagThumbs } from './companion-button-preview-url.js'
import { showAppToast } from './app-toast.js'
import { isLayerRecentlyEdited } from './scene-state-layer-logic.js'

/** WO-213: Track previous sceneId per channel to detect PRV rewrites. */
let prevLiveSceneIdByChannel = {}
/* WO-329B: last "remote sync" toast — imports apply every time, the toast is rate-limited. */
let lastProjectSyncToastAt = 0

/**
 * WO-213: When any PRV channel's live sceneId changes, the server has rewritten that PRV channel.
 * Dispatch an event to invalidate the client's preview snapshot cache so subsequent edits take the ADD path.
 * @param {Object.<string, { sceneId?: string }>} liveMap
 * @param {Object} channelMap
 */
export function maybeInvalidatePreviewOnLiveChange(liveMap, channelMap) {
	if (!liveMap || !channelMap) return
	const previewChannels = channelMap.previewChannels || []
	let shouldInvalidate = false

	for (const [channelStr, entry] of Object.entries(liveMap)) {
		const chNum = Number(channelStr)
		const isPreviewChannel = previewChannels.includes(chNum)
		const prevSceneId = prevLiveSceneIdByChannel[channelStr]
		const curSceneId = entry?.sceneId

		if (isPreviewChannel && prevSceneId !== curSceneId) {
			shouldInvalidate = true
		}
		// Always update tracking, whether preview or not
		if (curSceneId !== undefined) {
			prevLiveSceneIdByChannel[channelStr] = curSceneId
		}
	}

	// FIX-2 (2026-07-15 review, WO-213 finding 2): the live map is always sent in full, so a
	// tracked channel key that's absent from this payload means the server deleted that
	// channel's live entry (e.g. an explicit preview clear). Reset its tracked sceneId to a
	// sentinel that can never equal a real sceneId, so a later clear-then-restage with the
	// SAME sceneId still compares as changed instead of skipping invalidation.
	for (const channelStr of Object.keys(prevLiveSceneIdByChannel)) {
		if (!Object.prototype.hasOwnProperty.call(liveMap, channelStr)) {
			prevLiveSceneIdByChannel[channelStr] = null
		}
	}

	if (shouldInvalidate && typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent('scenes-preview-invalidate'))
	}
}

/**
 * @param {unknown} data
 * @param {{ sceneState: object, programOutputState: object, appLogic: object }} ctx
 */
function applyWsStateSideEffects(data, { sceneState, programOutputState, appLogic }) {
	if (!data || typeof data !== 'object') return
	if (data.channelMap?.programResolutions) {
		sceneState.setCanvasResolutions(data.channelMap.programResolutions)
		programOutputState?.setCanvasResolutions?.(data.channelMap.programResolutions)
	}
	appLogic.syncMultiviewCanvas(data.channelMap)
	appLogic.scheduleMultiviewRefresh()
	appLogic.emitCasparConnectedIfNeeded(data)
	if (data.scene?.live) {
		maybeInvalidatePreviewOnLiveChange(data.scene.live, data.channelMap)
		sceneState.applyServerLiveChannels(data.scene.live, data.channelMap)
	}
	if (Array.isArray(data.scene?.globalBorders)) {
		applyRemoteGlobalBordersArray(sceneState, data.scene.globalBorders, { source: 'project' })
	}
	appLogic.updateStatus(true, null)
	appLogic.refreshStatusLine()
	appLogic.refreshEye()
}

export function attachWsHandlers(ws, { stateStore, sceneState, timelineState, multiviewState, programOutputState, projectState, dmxState, variableStore, appLogic }) {
	ws.on('variable_update', (changed) => {
		if (!changed || typeof changed !== 'object') return
		const cur = stateStore.getState()?.variables
		stateStore.applyChange('variables', { ...(cur && typeof cur === 'object' ? cur : {}), ...changed })
	})

	ws.on('state', (data) => {
		stateStore.setState(data)
		applyWsStateSideEffects(data, { sceneState, programOutputState, appLogic })
		if (data?.channelMap) {
			syncComposePreviewFromChannelMap(data.channelMap)
		}
		if (data?.composePreview?.blocklist) {
			// Bootstrap the WO-144 badge on connect/reconnect (WO-159 T159.2).
			syncComposePreviewBlocklist(data.composePreview.blocklist)
		}
		if (data?.catalogDeferred) {
			void loadDeferredCatalogOverWs(ws, stateStore, (full) =>
				applyWsStateSideEffects(full, { sceneState, programOutputState, appLogic }),
			)
		}
	})

	ws.on('dmx:colors', (data) => dmxState.setLiveColors(data))

	ws.on('change', (data) => {
		if (!data || data.path == null) return
		stateStore.applyChange(data.path, data.value)
		ingestStreamingChannelChange(data.path, data.value)
		if (data.path === 'scene.live' && data.value) {
			maybeInvalidatePreviewOnLiveChange(data.value, stateStore.getState()?.channelMap)
			sceneState.applyServerLiveChannels(data.value, stateStore.getState()?.channelMap)
		}
		if (data.path === 'scene.globalBorders' && Array.isArray(data.value)) {
			ingestArtnetGlobalBordersArray(sceneState, data.value)
		}
		if (data.path === 'channelMap') {
			if (data.value?.programResolutions) {
				sceneState.setCanvasResolutions(data.value.programResolutions)
				programOutputState?.setCanvasResolutions?.(data.value.programResolutions)
			}
			const cm = data.value
			if (cm) {
				syncComposePreviewClientChannels(resolveComposePreviewChannelsFromChannelMap(cm))
			}
			appLogic.scheduleMultiviewRefresh()
		}
		if (data.path === 'caspar.connection') {
			appLogic.scheduleMultiviewRefresh()
			appLogic.emitCasparConnectedIfNeeded(stateStore.getState())
		}
		if (data.path === 'caspar.connection' || String(data.path || '').startsWith('caspar.') || data.path === 'configComparison') {
			appLogic.refreshStatusLine(); appLogic.refreshEye()
		}
	})

	ws.on('timeline.tick', (data) => stateStore.applyChange('timeline.tick', data))
	ws.on('timeline.playback', (pb) => stateStore.applyChange('timeline.playback', pb))

	ws.on('streaming_channel', (data) => ingestStreamingChannelWsEvent(data))

	ws.on('compose.preview', (data) => ingestComposePreviewWs(data))

	// WO-319: the shared operator compose layout changed (any client moved a window) — re-sync tiles.
	ws.on('operatorGuiLayout', (data) => applySharedLayoutBroadcast(data?.cells))

	ws.on('companion.buttonPreview', (data) => {
		invalidateCompanionFlagThumbs()
		try {
			window.dispatchEvent(new CustomEvent('companion-button-preview', { detail: data }))
		} catch { /* non-browser */ }
	})

	ws.on('global_border_sync', (data) => {
		ingestArtnetGlobalBorderSync(sceneState, data)
	})

	ws.on('lower-third.state', (data) => {
		try {
			window.dispatchEvent(new CustomEvent('highascg-lower-third-state', { detail: data }))
		} catch { /* non-browser */ }
	})

	ws.on('project_sync', (project) => {
		if (!project || project.error || !project.version || consumeSkipRemoteProjectSync()) return
		try {
			projectState.importProject(project, sceneState, timelineState, multiviewState, programOutputState, { silent: true })
			window.dispatchEvent(new Event('project-loaded'))
			/* WO-329B: autosaves now broadcast too, so during active remote editing this fires
			 * every ~3s — throttle the toast (the import itself always applies). */
			const now = Date.now()
			if (now - lastProjectSyncToastAt > 10000) {
				lastProjectSyncToastAt = now
				showAppToast('Show file updated from server (remote sync)', 'warn')
			}
		} catch (e) {
			console.warn('[HighAsCG] project_sync failed:', e.message)
		}
	})

	ws.on('mixer_update', (data) => {
		const { lookId, layerIdx, updatedValues } = data
		const sc = sceneState.getScene(lookId)
		const L = sc?.layers?.[layerIdx]
		if (L) {
			// WO-177: whitelist-based approach. Apply ONLY keys the mixer_update emitter legitimately sends
			// (from src/api/routes-mixer-inspector.js:213). Prevents echo from stomping structural fields
			// (pipOverlays, effects, source, globalBorder, transition, audioRoute, etc).
			const mixerUpdateWhitelist = ['opacity', 'x', 'y', 'scaleX', 'scaleY']
			const fillProps = ['x', 'y', 'scaleX', 'scaleY']

			// Guard against stomping recent local edits (WO-177 T177.2).
			const recentEdit = isLayerRecentlyEdited(L)

			// Apply fill props to L.fill
			const hasFill = Object.keys(updatedValues).some(k => fillProps.includes(k))
			if (hasFill && !recentEdit) {
				if (!L.fill) L.fill = {}
				for (const k of fillProps) {
					if (updatedValues[k] !== undefined) L.fill[k] = updatedValues[k]
				}
			}

			// Apply whitelisted non-fill keys (currently just opacity)
			for (const k of mixerUpdateWhitelist) {
				if (!fillProps.includes(k) && updatedValues[k] !== undefined && !recentEdit) {
					L[k] = updatedValues[k]
				}
			}

			sceneState._emit('softChange')
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		}
	})

	ws.on('gpu_topology_changed', () => {
		try {
			window.dispatchEvent(new Event('highascg-device-view-reload'))
		} catch { /* non-browser */ }
	})

	ws.on('connect', () => {
		appLogic.updateStatus(true, null); appLogic.refreshEye()
		appLogic.scheduleMultiviewRefresh()
		appLogic.onConnect()
		void bootstrapStreamingChannelStatus()
	})

	ws.on('disconnect', async () => {
		clearStreamingChannelStatus()
		return appLogic.handleWsDisconnect('Disconnected')
	})
	ws.on('error', async () => appLogic.handleWsDisconnect('WebSocket error'))
}

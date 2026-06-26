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
	if (data.scene?.live) sceneState.applyServerLiveChannels(data.scene.live, data.channelMap)
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
		if (data.path === 'scene.live' && data.value) sceneState.applyServerLiveChannels(data.value, stateStore.getState()?.channelMap)
		if (data.path === 'scene.globalBorders' && Array.isArray(data.value)) {
			ingestArtnetGlobalBordersArray(sceneState, data.value)
		}
		if (data.path === 'channelMap') {
			if (data.value?.programResolutions) {
				sceneState.setCanvasResolutions(data.value.programResolutions)
				programOutputState?.setCanvasResolutions?.(data.value.programResolutions)
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
		} catch (e) { console.warn('[HighAsCG] project_sync failed:', e.message) }
	})

	ws.on('mixer_update', (data) => {
		const { lookId, layerIdx, updatedValues } = data
		const sc = sceneState.getScene(lookId)
		const L = sc?.layers?.[layerIdx]
		if (L) {
			const fillProps = ['x', 'y', 'scaleX', 'scaleY']
			const hasFill = Object.keys(updatedValues).some(k => fillProps.includes(k))
			
			if (hasFill) {
				if (!L.fill) L.fill = {}
				for (const k of fillProps) {
					if (updatedValues[k] !== undefined) L.fill[k] = updatedValues[k]
				}
			}
			
			for (const [k, v] of Object.entries(updatedValues)) {
				if (!fillProps.includes(k)) {
					L[k] = v
				}
			}
			
			sceneState._emit('softChange')
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		}
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

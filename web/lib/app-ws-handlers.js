/**
 * WebSocket event handlers for the main app.
 */
import { consumeSkipRemoteProjectSync } from './project-remote-sync.js'

export function attachWsHandlers(ws, { stateStore, sceneState, timelineState, multiviewState, dashboardState, projectState, dmxState, variableStore, appLogic }) {
	ws.on('variable_update', (changed) => {
		if (!changed || typeof changed !== 'object') return
		const cur = stateStore.getState()?.variables
		stateStore.applyChange('variables', { ...(cur && typeof cur === 'object' ? cur : {}), ...changed })
	})

	ws.on('state', (data) => {
		stateStore.setState(data)
		if (data?.channelMap?.programResolutions) sceneState.setCanvasResolutions(data.channelMap.programResolutions)
		appLogic.syncMultiviewCanvas(data?.channelMap)
		appLogic.scheduleMultiviewRefresh()
		appLogic.emitCasparConnectedIfNeeded(data)
		if (data?.scene?.live) sceneState.applyServerLiveChannels(data.scene.live, data.channelMap)
		appLogic.updateStatus(true, null)
		appLogic.refreshStatusLine()
		appLogic.refreshEye()
	})

	ws.on('dmx:colors', (data) => dmxState.setLiveColors(data))

	ws.on('change', (data) => {
		if (!data || data.path == null) return
		stateStore.applyChange(data.path, data.value)
		if (data.path === 'scene.live' && data.value) sceneState.applyServerLiveChannels(data.value, stateStore.getState()?.channelMap)
		if (data.path === 'channelMap') {
			if (data.value?.programResolutions) sceneState.setCanvasResolutions(data.value.programResolutions)
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

	ws.on('project_sync', (project) => {
		if (!project || project.error || !project.version || consumeSkipRemoteProjectSync()) return
		try {
			projectState.importProject(project, sceneState, timelineState, multiviewState, dashboardState)
			window.dispatchEvent(new Event('project-loaded'))
		} catch (e) { console.warn('[HighAsCG] project_sync failed:', e.message) }
	})

	ws.on('connect', () => {
		appLogic.updateStatus(true, null); appLogic.refreshEye()
		appLogic.scheduleMultiviewRefresh(); appLogic.scheduleSceneDeckSync()
		appLogic.onConnect()
	})

	ws.on('disconnect', async () => appLogic.handleWsDisconnect('Disconnected'))
	ws.on('error', async () => appLogic.handleWsDisconnect('WebSocket error'))
}

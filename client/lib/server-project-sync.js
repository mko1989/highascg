/**
 * Server-first project sync — client adopts the playout server's running project on connect.
 * Outbound deck sync / autosave stay gated until bootstrap (or explicit Load) completes.
 */
import { api } from './api-client.js'
import { fetchProjectFromServer } from './project-load.js'
import { importProjectWithHardwareReconcile } from './project-import-flow.js'
import { normalizeGlobalBordersArray } from './scene-state-global-border.js'

let synced = false
let offlineMode = false
let resyncPromise = null
let lastSyncedAt = 0

export function setOfflineBootstrapMode(enabled) {
	offlineMode = !!enabled
	if (offlineMode) markServerProjectSynced()
}

export function isServerProjectSynced() {
	return synced || offlineMode
}

export function canPushProjectToServer() {
	return synced && !offlineMode
}

export function markServerProjectSynced() {
	synced = true
	lastSyncedAt = Date.now()
}

export function resetServerProjectSync() {
	synced = false
}

/**
 * Apply GET /api/state (or WS `state`) into client stores.
 * @param {object} state
 * @param {object} ctx
 */
export function applyServerRuntimeState(state, ctx) {
	const { stateStore, sceneState, programOutputState, appLogic, getVariableStore } = ctx
	if (!state || typeof state !== 'object') return
	stateStore.setState(state)
	if (state.variables) getVariableStore?.()?.mergeFromServer(state.variables)
	if (state.channelMap?.programResolutions) {
		sceneState.setCanvasResolutions(state.channelMap.programResolutions)
		programOutputState?.setCanvasResolutions?.(state.channelMap.programResolutions)
	}
	appLogic.syncMultiviewCanvas(state.channelMap)
	appLogic.scheduleMultiviewRefresh()
	appLogic.emitCasparConnectedIfNeeded(state)
	if (state.scene?.live) sceneState.applyServerLiveChannels(state.scene.live, state.channelMap)
	if (Array.isArray(state.scene?.globalBorders)) {
		sceneState.globalBorders = normalizeGlobalBordersArray(state.scene.globalBorders)
	}
}

/**
 * Fetch runtime state + active server project and hydrate the client.
 * @param {object} deps
 * @returns {Promise<object|null>} state snapshot when available
 */
export async function bootstrapFromServer(deps) {
	const {
		stateStore,
		sceneState,
		timelineState,
		multiviewState,
		programOutputState,
		projectState,
		getVariableStore,
		appLogic,
	} = deps

	let state = null
	try {
		state = await api.get('/api/state')
	} catch (e) {
		console.warn('[HighAsCG] GET /api/state failed:', e?.message || e)
	}

	if (state) {
		applyServerRuntimeState(state, {
			stateStore,
			sceneState,
			programOutputState,
			appLogic,
			getVariableStore,
		})
		appLogic.updateStatus?.(true)
		appLogic.refreshEye?.()
	}

	try {
		const project = await fetchProjectFromServer()
		if (project?.version) {
			await importProjectWithHardwareReconcile(project, {
				projectState,
				sceneState,
				timelineState,
				multiviewState,
				programOutputState,
				stateStore,
				source: deps.source || 'server-bootstrap',
			})
			markServerProjectSynced()
			appLogic.scheduleSceneDeckSync?.()
		}
	} catch (e) {
		console.warn('[HighAsCG] Server project load failed:', e?.message || e)
	}

	return state
}

/**
 * Re-read server state + project (e.g. after WebSocket reconnect).
 * @param {object} deps
 */
export async function resyncFromServer(deps) {
	if (offlineMode) return null
	if (resyncPromise) return resyncPromise
	resyncPromise = (async () => {
		try {
			resetServerProjectSync()
			return await bootstrapFromServer({ ...deps, source: 'server-reconnect' })
		} finally {
			resyncPromise = null
		}
	})()
	return resyncPromise
}

/** Skip immediate reconnect resync when bootstrap just finished. */
export function shouldResyncOnWsConnect() {
	return isServerProjectSynced() && Date.now() - lastSyncedAt > 2500
}

/**
 * Server-first project sync — client adopts the playout server's running project on connect.
 * Outbound deck sync / autosave stay gated until bootstrap (or explicit Load) completes.
 */
import { api } from './api-client.js'
import { fetchProjectFromServer } from './project-load.js'
import { importProjectWithHardwareReconcile } from './project-import-flow.js'
import { normalizeGlobalBordersArray } from './scene-state-global-border.js'
import { syncComposePreviewFromChannelMap } from '../components/preview-canvas-compose-snapshot.js'

let synced = false
let offlineMode = false
/** WO-311 latch: the server says this project is gone; stop pushing until the operator acts. */
let projectGone = false
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
	return synced && !offlineMode && !projectGone
}

/**
 * WO-311: the server refused an autosave because this project was deleted there (410
 * `project_gone`). Latch outbound pushes OFF — retrying would be an attempt to resurrect a
 * project someone deliberately trashed, which is exactly the bug. The operator must act:
 * Save As keeps their in-memory copy under a new slug, or a reload adopts the server's truth
 * (a fresh page re-imports this module, so the latch does not outlive the session).
 */
export function markProjectGoneOnServer() {
	projectGone = true
}

export function isProjectGoneOnServer() {
	return projectGone
}

/** Explicit operator action produced a real project again (Save As / Load). */
export function clearProjectGoneOnServer() {
	projectGone = false
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
	if (state.channelMap) {
		syncComposePreviewFromChannelMap(state.channelMap)
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
	let serverWasFresh = false
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
		} else if (!project || (typeof project === 'object' && !Object.keys(project).length)) {
			// Fresh server with no saved project yet — allow outbound sync.
			markServerProjectSynced()
			serverWasFresh = true
		} else {
			console.warn('[HighAsCG] Server project missing version — blocking push until reload')
		}
	} catch (e) {
		console.warn('[HighAsCG] Server project load failed:', e?.message || e)
	} finally {
		/* WO-341 kill #2: a resync/reconnect is NOT user interaction — adopt server state,
		 * never push back. The one legitimate push here is SEEDING a fresh server that has
		 * no project at all. */
		if (serverWasFresh && isServerProjectSynced()) {
			appLogic.scheduleSceneDeckSync?.()
		}
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

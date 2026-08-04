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
let bootstrapInFlight = false

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
 * Save / Save As keeps their in-memory copy, Load/New adopts or creates a real project — any
 * of those reaches markServerProjectSynced(), which is the single exit from this latch.
 */
export function markProjectGoneOnServer() {
	projectGone = true
}

export function isProjectGoneOnServer() {
	return projectGone
}

export function markServerProjectSynced() {
	synced = true
	lastSyncedAt = Date.now()
	/* Every caller of this is either an operator action that produced a real server project
	 * again (Save / Save As / Load / New project / file import) or an adoption of server truth
	 * (bootstrap / resync) — each is a legitimate exit from the WO-311 `project_gone` latch.
	 * Before this line the latch was permanent: an exported clear function existed but nothing
	 * called it, so one 410 killed autosave + deck sync for the rest of the kiosk session. */
	projectGone = false
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
	bootstrapInFlight = true
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
		bootstrapInFlight = false
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

/**
 * Resync on WS connect unless a bootstrap just finished (or is running right now).
 * The old gate was `synced && age > 2500` — inverted for the failure case: a client whose
 * bootstrap/resync FAILED (synced=false) never resynced again, leaving autosave + deck sync
 * silently off for the whole kiosk session (kiosk F5 during the node restart window hit this
 * every deploy). NOT-synced is exactly when a reconnect must retry.
 */
export function shouldResyncOnWsConnect() {
	if (offlineMode || bootstrapInFlight) return false
	if (!synced) return true
	return Date.now() - lastSyncedAt > 2500
}

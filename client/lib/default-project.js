/**
 * Default empty project — shared by New project, factory reset, and server bootstrap fallbacks.
 */
import { api } from './api-client.js'
import { fetchProjectFromServer } from './project-load.js'
import { defaultTransition } from './scene-state-helpers.js'
import { projectState } from './project-state.js'
import { sceneState } from './scene-state.js'
import { timelineState } from './timeline-state.js'
import { multiviewState } from './multiview-state.js'
import { programOutputState } from './program-output-state.js'
import { projectFileIdFromName } from './project-files.js'
import { markLocalProjectSaved } from './project-remote-sync.js'
import { markServerProjectSynced, resetServerProjectSync, applyServerRuntimeState } from './server-project-sync.js'
import { syncComposePreviewClientChannels } from '../components/preview-canvas-compose-snapshot.js'
import { getAppWs, getAppStateStore, getAppLogic, getAppVariableStore } from './app-runtime.js'
import { flushSceneDeckSync } from './app-scene-deck.js'
import { syncProjectMediaContextFromClient } from './project-media-context.js'
import { settingsState } from './settings-state.js'
import { placeholderState } from './placeholder-state.js'

export const DEFAULT_PROJECT_NAME = 'Untitled'
const PROJECT_VERSION = 2

/** @returns {object} Scene export blob for an empty deck. */
export function buildDefaultSceneExportData() {
	return {
		scenes: [],
		liveSceneId: null,
		previewSceneId: null,
		liveSceneIdByMain: [null, null, null, null],
		previewSceneIdByMain: [null, null, null, null],
		activeScreenIndex: 0,
		globalDefaultTransition: { ...defaultTransition() },
		mainEditorVisible: [true, false, false, false],
		layerPresets: [],
		lookPresets: [],
		globalBorders: [null, null, null, null],
	}
}

/** @returns {object} Full project JSON for an empty Untitled project. */
export function buildDefaultUntitledProject() {
	return {
		version: PROJECT_VERSION,
		name: DEFAULT_PROJECT_NAME,
		savedAt: new Date().toISOString(),
		scenes: buildDefaultSceneExportData(),
		timelines: { timelines: [], activeId: null },
		multiview: {
			cells: [],
			canvasWidth: 1920,
			canvasHeight: 1080,
			showOverlay: true,
			bgColor: '#000000',
			showTimersUnderLabels: false,
		},
		placeholders: [],
	}
}

/**
 * Replace in-memory project with empty Untitled (looks, timelines, multiview, program strip).
 * @param {{ silent?: boolean, emitLoaded?: boolean }} [opts]
 */
export function applyDefaultUntitledProjectLocally(opts = {}) {
	const { silent = false, emitLoaded = true } = opts
	projectState.setProjectName(DEFAULT_PROJECT_NAME)
	sceneState.loadFromData(buildDefaultSceneExportData(), { silent })
	sceneState.setEditingScene(null)
	timelineState.loadFromData({ timelines: [], activeId: null }, { silent })
	multiviewState.loadFromData(
		{
			cells: [],
			canvasWidth: 1920,
			canvasHeight: 1080,
			showOverlay: true,
			bgColor: '#000000',
			showTimersUnderLabels: false,
		},
		{ silent },
	)
	programOutputState.resetAllMainsForNewProject({ silent })
	placeholderState.loadFromData([])
	syncProjectMediaContextFromClient(settingsState.getSettings())
	if (emitLoaded) window.dispatchEvent(new Event('project-loaded'))
}

/** @param {string} message */
function isProjectSaveConflictError(message) {
	return /409|payload is older|save rejected/i.test(String(message || ''))
}

/** @param {unknown} project */
function isEmptyStoredProject(project) {
	if (!project || typeof project !== 'object') return false
	const scenes = /** @type {{ scenes?: unknown[] }} */ (project).scenes
	const list = Array.isArray(scenes) ? scenes : scenes && typeof scenes === 'object' ? scenes.scenes : null
	return Array.isArray(list) && list.length === 0
}

/**
 * POST /api/project/save — optional force bypasses server savedAt conflict checks (factory reset).
 * @param {object} project
 * @param {string} id
 * @param {{ force?: boolean }} [opts]
 */
async function postProjectSave(project, id, opts = {}) {
	project.savedAt = new Date().toISOString()
	const body = { project, id }
	if (opts.force) body.force = true
	try {
		await api.post('/api/project/save', body)
		return
	} catch (e) {
		if (!isProjectSaveConflictError(e?.message)) throw e
		if (opts.force) {
			try {
				const serverProject = await fetchProjectFromServer()
				if (isEmptyStoredProject(serverProject)) return
			} catch {
				/* fall through to forced save */
			}
		}
		project.savedAt = new Date().toISOString()
		await api.post('/api/project/save', { project, id, force: true })
	}
}

/**
 * Persist empty Untitled project to the playout server and sync deck metadata.
 * @param {{ silent?: boolean, force?: boolean }} [opts]
 * @returns {Promise<object>} saved project payload
 */
export async function saveDefaultUntitledProjectToServer(opts = {}) {
	const { silent = true, force = false } = opts
	applyDefaultUntitledProjectLocally({ silent, emitLoaded: false })
	const project = projectState.exportProject(sceneState, timelineState, multiviewState, programOutputState)
	project.name = DEFAULT_PROJECT_NAME
	const id = projectFileIdFromName(project.name)
	await postProjectSave(project, id, { force })
	markLocalProjectSaved()
	markServerProjectSynced()
	const appWs = getAppWs()
	if (appWs) flushSceneDeckSync(appWs, sceneState)
	window.dispatchEvent(new Event('project-loaded'))
	return project
}

/**
 * Factory reset: server config wipe + empty Untitled project (clears all looks).
 */
export async function performFactoryReset() {
	resetServerProjectSync()
	await api.post('/api/config/reset', { reset: true })
	await saveDefaultUntitledProjectToServer({ force: true })
}

/**
 * New project — empty show + starter routing (1× PGM) on server and client.
 * @param {{ showToast?: (msg: string, type?: string) => void }} [opts]
 * @returns {Promise<object>} saved project payload
 */
export async function startNewProject(opts = {}) {
	resetServerProjectSync()
	const res = await api.post('/api/project/new', {})
	if (!res?.ok || !res?.project) {
		throw new Error(res?.error || 'New project failed')
	}

	const project = res.project
	projectState.importProject(project, sceneState, timelineState, multiviewState, programOutputState, {
		silent: true,
	})
	sceneState.setEditingScene(null)
	programOutputState.resetAllMainsForNewProject({ silent: true })
	placeholderState.loadFromData([])

	await settingsState.load()
	document.dispatchEvent(new CustomEvent('highascg-settings-applied'))

	try {
		const state = await api.get('/api/state')
		const stateStore = getAppStateStore()
		const appLogic = getAppLogic()
		if (state && stateStore && appLogic) {
			applyServerRuntimeState(state, {
				stateStore,
				sceneState,
				programOutputState,
				appLogic,
				getVariableStore: () => getAppVariableStore(),
			})
		} else if (state?.channelMap?.programResolutions) {
			sceneState.setCanvasResolutions(state.channelMap.programResolutions)
			programOutputState.setCanvasResolutions(state.channelMap.programResolutions)
			if (stateStore) stateStore.applyChange('channelMap', state.channelMap)
		}
		if (state?.channelMap) {
			syncComposePreviewClientChannels([
				...(state.channelMap.programChannels || []),
				...(state.channelMap.previewChannels || []),
			])
		}
	} catch (e) {
		console.warn('[HighAsCG] GET /api/state after new project:', e?.message || e)
	}

	multiviewState.switchTo(1)
	document.dispatchEvent(new CustomEvent('highascg-device-view-reload'))

	markLocalProjectSaved()
	markServerProjectSynced()
	const appWs = getAppWs()
	if (appWs) flushSceneDeckSync(appWs, sceneState)
	syncProjectMediaContextFromClient(settingsState.getSettings())
	window.dispatchEvent(new Event('project-loaded'))
	opts.showToast?.('New project started', 'success')
	return project
}

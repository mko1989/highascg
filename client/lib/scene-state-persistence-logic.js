/**
 * Persistence logic for SceneState.
 */
import {
	defaultTransition,
	migrateScene,
} from './scene-state-helpers.js'
import { normalizeGlobalBordersArray } from './scene-state-global-border.js'

export const STORAGE_KEY_V1 = 'casparcg_scenes_v1'
export const STORAGE_KEY = 'casparcg_scenes_v2'
export const FALLBACK_RESOLUTION = { w: 1920, h: 1080, fps: 50 }

export function defaultMainEditorVisible() {
	return [true, true, true, true]
}

function normSceneIdSlot(v) {
	if (v == null || v === '') return null
	const s = String(v).trim()
	return s || null
}

export function normalizeMainSceneSlots(arr) {
	const out = [null, null, null, null]
	if (!Array.isArray(arr)) return out
	for (let i = 0; i < 4; i++) {
		out[i] = normSceneIdSlot(arr[i])
	}
	return out
}

export function getCanvasResolutionsEqual(a, b) {
	const la = a?.length ?? 0
	const lb = b?.length ?? 0
	if (la !== lb) return false
	if (la === 0) return true
	for (let i = 0; i < la; i++) {
		if (a[i].w !== b[i].w || a[i].h !== b[i].h || (a[i].fps ?? 50) !== (b[i].fps ?? 50)) return false
	}
	return true
}

export function applyPersistedData(state, data) {
	if (!data || !Array.isArray(data.scenes)) return false
	state.scenes = data.scenes.map((s) => migrateScene(s))
	const act = typeof data.activeScreenIndex === 'number' ? data.activeScreenIndex : 0
	state.liveSceneIdByMain = normalizeMainSceneSlots(data.liveSceneIdByMain)
	state.previewSceneIdByMain = normalizeMainSceneSlots(data.previewSceneIdByMain)
	
	if (!data.liveSceneIdByMain && data.liveSceneId != null) {
		state.liveSceneIdByMain[act] = normSceneIdSlot(data.liveSceneId)
	}
	if (!data.previewSceneIdByMain && data.previewSceneId != null) {
		state.previewSceneIdByMain[act] = normSceneIdSlot(data.previewSceneId)
	}
	state.activeScreenIndex = act
	
	if (data.globalDefaultTransition && typeof data.globalDefaultTransition === 'object') {
		state.globalDefaultTransition = { ...defaultTransition(), ...data.globalDefaultTransition }
	} else {
		state.globalDefaultTransition = { ...defaultTransition() }
	}
	
	if (Array.isArray(data.mainEditorVisible) && data.mainEditorVisible.length) {
		const d = defaultMainEditorVisible()
		for (let i = 0; i < 4; i++) {
			d[i] = data.mainEditorVisible[i] !== false
		}
		state.mainEditorVisible = d
	} else {
		state.mainEditorVisible = defaultMainEditorVisible()
	}
	
	if (Array.isArray(data.layerPresets)) {
		state.layerPresets = data.layerPresets
			.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.data && typeof p.data === 'object')
			.map((p) => ({ id: p.id, name: p.name, data: p.data }))
	} else {
		state.layerPresets = []
	}
	
	if (Array.isArray(data.lookPresets)) {
		const sk = (v) => (v === 'prv' || v === 'pgm' || v === 'editing' ? v : 'editing')
		state.lookPresets = data.lookPresets
			.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.sceneId === 'string' && state.getScene(p.sceneId))
			.map((p) => {
				const entry = {
					id: p.id,
					name: p.name,
					createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
					sceneId: p.sceneId,
					sourceKind: sk(p.sourceKind),
					targetMain: typeof p.targetMain === 'number' && p.targetMain >= 0 ? p.targetMain : 0,
				}
				return entry
			})
	} else {
		state.lookPresets = []
	}
	state.globalBorders = normalizeGlobalBordersArray(data.globalBorders)
	return true
}

export function getPersistPayload(state) {
	return JSON.stringify({
		scenes: state.scenes,
		liveSceneIdByMain: state.liveSceneIdByMain,
		previewSceneIdByMain: state.previewSceneIdByMain,
		liveSceneId: state.liveSceneId,
		previewSceneId: state.previewSceneId,
		activeScreenIndex: state.activeScreenIndex,
		globalDefaultTransition: state.globalDefaultTransition,
		mainEditorVisible: state.mainEditorVisible,
		layerPresets: state.layerPresets,
		lookPresets: state.lookPresets,
		globalBorders: state.globalBorders,
	})
}

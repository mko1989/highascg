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

/** @deprecated Legacy new-project default — only Screen 1 column visible. */
export const LEGACY_MAIN_EDITOR_VISIBLE = Object.freeze([true, false, false, false])

/**
 * @param {boolean[] | undefined} arr
 * @returns {boolean}
 */
export function isLegacyMainEditorVisible(arr) {
	if (!Array.isArray(arr) || arr.length < 4) return false
	return arr[0] === true && arr[1] === false && arr[2] === false && arr[3] === false
}

/**
 * Ensure each configured main has its look column visible (legacy projects hid screens 2–4).
 * @param {{ mainEditorVisible?: boolean[], mainEditorVisibleScreenCount?: number, mainEditorVisibilityMigrated?: boolean }} state
 * @param {number} screenCount
 * @returns {boolean} true when visibility array changed
 */
export function ensureMainEditorVisibleForScreenCount(state, screenCount) {
	const n = Math.max(1, Math.min(4, Number(screenCount) || 1))
	const d = [...(state.mainEditorVisible?.length ? state.mainEditorVisible : defaultMainEditorVisible())]
	while (d.length < 4) d.push(true)
	let changed = false

	const prevCount =
		typeof state.mainEditorVisibleScreenCount === 'number' && state.mainEditorVisibleScreenCount >= 1
			? Math.min(4, state.mainEditorVisibleScreenCount)
			: isLegacyMainEditorVisible(d)
				? 1
				: n

	if (!state.mainEditorVisibilityMigrated && isLegacyMainEditorVisible(d) && n > 1) {
		for (let i = 1; i < n; i++) {
			if (d[i] !== true) {
				d[i] = true
				changed = true
			}
		}
		state.mainEditorVisibilityMigrated = true
	}

	if (n > prevCount) {
		for (let i = prevCount; i < n; i++) {
			if (d[i] === false) {
				d[i] = true
				changed = true
			}
		}
	}

	state.mainEditorVisibleScreenCount = n

	if (changed) {
		state.mainEditorVisible = d.slice(0, 4)
	}
	return changed
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

	state.mainEditorVisibleScreenCount =
		typeof data.mainEditorVisibleScreenCount === 'number' && data.mainEditorVisibleScreenCount >= 1
			? Math.min(4, data.mainEditorVisibleScreenCount)
			: isLegacyMainEditorVisible(state.mainEditorVisible)
				? 1
				: state.mainEditorVisible.filter(Boolean).length || 1
	state.mainEditorVisibilityMigrated = data.mainEditorVisibilityMigrated === true
	
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
			.filter((p) => {
				if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') return false
				if (typeof p.sceneId === 'string' && state.getScene(p.sceneId)) return true
				// B150.4: multi-main presets stay valid when any item's look still exists.
				return Array.isArray(p.items) && p.items.some((it) => it && state.getScene(it.sceneId))
			})
			.map((p) => {
				const entry = {
					id: p.id,
					name: p.name,
					createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
					sceneId: typeof p.sceneId === 'string' ? p.sceneId : '',
					sourceKind: sk(p.sourceKind),
					targetMain: typeof p.targetMain === 'number' && p.targetMain >= 0 ? p.targetMain : 0,
				}
				// B150.4: keep per-main items — dropping them made overwrites of
				// multi-main presets silently revert to a single look after reload.
				if (Array.isArray(p.items) && p.items.length > 0) {
					entry.items = p.items
						.filter((it) => it && typeof it.sceneId === 'string')
						.map((it) => ({
							mainIdx: typeof it.mainIdx === 'number' && it.mainIdx >= 0 ? Math.floor(it.mainIdx) : 0,
							sceneId: String(it.sceneId),
							sourceKind: sk(it.sourceKind),
						}))
				}
				if (p.tandem != null && typeof p.tandem === 'object') entry.tandem = p.tandem
				return entry
			})
	} else {
		state.lookPresets = []
	}

	if (Array.isArray(data.timers)) {
		state.timers = data.timers
			.filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && t.config && typeof t.config === 'object')
			.map((t) => ({
				id: t.id,
				name: t.name,
				config: t.config,
				canonicalLayerByScreen: t.canonicalLayerByScreen && typeof t.canonicalLayerByScreen === 'object' ? t.canonicalLayerByScreen : {},
			}))
	} else {
		state.timers = []
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
		mainEditorVisibleScreenCount: state.mainEditorVisibleScreenCount,
		mainEditorVisibilityMigrated: state.mainEditorVisibilityMigrated === true,
		layerPresets: state.layerPresets,
		lookPresets: state.lookPresets,
		timers: state.timers,
		globalBorders: state.globalBorders,
	})
}

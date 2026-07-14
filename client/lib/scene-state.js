/**
 * Scene / Look state — named compositions of per-layer content + normalized FILL.
 * @see docs/scene-system-plan.md
 */
import {
	defaultTransition,
	defaultLayerConfig,
	migrateScene,
	newId,
	nextLayerNumber,
	LOOK_FULL_MESSAGE,
	LOOK_LAYER_FIRST,
	LOOK_LAYER_STEP,
} from './scene-state-helpers.js'
import { showAppToast } from './app-toast.js'

import * as Persistence from './scene-state-persistence-logic.js'
import * as LayerLogic from './scene-state-layer-logic.js'
import * as LookLogic from './scene-state-look-logic.js'
import {
	sceneStateGetGlobalBorderForScreen,
	sceneStateSetGlobalBorderForScreen,
	sceneStateNoteGlobalBorderPushedToPgm,
	sceneStateGetGlobalBorderPresetSlotCount,
	sceneStateSaveGlobalBorderPresetSlot,
	sceneStateDeleteGlobalBorderPresetSlot,
	sceneStateGetGlobalBorderPreset,
	sceneStateSetGlobalBorder,
} from './scene-state-global-border.js'
import { syncMainSlotsFromSceneLive } from './scene-live-main-sync.js'
import { applySceneLayerDefaults } from './editor-defaults.js'
import {
	isAutoTransitionDuration,
	resolveTransitionDuration,
	transitionDurationForFps,
} from './transition-duration.js'
import {
	sceneStateCopyLayerStyle,
	sceneStateSaveLayerPresetFromLayer,
	sceneStatePasteLayerStyle,
	sceneStateApplyLayerPresetToLayer,
	sceneStateRemoveLayerPreset,
	sceneStateSaveLookPreset,
	sceneStateOverwriteLookPreset,
	sceneStateRemoveLookPreset,
	sceneStatePatchLookPreset,
	sceneStateImportLayerPresetsFromServer,
	sceneStateImportLookPresetsFromServer,
} from './scene-state-preset-actions.js'
import {
	createTimerFromLayer,
	getTimer,
	renameTimer,
	ensureCanonicalLayer,
	listTimers,
	findBoundLayers,
} from './scene-state-timers.js'
export {
	defaultTransition,
	previewChannelLayerForSceneLayer,
	defaultLayerConfig,
	LOOK_LAYER_FIRST,
	LOOK_LAYER_STEP,
	LOOK_LAYER_MAX,
	isValidLookLayerNumber,
} from './scene-state-helpers.js'

export class SceneState {
	constructor() {
		this._canvasResolutions = []
		this.activeScreenIndex = 0
		this.armedScreenIndices = [0]
		this.scenes = []
		this.editingSceneId = null
		this.liveSceneIdByMain = [null, null, null, null]
		this.liveSceneSnapshotsByMain = [null, null, null, null]
		this.previewSceneIdByMain = [null, null, null, null]
		this.globalDefaultTransition = { ...defaultTransition() }
		this._layerStyleClipboard = null
		this.layerPresets = []
		this.lookPresets = []
		this.timers = []
		this.globalBorders = [null, null, null, null]
		this.mainEditorVisible = Persistence.defaultMainEditorVisible()
		this.mainEditorVisibleScreenCount = 1
		this.mainEditorVisibilityMigrated = false
		this.isInteracting = false
		this.editOnPgm = false
		this._listeners = new Map()
		this._timersSnapshotFn = null // WO-210 T210.8: function to snapshot timers visibility
		this._load()
		this._applyFpsAwareGlobalDefaultTransition(false)
	}

	get liveSceneId() { return this.liveSceneIdByMain[this.activeScreenIndex] ?? null }
	get previewSceneId() { return this.previewSceneIdByMain[this.activeScreenIndex] ?? null }
	getLiveSceneIdForMain(mainIdx) { return this.liveSceneIdByMain[Math.max(0, Math.min(3, mainIdx))] ?? null }
	getLiveSceneSnapshot(mainIdx) { return this.liveSceneSnapshotsByMain[Math.max(0, Math.min(3, mainIdx))] || null }

	/** Re-copy live PGM snapshots from deck looks after media path rewrites (all mains). */
	refreshLiveSnapshotsFromScenes() {
		for (let m = 0; m < 4; m++) {
			const sid = this.liveSceneIdByMain[m]
			if (!sid) {
				this.liveSceneSnapshotsByMain[m] = null
				continue
			}
			const s = this.getScene(sid)
			this.liveSceneSnapshotsByMain[m] = s ? JSON.parse(JSON.stringify(s)) : null
		}
	}

	getPreviewSceneIdForMain(mainIdx) { return this.previewSceneIdByMain[Math.max(0, Math.min(3, mainIdx))] ?? null }

	_getCanvas(screenIdx) {
		const r = this._canvasResolutions[screenIdx]
		if (r?.w > 0 && r?.h > 0) return { width: r.w, height: r.h, framerate: r.fps ?? 50 }
		return { width: Persistence.FALLBACK_RESOLUTION.w, height: Persistence.FALLBACK_RESOLUTION.h, framerate: Persistence.FALLBACK_RESOLUTION.fps }
	}

	setCanvasResolutions(resolutions) {
		if (!Array.isArray(resolutions)) return
		const next = resolutions.map((r) => r?.w > 0 && r?.h > 0 ? { w: r.w, h: r.h, fps: r.fps ?? 50 } : { ...Persistence.FALLBACK_RESOLUTION })
		if (Persistence.getCanvasResolutionsEqual(this._canvasResolutions, next)) return
		this._canvasResolutions = next
		const visChanged = Persistence.ensureMainEditorVisibleForScreenCount(this, next.length)
		this._applyFpsAwareGlobalDefaultTransition()
		this._save()
		this._emit('screenChange')
		this._emit('change')
		void visChanged
	}

	syncMainEditorVisibleToScreenCount(screenCount) {
		if (Persistence.ensureMainEditorVisibleForScreenCount(this, screenCount)) {
			this._save()
			this._emit('change')
		}
	}

	getCanvasForScreen(screenIdx = this.activeScreenIndex) { return this._getCanvas(screenIdx) }

	/** @param {boolean} [persist] */
	_applyFpsAwareGlobalDefaultTransition(persist = true) {
		const g = this.globalDefaultTransition
		if (!g || !isAutoTransitionDuration(g.duration)) return false
		const fps = this.getCanvasForScreen(0).framerate
		const next = transitionDurationForFps(fps)
		if (Math.round(Number(g.duration)) === next) return false
		g.duration = next
		if (persist) this._save()
		return true
	}

	getResolvedGlobalDefaultTransition() {
		const fps = this.getCanvasForScreen(0).framerate
		return {
			...this.globalDefaultTransition,
			duration: resolveTransitionDuration(this.globalDefaultTransition?.duration, fps),
		}
	}

	_applyPersistedData(data) { return Persistence.applyPersistedData(this, data) }

	_load() {
		try {
			let raw = localStorage.getItem(Persistence.STORAGE_KEY) || localStorage.getItem(Persistence.STORAGE_KEY_V1)
			if (raw) {
				const data = JSON.parse(raw)
				if (this._applyPersistedData(data)) {
					localStorage.removeItem(Persistence.STORAGE_KEY_V1)
					this._persist()
					return
				}
			}
		} catch {}
		this.scenes = []; this.liveSceneIdByMain = [null, null, null, null]; this.previewSceneIdByMain = [null, null, null, null]
		this.mainEditorVisible = Persistence.defaultMainEditorVisible()
		this.mainEditorVisibleScreenCount = 1
		this.mainEditorVisibilityMigrated = false
		this.layerPresets = []; this.lookPresets = []
		this.armedScreenIndices = [this.activeScreenIndex]
	}

	_persist() {
		if (this._persistTimer) clearTimeout(this._persistTimer)
		this._persistTimer = setTimeout(() => {
			this._persistTimer = null
			try {
				localStorage.setItem(Persistence.STORAGE_KEY, Persistence.getPersistPayload(this))
				this._emit('persisted')
			} catch {}
		}, 1000)
	}

	_save() {
		// Save immediately (e.g. on click, delete, scope change)
		if (this._persistTimer) clearTimeout(this._persistTimer)
		this._persistTimer = null

		// WO-210 T210.8: capture the timers-visibility snapshot ONLY on the look currently
		// being edited — every other look keeps its previously saved state (stamping all
		// scenes would make every look carry the same map and takes could never flip it).
		if (this._timersSnapshotFn && this.editingSceneId) {
			try {
				const scene = this.scenes.find((s) => s && s.id === this.editingSceneId)
				if (scene) {
					const snapshot = this._timersSnapshotFn(scene)
					if (snapshot) scene.timersVisibility = snapshot
				}
			} catch (err) {
				console.warn('[scene-state] timers snapshot failed:', err?.message || err)
			}
		}

		try {
			localStorage.setItem(Persistence.STORAGE_KEY, Persistence.getPersistPayload(this))
		} catch {}
		this._emit('change')
	}

	_softSave() {
		// Debounce persistence for high-frequency updates (drag/resize)
		this._persist()
		this._emit('softChange')
	}

	on(key, fn) {
		if (!this._listeners.has(key)) this._listeners.set(key, [])
		this._listeners.get(key).push(fn)
		return () => {
			const fns = this._listeners.get(key)
			if (fns) { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1) }
		}
	}

	_emit(key, data) { const fns = this._listeners.get(key); if (fns) fns.forEach((fn) => fn(data)) }

	/** Public emit for external modules (compose handlers call sceneState.emit('change') —
	 * without this alias the edit-on-PGM padlock flow crashed with "e.emit is not a function"). */
	emit(key, data) { this._emit(key, data) }

	switchScreen(screenIdx) {
		if (screenIdx === this.activeScreenIndex && this.armedScreenIndices.length === 1 && this.armedScreenIndices[0] === screenIdx) return
		this.activeScreenIndex = screenIdx
		this.armedScreenIndices = [screenIdx]
		this._save()
		this._emit('screenChange', screenIdx)
	}

	toggleArmedScreen(screenIdx) {
		const s = new Set(this.armedScreenIndices)
		if (s.has(screenIdx)) {
			s.delete(screenIdx)
		} else {
			s.add(screenIdx)
		}
		this.armedScreenIndices = Array.from(s).sort()
		this._emit('screenChange')
	}

	sceneMatchesMain(scene, mainIdx) {
		if (!scene) return false
		const m = scene.mainScope
		return m === 'all' || String(m) === String(mainIdx)
	}

	getScenesForMain(mainIdx) { return this.scenes.filter((s) => this.sceneMatchesMain(s, mainIdx)) }
	isMainEditorVisible(mainIdx) { return mainIdx >= 0 && mainIdx <= 3 ? this.mainEditorVisible[mainIdx] !== false : true }
	toggleMainEditorVisible(mainIdx) {
		if (mainIdx < 0 || mainIdx > 3) return
		const d = [...this.mainEditorVisible]
		d[mainIdx] = !this.isMainEditorVisible(mainIdx)
		this.mainEditorVisible = d
		this.mainEditorVisibilityMigrated = true
		this._save()
	}

	setSceneMainScope(id, scope) {
		const s = this.getScene(id)
		if (!s) return
		if (scope === 'all') s.mainScope = 'all'
		else if (/^[0-3]$/.test(String(scope))) s.mainScope = scope
		this._save()
	}

	addScene(name, opts = {}) {
		const ms = opts.mainScope === 'all' ? 'all' : (/^[0-3]$/.test(String(opts.mainScope)) ? String(opts.mainScope) : String(this.activeScreenIndex))
		const scene = migrateScene({ id: newId(), name: name || `Look ${this.scenes.length + 1}`, layers: [], mainScope: ms, defaultTransition: { ...defaultTransition(), ...this.globalDefaultTransition } })
		this.scenes.push(scene); this._save(); return scene.id
	}

	duplicateScene(id) {
		const s = this.getScene(id)
		if (!s) return null
		const dupe = migrateScene({ id: newId(), name: LookLogic.uniqueLookNameForDuplicate(this.scenes, s.name), layers: JSON.parse(JSON.stringify(s.layers || [])), mainScope: s.mainScope, defaultTransition: s.defaultTransition })
		this.scenes.push(dupe); this._save(); return dupe.id
	}

	setPreviewSceneId(id, mainIdx) {
		const m = mainIdx != null && mainIdx >= 0 && mainIdx < 4 ? Math.floor(mainIdx) : this.activeScreenIndex
		const next = id ? String(id) : null
		if (this.previewSceneIdByMain[m] === next) return
		this.previewSceneIdByMain[m] = next
		this._persist()
		this._emit('previewScene')
	}

	copyLayerStyle(sceneId, layerIndex) {
		return sceneStateCopyLayerStyle(this, sceneId, layerIndex)
	}

	hasLayerStyleClipboard() { return this._layerStyleClipboard != null }
	getLayerPresets() { return this.layerPresets }

	saveLayerPresetFromLayer(sceneId, layerIndex, name) {
		return sceneStateSaveLayerPresetFromLayer(this, sceneId, layerIndex, name)
	}

	pasteLayerStyle(sceneId, layerIndex) {
		return sceneStatePasteLayerStyle(this, sceneId, layerIndex)
	}

	applyLayerPresetToLayer(sceneId, layerIndex, presetId) {
		return sceneStateApplyLayerPresetToLayer(this, sceneId, layerIndex, presetId)
	}

	removeLayerPreset(presetId) {
		return sceneStateRemoveLayerPreset(this, presetId)
	}

	getLookPresets() { return this.lookPresets }

	saveLookPreset(name, sourceKind) {
		return sceneStateSaveLookPreset(this, name, sourceKind)
	}

	overwriteLookPreset(presetId) {
		return sceneStateOverwriteLookPreset(this, presetId)
	}

	removeLookPreset(presetId) {
		return sceneStateRemoveLookPreset(this, presetId)
	}

	patchLookPreset(lookPresetId, patch) {
		return sceneStatePatchLookPreset(this, lookPresetId, patch)
	}

	importLayerPresetsFromServer(list) {
		return sceneStateImportLayerPresetsFromServer(this, list)
	}

	importLookPresetsFromServer(list) {
		return sceneStateImportLookPresetsFromServer(this, list)
	}

	// ── Timer instances (WO-208) ──────────────────────────────────────

	createTimer(layer, mainIdx) {
		const timer = createTimerFromLayer(layer, mainIdx)
		this.timers.push(timer)
		this._save()
		return timer
	}

	getTimer(id) {
		return getTimer(this, id)
	}

	renameTimer(id, newName) {
		if (renameTimer(this, id, newName)) {
			this._save()
			return true
		}
		return false
	}

	ensureCanonicalLayer(timerId, mainIdx, preferredNum, scene) {
		return ensureCanonicalLayer(this, timerId, mainIdx, preferredNum, scene)
	}

	listTimers() {
		return listTimers(this)
	}

	findBoundLayers(timerId) {
		return findBoundLayers(this, timerId)
	}

	removeScene(id) {
		const i = this.scenes.findIndex((s) => s.id === id)
		if (i < 0) return
		this.scenes.splice(i, 1)
		if (this.editingSceneId === id) this.editingSceneId = null
		for (let m = 0; m < 4; m++) {
			if (this.liveSceneIdByMain[m] === id) this.liveSceneIdByMain[m] = null
			if (this.previewSceneIdByMain[m] === id) this.previewSceneIdByMain[m] = null
		}
		this.lookPresets = this.lookPresets.filter((p) => p.sceneId !== id)
		this._save()
	}

	setSceneName(id, name) {
		const s = this.getScene(id)
		if (!s) return
		const next = (name || '').trim() || 'Untitled look'
		if (s.name === next) return
		s.name = next
		this._save()
	}

	setLiveSceneId(id, mainIdx, opts = {}) {
		const m = mainIdx != null && mainIdx >= 0 && mainIdx < 4 ? Math.floor(mainIdx) : this.activeScreenIndex
		this.liveSceneIdByMain[m] = id ? String(id) : null
		if (id) {
			const s = this.getScene(id)
			if (s) this.liveSceneSnapshotsByMain[m] = JSON.parse(JSON.stringify(s))
			else this.liveSceneSnapshotsByMain[m] = null
		} else {
			this.liveSceneSnapshotsByMain[m] = null
		}
		if (opts?.silent) this._persist()
		else this._softSave()
	}

	applySceneFromTakePayload(sceneId, payload, opts = {}) {
		const s = this.getScene(sceneId)
		if (s && LookLogic.applySceneFromTakePayload(s, payload)) {
			for (let m = 0; m < 4; m++) {
				if (String(this.liveSceneIdByMain[m]) === String(sceneId)) {
					this.liveSceneSnapshotsByMain[m] = JSON.parse(JSON.stringify(s))
				}
			}
			if (opts?.silent) this._persist()
			else this._softSave()
		}
	}

	applyServerLiveChannels(channels, channelMap) {
		if (!channels || !channelMap?.programChannels?.length) return
		const { liveSceneIdByMain, previewSceneIdByMain, changed, previewChanged } = syncMainSlotsFromSceneLive(
			channels,
			channelMap,
			(id) => !!this.getScene(id),
			{
				liveSceneIdByMain: this.liveSceneIdByMain,
				previewSceneIdByMain: this.previewSceneIdByMain,
			},
		)
		if (!changed) return
		this.liveSceneIdByMain = liveSceneIdByMain
		this.previewSceneIdByMain = previewSceneIdByMain
		for (let m = 0; m < 4; m++) {
			const sid = this.liveSceneIdByMain[m]
			if (sid) {
				const s = this.getScene(sid)
				this.liveSceneSnapshotsByMain[m] = s ? JSON.parse(JSON.stringify(s)) : null
			} else {
				this.liveSceneSnapshotsByMain[m] = null
			}
		}
		this._softSave()
		if (previewChanged) this._emit('previewScene')
	}

	getScene(id) { return id ? this.scenes.find((s) => String(s.id) === String(id)) || null : null }

	setEditingScene(id) {
		this.editingSceneId = id
		if (!id) this.editOnPgm = false
		this._emit('editingChange', id)
	}

	setEditOnPgm(val) {
		this.editOnPgm = !!val
		this._emit('change')
	}

	/** WO-210 T210.8: Register function to snapshot timer visibility state when saving looks. */
	setTimersSnapshotFn(fn) {
		this._timersSnapshotFn = typeof fn === 'function' ? fn : null
	}

	/** WO-160: lowest free number ≥ 10, or -1 when the look is full (see scene-state-helpers.js). */
	nextLayerNumber(scene) {
		return nextLayerNumber(scene)
	}

	addLayer(sceneId) {
		const s = this.getScene(sceneId)
		if (!s) return -1
		const n = this.nextLayerNumber(s)
		if (n < 0) {
			try {
				showAppToast(LOOK_FULL_MESSAGE, 'warn')
			} catch {
				/* non-DOM context (tests) */
			}
			return -1
		}
		const layer = defaultLayerConfig(n)
		applySceneLayerDefaults(layer)
		s.layers.push(layer)
		this._save()
		return s.layers.length - 1
	}

	removeLayer(sceneId, layerIndex) {
		const s = this.getScene(sceneId)
		if (s && layerIndex >= 0 && layerIndex < s.layers.length) { s.layers.splice(layerIndex, 1); this._save() }
	}

	reorderLayers(sceneId, fromVisualIndex, toVisualIndex) {
		const s = this.getScene(sceneId)
		if (!s?.layers?.length) return
		const next = LayerLogic.reorderLayers(s.layers, fromVisualIndex, toVisualIndex, LOOK_LAYER_FIRST, LOOK_LAYER_STEP)
		if (next) { s.layers = next; this._save() }
	}

	setLayerNumber(sceneId, layerIndex, layerNumber) {
		const s = this.getScene(sceneId)
		if (!s?.layers?.length) return { ok: false, reason: 'Look not found' }
		const result = LayerLogic.setLayerNumberOnLayer(s.layers, layerIndex, layerNumber)
		if (result.ok && result.changed) this._save()
		return result
	}

	setLayerSource(sceneId, layerIndex, source) {
		const s = this.getScene(sceneId); const L = s?.layers?.[layerIndex]
		if (!L) return
		L.source = source
		if (source?.value && /\.(jpe?g|png|gif|bmp|webp|tiff?)$/i.test(String(source.value))) L.loop = false
		this._save()
	}

	patchLayer(sceneId, layerIndex, patch) {
		const L = this.getScene(sceneId)?.layers?.[layerIndex]
		if (L) { LayerLogic.patchLayer(L, patch); this._softSave() }
	}

	setDefaultTransition(sceneId, t) {
		const s = this.getScene(sceneId)
		if (s) { s.defaultTransition = { ...defaultTransition(), ...s.defaultTransition, ...t }; this._softSave() }
	}

	getGlobalBorderForScreen(screenIdx) {
		return sceneStateGetGlobalBorderForScreen(this, screenIdx)
	}

	setGlobalBorderForScreen(screenIdx, border) {
		sceneStateSetGlobalBorderForScreen(this, screenIdx, border)
	}

	noteGlobalBorderPushedToPgm(screenIdx, slice) {
		sceneStateNoteGlobalBorderPushedToPgm(this, screenIdx, slice)
	}

	getGlobalBorderPresetSlotCount(screenIdx) {
		return sceneStateGetGlobalBorderPresetSlotCount(this, screenIdx)
	}

	saveGlobalBorderPresetSlot(screenIdx, slotNum, name) {
		sceneStateSaveGlobalBorderPresetSlot(this, screenIdx, slotNum, name)
	}

	deleteGlobalBorderPresetSlot(screenIdx, slotNum) {
		sceneStateDeleteGlobalBorderPresetSlot(this, screenIdx, slotNum)
	}

	getGlobalBorderPreset(screenIdx, slotNum) {
		return sceneStateGetGlobalBorderPreset(this, screenIdx, slotNum)
	}

	setGlobalBorder(sceneId, border) {
		sceneStateSetGlobalBorder(this, sceneId, border)
	}

	setGlobalDefaultTransition(t) {
		this.globalDefaultTransition = { ...defaultTransition(), ...this.globalDefaultTransition, ...t }
		this._softSave()
	}

	applyGlobalDefaultToAllLooks(screenCount) {
		const g = { ...defaultTransition(), ...this.globalDefaultTransition }
		const targets = Number.isFinite(screenCount) && screenCount >= 2 ? this.getScenesForMain(this.activeScreenIndex) : this.scenes
		const onDeck = new Set(targets.map(s => s.id))
		this.scenes.forEach(s => { if (onDeck.has(s.id)) s.defaultTransition = { ...g } })
		this._save()
	}

	getExportData() {
		return JSON.parse(JSON.stringify({
			scenes: this.scenes, liveSceneIdByMain: this.liveSceneIdByMain, previewSceneIdByMain: this.previewSceneIdByMain,
			liveSceneId: this.liveSceneId, previewSceneId: this.previewSceneId, activeScreenIndex: this.activeScreenIndex,
			globalDefaultTransition: this.globalDefaultTransition, mainEditorVisible: this.mainEditorVisible,
			layerPresets: this.layerPresets, lookPresets: this.lookPresets, timers: this.timers,
			globalBorders: this.globalBorders,
		}))
	}

	loadFromData(data, opts = {}) {
		if (!this._applyPersistedData(data)) return
		if (opts.silent) {
			try {
				localStorage.setItem(Persistence.STORAGE_KEY, Persistence.getPersistPayload(this))
			} catch {}
		} else {
			this._save()
		}
		this._emit('imported')
	}
}

export const sceneState = new SceneState()

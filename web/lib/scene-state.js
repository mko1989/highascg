/**
 * Scene / Look state — named compositions of per-layer content + normalized FILL.
 * @see docs/scene-system-plan.md
 */
import {
	defaultTransition,
	defaultLayerConfig,
	migrateScene,
	newId,
	LOOK_LAYER_FIRST,
	LOOK_LAYER_STEP,
} from './scene-state-helpers.js'

import * as Persistence from './scene-state-persistence-logic.js'
import * as LayerLogic from './scene-state-layer-logic.js'
import * as LookLogic from './scene-state-look-logic.js'

export {
	defaultTransition,
	previewChannelLayerForSceneLayer,
	defaultLayerConfig,
	LOOK_LAYER_FIRST,
	LOOK_LAYER_STEP,
} from './scene-state-helpers.js'

export class SceneState {
	constructor() {
		this._canvasResolutions = []
		this.activeScreenIndex = 0
		this.armedScreenIndices = [0]
		this.scenes = []
		this.editingSceneId = null
		this.liveSceneIdByMain = [null, null, null, null]
		this.previewSceneIdByMain = [null, null, null, null]
		this.globalDefaultTransition = { ...defaultTransition() }
		this._layerStyleClipboard = null
		this.layerPresets = []
		this.lookPresets = []
		this.mainEditorVisible = Persistence.defaultMainEditorVisible()
		this.isInteracting = false
		this._listeners = new Map()
		this._load()
	}

	get liveSceneId() { return this.liveSceneIdByMain[this.activeScreenIndex] ?? null }
	get previewSceneId() { return this.previewSceneIdByMain[this.activeScreenIndex] ?? null }
	getLiveSceneIdForMain(mainIdx) { return this.liveSceneIdByMain[Math.max(0, Math.min(3, mainIdx))] ?? null }
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
		this._save()
	}

	getCanvasForScreen(screenIdx = this.activeScreenIndex) { return this._getCanvas(screenIdx) }

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
		this.mainEditorVisible = Persistence.defaultMainEditorVisible(); this.layerPresets = []; this.lookPresets = []
		this.armedScreenIndices = [this.activeScreenIndex]
	}

	_persist() {
		if (this._persistTimer) clearTimeout(this._persistTimer)
		this._persistTimer = setTimeout(() => {
			this._persistTimer = null
			try {
				localStorage.setItem(Persistence.STORAGE_KEY, Persistence.getPersistPayload(this))
			} catch {}
		}, 1000)
	}

	_save() {
		// Save immediately (e.g. on click, delete, scope change)
		if (this._persistTimer) clearTimeout(this._persistTimer)
		this._persistTimer = null
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
			if (s.size === 0) s.add(this.activeScreenIndex)
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
		this.previewSceneIdByMain[m] = id ? String(id) : null
		this._persist(); this._emit('previewScene')
	}

	copyLayerStyle(sceneId, layerIndex) {
		const l = this.getScene(sceneId)?.layers?.[layerIndex]
		if (!l) return false
		this._layerStyleClipboard = LayerLogic.getLayerStyleDataFromLayer(l)
		return true
	}

	hasLayerStyleClipboard() { return this._layerStyleClipboard != null }
	getLayerPresets() { return this.layerPresets }

	saveLayerPresetFromLayer(sceneId, layerIndex, name) {
		const l = this.getScene(sceneId)?.layers?.[layerIndex]
		if (!l || !String(name || '').trim()) return null
		const id = newId()
		this.layerPresets.push({ id, name: LayerLogic.uniqueLayerPresetName(this.layerPresets, name.trim()), data: LayerLogic.getLayerStyleDataFromLayer(l) })
		this._save(); return id
	}

	pasteLayerStyle(sceneId, layerIndex) {
		const L = this.getScene(sceneId)?.layers?.[layerIndex]
		if (!L || !this._layerStyleClipboard) return false
		LayerLogic.applyLayerStyleData(L, this._layerStyleClipboard)
		this._softSave(); return true
	}

	applyLayerPresetToLayer(sceneId, layerIndex, presetId) {
		const p = this.layerPresets.find((x) => x.id === presetId)
		const L = this.getScene(sceneId)?.layers?.[layerIndex]
		if (!p?.data || !L) return false
		LayerLogic.applyLayerStyleData(L, p.data)
		this._softSave(); return true
	}

	removeLayerPreset(presetId) {
		const i = this.layerPresets.findIndex((p) => p.id === presetId)
		if (i < 0) return false
		this.layerPresets.splice(i, 1); this._save(); return true
	}

	getLookPresets() { return this.lookPresets }

	saveLookPreset(name, sourceKind) {
		const nameTrim = String(name || '').trim()
		if (!nameTrim) return null
		
		const items = []
		const targets = this.armedScreenIndices?.length ? this.armedScreenIndices : [this.activeScreenIndex]
		targets.forEach(idx => {
			const sceneId = sourceKind === 'prv' ? this.previewSceneIdByMain[idx] : (sourceKind === 'pgm' ? this.liveSceneIdByMain[idx] : (sourceKind === 'editing' ? this.editingSceneId : null))
			if (sceneId && this.getScene(sceneId)) {
				items.push({ mainIdx: idx, sceneId, sourceKind })
			}
		})
		
		if (items.length === 0) return null
		
		const id = newId()
		const legacyFallback = items[0]
		this.lookPresets.push({ 
			id, 
			name: LookLogic.uniqueLookPresetName(this.lookPresets, nameTrim), 
			createdAt: Date.now(), 
			items,
			sceneId: legacyFallback.sceneId, 
			sourceKind: legacyFallback.sourceKind, 
			targetMain: legacyFallback.mainIdx 
		})
		this._save(); return id
	}

	removeLookPreset(presetId) {
		const i = this.lookPresets.findIndex((p) => p.id === presetId)
		if (i < 0) return false
		this.lookPresets.splice(i, 1); this._save(); return true
	}

	patchLookPreset(lookPresetId, patch) {
		const i = this.lookPresets.findIndex((p) => p.id === lookPresetId)
		if (i < 0) return false
		if (patch?.tandem === null) {
			const { tandem: _t, ...rest } = patch
			this.lookPresets[i] = { ...this.lookPresets[i], ...rest }; delete this.lookPresets[i].tandem
		} else {
			this.lookPresets[i] = { ...this.lookPresets[i], ...patch }
		}
		this._save(); return true
	}

	importLayerPresetsFromServer(list) {
		const next = LayerLogic.importLayerPresetsFromServer(this.layerPresets, list)
		if (!next) return false
		this.layerPresets = next; this._save(); return true
	}

	importLookPresetsFromServer(list) {
		const next = LookLogic.importLookPresetsFromServer(list)
		if (!next) return false
		this.lookPresets = next; this._save(); return true
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
		s.name = (name || '').trim() || 'Untitled look'
		this._save()
	}

	setLiveSceneId(id, mainIdx) {
		const m = mainIdx != null && mainIdx >= 0 && mainIdx < 4 ? Math.floor(mainIdx) : this.activeScreenIndex
		this.liveSceneIdByMain[m] = id ? String(id) : null
		this._softSave()
	}

	applySceneFromTakePayload(sceneId, payload) {
		const s = this.getScene(sceneId)
		if (s && LookLogic.applySceneFromTakePayload(s, payload)) this._softSave()
	}

	applyServerLiveChannels(channels, channelMap) {
		if (!channels || !channelMap?.programChannels?.length) return
		let any = false
		channelMap.programChannels.forEach((ch, idx) => {
			const sid = String(channels[String(ch)]?.sceneId || '')
			if (sid && this.getScene(sid) && this.liveSceneIdByMain[idx] !== sid) {
				this.liveSceneIdByMain[idx] = sid; any = true
			}
		})
		if (any) this._softSave()
	}

	getScene(id) { return id ? this.scenes.find((s) => String(s.id) === String(id)) || null : null }

	setEditingScene(id) { this.editingSceneId = id; this._emit('editingChange', id) }

	nextLayerNumber(scene) {
		const used = new Set((scene.layers || []).map(l => Number(l.layerNumber)).filter(n => Number.isFinite(n) && n >= LOOK_LAYER_FIRST && n % LOOK_LAYER_STEP === 0))
		let c = LOOK_LAYER_FIRST
		while (used.has(c)) c += LOOK_LAYER_STEP
		return c
	}

	addLayer(sceneId) {
		const s = this.getScene(sceneId)
		if (!s) return -1
		s.layers.push(defaultLayerConfig(this.nextLayerNumber(s))); this._save(); return s.layers.length - 1
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
			layerPresets: this.layerPresets, lookPresets: this.lookPresets
		}))
	}

	loadFromData(data) { if (this._applyPersistedData(data)) { this._save(); this._emit('imported') } }
}

export const sceneState = new SceneState()

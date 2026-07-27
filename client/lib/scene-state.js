/**
 * Scene / Look state — named compositions of per-layer content + normalized FILL.
 * @see docs/scene-system-plan.md
 */
import {
	defaultTransition,
	migrateScene,
	newId,
} from './scene-state-helpers.js'

import * as Persistence from './scene-state-persistence-logic.js'
import * as LookLogic from './scene-state-look-logic.js'
import { syncMainSlotsFromSceneLive } from './scene-live-main-sync.js'
import {
	isAutoTransitionDuration,
	resolveTransitionDuration,
	transitionDurationForFps,
} from './transition-duration.js'
import { mixinSceneStateLayerOps } from './scene-state-layer-ops.js'
import { mixinSceneStateGlobalBorderOps } from './scene-state-global-border-ops.js'
import { mixinSceneStatePresetOps } from './scene-state-preset-ops.js'
import { mixinSceneStateTimerOps } from './scene-state-timer-ops.js'
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

	_persist(meta) {
		/* WO-341 kill #1: the 1s timer used to ERASE the remote origin — a ws import would
		 * emit a bare 'persisted' a second later and the deck-sync/autosave listeners wrote
		 * server data back. Track whether ANY contribution in this debounce window was local;
		 * an all-remote window emits { remote: true } and the write listeners skip it. */
		if (meta?.remote !== true) this._persistHasLocal = true
		if (this._persistTimer) clearTimeout(this._persistTimer)
		this._persistTimer = setTimeout(() => {
			this._persistTimer = null
			const remoteOnly = !this._persistHasLocal
			this._persistHasLocal = false
			try {
				localStorage.setItem(Persistence.STORAGE_KEY, Persistence.getPersistPayload(this))
				this._emit('persisted', remoteOnly ? { remote: true } : {})
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

	/* WO-341 kill #6: ingest the server's scene.deck broadcast as REMOTE data — a look created
	 * on the other client appears here immediately, without waiting for the debounced project
	 * save. Upsert-only (deletions still flow via project_sync), never touches the look being
	 * edited locally, and the 'imported' emit is remote-tagged so no write-back fires. */
	ingestRemoteDeckScenes(snapshots) {
		if (!Array.isArray(snapshots) || !snapshots.length) return false
		let changed = false
		for (const snap of snapshots) {
			const id = snap?.id != null ? String(snap.id) : ''
			if (!id || id === this.editingSceneId) continue
			let scene
			try {
				scene = migrateScene(JSON.parse(JSON.stringify(snap)))
			} catch {
				continue
			}
			const idx = this.scenes.findIndex((sc) => sc && String(sc.id) === id)
			if (idx >= 0) {
				if (JSON.stringify(this.scenes[idx]) === JSON.stringify(scene)) continue
				this.scenes[idx] = scene
			} else {
				this.scenes.push(scene)
			}
			changed = true
		}
		if (changed) {
			this._persist({ remote: true })
			this._emit('imported', { remote: true })
		}
		return changed
	}

	_softSave(meta) {
		// Debounce persistence for high-frequency updates (drag/resize)
		this._persist(meta)
		this._emit('softChange', meta)
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
		this._softSave({ remote: true })
		/* WO-341: server-originated (ws scene.live) — write-back listeners must not react. */
		if (previewChanged) this._emit('previewScene', { remote: true })
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
		/* WO-341 (owner sync principle, 2026-07-26): `remote` marks a SERVER-originated import
		 * (ws project_sync → importProject({silent})). Listeners that WRITE shared state back
		 * (deck sync, autosave flush) must skip remote imports — emitting unmarked here made
		 * every incoming sync echo a write, the primary client↔client sync loop. */
		this._emit('imported', { remote: opts.silent === true })
	}
}

mixinSceneStateLayerOps(SceneState)
mixinSceneStateGlobalBorderOps(SceneState)
mixinSceneStatePresetOps(SceneState)
mixinSceneStateTimerOps(SceneState)

export const sceneState = new SceneState()

/**
 * Previs PGM 3D inspector binder (WO-17 T3.1 glue).
 *
 * Ties together three moving parts so `previs-pgm-3d.js` stays thin:
 *
 *   1. `createPrevisMeshInspector` (DOM + interaction).
 *   2. `createPrevisSceneModel` (the scene-side owner of the loaded glTF + video tex slot).
 *   3. `createPrevisState` (persistent view-model: models list, active id, tags, UI toggles).
 *
 * Responsibilities:
 *   - Fetches `/api/previs/models` on start and syncs into state. Re-runs after uploads.
 *   - Translates the inspector's uuid-based callbacks into real `THREE.Mesh` references
 *     (maintains a `meshByUuid` lookup refreshed whenever a model is set).
 *   - Applies persisted screen tags + UI toggles after a model loads.
 *   - Owns the load-from-server download path (`GET /api/previs/models/:id` →
 *     `loadModelFromArrayBuffer` → scene-model host).
 *
 * All failures are logged via the injected `log` function; the inspector is the user-
 * facing status channel (via `state.setModels` / `inspector.refresh()` loops).
 */

import { createPrevisMeshInspector } from './previs-mesh-inspector.js'
import { createPrevisSettingsPanel } from './previs-settings-panel.js'
import { loadModelFromArrayBuffer } from '../lib/previs-model-loader.js'
import { readScreenTag, tagScreenMesh } from '../lib/previs-mesh-info.js'

/**
 * @typedef {Object} PrevisInspectorBinderOptions
 * @property {HTMLElement} overlay                     Element to mount the inspector panel into.
 * @property {ReturnType<typeof import('../lib/previs-state.js').createPrevisState>} state
 * @property {import('../lib/previs-scene-model.js').PrevisSceneModelHandle} modelHost
 * @property {import('../lib/previs-scene.js').PrevisSceneHandle} sceneHandle
 * @property {{ THREE: any, GLTFLoader: any | null }} threeMod
 * @property {(level: 'log'|'warn'|'error', msg: string, ...args: any[]) => void} log
 * @property {() => import('../lib/previs-model-loader.js').LoadedModel | null} getCurrentModel
 * @property {(model: import('../lib/previs-model-loader.js').LoadedModel | null) => void} setCurrentModel
 * @property {() => Array<{ id: string, label: string }>} [getAvailableSources]
 *   Optional — when provided the inspector shows a per-mesh stream dropdown instead of
 *   plain Set/Clear buttons. Usually wired to `streamManager.listSources`.
 * @property {() => Array<{ id: string, label: string, live: boolean, acquired: boolean }>} [getStreamStatuses]
 *   Optional — drives the **Video streams** inspector section (live vs waiting).
 */

/**
 * @typedef {Object} PrevisInspectorBinderHandle
 * @property {() => void} refresh                       Re-render the panel (call after uploads).
 * @property {() => Promise<void>} refreshSavedModels   Re-fetch `/api/previs/models`.
 * @property {(model: import('../lib/previs-model-loader.js').LoadedModel | null, id: string | null) => void} noteModelLoaded
 *   Called by the host after a local (drag-drop) import finishes, so the binder can
 *   update its uuid → mesh cache and the inspector list.
 * @property {() => void} dispose
 * @property {() => void} [refreshPipeline]  Re-render only the Video streams section (lighter than `refresh`).
 * @property {() => void} [refreshMapping]  Re-render only the Screen mapping section.
 */

/**
 * @param {PrevisInspectorBinderOptions} opts
 * @returns {PrevisInspectorBinderHandle}
 */
export function createPrevisPgm3dInspectorBinder(opts) {
	const { overlay, state, modelHost, sceneHandle, threeMod, log } = opts
	/** @type {Map<string, any>} Mesh UUID → THREE.Mesh */
	const meshByUuid = new Map()

	const inspector = createPrevisMeshInspector({
		state,
		getMeshes,
		getSceneToggles: () => ({
			grid: sceneHandle.grid,
			axes: sceneHandle.axes,
			setWireframe: sceneHandle.setWireframe,
		}),
		getAvailableSources: opts.getAvailableSources,
		getStreamStatuses: opts.getStreamStatuses,
		getSelectedMeshUuid: () => {
			if (typeof modelHost.getSelection !== 'function') return null
			const m = modelHost.getSelection()
			return m && m.uuid ? m.uuid : null
		},
		getScreenMappingSummary: (uuid) => {
			if (typeof modelHost.getScreenMappingSummary !== 'function') return null
			return modelHost.getScreenMappingSummary(uuid)
		},
		onCanvasRegionLive: (meshUuid, r) => applyCanvasRegionToMesh(meshUuid, r, false),
		onCanvasRegionCommit: (meshUuid, r) => applyCanvasRegionToMesh(meshUuid, r, true),
		onCanvasRegionReset: (meshUuid) => resetCanvasRegion(meshUuid),
		onSavePreset: (name) => saveCurrentView(name),
		onRecallPreset: (id) => recallPreset(id),
		onDeletePreset: (id) => {
			const activeId = state.getSnapshot().activeModelId
			if (!activeId) return
			state.removePreset(activeId, id)
			inspector.refresh()
		},
		onSelectMesh: (uuid) => {
			const mesh = meshByUuid.get(uuid) || null
			modelHost.setSelection(mesh)
			if (typeof inspector.refreshMapping === 'function') inspector.refreshMapping()
		},
		onTagMesh: (uuid) => tagMeshWithSource(uuid, null),
		onUntagMesh: (uuid) => {
			const mesh = meshByUuid.get(uuid)
			if (!mesh) return
			modelHost.untagMesh(mesh)
			const activeId = state.getSnapshot().activeModelId
			if (activeId) state.clearTag(activeId, uuid)
			inspector.refresh()
		},
		onSetMeshSource: (uuid, sourceId) => tagMeshWithSource(uuid, sourceId),
		onLoadSavedModel: loadSavedModel,
		onDeleteSavedModel: deleteSavedModel,
	})
	const settingsPanel = createPrevisSettingsPanel({ state })
	overlay.appendChild(settingsPanel.el)
	overlay.appendChild(inspector.el)

	applyInitialUI()
	refreshSavedModels().catch((err) => log('warn', '[previs-inspector] initial model list fetch failed', err && err.message))

	return {
		refresh: () => inspector.refresh(),
		refreshPipeline: () => {
			if (typeof inspector.refreshPipeline === 'function') inspector.refreshPipeline()
		},
		refreshMapping: () => {
			if (typeof inspector.refreshMapping === 'function') inspector.refreshMapping()
		},
		refreshSavedModels,
		noteModelLoaded,
		loadSavedModelById: (id) => loadSavedModel(id),
		dispose() {
			settingsPanel.dispose()
			inspector.destroy()
			meshByUuid.clear()
		},
	}

	function getMeshes() {
		const primary = modelHost.getScreenMesh()
		const entries = []
		const model = opts.getCurrentModel()
		if (!model) return entries
		const getSource = typeof modelHost.getMeshSource === 'function' ? modelHost.getMeshSource : () => null
		for (const info of model.meshInfos) {
			const mesh = meshByUuid.get(info.uuid)
			if (!mesh) continue
			const sourceId = getSource(info.uuid)
			entries.push({
				mesh,
				name: info.name,
				uuid: info.uuid,
				isScreen: !!sourceId || mesh === primary,
				sourceId: sourceId || null,
			})
		}
		return entries
	}

	function tagMeshWithSource(uuid, sourceId) {
		const mesh = meshByUuid.get(uuid)
		if (!mesh) return
		const effectiveSource = sourceId || defaultSourceFromOpts() || 'pgm'
		const activeId = state.getSnapshot().activeModelId
		const prevTag = activeId ? state.getTagsForModel(activeId)[uuid] || {} : {}
		if (typeof modelHost.setMeshSource === 'function') {
			modelHost.setMeshSource(mesh, effectiveSource)
		} else {
			modelHost.tagMeshAsScreen(mesh, {
				...prevTag,
				screenId: uuid,
				source: effectiveSource,
			})
		}
		if (activeId) {
			state.setTag(activeId, uuid, {
				...prevTag,
				screenId: uuid,
				source: effectiveSource,
			})
		}
		inspector.refresh()
	}

	/**
	 * @param {string} meshUuid
	 * @param {{ canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number }} r
	 * @param {boolean} persist
	 */
	function applyCanvasRegionToMesh(meshUuid, r, persist) {
		const mesh = meshByUuid.get(meshUuid)
		if (!mesh) return
		const existing = readScreenTag(mesh) || {}
		tagScreenMesh(mesh, { ...existing, canvasRegion: { ...r } })
		if (typeof modelHost.refreshTextureCrop === 'function') modelHost.refreshTextureCrop()
		if (persist) {
			const activeId = state.getSnapshot().activeModelId
			if (activeId) {
				const prev = state.getTagsForModel(activeId)[meshUuid] || {}
				state.setTag(activeId, meshUuid, { ...prev, canvasRegion: { ...r } })
			}
		}
	}

	function resetCanvasRegion(meshUuid) {
		const mesh = meshByUuid.get(meshUuid)
		if (!mesh) return
		const existing = readScreenTag(mesh) || {}
		const next = { ...existing }
		delete next.canvasRegion
		tagScreenMesh(mesh, next)
		if (typeof modelHost.refreshTextureCrop === 'function') modelHost.refreshTextureCrop()
		const activeId = state.getSnapshot().activeModelId
		if (activeId) {
			const prev = state.getTagsForModel(activeId)[meshUuid] || {}
			const st = { ...prev }
			delete st.canvasRegion
			state.setTag(activeId, meshUuid, st)
		}
		inspector.refreshMapping()
	}

	function defaultSourceFromOpts() {
		if (typeof opts.getAvailableSources !== 'function') return null
		const list = opts.getAvailableSources()
		return (list && list[0] && list[0].id) || null
	}

	async function refreshSavedModels() {
		const res = await fetch('/api/previs/models', { cache: 'no-store' })
		if (!res.ok) throw new Error(`models list HTTP ${res.status}`)
		const payload = await res.json()
		state.setModels(Array.isArray(payload && payload.models) ? payload.models : [])
	}

	async function loadSavedModel(id) {
		if (!threeMod || !threeMod.GLTFLoader) {
			log('warn', '[previs-inspector] GLTFLoader unavailable — cannot load saved model.')
			return
		}
		try {
			const res = await fetch(`/api/previs/models/${encodeURIComponent(id)}`)
			if (!res.ok) throw new Error(`download HTTP ${res.status}`)
			const buffer = await res.arrayBuffer()
			const loaded = await loadModelFromArrayBuffer(buffer, threeMod.THREE, threeMod.GLTFLoader, {})
			applySavedTags(loaded, id)
			opts.setCurrentModel(loaded)
			modelHost.setModel(loaded)
			rebuildMeshCache(loaded)
			state.setActiveModel(id)
			inspector.refresh()
			log('log', `[previs-inspector] loaded saved model ${id} (${loaded.meshInfos.length} meshes)`)
		} catch (err) {
			log('error', '[previs-inspector] load saved model failed', err && err.message)
		}
	}

	async function deleteSavedModel(id) {
		try {
			const res = await fetch(`/api/previs/models/${encodeURIComponent(id)}`, { method: 'DELETE' })
			if (!res.ok) throw new Error(`delete HTTP ${res.status}`)
			state.removeModel(id)
			if (state.getActiveModel() == null && opts.getCurrentModel()) {
				opts.setCurrentModel(null)
				modelHost.setModel(null)
				rebuildMeshCache(null)
			}
			inspector.refresh()
		} catch (err) {
			log('error', '[previs-inspector] delete saved model failed', err && err.message)
		}
	}

	function noteModelLoaded(model, id) {
		rebuildMeshCache(model)
		state.setActiveModel(id)
		if (id && model) applySavedTags(model, id)
		inspector.refresh()
	}

	function rebuildMeshCache(model) {
		meshByUuid.clear()
		if (!model || !model.root) return
		model.root.traverse((obj) => {
			if (obj.isMesh) meshByUuid.set(obj.uuid, obj)
		})
	}

	function applySavedTags(model, modelId) {
		const tags = state.getTagsForModel(modelId)
		if (!tags) return
		let applied = 0
		model.root.traverse((obj) => {
			if (!obj.isMesh) return
			const tag = tags[obj.uuid]
			if (!tag) return
			if (!obj.userData) obj.userData = {}
			obj.userData['highascg.screen'] = { ...tag }
			applied++
		})
		if (applied) log('log', `[previs-inspector] restored ${applied} saved tag(s) on model ${modelId}`)
	}

	function applyInitialUI() {
		const ui = state.getUI()
		if (sceneHandle.grid) sceneHandle.grid.visible = !!ui.grid
		if (sceneHandle.axes) sceneHandle.axes.visible = !!ui.axes
		if (typeof sceneHandle.setWireframe === 'function') sceneHandle.setWireframe(!!ui.wireframe)
	}

	function saveCurrentView(name) {
		const activeId = state.getSnapshot().activeModelId
		if (!activeId || typeof sceneHandle.getCameraState !== 'function') return
		const snap = sceneHandle.getCameraState()
		const preset = {
			id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
			name: name || `View`,
			position: snap.position,
			target: snap.target,
			fov: snap.fov,
		}
		state.addPreset(activeId, preset)
		inspector.refresh()
		log('log', `[previs-inspector] saved view "${preset.name}"`)
	}

	function recallPreset(id) {
		if (typeof sceneHandle.flyTo !== 'function') return
		const builtin = getBuiltinPreset(id)
		if (builtin) {
			sceneHandle.flyTo(builtin, 500)
			return
		}
		const activeId = state.getSnapshot().activeModelId
		if (!activeId) return
		const preset = state.getPresets(activeId).find((p) => p.id === id)
		if (!preset) return
		sceneHandle.flyTo({ position: preset.position, target: preset.target, fov: preset.fov }, 500)
	}
}

/**
 * Built-in camera presets — keyed by the inspector's `__builtin_*` ids. Positions are
 * in stage coordinates (+Y up, metres). Target is always origin so the grid stays framed.
 *
 * @param {string} id
 */
function getBuiltinPreset(id) {
	if (id === '__builtin_front') return { position: [0, 3, 10], target: [0, 2, 0], fov: 45 }
	if (id === '__builtin_top') return { position: [0, 12, 0.01], target: [0, 0, 0], fov: 45 }
	if (id === '__builtin_iso') return { position: [8, 8, 8], target: [0, 1.5, 0], fov: 45 }
	return null
}

/**
 * Previs 3D dropzone + model-upload plumbing (WO-17).
 *
 * Extracted from `previs-pgm-3d.js` to keep the keystone under the 500-line budget.
 * Owns:
 *   - drag/drop events on the overlay element (`dragenter`/`dragleave`/`dragover`/`drop`)
 *   - file-picker callback (shared with the toolbar's "Load model…" button)
 *   - in-browser glTF/GLB parse via `previs-model-loader.js`
 *   - streaming the same binary to `POST /api/previs/models` for persistence
 *   - progress / error status reporting via the toolbar
 *
 * Intentionally does NOT own the overlay, the toolbar, the scene-model host, or the
 * inspector — it receives thin accessors for each so the keystone remains the single
 * source of truth for lifecycle.
 */

import { loadModelFromFile, detectModelKind } from '../lib/previs-model-loader.js'

/**
 * @typedef {Object} PrevisDropzoneDeps
 * @property {HTMLElement} overlay                              Focusable 3D overlay element.
 * @property {() => any} getToolbar                             Returns the toolbar handle (or null).
 * @property {() => any} getModelHost                           Returns the scene-model host (or null).
 * @property {() => Promise<{ THREE: any, GLTFLoader: any } | null> | null} getThreeModulePromise
 *     Returns the promise resolving to the shared THREE module bundle (same promise cached
 *     in the keystone so we don't re-import).
 * @property {() => any} getInspectorBinder                     Returns the inspector binder (or null).
 * @property {ReturnType<typeof import('../lib/previs-state.js').createPrevisState>} state
 * @property {(model: import('../lib/previs-model-loader.js').LoadedModel | null) => void} setCurrentModel
 *     Keystone-owned setter. Passed in so dropzone state never diverges from the keystone's view.
 * @property {(level: 'log'|'warn'|'error', msg: string, ...args: any[]) => void} log
 */

/**
 * @param {PrevisDropzoneDeps} deps
 * @returns {{ onFileChosen: (f: File) => void, onClearModel: () => void, dispose: () => void }}
 */
export function createPrevisPgm3dDropzone(deps) {
	const { overlay, getToolbar, getModelHost, getThreeModulePromise, getInspectorBinder, state, setCurrentModel, log } = deps
	if (!overlay) throw new Error('createPrevisPgm3dDropzone: overlay required')

	let dragEnterCount = 0

	overlay.addEventListener('dragenter', onDragEnter)
	overlay.addEventListener('dragleave', onDragLeave)
	overlay.addEventListener('dragover', onDragOver)
	overlay.addEventListener('drop', onDrop)

	return {
		onFileChosen: (file) => {
			loadAndMountModel(file).catch((err) => showError(err))
		},
		onClearModel: () => {
			const modelHost = getModelHost()
			if (!modelHost) return
			modelHost.setModel(null)
			setCurrentModel(null)
			state.setActiveModel(null)
			const binder = getInspectorBinder()
			if (binder) binder.noteModelLoaded(null, null)
			const toolbar = getToolbar()
			if (toolbar) toolbar.setStatus('demo plane active')
		},
		dispose() {
			overlay.removeEventListener('dragenter', onDragEnter)
			overlay.removeEventListener('dragleave', onDragLeave)
			overlay.removeEventListener('dragover', onDragOver)
			overlay.removeEventListener('drop', onDrop)
			dragEnterCount = 0
		},
	}

	function onDragEnter(ev) {
		if (!hasFile(ev)) return
		ev.preventDefault()
		dragEnterCount++
		const toolbar = getToolbar()
		if (toolbar) toolbar.setDropzoneVisible(true)
	}
	function onDragLeave(ev) {
		if (!hasFile(ev)) return
		dragEnterCount = Math.max(0, dragEnterCount - 1)
		if (dragEnterCount === 0) {
			const toolbar = getToolbar()
			if (toolbar) toolbar.setDropzoneVisible(false)
		}
	}
	function onDragOver(ev) {
		if (!hasFile(ev)) return
		ev.preventDefault()
		if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
	}
	function onDrop(ev) {
		if (!hasFile(ev)) return
		ev.preventDefault()
		dragEnterCount = 0
		const toolbar = getToolbar()
		if (toolbar) toolbar.setDropzoneVisible(false)
		const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]
		if (file) loadAndMountModel(file).catch((err) => showError(err))
	}

	async function loadAndMountModel(file) {
		const modelHost = getModelHost()
		const threePromise = getThreeModulePromise()
		if (!modelHost || !threePromise) return
		const kind = detectModelKind(file.name)
		if (kind !== 'glb' && kind !== 'gltf') {
			showError(new Error(`Unsupported file: ${file.name} — only .glb/.gltf are wired up (Phase 2).`))
			return
		}
		const threeMod = await threePromise
		if (!threeMod || !threeMod.GLTFLoader) {
			showError(new Error('GLTFLoader not available — check /vendor/three/examples/jsm/loaders/.'))
			return
		}
		const toolbar = getToolbar()
		if (toolbar) {
			toolbar.setBusy(true)
			toolbar.setStatus(`parsing ${file.name}…`)
		}
		try {
			const loaded = await loadModelFromFile(file, threeMod.THREE, threeMod.GLTFLoader, {
				onProgress: (phase, p) => {
					const tb = getToolbar()
					if (tb) tb.setStatus(`${phase} ${(p * 100).toFixed(0)}% — ${file.name}`)
				},
			})
			setCurrentModel(loaded)
			modelHost.setModel(loaded)
			const tb = getToolbar()
			if (tb) tb.setStatus(`${file.name} (${loaded.meshInfos.length} meshes)`)
			const binder = getInspectorBinder()
			if (binder) binder.noteModelLoaded(loaded, null)
			uploadModelToServer(file, loaded).catch((err) => log('warn', '[previs-pgm-3d] server upload failed', err))
		} catch (err) {
			showError(err)
		} finally {
			const tb = getToolbar()
			if (tb) tb.setBusy(false)
		}
	}

	async function uploadModelToServer(file, loadedModel) {
		const form = new FormData()
		form.append('name', file.name)
		form.append('file', file, file.name)
		const res = await fetch('/api/previs/models', { method: 'POST', body: form })
		if (!res.ok) throw new Error(`upload HTTP ${res.status}`)
		const payload = await res.json().catch(() => null)
		if (payload && payload.model) {
			log('log', `[previs-pgm-3d] model persisted id=${payload.model.id}`)
			state.upsertModel(payload.model)
			state.setActiveModel(payload.model.id)
			const binder = getInspectorBinder()
			if (binder) binder.noteModelLoaded(loadedModel, payload.model.id)
		}
	}

	function showError(err) {
		const msg = (err && err.message) || String(err)
		log('error', '[previs-pgm-3d]', msg)
		const tb = getToolbar()
		if (tb) tb.setStatus(`error: ${msg}`)
	}
}

function hasFile(ev) {
	if (!ev || !ev.dataTransfer) return false
	const types = ev.dataTransfer.types
	if (!types) return false
	for (const t of types) if (t === 'Files') return true
	return false
}

/**
 * Previs PGM 3D overlay toolbar (WO-17 Phase 2).
 *
 * Lightweight DOM factory for the controls that sit on top of the 3D overlay:
 *   - Model menu: file picker + "Clear model" action.
 *   - Status line: currently-loaded model name or hint text.
 *   - Drop-zone backdrop: visible while the user is dragging a file over the cell.
 *
 * Split out from `previs-pgm-3d.js` to keep that file under the 500-line cap; has no
 * Three.js dependency, so it works in tooling/tests without the optional dep.
 *
 * All static styling lives in `web/styles/previs.css` (T5.4) — this file only toggles
 * state-class modifiers (`is-visible`, disabled buttons) so the module stays themeable.
 */

const TOOLBAR_CLASS = 'previs-pgm-3d-toolbar'
const DROPZONE_CLASS = 'previs-pgm-3d-dropzone'
const BUTTON_CLASS = 'previs-pgm-3d-toolbar__button'
const STATUS_CLASS = 'previs-pgm-3d-toolbar__status'
const FILE_INPUT_CLASS = 'previs-pgm-3d-toolbar__file-input'
const MODEL_ROW_CLASS = 'previs-pgm-3d-toolbar__model-row'
const MODEL_SELECT_CLASS = 'previs-pgm-3d-toolbar__model-select'

/**
 * @typedef {Object} PrevisToolbarOptions
 * @property {(file: File) => void} onFileChosen          Fired when a file is picked via the input OR dropped.
 * @property {() => void} onClear                         Fired when the user clicks "Clear model".
 * @property {() => object} [getStateSnapshot]  For the saved-model dropdown (T5.2); expect `{ models, activeModelId }`.
 * @property {(modelId: string) => void} [onPickSavedModel]   Load this server-side model id.
 */

/**
 * @typedef {Object} PrevisToolbarHandle
 * @property {HTMLElement} toolbarEl                      Mount at top-left of the overlay.
 * @property {HTMLElement} dropzoneEl                     Mount as a sibling of the overlay canvas.
 * @property {(text: string) => void} setStatus
 * @property {(visible: boolean) => void} setDropzoneVisible
 * @property {(busy: boolean) => void} setBusy
 * @property {() => void} syncSavedModelSelect   Repopulate the saved-model `<select>` from `getStateSnapshot`.
 * @property {() => void} destroy
 */

/**
 * Build the toolbar + drop-zone DOM nodes. Both are returned disconnected; the caller
 * decides where to attach them (so the toolbar can sit alongside the 2D/3D toggle).
 *
 * @param {PrevisToolbarOptions} options
 * @returns {PrevisToolbarHandle}
 */
export function createPrevisPgm3dToolbar(options) {
	const toolbar = document.createElement('div')
	toolbar.className = TOOLBAR_CLASS

	const loadBtn = document.createElement('button')
	loadBtn.type = 'button'
	loadBtn.className = BUTTON_CLASS
	loadBtn.textContent = 'Load model…'
	loadBtn.title = 'Load a .glb / .gltf stage model'

	const clearBtn = document.createElement('button')
	clearBtn.type = 'button'
	clearBtn.className = `${BUTTON_CLASS} ${BUTTON_CLASS}--ghost`
	clearBtn.textContent = 'Clear'
	clearBtn.title = 'Remove loaded model; return to demo plane'

	const status = document.createElement('span')
	status.className = STATUS_CLASS
	status.textContent = 'Drop .glb/.gltf here'

	const fileInput = document.createElement('input')
	fileInput.type = 'file'
	fileInput.className = FILE_INPUT_CLASS
	fileInput.accept = '.glb,.gltf,.obj,.fbx,model/gltf-binary,model/gltf+json'

	loadBtn.addEventListener('click', () => fileInput.click())
	fileInput.addEventListener('change', () => {
		const file = fileInput.files && fileInput.files[0]
		if (file) options.onFileChosen(file)
		fileInput.value = ''
	})
	clearBtn.addEventListener('click', () => options.onClear())

	const modelRow = document.createElement('div')
	modelRow.className = MODEL_ROW_CLASS
	const modelSel = document.createElement('select')
	modelSel.className = MODEL_SELECT_CLASS
	modelSel.title = 'Load a model saved on the server'
	const modelPh = document.createElement('option')
	modelPh.value = ''
	modelPh.textContent = 'Saved model…'
	modelSel.appendChild(modelPh)
	modelSel.addEventListener('change', () => {
		const id = modelSel.value
		if (id && typeof options.onPickSavedModel === 'function') options.onPickSavedModel(id)
		modelSel.value = ''
	})
	modelRow.appendChild(modelSel)

	toolbar.append(loadBtn, clearBtn, modelRow, status, fileInput)

	const dropzone = document.createElement('div')
	dropzone.className = DROPZONE_CLASS
	dropzone.textContent = 'Drop model file to import'

	let destroyed = false

	function syncSavedModelSelect() {
		if (destroyed || typeof options.getStateSnapshot !== 'function') return
		const snap = options.getStateSnapshot()
		const models = (snap && snap.models) || []
		const activeId = snap && snap.activeModelId
		while (modelSel.firstChild) modelSel.removeChild(modelSel.firstChild)
		const ph = document.createElement('option')
		ph.value = ''
		ph.textContent = models.length ? 'Saved model…' : 'No saved models'
		modelSel.appendChild(ph)
		for (const m of models) {
			const o = document.createElement('option')
			o.value = m.id
			o.textContent = m.name || m.filename || m.id
			modelSel.appendChild(o)
		}
		if (activeId && models.some((m) => m.id === activeId)) modelSel.value = activeId
		else modelSel.value = ''
	}
	syncSavedModelSelect()

	return {
		toolbarEl: toolbar,
		dropzoneEl: dropzone,
		setStatus(text) { if (!destroyed) status.textContent = text },
		setDropzoneVisible(visible) {
			if (destroyed) return
			dropzone.classList.toggle('is-visible', !!visible)
		},
		setBusy(busy) {
			if (destroyed) return
			loadBtn.disabled = !!busy
			clearBtn.disabled = !!busy
		},
		syncSavedModelSelect,
		destroy() {
			destroyed = true
			if (toolbar.parentNode) toolbar.parentNode.removeChild(toolbar)
			if (dropzone.parentNode) dropzone.parentNode.removeChild(dropzone)
		},
	}
}

export { TOOLBAR_CLASS, DROPZONE_CLASS }

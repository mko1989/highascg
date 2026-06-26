/**
 * Load project modal — server project files list, load, download, or local JSON.
 */

import {
	downloadProjectFile,
	fetchProjectFileContentById,
	fetchProjectFileList,
	formatProjectFileDate,
	formatProjectFileSize,
} from '../lib/project-files.js'
import { api } from '../lib/api-client.js'
import { importProjectWithHardwareReconcile } from '../lib/project-import-flow.js'
import { projectState } from '../lib/project-state.js'
import { sceneState } from '../lib/scene-state.js'
import { programOutputState } from '../lib/program-output-state.js'
import { timelineState } from '../lib/timeline-state.js'
import { multiviewState } from '../lib/multiview-state.js'
import { markServerProjectSynced } from '../lib/server-project-sync.js'
import { getAppWs } from '../lib/app-runtime.js'
import { flushSceneDeckSync } from '../lib/app-scene-deck.js'

const MODAL_ID = 'load-project-modal'

/**
 * @param {object} [opts]
 * @param {(msg: string, type?: string) => void} [opts.showToast]
 * @param {() => void} [opts.onLoaded]
 * @param {(name: string) => void} [opts.onNameSync]
 * @param {import('../lib/state-store.js').StateStore} [opts.stateStore]
 */
export function showLoadProjectModal(opts = {}) {
	if (document.getElementById(MODAL_ID)) return

	const { showToast, onLoaded, onNameSync, stateStore } = opts

	const modal = document.createElement('div')
	modal.id = MODAL_ID
	modal.className = 'modal-overlay'
	modal.innerHTML = `
		<div class="modal-content load-project-modal">
			<div class="modal-header">
				<h2>Load project</h2>
				<button type="button" class="modal-close" id="load-project-close" aria-label="Close">&times;</button>
			</div>
			<div class="modal-body">
				<p class="load-project-modal__hint">
					Choose a project file stored on the playout server, or load a JSON file from this computer.
					Server saves include Device View routing and screen layout when saved via the header Save button.
				</p>
				<div id="load-project-list-loading" class="sync-loading">
					<span class="spinner"></span> Loading project files…
				</div>
				<div id="load-project-list-wrap" class="load-project-modal__list-wrap" hidden>
					<table class="load-project-modal__table" aria-label="Project files on server">
						<thead>
							<tr>
								<th scope="col"></th>
								<th scope="col">Name</th>
								<th scope="col">Saved</th>
								<th scope="col">Size</th>
							</tr>
						</thead>
						<tbody id="load-project-list-body"></tbody>
					</table>
					<p id="load-project-list-empty" class="load-project-modal__empty" hidden>No project files on server yet. Save a project or use a local JSON file.</p>
					<p id="load-project-list-legacy" class="load-project-modal__preview" hidden></p>
				</div>
				<div id="load-project-status" class="load-project-modal__status" hidden></div>
				<div id="load-project-action-loading" class="sync-loading" hidden>
					<span class="spinner"></span> Working…
				</div>
			</div>
			<div class="modal-footer">
				<button type="button" class="btn btn--secondary" id="load-project-cancel">Cancel</button>
				<button type="button" class="btn btn--secondary" id="load-project-refresh" title="Refresh file list">Refresh</button>
				<button type="button" class="btn btn--secondary" id="load-project-download" disabled>Download</button>
				<button type="button" class="btn btn--secondary" id="load-project-file">Local JSON…</button>
				<button type="button" class="btn btn--primary" id="load-project-load" disabled>Load selected</button>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const fileInput = document.createElement('input')
	fileInput.type = 'file'
	fileInput.accept = '.json,application/json'
	fileInput.style.display = 'none'
	document.body.appendChild(fileInput)

	/** @type {import('../lib/project-files.js').ProjectFileEntry[]} */
	let files = []
	let selectedId = null
	let fromListApi = false

	const close = () => {
		fileInput.remove()
		modal.remove()
	}

	const listLoadingEl = modal.querySelector('#load-project-list-loading')
	const listWrapEl = modal.querySelector('#load-project-list-wrap')
	const listBodyEl = modal.querySelector('#load-project-list-body')
	const listEmptyEl = modal.querySelector('#load-project-list-empty')
	const listLegacyEl = modal.querySelector('#load-project-list-legacy')
	const statusEl = modal.querySelector('#load-project-status')
	const actionLoadingEl = modal.querySelector('#load-project-action-loading')
	const loadBtn = modal.querySelector('#load-project-load')
	const downloadBtn = modal.querySelector('#load-project-download')

	function setStatus(msg, isError = false) {
		if (!statusEl) return
		statusEl.hidden = !msg
		statusEl.textContent = msg
		statusEl.className =
			'load-project-modal__status' + (isError ? ' load-project-modal__status--error' : '')
	}

	function setActionLoading(on) {
		if (actionLoadingEl) actionLoadingEl.hidden = !on
		if (loadBtn) loadBtn.disabled = on || !selectedId
		if (downloadBtn) downloadBtn.disabled = on || !selectedId
		const refreshBtn = modal.querySelector('#load-project-refresh')
		const fileBtn = modal.querySelector('#load-project-file')
		if (refreshBtn) refreshBtn.disabled = on
		if (fileBtn) fileBtn.disabled = on
	}

	function getSelectedEntry() {
		return files.find((f) => f.id === selectedId) || null
	}

	function selectFile(id) {
		selectedId = id
		if (loadBtn) loadBtn.disabled = !id
		if (downloadBtn) downloadBtn.disabled = !id
		listBodyEl?.querySelectorAll('tr[data-file-id]').forEach((row) => {
			const rid = row.getAttribute('data-file-id')
			row.classList.toggle('load-project-modal__row--selected', rid === id)
			const radio = row.querySelector('input[type="radio"]')
			if (radio) radio.checked = rid === id
		})
	}

	function renderFileList() {
		if (!listBodyEl) return
		listBodyEl.replaceChildren()
		if (!files.length) {
			if (listEmptyEl) listEmptyEl.hidden = false
			selectFile(null)
			return
		}
		if (listEmptyEl) listEmptyEl.hidden = true

		for (const f of files) {
			const tr = document.createElement('tr')
			tr.className = 'load-project-modal__row'
			tr.setAttribute('data-file-id', f.id)
			if (f.active) tr.classList.add('load-project-modal__row--active')

			const tdRadio = document.createElement('td')
			const radio = document.createElement('input')
			radio.type = 'radio'
			radio.name = 'load-project-file'
			radio.value = f.id
			radio.addEventListener('change', () => selectFile(f.id))
			tdRadio.appendChild(radio)

			const tdName = document.createElement('td')
			const nameStrong = document.createElement('strong')
			nameStrong.textContent = f.name
			tdName.append(nameStrong)
			if (f.legacy) {
				const tag = document.createElement('span')
				tag.className = 'load-project-modal__tag'
				tag.textContent = 'active snapshot'
				tdName.append(' ', tag)
			} else if (f.active) {
				const tag = document.createElement('span')
				tag.className = 'load-project-modal__tag load-project-modal__tag--active'
				tag.textContent = 'active'
				tdName.append(' ', tag)
			}
			const fileHint = document.createElement('div')
			fileHint.className = 'load-project-modal__filename'
			fileHint.textContent = f.filename
			tdName.append(fileHint)

			const tdDate = document.createElement('td')
			tdDate.textContent = formatProjectFileDate(f.savedAt || f.modifiedAt)

			const tdSize = document.createElement('td')
			tdSize.textContent = formatProjectFileSize(f.sizeBytes) || '—'

			tr.append(tdRadio, tdName, tdDate, tdSize)
			tr.addEventListener('click', (e) => {
				if (e.target instanceof HTMLInputElement) return
				selectFile(f.id)
				radio.checked = true
			})
			listBodyEl.appendChild(tr)
		}

		const preselect = files.find((f) => f.active)?.id ?? files[0]?.id ?? null
		if (preselect) {
			selectFile(preselect)
			const row = listBodyEl.querySelector(`tr[data-file-id="${CSS.escape(preselect)}"]`)
			const radio = row?.querySelector('input[type="radio"]')
			if (radio) radio.checked = true
		}
	}

	async function refreshList() {
		if (listLoadingEl) listLoadingEl.hidden = false
		if (listWrapEl) listWrapEl.hidden = true
		setStatus('')
		try {
			const res = await fetchProjectFileList()
			files = res.files
			fromListApi = res.fromListApi
			if (listLegacyEl) {
				if (!fromListApi && files.some((f) => f.legacy)) {
					listLegacyEl.hidden = false
					listLegacyEl.textContent =
						'Server has no project file list yet (GET /api/project/list). Showing the current in-memory project only.'
				} else {
					listLegacyEl.hidden = true
				}
			}
			renderFileList()
			if (listWrapEl) listWrapEl.hidden = false
		} catch (e) {
			setStatus('Could not load project file list: ' + (e?.message || e), true)
			if (listWrapEl) listWrapEl.hidden = false
			if (listEmptyEl) listEmptyEl.hidden = false
		} finally {
			if (listLoadingEl) listLoadingEl.hidden = true
		}
	}

	function importDeps(entry) {
		return {
			projectState,
			sceneState,
			timelineState,
			multiviewState,
			programOutputState,
			stateStore,
			showToast,
			onNameSync,
			onApplyServerProject:
				entry && !entry.legacy
					? () => api.post('/api/project/load', { id: entry.id })
					: undefined,
			source: 'load-modal',
		}
	}

	async function finishImport(project, entry) {
		const result = await importProjectWithHardwareReconcile(project, importDeps(entry))
		if (result === 'cancelled') return
		markServerProjectSynced()
		const appWs = getAppWs()
		if (appWs) flushSceneDeckSync(appWs, sceneState)
		onLoaded?.()
		if (result === 'full') showToast?.('Loaded with project hardware', 'success')
		else showToast?.('Loaded (looks only)', 'success')
		close()
	}

	async function loadFromFile(file) {
		const r = new FileReader()
		r.onload = () => {
			void (async () => {
				try {
					const project = JSON.parse(String(r.result))
					if (!project || typeof project !== 'object') throw new Error('Invalid JSON')
					setActionLoading(true)
					await finishImport(project, null)
				} catch (e) {
					setStatus('Invalid project file: ' + (e?.message || e), true)
					showToast?.('Invalid project file', 'error')
				} finally {
					setActionLoading(false)
				}
			})()
		}
		r.onerror = () => setStatus('Could not read file', true)
		r.readAsText(file)
	}

	async function loadSelected() {
		const entry = getSelectedEntry()
		if (!entry) return
		setStatus('')
		setActionLoading(true)
		try {
			const project = await fetchProjectFileContentById(entry.id)
			await finishImport(project, entry)
		} catch (e) {
			const msg = e?.message || String(e)
			setStatus(msg, true)
			showToast?.('Load failed: ' + msg, 'error')
		} finally {
			setActionLoading(false)
		}
	}

	async function downloadSelected() {
		const entry = getSelectedEntry()
		if (!entry) return
		setStatus('')
		setActionLoading(true)
		try {
			await downloadProjectFile(entry)
			showToast?.('Download started', 'success')
		} catch (e) {
			const msg = e?.message || String(e)
			setStatus(msg, true)
			showToast?.('Download failed: ' + msg, 'error')
		} finally {
			setActionLoading(false)
		}
	}

	modal.querySelector('#load-project-close')?.addEventListener('click', close)
	modal.querySelector('#load-project-cancel')?.addEventListener('click', close)
	modal.querySelector('#load-project-refresh')?.addEventListener('click', () => void refreshList())
	modal.querySelector('#load-project-load')?.addEventListener('click', () => void loadSelected())
	modal.querySelector('#load-project-download')?.addEventListener('click', () => void downloadSelected())
	modal.querySelector('#load-project-file')?.addEventListener('click', () => fileInput.click())
	modal.addEventListener('click', (e) => {
		if (e.target === modal) close()
	})

	fileInput.addEventListener('change', () => {
		const f = fileInput.files?.[0]
		if (f) loadFromFile(f)
		fileInput.value = ''
	})

	void refreshList()
}

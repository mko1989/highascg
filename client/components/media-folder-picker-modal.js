/**
 * Pick a destination folder for media copy / move.
 */
import { escapeHtml } from './sources-panel-helpers.js'

const MODAL_ID = 'media-folder-picker-modal'

/**
 * @param {unknown[]} mediaList - GET /api/media rows (includes isDir)
 * @returns {string[]} sorted unique folder paths
 */
export function listMediaFolders(mediaList) {
	const folders = new Set()
	if (!Array.isArray(mediaList)) return []
	for (const item of mediaList) {
		if (!item?.isDir) continue
		const id = String(item.id ?? '').trim()
		if (id) folders.add(id)
	}
	// Implicit parents from file paths
	for (const item of mediaList) {
		if (item?.isDir) continue
		const id = String(item.id ?? '').trim()
		const parts = id.split('/').filter(Boolean)
		for (let i = 1; i < parts.length; i++) {
			folders.add(parts.slice(0, i).join('/'))
		}
	}
	return [...folders].sort((a, b) => a.localeCompare(b))
}

/**
 * @param {{
 *   title?: string,
 *   mediaList?: unknown[],
 *   initialPath?: string,
 * }} [opts]
 * @returns {Promise<string | null>} folder path ('' = root) or null if cancelled
 */
export function showMediaFolderPicker(opts = {}) {
	if (document.getElementById(MODAL_ID)) return Promise.resolve(null)

	const folders = listMediaFolders(opts.mediaList || [])
	const title = opts.title || 'Choose folder'
	let selected = String(opts.initialPath ?? '').trim()

	return new Promise((resolve) => {
		const modal = document.createElement('div')
		modal.id = MODAL_ID
		modal.className = 'modal-overlay media-folder-picker-overlay'
		modal.innerHTML = `
			<div class="modal-content media-folder-picker">
				<div class="modal-header">
					<h2>${escapeHtml(title)}</h2>
					<button type="button" class="modal-close" id="mfp-close" aria-label="Close">&times;</button>
				</div>
				<div class="modal-body">
					<p class="media-folder-picker__hint">Select destination folder on the media server.</p>
					<div class="media-folder-picker__list" id="mfp-list" role="listbox"></div>
					<label class="media-folder-picker__new">
						<span>New subfolder name</span>
						<input type="text" id="mfp-new" class="inspector-field__input" placeholder="optional — created inside selection" />
					</label>
				</div>
				<div class="modal-footer">
					<button type="button" class="btn btn--secondary" id="mfp-cancel">Cancel</button>
					<button type="button" class="btn btn--primary" id="mfp-ok">Choose</button>
				</div>
			</div>
		`
		document.body.appendChild(modal)

		const listEl = modal.querySelector('#mfp-list')
		const newInp = modal.querySelector('#mfp-new')

		const renderList = () => {
			listEl.innerHTML = ''
			const rootBtn = document.createElement('button')
			rootBtn.type = 'button'
			rootBtn.className = `media-folder-picker__row${selected === '' ? ' media-folder-picker__row--active' : ''}`
			rootBtn.textContent = '/ (root)'
			rootBtn.onclick = () => {
				selected = ''
				renderList()
			}
			listEl.appendChild(rootBtn)

			for (const path of folders) {
				const depth = path.split('/').length - 1
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = `media-folder-picker__row${selected === path ? ' media-folder-picker__row--active' : ''}`
				btn.style.paddingLeft = `${12 + depth * 14}px`
				btn.textContent = path.split('/').pop() || path
				btn.title = path
				btn.onclick = () => {
					selected = path
					renderList()
				}
				listEl.appendChild(btn)
			}
		}

		const close = (value) => {
			modal.remove()
			resolve(value)
		}

		renderList()

		modal.querySelector('#mfp-close')?.addEventListener('click', () => close(null))
		modal.querySelector('#mfp-cancel')?.addEventListener('click', () => close(null))
		modal.querySelector('#mfp-ok')?.addEventListener('click', () => {
			const sub = String(newInp?.value || '').trim().replace(/^\/+|\/+$/g, '')
			if (sub.includes('..') || sub.includes('/')) {
				alert('Folder name cannot contain slashes or "..".')
				return
			}
			const dest = sub ? (selected ? `${selected}/${sub}` : sub) : selected
			close(dest)
		})
		modal.addEventListener('click', (e) => {
			if (e.target === modal) close(null)
		})
	})
}

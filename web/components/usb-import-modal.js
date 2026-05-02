/**
 * Modal: browse USB volumes, multi-select files, import with progress, eject.
 * @see work/29_WO_USB_MEDIA_INGEST.md
 */

import { api } from '../lib/api-client.js'

const MEDIA_EXT = new Set([
	'.mp4', '.mov', '.mxf', '.mkv', '.webm', '.avi', '.m4v', '.mpg', '.mpeg', '.wmv',
	'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tga', '.svg',
	'.wav', '.mp3', '.aac', '.m4a', '.flac', '.aiff', '.ogg',
	'.zip',
])

function isMediaFile(name) {
	const i = name.lastIndexOf('.')
	if (i < 0) return false
	return MEDIA_EXT.has(name.slice(i).toLowerCase())
}

/**
 * @param {object} opts
 * @param {import('../lib/ws-client.js').WsClient} [opts.wsClient]
 * @param {() => void} [opts.onImported]
 */
export function showUsbImportModal(opts = {}) {
	const ws = opts.wsClient
	const existing = document.getElementById('usb-import-modal')
	if (existing) existing.remove()

	const overlay = document.createElement('div')
	overlay.id = 'usb-import-modal'
	overlay.className = 'modal-overlay usb-import-modal-overlay'
	overlay.innerHTML = `
		<div class="modal-content usb-import-modal" role="dialog" aria-modal="true" aria-labelledby="usb-import-title">
			<div class="modal-header">
				<h2 id="usb-import-title">Import from USB</h2>
				<button type="button" class="modal-close" data-usb-close aria-label="Close">&times;</button>
			</div>
			<div class="usb-import-modal__body">
				<p class="usb-import-modal__note" id="usb-import-platform-note" style="display:none"></p>
				<p class="usb-import-modal__note usb-import-modal__note--hint" id="usb-import-empty-hint" style="display:none"></p>
				<div class="usb-import-modal__row">
					<label class="usb-import-modal__label" for="usb-import-drive">Drive</label>
					<select id="usb-import-drive" class="usb-import-modal__select"></select>
					<button type="button" class="btn btn--secondary" id="usb-import-refresh-drives" title="Refresh drive list">↻</button>
				</div>
				<div class="usb-import-modal__breadcrumb" id="usb-import-bc" aria-label="Current folder"></div>
				<div class="usb-import-modal__list-wrap">
					<ul class="usb-import-modal__list" id="usb-import-list" role="listbox" aria-label="Files and folders on the selected drive"></ul>
				</div>
				<div class="usb-import-modal__actions-row">
					<button type="button" class="btn btn--secondary" id="usb-import-select-media">Select media in folder</button>
					<span class="usb-import-modal__summary" id="usb-import-summary">0 files selected</span>
				</div>
				<div class="usb-import-modal__progress" id="usb-import-progress" style="display:none" aria-label="Copy progress">
					<div class="usb-import-modal__progress-track"><div class="usb-import-modal__progress-bar" id="usb-import-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Copy progress bar"></div></div>
					<div class="usb-import-modal__progress-meta" id="usb-import-progress-meta" aria-hidden="true"></div>
					<div id="usb-import-announcer" role="status" aria-live="polite" aria-atomic="true" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0"></div>
					<button type="button" class="btn btn--secondary" id="usb-import-cancel-job">Cancel copy</button>
				</div>
				<p class="usb-import-modal__error" id="usb-import-error" style="display:none"></p>
			</div>
			<div class="modal-footer usb-import-modal__footer">
				<button type="button" class="btn btn--secondary" id="usb-import-eject">Safely eject</button>
				<button type="button" class="btn btn--primary" id="usb-import-run">Import</button>
				<button type="button" class="btn btn--secondary" data-usb-close>Close</button>
			</div>
		</div>
	`

	document.body.appendChild(overlay)

	const driveSel = overlay.querySelector('#usb-import-drive')
	const listEl = overlay.querySelector('#usb-import-list')
	const bcEl = overlay.querySelector('#usb-import-bc')
	const summaryEl = overlay.querySelector('#usb-import-summary')
	const errEl = overlay.querySelector('#usb-import-error')
	const platformNote = overlay.querySelector('#usb-import-platform-note')
	const emptyHint = overlay.querySelector('#usb-import-empty-hint')
	const progressWrap = overlay.querySelector('#usb-import-progress')
	const progressBar = overlay.querySelector('#usb-import-progress-bar')
	const progressMeta = overlay.querySelector('#usb-import-progress-meta')
	const announcer = overlay.querySelector('#usb-import-announcer')
	const dialogEl = overlay.querySelector('.usb-import-modal')
	const previousActive = document.activeElement

	/** @type {{ id: string, label: string, mountpoint: string }[]} */
	let drives = []
	let currentDriveId = ''
	/** @type {string} relative path from drive root, posix */
	let currentRel = ''
	/** @type {Set<string>} */
	const selected = new Set()

	function showError(msg) {
		if (!msg) {
			errEl.style.display = 'none'
			errEl.textContent = ''
			return
		}
		errEl.style.display = 'block'
		errEl.textContent = msg
	}

	function close() {
		if (unsubWs) unsubWs()
		if (pollTimer) clearInterval(pollTimer)
		document.removeEventListener('keydown', onKey)
		overlay.removeEventListener('keydown', onTrapTab)
		overlay.remove()
		try {
			if (previousActive && typeof previousActive.focus === 'function') previousActive.focus()
		} catch {
			/* ignore */
		}
	}

	function onKey(e) {
		if (e.key === 'Escape') {
			e.preventDefault()
			close()
		}
		if (e.key === 'Enter' && e.target && !e.target.closest('textarea')) {
			const active = document.activeElement
			if (active && overlay.contains(active) && active.tagName !== 'BUTTON' && active.tagName !== 'SELECT') {
				e.preventDefault()
				void runImport()
			}
		}
	}

	function getFocusable(root) {
		if (!root) return []
		return Array.from(
			root.querySelectorAll(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
			)
		).filter((n) => n.offsetParent !== null)
	}
	function onTrapTab(e) {
		if (e.key !== 'Tab' || !dialogEl) return
		const list = getFocusable(dialogEl)
		if (list.length === 0) return
		const first = list[0]
		const last = list[list.length - 1]
		if (e.shiftKey) {
			if (document.activeElement === first) {
				e.preventDefault()
				last.focus()
			}
		} else if (document.activeElement === last) {
			e.preventDefault()
			first.focus()
		}
	}
	document.addEventListener('keydown', onKey)
	overlay.addEventListener('keydown', onTrapTab)

	overlay.querySelectorAll('[data-usb-close]').forEach((b) => {
		b.addEventListener('click', () => close())
	})
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) close()
	})

	async function fetchDrives() {
		showError('')
		try {
			const r = await api.get('/api/usb/drives')
			if (r.platformNote) {
				platformNote.style.display = 'block'
				platformNote.textContent = r.platformNote
			} else {
				platformNote.style.display = 'none'
				platformNote.textContent = ''
			}
			drives = Array.isArray(r.drives) ? r.drives : []
			if (emptyHint) {
				if (drives.length === 0 && !r.platformNote) {
					emptyHint.style.display = 'block'
					emptyHint.textContent =
						'No removable disk detected on the server. Plug in a USB stick, ensure it is mounted (Linux: often under /media/…), turn on Settings → Media (USB) → Enable USB import, then press ↻ below.'
				} else {
					emptyHint.style.display = 'none'
					emptyHint.textContent = ''
				}
			}
			const prev = currentDriveId
			driveSel.innerHTML =
				drives.length === 0
					? '<option value="">No USB / removable volume detected</option>'
					: ['<option value="">Select drive…</option>']
							.concat(drives.map((d) => `<option value="${escapeAttr(d.id)}">${escapeHtml(d.label)} (${escapeHtml(d.size || '—')})</option>`))
							.join('')
			if (prev && drives.some((d) => d.id === prev)) driveSel.value = prev
			else {
				currentDriveId = driveSel.value || ''
				currentRel = ''
				selected.clear()
				updateSummary()
			}
			if (currentDriveId) void fetchBrowse()
		} catch (e) {
			if (emptyHint) {
				emptyHint.style.display = 'none'
				emptyHint.textContent = ''
			}
			showError(e?.message || String(e))
		}
	}

	function escapeHtml(s) {
		return String(s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
	}
	function escapeAttr(s) {
		return escapeHtml(s).replace(/'/g, '&#39;')
	}

	async function fetchBrowse() {
		if (!currentDriveId) {
			listEl.innerHTML = ''
			bcEl.innerHTML = ''
			return
		}
		showError('')
		try {
			const q = new URLSearchParams({ driveId: currentDriveId, path: currentRel })
			const r = await api.get('/api/usb/browse?' + q.toString())
			const entries = r.entries || []
			renderBreadcrumb()
			listEl.innerHTML = ''
			if (currentRel) {
				const li = document.createElement('li')
				li.className = 'usb-import-modal__item usb-import-modal__item--dir'
				li.innerHTML = `<button type="button" class="usb-import-modal__up" data-up>📁 ..</button>`
				li.querySelector('[data-up]').addEventListener('click', () => {
					const parts = currentRel.split('/').filter(Boolean)
					parts.pop()
					currentRel = parts.join('/')
					void fetchBrowse()
				})
				listEl.appendChild(li)
			}
			for (const ent of entries) {
				const li = document.createElement('li')
				li.className = 'usb-import-modal__item' + (ent.isDirectory ? ' usb-import-modal__item--dir' : '')
				if (ent.isDirectory) {
					li.innerHTML = `<button type="button" class="usb-import-modal__dir" data-rel="${escapeAttr(ent.rel)}">📁 ${escapeHtml(ent.name)}</button>`
					li.querySelector('button').addEventListener('click', () => {
						currentRel = ent.rel
						void fetchBrowse()
					})
				} else {
					const id = `usb-cb-${ent.rel.replace(/[^a-z0-9]/gi, '_')}`
					const checked = selected.has(ent.rel) ? 'checked' : ''
					li.innerHTML = `<label class="usb-import-modal__file"><input type="checkbox" id="${id}" data-rel="${escapeAttr(ent.rel)}" ${checked} /> <span>${escapeHtml(ent.name)}</span> <span class="usb-import-modal__size">${formatSize(ent.size)}</span></label>`
					const cb = li.querySelector('input')
					cb.addEventListener('change', () => {
						if (cb.checked) selected.add(ent.rel)
						else selected.delete(ent.rel)
						updateSummary()
					})
				}
				listEl.appendChild(li)
			}
		} catch (e) {
			showError(e?.message || String(e))
			listEl.innerHTML = ''
		}
	}

	function renderBreadcrumb() {
		const parts = currentRel ? currentRel.split('/').filter(Boolean) : []
		const bits = ['<span class="usb-import-modal__bc-root">/</span>']
		let acc = ''
		for (const p of parts) {
			acc = acc ? `${acc}/${p}` : p
			const path = acc
			bits.push(`<button type="button" class="usb-import-modal__bc-part" data-path="${escapeAttr(path)}">${escapeHtml(p)}</button>`)
		}
		bcEl.innerHTML = bits.join(' <span class="usb-import-modal__bc-sep">/</span> ')
		bcEl.querySelectorAll('[data-path]').forEach((btn) => {
			btn.addEventListener('click', () => {
				currentRel = btn.getAttribute('data-path') || ''
				void fetchBrowse()
			})
		})
	}

	function formatSize(n) {
		if (!n || n < 1024) return n ? `${n} B` : ''
		const kb = n / 1024
		if (kb < 1024) return `${kb.toFixed(1)} KB`
		const mb = kb / 1024
		if (mb < 1024) return `${mb.toFixed(1)} MB`
		return `${(mb / 1024).toFixed(2)} GB`
	}

	function updateSummary() {
		summaryEl.textContent = `${selected.size} file(s) selected`
	}

	driveSel.addEventListener('change', () => {
		currentDriveId = driveSel.value
		currentRel = ''
		selected.clear()
		updateSummary()
		void fetchBrowse()
	})

	overlay.querySelector('#usb-import-refresh-drives').addEventListener('click', () => void fetchDrives())

	overlay.querySelector('#usb-import-select-media').addEventListener('click', () => {
		const checks = listEl.querySelectorAll('input[type="checkbox"][data-rel]')
		checks.forEach((cb) => {
			const row = cb.closest('label')
			const name = row ? row.querySelector('span')?.textContent || '' : ''
			if (isMediaFile(name)) {
				cb.checked = true
				const rel = cb.getAttribute('data-rel')
				if (rel) selected.add(rel)
			}
		})
		updateSummary()
	})

	let pollTimer = null
	let unsubWs = null

	function stopPoll() {
		if (pollTimer) {
			clearInterval(pollTimer)
			pollTimer = null
		}
	}

	function applyProgress(st) {
		if (!st.active && st.phase !== 'copying') {
			progressWrap.style.display = st.phase === 'complete' || st.phase === 'error' ? 'block' : 'none'
		} else progressWrap.style.display = 'block'
		const pct = st.progress != null ? Math.min(100, Math.max(0, Number(st.progress))) : 0
		progressBar.style.width = `${Number.isFinite(pct) ? pct : 0}%`
		if (progressBar) {
			progressBar.setAttribute('aria-valuenow', String(Math.round(Number.isFinite(pct) ? pct : 0)))
		}
		progressMeta.textContent = `${st.message || ''}${st.fileRel ? ` — ${st.fileRel}` : ''}`
		if (announcer) {
			const line = st.phase === 'error' && st.error ? `Error: ${st.error}` : progressMeta.textContent?.trim() || ''
			if (line) announcer.textContent = line
		}
		if (st.phase === 'complete' && !st.active) {
			showError('')
			if (announcer) announcer.textContent = 'Copy finished.'
			opts.onImported?.()
		}
		if (st.phase === 'error' && st.error) showError(st.error)
	}

	async function pollStatus() {
		try {
			const st = await api.get('/api/usb/import-status')
			applyProgress(st)
			if (!st.active && (st.phase === 'complete' || st.phase === 'error')) stopPoll()
		} catch {
			/* ignore */
		}
	}

	overlay.querySelector('#usb-import-cancel-job').addEventListener('click', async () => {
		try {
			await api.post('/api/usb/import-cancel', {})
		} catch {
			/* ignore */
		}
	})

	async function runImport() {
		if (!currentDriveId) {
			showError('Select a drive first')
			return
		}
		if (selected.size === 0) {
			showError('Select at least one file')
			return
		}
		showError('')
		progressWrap.style.display = 'block'
		progressBar.style.width = '0%'
		progressMeta.textContent = 'Starting…'
		try {
			const resp = await api.post('/api/usb/import', {
				driveId: currentDriveId,
				items: [...selected],
			})
			if (resp.error && !resp.ok) throw new Error(resp.error)
			stopPoll()
			pollTimer = setInterval(() => void pollStatus(), 400)
			void pollStatus()
		} catch (e) {
			showError(e?.message || String(e))
		}
	}

	overlay.querySelector('#usb-import-run').addEventListener('click', () => void runImport())

	overlay.querySelector('#usb-import-eject').addEventListener('click', async () => {
		if (!currentDriveId) {
			showError('Select a drive')
			return
		}
		showError('')
		try {
			const r = await api.post('/api/usb/eject', { driveId: currentDriveId })
			if (r.error) throw new Error(r.error)
			selected.clear()
			currentDriveId = ''
			driveSel.value = ''
			await fetchDrives()
			showError('')
			alert(r.message || 'You can remove the device.')
		} catch (e) {
			showError(e?.message || String(e))
		}
	})

	if (ws && typeof ws.on === 'function') {
		const onProgress = (payload) => {
			if (!payload || typeof payload !== 'object') return
			if (payload.phase === 'copying' && payload.progress != null) {
				progressWrap.style.display = 'block'
				const p = Math.min(100, payload.progress)
				progressBar.style.width = `${p}%`
				if (progressBar) progressBar.setAttribute('aria-valuenow', String(Math.round(p)))
				progressMeta.textContent = `${payload.fileRel || ''} (${payload.fileIndex + 1}/${payload.fileTotal})`
				if (announcer) {
					announcer.textContent = `Copying ${Math.round(p)} percent. ${progressMeta.textContent}`
				}
			}
			if (payload.phase === 'complete') {
				stopPoll()
				void pollStatus()
				opts.onImported?.()
			}
			if (payload.phase === 'error') showError(payload.error || 'Import failed')
		}
		const u1 = ws.on('usb:copy-progress', onProgress)
		const u2 = ws.on('usb:attached', () => void fetchDrives())
		const u3 = ws.on('usb:detached', () => void fetchDrives())
		unsubWs = () => {
			if (typeof u1 === 'function') u1()
			if (typeof u2 === 'function') u2()
			if (typeof u3 === 'function') u3()
		}
	}

	driveSel?.focus()
	void fetchDrives()
}

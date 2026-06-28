/**
 * Companion page grid picker for timeline companion_press flags (WO-75).
 */
import { api, getApiBase } from '../lib/api-client.js'
import { formatCompanionLocation } from '../lib/companion-location-parse.js'

const MODAL_ID = 'companion-button-picker-modal'

/**
 * @param {{
 *   initial?: { page?: number, row?: number, column?: number },
 *   onSelect?: (loc: { page: number, row: number, column: number }) => void,
 * }} opts
 */
export function openCompanionButtonPickerModal(opts = {}) {
	const existing = document.getElementById(MODAL_ID)
	if (existing) existing.remove()

	let page = opts.initial?.page ?? 1
	let sessionId = null
	let gridSize = 8
	let selected = {
		page: opts.initial?.page ?? 1,
		row: opts.initial?.row ?? 0,
		column: opts.initial?.column ?? 0,
	}

	const modal = document.createElement('div')
	modal.id = MODAL_ID
	modal.className = 'modal-overlay companion-picker-overlay'
	modal.innerHTML = `
		<div class="modal-content companion-picker-modal">
			<div class="modal-header">
				<h2 class="modal-title">Choose Companion button</h2>
				<button type="button" class="modal-close" aria-label="Close">&times;</button>
			</div>
			<div class="modal-body">
				<div class="companion-picker-toolbar">
					<button type="button" class="inspector-btn-sm" data-act="prev">◀ Prev</button>
					<label class="companion-picker-page">Page <input type="text" inputmode="numeric" data-page value="1" /></label>
					<button type="button" class="inspector-btn-sm" data-act="next">Next ▶</button>
					<button type="button" class="inspector-btn-sm" data-act="refresh">Refresh</button>
				</div>
				<p class="companion-picker-status settings-note" data-status>Loading…</p>
				<div class="companion-picker-grid" data-grid></div>
			</div>
			<div class="modal-footer">
				<button type="button" class="btn btn--secondary" data-cancel>Cancel</button>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const gridEl = modal.querySelector('[data-grid]')
	const statusEl = modal.querySelector('[data-status]')
	const pageInp = modal.querySelector('[data-page]')

	const close = () => {
		if (sessionId) {
			void api.post('/api/companion/page-preview/unsubscribe', { sessionId }).catch(() => {})
		}
		modal.remove()
	}

	modal.querySelector('.modal-close')?.addEventListener('click', close)
	modal.querySelector('[data-cancel]')?.addEventListener('click', close)
	modal.addEventListener('click', (e) => {
		if (e.target === modal) close()
	})

	const renderGrid = (cells) => {
		gridEl.innerHTML = ''
		const byKey = new Map(cells.map((c) => [`${c.row}/${c.column}`, c]))
		for (let row = 0; row < gridSize; row++) {
			for (let column = 0; column < gridSize; column++) {
				const cell = byKey.get(`${row}/${column}`) || { row, column }
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = 'companion-picker-cell'
				if (page === selected.page && row === selected.row && column === selected.column) {
					btn.classList.add('companion-picker-cell--selected')
				}
				btn.title = `${page}/${row}/${column}`
				const img = document.createElement('img')
				img.alt = cell.text || btn.title
				img.loading = 'lazy'
				img.src = `${getApiBase()}/api/companion/button-preview/${page}/${row}/${column}.jpg?t=${cell.mtimeMs || Date.now()}`
				img.onerror = () => {
					btn.classList.add('companion-picker-cell--empty')
				}
				btn.appendChild(img)
				const cap = document.createElement('span')
				cap.className = 'companion-picker-cell__label'
				cap.textContent = `${row}/${column}`
				btn.appendChild(cap)
				btn.addEventListener('click', () => {
					selected = { page, row, column }
					opts.onSelect?.({ page, row, column })
					close()
				})
				gridEl.appendChild(btn)
			}
		}
		statusEl.textContent = `Page ${page} — click a button to bind this timeline flag.`
	}

	const loadPage = async () => {
		pageInp.value = String(page)
		statusEl.textContent = 'Subscribing to Companion page previews…'
		try {
			if (sessionId) {
				await api.post('/api/companion/page-preview/unsubscribe', { sessionId })
				sessionId = null
			}
			const sub = await api.post('/api/companion/page-preview/subscribe', { page, sessionId: crypto.randomUUID() })
			sessionId = sub.sessionId
			gridSize = sub.gridSize || 8
			gridEl.style.setProperty('--companion-picker-cols', String(gridSize))
			const st = await api.get(`/api/companion/page-preview/${page}/status`)
			renderGrid(st.cells || [])
		} catch (e) {
			statusEl.textContent = `Preview unavailable: ${e.message || e}. Enable Companion Satellite (port 16622) in Settings.`
			gridEl.innerHTML = ''
		}
	}

	modal.querySelector('[data-act="prev"]')?.addEventListener('click', () => {
		page = Math.max(1, page - 1)
		void loadPage()
	})
	modal.querySelector('[data-act="next"]')?.addEventListener('click', () => {
		page += 1
		void loadPage()
	})
	modal.querySelector('[data-act="refresh"]')?.addEventListener('click', () => void loadPage())
	pageInp.addEventListener('change', () => {
		const n = parseInt(pageInp.value, 10)
		if (Number.isFinite(n) && n >= 1) {
			page = n
			void loadPage()
		} else {
			pageInp.value = String(page)
		}
	})

	void loadPage()
}

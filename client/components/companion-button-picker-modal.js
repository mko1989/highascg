/**
 * Companion page grid picker for timeline companion_press flags (WO-75).
 */
import { api, getApiBase } from '../lib/api-client.js'

const MODAL_ID = 'companion-button-picker-modal'

/**
 * @param {HTMLImageElement} img
 * @param {string} url
 * @param {() => void} onReady
 * @param {() => void} onGiveUp
 */
function loadPreviewImgWithRetry(img, url, onReady, onGiveUp) {
	let retries = 0
	const maxRetries = 15
	const attempt = () => {
		img.src = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`
	}
	img.onload = () => onReady()
	img.onerror = () => {
		retries += 1
		if (retries < maxRetries) {
			setTimeout(attempt, 400)
		} else {
			onGiveUp()
		}
	}
	attempt()
}

/**
 * @param {number} page
 * @param {number} timeoutMs
 */
async function waitForPagePreviews(page, timeoutMs = 8000) {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		const st = await api.get(`/api/companion/page-preview/${page}/status`)
		const ready = (st.cells || []).filter((c) => c.ready).length
		if (ready > 0) return st
		await new Promise((r) => setTimeout(r, 300))
	}
	return api.get(`/api/companion/page-preview/${page}/status`).catch(() => ({ cells: [] }))
}

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

	const refreshCellImage = (row, column) => {
		const btn = gridEl.querySelector(`[data-row="${row}"][data-col="${column}"]`)
		if (!btn) return
		const img = btn.querySelector('img')
		if (!img) return
		const url = `${getApiBase()}/api/companion/button-preview/${page}/${row}/${column}.jpg`
		loadPreviewImgWithRetry(
			img,
			url,
			() => btn.classList.remove('companion-picker-cell--empty'),
			() => btn.classList.add('companion-picker-cell--empty'),
		)
	}

	const onPreviewWs = (e) => {
		const d = e.detail
		if (!d || d.page !== page) return
		refreshCellImage(d.row, d.column)
	}
	window.addEventListener('companion-button-preview', onPreviewWs)

	const close = () => {
		window.removeEventListener('companion-button-preview', onPreviewWs)
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
		const readyCount = cells.filter((c) => c.ready).length
		for (let row = 0; row < gridSize; row++) {
			for (let column = 0; column < gridSize; column++) {
				const cell = byKey.get(`${row}/${column}`) || { row, column }
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = 'companion-picker-cell'
				btn.dataset.row = String(row)
				btn.dataset.col = String(column)
				if (page === selected.page && row === selected.row && column === selected.column) {
					btn.classList.add('companion-picker-cell--selected')
				}
				btn.title = `${page}/${row}/${column}`
				const img = document.createElement('img')
				img.alt = cell.text || btn.title
				const url = `${getApiBase()}/api/companion/button-preview/${page}/${row}/${column}.jpg`
				loadPreviewImgWithRetry(
					img,
					url,
					() => btn.classList.remove('companion-picker-cell--empty'),
					() => btn.classList.add('companion-picker-cell--empty'),
				)
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
		statusEl.classList.remove('companion-picker-status--warn')
		statusEl.textContent =
			readyCount > 0
				? `Page ${page} — ${readyCount}/${gridSize * gridSize} previews loaded. Click a button to bind.`
				: `Page ${page} — waiting for Companion previews…`
	}

	const loadPage = async () => {
		pageInp.value = String(page)
		statusEl.classList.remove('companion-picker-status--warn')
		statusEl.textContent = 'Subscribing to Companion page previews…'
		gridEl.innerHTML = ''
		try {
			if (sessionId) {
				await api.post('/api/companion/page-preview/unsubscribe', { sessionId })
				sessionId = null
			}
			const sub = await api.post('/api/companion/page-preview/subscribe', { page })
			if (!sub?.ok) {
				/* No previews ≠ no picking: a binding is just page/row/column, so render the grid
				 * blind and keep the warning visible (todos06.08: "doesnt actually let me pick a
				 * button"). renderGrid resets the status line, so set the warning after it. */
				renderGrid([])
				statusEl.classList.add('companion-picker-status--warn')
				statusEl.textContent =
					(sub?.hint ||
						(sub?.reason === 'subscriptions_disabled'
							? 'Enable Button Subscriptions API in Companion Settings (not only the Satellite server).'
							: 'Companion Satellite preview unavailable.')) +
					' You can still click a cell to bind it — previews will appear once enabled.'
				return
			}
			sessionId = sub.sessionId
			gridSize = sub.gridSize || 8
			gridEl.style.setProperty('--companion-picker-cols', String(gridSize))
			statusEl.textContent = 'Loading button images from Companion…'
			const st = await waitForPagePreviews(page)
			renderGrid(st.cells || [])
		} catch (e) {
			/* The subscribe route answers 503 (with reason/hint in the body) when previews are
			 * unavailable, and api.post THROWS on non-2xx — so the !sub.ok branch above never
			 * sees it. Same story here: render the blind grid, picking needs no previews. */
			renderGrid([])
			statusEl.classList.add('companion-picker-status--warn')
			const msg = e?.message || String(e)
			const friendly =
				/crypto\.randomUUID|secure context/i.test(msg)
					? 'Browser blocked session id on HTTP — rebuild client (server assigns session id now).'
					: e?.reason === 'subscriptions_disabled'
						? 'Enable Button Subscriptions API in Companion Settings (not only the Satellite server).'
						: msg
			statusEl.textContent = `Previews unavailable: ${friendly} You can still click a cell to bind it.`
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

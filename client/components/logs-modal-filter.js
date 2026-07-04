/**
 * Logs modal — filter helpers, categories, and category dropdown UI.
 */

export const LOG_CATEGORIES = [
	{ id: 'system', label: 'System' },
	{ id: 'config', label: 'Config' },
	{ id: 'os-display', label: 'OS / xrandr' },
	{ id: 'amcp', label: 'AMCP' },
	{ id: 'playback', label: 'Playback' },
	{ id: 'streaming', label: 'Streaming' },
	{ id: 'audio', label: 'Audio' },
	{ id: 'network', label: 'Network' },
	{ id: 'artnet', label: 'Art-Net' },
	{ id: 'replication', label: 'Replication' },
	{ id: 'websocket', label: 'WebSocket' },
	{ id: 'device', label: 'Device' },
	{ id: 'sync', label: 'Sync' },
	{ id: 'debug', label: 'Debug' },
]

export const DEFAULT_CATEGORIES = new Set(LOG_CATEGORIES.filter((c) => c.id !== 'debug').map((c) => c.id))
export const DEFAULT_LEVELS = new Set(['info', 'warn', 'error'])

export const LOG_FILTER_ICON = `<svg class="logs-modal__filter-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`

/**
 * @param {Set<string>} categories
 * @param {Set<string>} levels
 * @param {number} [lineCount]
 */
export function buildLogsQuery(categories, levels, lineCount = 500) {
	const params = new URLSearchParams()
	params.set('lines', String(lineCount))
	params.set('caspar', '0')
	params.set(
		'categories',
		categories.size ? [...categories].join(',') : '__none__',
	)
	params.set('levels', [...levels].join(','))
	return `/api/logs?${params.toString()}`
}

/**
 * @param {unknown} payload
 */
export function recordFromWsPayload(payload) {
	if (typeof payload === 'string') return { line: payload, level: 'info', category: 'system' }
	if (payload && typeof payload === 'object') {
		const p = /** @type {{ line?: string, message?: string, level?: string, category?: string }} */ (payload)
		return {
			line: p.line || p.message || '',
			level: p.level || 'info',
			category: p.category || 'system',
		}
	}
	return null
}

/**
 * @param {{ level?: string, category?: string }} record
 * @param {Set<string>} categories
 * @param {Set<string>} levels
 */
export function matchesFilter(record, categories, levels) {
	if (!record) return false
	if (!categories.size) return false
	if (!categories.has(record.category)) return false
	if (levels.size && !levels.has(record.level)) return false
	return true
}

/**
 * Wire category filter dropdown; mutates `ctx.activeCategories` and calls `onFilterChange` when selection changes.
 * @param {HTMLElement} modal
 * @param {{
 *   activeCategories: Set<string>,
 *   onFilterChange: () => void,
 * }} ctx
 * @returns {{ cleanup: () => void }}
 */
export function attachLogsCategoryFilter(modal, ctx) {
	const categoryDrop = modal.querySelector('#logs-category-drop')
	const categoryToggle = modal.querySelector('#logs-category-toggle')
	const categoryMenu = modal.querySelector('#logs-category-menu')
	const categoryList = modal.querySelector('#logs-category-list')
	const categoryAllInp = modal.querySelector('#logs-category-all')
	const categoryAllLabel = modal.querySelector('#logs-category-all-label')

	function categoryFilterTitle() {
		const n = ctx.activeCategories.size
		const total = LOG_CATEGORIES.length
		if (n === total) return 'Categories: all'
		if (n === 0) return 'Categories: none selected'
		return `Categories: ${n} of ${total}`
	}

	function syncCategoryAllCheckbox() {
		if (!categoryAllInp) return
		const total = LOG_CATEGORIES.length
		const n = ctx.activeCategories.size
		const allSelected = n === total
		categoryAllInp.checked = allSelected
		categoryAllInp.indeterminate = n > 0 && n < total
		if (categoryAllLabel) {
			categoryAllLabel.textContent = allSelected ? 'Disable all' : 'Enable all'
		}
	}

	function syncCategoryCheckboxes() {
		if (!categoryList) return
		categoryList.querySelectorAll('input[data-category]').forEach((inp) => {
			const id = inp.getAttribute('data-category')
			if (id) inp.checked = ctx.activeCategories.has(id)
		})
		syncCategoryAllCheckbox()
		const title = categoryFilterTitle()
		if (categoryToggle) {
			categoryToggle.setAttribute('title', title)
			categoryToggle.setAttribute('aria-label', title)
			const n = ctx.activeCategories.size
			categoryToggle.classList.toggle('logs-modal__filter-btn--active', n < LOG_CATEGORIES.length)
		}
	}

	function setCategoryDropdownOpen(open) {
		if (!categoryMenu || !categoryToggle) return
		categoryMenu.hidden = !open
		categoryToggle.setAttribute('aria-expanded', open ? 'true' : 'false')
		categoryToggle.classList.toggle('logs-modal__filter-btn--open', open)
	}

	function onCategoryDropOutside() {
		setCategoryDropdownOpen(false)
	}

	if (categoryList) {
		categoryList.innerHTML = ''
		for (const cat of LOG_CATEGORIES) {
			const label = document.createElement('label')
			label.className = 'logs-modal__cat-item'
			label.innerHTML = `<input type="checkbox" data-category="${cat.id}" /><span>${cat.label}</span>`
			const inp = label.querySelector('input')
			inp?.addEventListener('change', () => {
				if (!inp) return
				if (inp.checked) ctx.activeCategories.add(cat.id)
				else ctx.activeCategories.delete(cat.id)
				syncCategoryCheckboxes()
				ctx.onFilterChange()
			})
			categoryList.appendChild(label)
		}
	}

	categoryAllInp?.addEventListener('change', () => {
		ctx.activeCategories.clear()
		if (categoryAllInp.checked) {
			for (const c of LOG_CATEGORIES) ctx.activeCategories.add(c.id)
		}
		syncCategoryCheckboxes()
		ctx.onFilterChange()
	})

	categoryToggle?.addEventListener('click', (e) => {
		e.stopPropagation()
		setCategoryDropdownOpen(categoryMenu?.hidden ?? true)
	})

	categoryMenu?.addEventListener('click', (e) => e.stopPropagation())
	document.addEventListener('click', onCategoryDropOutside)

	syncCategoryCheckboxes()

	return {
		cleanup: () => document.removeEventListener('click', onCategoryDropOutside),
	}
}

/**
 * Variables Panel — searchable list of system variables.
 */

import { getVariableStore } from '../lib/variable-state.js'
import { getAppWs } from '../lib/app-runtime.js'
import { escapeAttr } from '../lib/dom-escape.js'

const DISPLAY_VALUE_MAX = 56

/** Shorten huge values (e.g. base64 images) for table display. */
function formatDisplayValue(v) {
	if (v == null) return { text: '', title: '' }
	const s = typeof v === 'string' ? v : JSON.stringify(v)
	if (s.length <= DISPLAY_VALUE_MAX) return { text: s, title: '' }
	return {
		text: `${s.slice(0, DISPLAY_VALUE_MAX - 1)}…`,
		title: `${s.length.toLocaleString()} characters`,
	}
}

/**
 * @param {HTMLElement} container
 */
export async function mountVariablesPanel(container) {
	const ws = getAppWs()
	const store = ws ? getVariableStore(ws) : null
	if (!store) return

	container.innerHTML = `
		<div class="variables-panel">
			<div class="variables-header">
				<input type="text" id="var-search" placeholder="Search variables..." class="var-search-input">
				<div class="var-filters">
					<button type="button" class="btn-filter active" data-prefix="">All</button>
					<button type="button" class="btn-filter" data-prefix="osc_">OSC</button>
					<button type="button" class="btn-filter" data-prefix="app_">App</button>
					<button type="button" class="btn-filter" data-prefix="caspar_">Caspar</button>
				</div>
			</div>
			<div class="variables-table-container">
				<table class="variables-table">
					<thead>
						<tr>
							<th>Variable Key</th>
							<th>Value</th>
							<th class="var-action" aria-hidden="true"></th>
						</tr>
					</thead>
					<tbody id="variables-tbody"></tbody>
				</table>
			</div>
		</div>
	`

	const tbody = container.querySelector('#variables-tbody')
	const searchInput = container.querySelector('#var-search')
	const filterBtns = container.querySelectorAll('.btn-filter')
	let filter = ''
	let category = ''

	const render = () => {
		const vars = store.getAll()
		const keys = Object.keys(vars).sort()
		const filtered = keys.filter((k) => {
			const matchesSearch = k.toLowerCase().includes(filter.toLowerCase())
			const matchesCat = !category || k.startsWith(category)
			return matchesSearch && matchesCat
		})

		tbody.innerHTML = filtered
			.map((k) => {
				const clip = `$(highascg:${k})`
				const { text, title } = formatDisplayValue(vars[k])
				const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
				return `<tr>
					<td class="var-key">${escapeAttr(clip)}</td>
					<td class="var-value"${titleAttr}>${escapeAttr(text)}</td>
					<td class="var-action"><button type="button" class="var-copy-btn" data-key="${escapeAttr(clip)}" title="Copy key" aria-label="Copy key"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 2.5A1.5 1.5 0 0 1 5.5 1h5A1.5 1.5 0 0 1 12 2.5V3h.5A1.5 1.5 0 0 1 14 4.5v8a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 4 12.5v-10Zm1 0V3h5.5a.5.5 0 0 0 .5-.5v-.5h-5a.5.5 0 0 0-.5.5ZM5 4.5v8a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5h-7a.5.5 0 0 0-.5.5Z"/></svg></button></td>
				</tr>`
			})
			.join('')

		tbody.querySelectorAll('.var-copy-btn').forEach((btn) => {
			btn.onclick = () => {
				const key = btn.getAttribute('data-key') || ''
				navigator.clipboard.writeText(key)
				btn.classList.add('var-copy-btn--copied')
				btn.setAttribute('title', 'Copied!')
				btn.setAttribute('aria-label', 'Copied!')
				setTimeout(() => {
					btn.classList.remove('var-copy-btn--copied')
					btn.setAttribute('title', 'Copy key')
					btn.setAttribute('aria-label', 'Copy key')
				}, 1000)
			}
		})
	}

	searchInput.oninput = (e) => {
		filter = e.target.value
		render()
	}

	filterBtns.forEach((btn) => {
		btn.onclick = () => {
			filterBtns.forEach((b) => b.classList.remove('active'))
			btn.classList.add('active')
			category = btn.dataset.prefix || ''
			render()
		}
	})

	const unsubscribe = store.subscribe(() => render())

	render()

	container.onUnmount = () => unsubscribe()
}

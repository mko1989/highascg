/**
 * Variables Panel — searchable list of system variables + optional custom labels (WO-10).
 */

import { getVariableStore } from '../lib/variable-state.js'
import { ws } from '../app.js'
import { api } from '../lib/api-client.js'

function escAttr(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/"/g, '&quot;')
}

/**
 * @param {HTMLElement} container
 */
export async function mountVariablesPanel(container) {
	const store = getVariableStore(ws)
	if (!store) return

	let customLabels = {}

	async function refreshLabels() {
		try {
			const r = await api.get('/api/variables/custom')
			customLabels = r.labels && typeof r.labels === 'object' ? r.labels : {}
		} catch {
			customLabels = {}
		}
	}

	await refreshLabels()

	container.innerHTML = `
		<div class="variables-panel">
			<p class="settings-note" style="margin-bottom:0.75rem">Custom labels are saved on this machine and shown beside keys (e.g. for documentation). Clear a field to remove.</p>
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
							<th>Custom label</th>
							<th>Value</th>
							<th>Action</th>
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
				const lab = customLabels[k] || ''
				return `<tr>
					<td class="var-key">${escAttr(clip)}</td>
					<td><input type="text" class="var-label-input" data-var-key="${escAttr(k)}" value="${escAttr(lab)}" placeholder="—" /></td>
					<td class="var-value">${escAttr(vars[k])}</td>
					<td><button type="button" class="btn-copy" data-key="${escAttr(clip)}">Copy Key</button></td>
				</tr>`
			})
			.join('')

		tbody.querySelectorAll('.btn-copy').forEach((btn) => {
			btn.onclick = () => {
				const key = btn.getAttribute('data-key') || ''
				navigator.clipboard.writeText(key)
				const original = btn.innerText
				btn.innerText = 'Copied!'
				setTimeout(() => {
					btn.innerText = original
				}, 1000)
			}
		})

		tbody.querySelectorAll('.var-label-input').forEach((inp) => {
			inp.onblur = async () => {
				const key = inp.getAttribute('data-var-key')
				if (!key) return
				const val = inp.value.trim()
				const prev = customLabels[key] || ''
				if (val === prev) return
				try {
					await api.post('/api/variables/custom', { labels: { [key]: val || null } })
					if (val) customLabels[key] = val
					else delete customLabels[key]
				} catch (e) {
					console.warn('[VariablesPanel] save label failed', e)
				}
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

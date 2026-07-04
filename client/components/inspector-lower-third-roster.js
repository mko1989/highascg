/**
 * Lower-third roster (spreadsheet import, mapping, row picker).
 */

import { sceneState } from '../lib/scene-state.js'
import {
	buildRosterFromParsed,
	filterRosterRows,
	guessRosterMapping,
	mapRowToLowerThirdConfig,
	normalizeLowerThirdRoster,
	parseSpreadsheetFile,
} from '../lib/lower-third-roster-import.js'
import { escapeAttr } from '../lib/dom-escape.js'

/**
 * @param {HTMLElement} grp
 * @param {object} opts
 * @param {string} opts.sceneId
 * @param {number} opts.layerIndex
 * @param {object} opts.src
 * @param {(mapped: { title: string, subtitle: string }) => void} opts.onApplyRow
 */
export function appendLowerThirdRoster(grp, { sceneId, layerIndex, src, onApplyRow }) {
	let roster = normalizeLowerThirdRoster(src.lowerThirdRoster)
	let rosterFilter = ''
	let rosterSelectedIndex = -1

	const rosterDetails = document.createElement('details')
	rosterDetails.className = 'inspector-lt-roster'
	rosterDetails.open = !!roster
	rosterDetails.innerHTML = '<summary class="inspector-lt-roster__summary">Data sheet</summary>'
	const rosterBody = document.createElement('div')
	rosterBody.className = 'inspector-lt-roster__body'
	rosterDetails.appendChild(rosterBody)

	const rosterToolbar = document.createElement('div')
	rosterToolbar.className = 'inspector-lt-roster__toolbar'
	const importLabel = document.createElement('label')
	importLabel.className = 'inspector-btn inspector-lt-btn inspector-lt-roster__import'
	importLabel.textContent = 'Import Excel / CSV'
	const importInput = document.createElement('input')
	importInput.type = 'file'
	importInput.accept = '.xlsx,.csv,.txt'
	importInput.className = 'inspector-lt-roster__file'
	importLabel.appendChild(importInput)
	const rosterMeta = document.createElement('span')
	rosterMeta.className = 'inspector-lt-roster__meta'
	rosterToolbar.append(importLabel, rosterMeta)
	rosterBody.appendChild(rosterToolbar)

	const mappingRow = document.createElement('div')
	mappingRow.className = 'inspector-lt-roster__mapping'
	rosterBody.appendChild(mappingRow)

	const filterField = document.createElement('div')
	filterField.className = 'inspector-field'
	filterField.innerHTML = `
		<label class="inspector-field__label">Search
			<input type="search" class="inspector-field__input inspector-lt-roster__filter" placeholder="Filter rows…" />
		</label>
	`
	rosterBody.appendChild(filterField)
	const filterInput = filterField.querySelector('.inspector-lt-roster__filter')

	const tableWrap = document.createElement('div')
	tableWrap.className = 'inspector-lt-roster__table-wrap'
	rosterBody.appendChild(tableWrap)

	grp.appendChild(rosterDetails)

	function persistRoster() {
		const scene = sceneState.getScene(sceneId)
		const currentSrc = scene?.layers?.[layerIndex]?.source || src
		sceneState.patchLayer(sceneId, layerIndex, {
			source: { ...currentSrc, lowerThirdRoster: roster ? JSON.parse(JSON.stringify(roster)) : null },
		})
	}

	function mappingSelect(label, key, value) {
		const headers = roster?.headers || []
		const opts = [`<option value="">— ${label} —</option>`]
		for (const h of headers) {
			opts.push(`<option value="${escapeAttr(h)}"${value === h ? ' selected' : ''}>${escapeAttr(h)}</option>`)
		}
		return `<label class="inspector-lt-roster__map-field">
			<span class="inspector-lt-roster__map-label">${label}</span>
			<select class="inspector-field__select inspector-lt-roster__map-select" data-roster-map="${key}">${opts.join('')}</select>
		</label>`
	}

	function renderRosterMapping() {
		if (!roster) {
			mappingRow.innerHTML = '<p class="inspector-field inspector-field--hint">Import a spreadsheet to map columns to Title and Subtitle.</p>'
			return
		}
		const m = roster.mapping || guessRosterMapping(roster.headers)
		mappingRow.innerHTML = mappingSelect('First name', 'firstName', m.firstName || '') +
			mappingSelect('Surname', 'surname', m.surname || '') +
			mappingSelect('Title / role', 'subtitle', m.subtitle || '')
		for (const sel of mappingRow.querySelectorAll('[data-roster-map]')) {
			sel.addEventListener('change', () => {
				const k = sel.getAttribute('data-roster-map')
				if (!k || !roster) return
				roster.mapping = { ...roster.mapping, [k]: sel.value || '' }
				persistRoster()
				renderRosterTable()
			})
		}
	}

	function applyRowToEditor(row) {
		if (!roster?.mapping) return
		const mapped = mapRowToLowerThirdConfig(row, roster.mapping)
		const titleEl = grp.querySelector('#lt-title')
		const subEl = grp.querySelector('#lt-subtitle')
		if (titleEl) titleEl.value = mapped.title
		if (subEl) subEl.value = mapped.subtitle
		onApplyRow(mapped)
	}

	function renderRosterTable() {
		tableWrap.innerHTML = ''
		if (!roster?.rows?.length) {
			tableWrap.innerHTML = '<p class="inspector-field inspector-field--hint">No rows loaded.</p>'
			return
		}
		const visible = filterRosterRows(roster, rosterFilter)
		rosterMeta.textContent = `${roster.fileName || 'Sheet'} · ${visible.length}/${roster.rows.length} rows`
		if (!visible.length) {
			tableWrap.innerHTML = '<p class="inspector-field inspector-field--hint">No rows match filter.</p>'
			return
		}
		const m = roster.mapping || {}
		const cols = [m.firstName, m.surname, m.subtitle].filter(Boolean)
		const showCols = cols.length ? cols : roster.headers.slice(0, 4)

		const table = document.createElement('table')
		table.className = 'inspector-lt-roster__table'
		const thead = document.createElement('thead')
		const headTr = document.createElement('tr')
		for (const c of showCols) {
			const th = document.createElement('th')
			th.textContent = c
			headTr.appendChild(th)
		}
		thead.appendChild(headTr)
		table.appendChild(thead)

		const tbody = document.createElement('tbody')
		for (const row of visible) {
			const srcIndex = roster.rows.indexOf(row)
			const tr = document.createElement('tr')
			tr.tabIndex = 0
			if (srcIndex === rosterSelectedIndex) tr.classList.add('inspector-lt-roster__row--selected')
			tr.title = 'Click to fill Title and Subtitle'
			for (const c of showCols) {
				const td = document.createElement('td')
				td.textContent = row[c] ?? ''
				tr.appendChild(td)
			}
			const pick = () => {
				rosterSelectedIndex = srcIndex
				applyRowToEditor(row)
				renderRosterTable()
			}
			tr.addEventListener('click', pick)
			tr.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter' || ev.key === ' ') {
					ev.preventDefault()
					pick()
				}
			})
			tbody.appendChild(tr)
		}
		table.appendChild(tbody)
		tableWrap.appendChild(table)
	}

	function renderRosterUi() {
		renderRosterMapping()
		renderRosterTable()
	}

	importInput.addEventListener('change', async () => {
		const file = importInput.files?.[0]
		importInput.value = ''
		if (!file) return
		importLabel.classList.add('inspector-lt-roster__import--busy')
		try {
			const { headers, rows } = await parseSpreadsheetFile(file)
			if (!headers.length || !rows.length) {
				rosterMeta.textContent = 'No data rows found'
				return
			}
			roster = buildRosterFromParsed(file.name, headers, rows)
			rosterFilter = ''
			rosterSelectedIndex = -1
			if (filterInput) filterInput.value = ''
			persistRoster()
			rosterDetails.open = true
			renderRosterUi()
		} catch (err) {
			console.warn('[lower-third] roster import failed:', err)
			rosterMeta.textContent = 'Import failed'
		} finally {
			importLabel.classList.remove('inspector-lt-roster__import--busy')
		}
	})

	filterInput?.addEventListener('input', (e) => {
		rosterFilter = String(e.target.value || '')
		renderRosterTable()
	})

	renderRosterUi()

	return {
		getRoster: () => roster,
		cloneRosterForPersist: () => (roster ? JSON.parse(JSON.stringify(roster)) : null),
	}
}

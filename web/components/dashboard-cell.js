/**
 * Single dashboard grid cell — drop target, thumbnail, clear, selection + PRV cue.
 */

import { dashboardState } from '../lib/dashboard-state.js'
import { getApiBase } from '../lib/api-client.js'

export const CELL_WIDTH = 120
export const CELL_ASPECT = 16 / 9

export function escapeHtml(s) {
	const div = document.createElement('div')
	div.textContent = s
	return div.innerHTML
}

export function truncate(s, len) {
	if (!s || s.length <= len) return s
	return s.slice(0, len - 1) + '…'
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.mainHost
 * @param {() => void} opts.render
 * @param {(src: object) => void} opts.cuePreview
 * @param {() => void} opts.clearPreview
 */
export function createDashboardCell({ colIdx, layerIdx, mainHost, render, cuePreview, clearPreview }) {
	const cell = document.createElement('div')
	cell.className = 'dashboard-cell dashboard-cell-drop'
	cell.dataset.col = String(colIdx)
	cell.dataset.layer = String(layerIdx)
	cell.style.width = CELL_WIDTH + 'px'
	cell.style.flexShrink = '0'

	const layer = dashboardState.getCell(colIdx, layerIdx)
	const src = layer?.source
	const label = src ? (src.label || src.value || '') : ''
	const truncatedLabel = truncate(label, 14)

	if (src?.value) {
		cell.classList.add('has-source')
		const thumbUrl = (src.type === 'media' && typeof getApiBase === 'function')
			? `${getApiBase()}/api/thumbnail/${encodeURIComponent(src.value)}`
			: ''
		cell.innerHTML = `
			<div class="dashboard-cell__preview" style="aspect-ratio: ${CELL_ASPECT};">
				${thumbUrl ? `<img src="${escapeHtml(thumbUrl)}" alt="" class="dashboard-cell__thumb" onerror="this.style.display='none'" />` : ''}
				<div class="dashboard-cell__progress-bar" style="width: 0%"></div>
				<div class="dashboard-cell__live-info"></div>
			</div>
			<div class="dashboard-cell__label" title="${escapeHtml(label)}">${escapeHtml(truncatedLabel)}</div>
		`
	} else {
		cell.innerHTML = `
			<div class="dashboard-cell__preview" style="aspect-ratio: ${CELL_ASPECT};">
				<span class="dashboard-cell__placeholder">Drop</span>
			</div>
			<div class="dashboard-cell__label"></div>
		`
	}

	cell.addEventListener('dragover', (e) => {
		e.preventDefault()
		e.dataTransfer.dropEffect = 'copy'
		cell.classList.add('drag-over')
	})
	cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'))
	cell.addEventListener('drop', (e) => {
		e.preventDefault()
		cell.classList.remove('drag-over')
		let data
		try {
			data = JSON.parse(e.dataTransfer.getData('application/json'))
		} catch {
			const val = e.dataTransfer.getData('text/plain')
			if (val) data = { type: 'media', value: val, label: val }
		}
		if (data?.value) {
			dashboardState.setCellSource(colIdx, layerIdx, { type: data.type, value: data.value, label: data.label || data.value })
			render()
		}
	})
	cell.addEventListener('click', (e) => {
		if (e.target.closest('.dashboard-cell__clear')) return
		mainHost.querySelectorAll('.dashboard-cell').forEach((c) => c.classList.remove('selected'))
		cell.classList.add('selected')
		const L = dashboardState.getCell(colIdx, layerIdx)
		window.dispatchEvent(new CustomEvent('dashboard-select', { detail: { colIdx, layerIdx, cell: L } }))
		if (src?.value) {
			cuePreview(src)
		} else {
			clearPreview()
		}
	})

	if (src?.value) {
		const clear = document.createElement('button')
		clear.className = 'dashboard-cell__clear'
		clear.textContent = '×'
		clear.title = 'Clear'
		clear.addEventListener('click', (e) => {
			e.stopPropagation()
			dashboardState.setCellSource(colIdx, layerIdx, null)
			mainHost.querySelectorAll('.dashboard-cell').forEach((c) => c.classList.remove('selected'))
			clearPreview()
			render()
		})
		cell.appendChild(clear)
	}

	return cell
}

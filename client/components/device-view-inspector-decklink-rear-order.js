/**
 * Rear-panel DeckLink port order editor — split out of device-view-inspector-decklink-output.js
 * (WO-479) to keep that file under the 500-line CI limit.
 */
import { orderDecklinkConnectors, DECKLINK_REAR_ORDER_KEY, readSavedDecklinkOrder } from '../lib/device-view-decklink-order.js'
import { decklinkMergedConnectors } from './device-view-inspector-decklink-shared.js'

/** Rear-panel DeckLink port order editor (matches GPU layout inspector pattern). */
export function renderDecklinkRearOrderEditor(h, { lastPayload, load }) {
	const editMode = document.querySelector('.device-view__band--caspar')?.classList.contains('device-view--edit-mode-decklink')
	if (!editMode) return

	const deckMerged = decklinkMergedConnectors(lastPayload)
	if (!deckMerged.length) return

	const saved = readSavedDecklinkOrder()
	let orderIds = orderDecklinkConnectors(deckMerged, saved).orderIds.slice()

	const editGroup = Object.assign(document.createElement('div'), {
		style: 'border: 1px solid #555; padding: 8px; border-radius: 4px; background: #333; margin-bottom: 8px;',
	})
	editGroup.innerHTML =
		'<div style="font-weight:bold; margin-bottom: 6px; font-size: 11px; color: #aaa;">DeckLink rear order (drag to reorder)</div>'

	const listContainer = Object.assign(document.createElement('div'), {
		style: 'display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;',
	})

	const persistAndRefresh = async () => {
		try {
			localStorage.setItem(DECKLINK_REAR_ORDER_KEY, JSON.stringify(orderIds))
		} catch (e) {
			console.warn('[device-view] decklink order persist', e)
		}
		if (load) await load()
	}

	const labelForId = (id) => {
		const c = deckMerged.find((x) => String(x.id) === String(id))
		return c ? String(c.label || c.id) : id
	}

	const renderList = () => {
		listContainer.innerHTML = ''
		orderIds.forEach((id, index) => {
			const row = Object.assign(document.createElement('div'), {
				style:
					'display:flex; flex-direction:row; align-items:center; justify-content:space-between; gap:6px; padding:6px; border:1px solid #444; border-radius:3px; background:#2a2a2a; cursor:grab;',
				draggable: true,
			})
			const left = Object.assign(document.createElement('div'), {
				style: 'font-size:11px; display:flex; flex-direction:column; gap:2px; min-width:0; flex:1',
			})
			left.innerHTML = `<span style="opacity:0.75;font-size:10px">Slot ${index + 1}</span><strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(labelForId(
				id,
			))}</strong><span style="opacity:0.55;font-size:9px;font-family:ui-monospace,monospace">${escapeHtml(id)}</span>`

			const grip = Object.assign(document.createElement('span'), {
				textContent: '≡',
				style: 'opacity:0.6; font-size:14px; flex-shrink:0',
			})
			row.append(left, grip)

			row.addEventListener('dragstart', (ev) => {
				ev.dataTransfer.setData('application/x-highascg-inspector-decklink-slot', String(index))
				row.style.opacity = '0.5'
			})
			row.addEventListener('dragend', () => {
				row.style.opacity = '1'
			})
			row.addEventListener('dragover', (ev) => {
				ev.preventDefault()
				row.style.borderTop = '2px solid #007bff'
			})
			row.addEventListener('dragleave', () => {
				row.style.borderTop = '1px solid #444'
			})
			row.addEventListener('drop', (ev) => {
				ev.preventDefault()
				row.style.borderTop = '1px solid #444'
				const dragIdx = parseInt(ev.dataTransfer.getData('application/x-highascg-inspector-decklink-slot'), 10)
				if (!Number.isNaN(dragIdx) && dragIdx !== index) {
					const t = orderIds.splice(dragIdx, 1)[0]
					let insertAt = index
					if (dragIdx < index) insertAt = index - 1
					orderIds.splice(insertAt, 0, t)
					void persistAndRefresh()
				}
			})
			listContainer.append(row)
		})
	}

	renderList()

	const actionsRow = Object.assign(document.createElement('div'), { style: 'display:flex; gap:4px; margin-top:8px; flex-wrap:wrap' })
	const saveBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Save' })
	const exportBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Export' })
	const loadBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Load' })
	const resetBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn',
		textContent: 'Reset order',
		style: 'color: #ff6b6b; border-color: #ff6b6b33; margin-left: auto;',
		title: 'Clear saved DeckLink rear order for this browser',
	})
	const fileIn = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' })
	fileIn.style.display = 'none'

	saveBtn.onclick = () => void persistAndRefresh()

	exportBtn.onclick = () => {
		const payload = { version: 1, decklinkRearOrder: orderIds }
		const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2))
		const a = document.createElement('a')
		a.setAttribute('href', dataStr)
		a.setAttribute('download', 'decklink_rear_panel_order.json')
		document.body.appendChild(a)
		a.click()
		a.remove()
	}

	loadBtn.onclick = () => fileIn.click()
	fileIn.onchange = async () => {
		const file = fileIn.files?.[0]
		fileIn.value = ''
		if (!file) return
		try {
			const text = await file.text()
			const parsed = JSON.parse(text)
			let raw = []
			if (Array.isArray(parsed)) raw = parsed
			else if (Array.isArray(parsed?.decklinkRearOrder)) raw = parsed.decklinkRearOrder
			else if (Array.isArray(parsed?.connectorIds)) raw = parsed.connectorIds
			const asStrings = raw.map((x) => String(x)).filter(Boolean)
			const merged = orderDecklinkConnectors(deckMerged, asStrings)
			orderIds = merged.orderIds.slice()
			await persistAndRefresh()
		} catch (e) {
			alert('Invalid DeckLink order file: ' + (e?.message || e))
		}
	}

	resetBtn.onclick = async () => {
		if (!confirm('Clear saved DeckLink rear panel order?')) return
		try {
			localStorage.removeItem(DECKLINK_REAR_ORDER_KEY)
		} catch (e) {
			console.warn('[device-view] decklink order reset', e)
		}
		orderIds = orderDecklinkConnectors(deckMerged, []).orderIds.slice()
		if (load) await load()
	}

	actionsRow.append(saveBtn, exportBtn, loadBtn, resetBtn, fileIn)
	editGroup.append(listContainer, actionsRow)
	h.append(editGroup)
}

/**
 * DeckLink IO controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { api } from '../lib/api-client.js'
import { CASPAR_HOST } from './device-view-helpers.js'
import { DECKLINK_REAR_ORDER_KEY, readSavedDecklinkOrder, orderDecklinkConnectors } from '../lib/device-view-decklink-order.js'

function decklinkMergedConnectors(lastPayload) {
	const sug = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
	const deckIo = sug.filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'decklink_io')
	const deckOut = sug.filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'decklink_out')
	return [...deckIo, ...deckOut].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
}

/**
 * Rear-panel DeckLink port order editor (matches GPU layout inspector pattern).
 */
function renderDecklinkRearOrderEditor(h, { lastPayload, load }) {
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
			left.innerHTML = `<span style="opacity:0.75;font-size:10px">Slot ${index + 1}</span><strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${labelForId(
				id
			)}</strong><span style="opacity:0.55;font-size:9px;font-family:ui-monospace,monospace">${id}</span>`

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

export function renderDeckLinkIoControls(h, conn, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty }) {
	renderDecklinkRearOrderEditor(h, { lastPayload, load })

	if (conn?.kind === 'decklink_out') {
		const note = Object.assign(document.createElement('p'), {
			className: 'device-view__note',
			textContent:
				'Program DeckLink consumer. Use Edit on the rear panel and this inspector to reorder how DeckLink ports appear left-to-right.',
			style: 'margin-top:8px;font-size:0.85rem;opacity:0.9',
		})
		h.append(note)
		return
	}

	const ioDir = String(conn?.caspar?.ioDirection || 'in').toLowerCase() === 'out' ? 'out' : 'in'
	const devNum = parseInt(String(conn?.externalRef || '0'), 10) || 0
	const channelMap = lastPayload?.live?.caspar?.channelMap || currentSettings?.channelMap || {}
	const inputsCh = channelMap.inputsCh
	const isCurrentlyInput = ioDir === 'in'

	const ioWrap = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })

	if (isCurrentlyInput) {
		// Show "Remove as Input" — also switches BNC to Caspar SDI output mode (see device-view-crud default outputBinding).
		const removeBtn = Object.assign(document.createElement('button'), {
			className: 'header-btn',
			textContent: '⏹ Stop input → SDI output',
			style: 'width:100%;color:#f85149',
			title: 'Stops DeckLink capture on the inputs host, removes the Live tile, and maps this device to PGM SDI (screen 1 by default until you cable it in Device View).',
		})
		removeBtn.onclick = async () => {
			removeBtn.disabled = true
			try {
				// 1. Stop AMCP playback if we know the channel
				if (inputsCh != null && devNum > 0) {
					const layer = devNum
					try {
						await api.post('/api/raw', { cmd: `STOP ${inputsCh}-${layer}` })
						await api.post('/api/raw', { cmd: `MIXER ${inputsCh}-${layer} CLEAR` })
					} catch (e) {
						/* best effort */
					}
				}
				// 2. Remove from extra live sources
				const routeValue = inputsCh != null ? `route://${inputsCh}-${devNum}` : `decklink://${devNum}`
				try {
					const rm = await api.post('/api/device-view', { removeExtraLiveSource: { value: routeValue } })
					if (Array.isArray(rm?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
						window.__highascgApplyExtraLiveSources(rm.extraLiveSources)
					}
				} catch (e) {
					/* best effort */
				}
				// 3. Set connector back to output
				await Actions.updateConnector(conn.id, { caspar: { ioDirection: 'out' } })
				setCasparRestartDirty(true)
				setStatus(statusEl, `DeckLink ${devNum}: input cleared; SDI output mapping updated (apply Caspar plan if prompted).`, true)
				await load()
			} catch (e) {
				setStatus(statusEl, `Failed: ${e?.message || e}`, false)
				removeBtn.disabled = false
			}
		}
		ioWrap.appendChild(removeBtn)

		// Show current status
		if (inputsCh != null) {
			const statusNote = Object.assign(document.createElement('p'), {
				className: 'device-view__note',
				textContent: `Active as input on channel ${inputsCh}, layer ${devNum}`,
				style: 'color:var(--accent);margin-top:6px',
			})
			ioWrap.appendChild(statusNote)
		}
	} else {
		// Show "Set as Input" button
		const inputBtn = Object.assign(document.createElement('button'), {
			className: 'header-btn',
			textContent: '▶ Set as Input',
			style: 'width:100%',
		})
		if (inputsCh == null) {
			inputBtn.disabled = true
			inputBtn.title = 'No inputs host channel configured. Enable DeckLink inputs in Settings → Inputs first.'
		}
		inputBtn.onclick = async () => {
			if (inputsCh == null) {
				setStatus(statusEl, 'No inputs host channel. Configure in Settings → Inputs.', false)
				return
			}
			inputBtn.disabled = true
			try {
				// 1. Set connector as input
				await Actions.updateConnector(conn.id, { caspar: { ioDirection: 'in' } })
				// 2. Play DeckLink on inputs channel via AMCP
				const layer = devNum > 0 ? devNum : 1
				try {
					await api.post('/api/raw', { cmd: `PLAY ${inputsCh}-${layer} DECKLINK ${devNum}` })
				} catch (e) {
					setStatus(statusEl, `AMCP PLAY failed: ${e?.message || e}`, false)
				}
				// 3. Add to extra live sources for Sources panel Live tab
				const routeValue = `route://${inputsCh}-${layer}`
				const liveSource = {
					value: routeValue,
					type: 'route',
					routeType: 'decklink',
					label: `DeckLink ${devNum}`,
					decklinkSlot: layer,
					inputsChannel: inputsCh,
					decklinkDevice: devNum,
					connectorId: conn.id,
				}
				try {
					const addRes = await api.post('/api/device-view', { addExtraLiveSource: liveSource })
					if (Array.isArray(addRes?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
						window.__highascgApplyExtraLiveSources(addRes.extraLiveSources)
					}
				} catch (e) {
					/* best effort */
				}
				setCasparRestartDirty(true)
				setStatus(statusEl, `DeckLink ${devNum} set as input on ch ${inputsCh}-${layer}`, true)
				await load()
			} catch (e) {
				setStatus(statusEl, `Failed: ${e?.message || e}`, false)
				inputBtn.disabled = false
			}
		}
		ioWrap.appendChild(inputBtn)

		const noteOut = Object.assign(document.createElement('p'), {
			className: 'device-view__note',
			textContent:
				'SDI output mode. Cable this BNC to a destination block in Device View to choose which PGM screen (or multiview) feeds it; otherwise PGM screen 1 is used when you apply the Caspar plan.',
			style: 'margin-top:8px;font-size:0.85rem;opacity:0.9',
		})
		ioWrap.appendChild(noteOut)
	}

	h.append(ioWrap)
}

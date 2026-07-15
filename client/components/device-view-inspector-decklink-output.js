/**
 * DeckLink output controls: inherit status, consumer settings, fill+key, rear order editor.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { DECKLINK_REAR_ORDER_KEY, readSavedDecklinkOrder, orderDecklinkConnectors } from '../lib/device-view-decklink-order.js'
import { attachMathInput } from '../lib/math-input.js'
import {
	collectDecklinkDeviceIndices,
	resolveDecklinkKeyFillState,
} from '../lib/device-view-decklink-keyfill.js'
import { STANDARD_VIDEO_MODES } from './device-view-destinations-inspector.js'
import { DECKLINK_IO_UNASSIGNED } from '../lib/decklink-io-direction.js'
import { escapeHtml } from '../lib/dom-escape.js'
import {
	DECKLINK_LATENCY_OPTIONS,
	DECKLINK_COLOR_SPACE_OPTIONS,
	DECKLINK_CHANNEL_LAYOUT_OPTIONS,
	decklinkOutputStatusForConnector,
	formatInheritedDecklinkMode,
	appendDecklinkSectionHeading,
	appendDecklinkSectionNote,
	readDecklinkConsumerCaspar,
	decklinkMergedConnectors,
} from './device-view-inspector-decklink-shared.js'

export function renderDecklinkOutputInheritControls(h, conn, { lastPayload }) {
	const status = decklinkOutputStatusForConnector(lastPayload, conn?.id)
	const box = Object.assign(document.createElement('div'), { className: 'device-view__decklink-output-inherit' })

	appendDecklinkSectionHeading(box, 'SDI output')
	appendDecklinkSectionNote(
		box,
		'SDI format is the physical raster (e.g. 1080p50, 2160p50). Upstream canvas is passed through at 1:1 — no scaling. Larger canvas overflows; smaller canvas does not fill the SDI frame.',
	)

	const inherited = status?.inherited
	const sourceLabel = inherited?.sourceLabel ? String(inherited.sourceLabel) : 'Upstream feed'
	const modeText = formatInheritedDecklinkMode(inherited)
	const sdiMode = String(status?.decklinkVideoMode || inherited?.operatorOutputMode || '').trim()
	const canvasW = inherited?.width
	const canvasH = inherited?.height

	box.append(
		Object.assign(document.createElement('p'), {
			className: 'device-view__note',
			textContent: `Upstream: ${sourceLabel} — ${modeText}`,
		}),
	)

	if (canvasW && canvasH && sdiMode) {
		box.append(
			Object.assign(document.createElement('p'), {
				className: 'device-view__note',
				style: 'font-size:11px',
				textContent: `1:1 passthrough ${canvasW}×${canvasH} → SDI ${sdiMode}`,
			}),
		)
	} else if (sdiMode) {
		box.append(
			Object.assign(document.createElement('p'), {
				className: 'device-view__note',
				style: 'font-size:11px',
				textContent: `SDI format: ${sdiMode}`,
			}),
		)
	}

	if (status && !status.ok) {
		box.append(
			Object.assign(document.createElement('p'), {
				className: 'device-view__decklink-io-note device-view__decklink-io-note--warn',
				textContent: status.reason || 'Wire a destination feed to this SDI port.',
			}),
		)
	} else if (status?.reason) {
		box.append(
			Object.assign(document.createElement('p'), {
				className: 'device-view__note',
				style: 'font-size:11px',
				textContent: status.reason,
			}),
		)
	} else if (inherited?.outputModeSource === 'override') {
		box.append(
			Object.assign(document.createElement('p'), {
				className: 'device-view__note',
				style: 'font-size:11px',
				textContent: 'Channel pixels map 1:1 onto the SDI raster (crop or letterbox, never scaled).',
			}),
		)
	}

	h.append(box)
}

export function renderDecklinkConsumerSettingsControls(h, conn, { lastPayload, statusEl, load, setCasparRestartDirty }) {
	const cur = readDecklinkConsumerCaspar(conn)
	const box = Object.assign(document.createElement('div'), { className: 'device-view__decklink-consumer-settings' })
	appendDecklinkSectionHeading(box, 'SDI consumer')

	const grid = Object.assign(document.createElement('div'), {
		className: 'device-view__inspector-grid',
		style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px',
	})

	const mkField = (labelText) => {
		const wrap = Object.assign(document.createElement('label'), { className: 'device-view__field' })
		const cap = Object.assign(document.createElement('span'), {
			className: 'device-view__field-label',
			textContent: labelText,
			style: 'display:block;font-size:10px;opacity:0.75;margin-bottom:2px',
		})
		wrap.append(cap)
		return { wrap, cap }
	}

	const modeField = mkField('SDI format')
	const modeSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	const status = decklinkOutputStatusForConnector(lastPayload, conn?.id)
	const inheritedMode = String(status?.decklinkVideoMode || '').trim()
	modeSel.innerHTML =
		'<option value="" disabled>Select SDI format…</option>' +
		STANDARD_VIDEO_MODES.map((m) => `<option value="${m}">${m}</option>`).join('')
	const savedMode = cur.outputVideoMode && STANDARD_VIDEO_MODES.includes(cur.outputVideoMode) ? cur.outputVideoMode : ''
	modeSel.value =
		savedMode ||
		(inheritedMode && STANDARD_VIDEO_MODES.includes(inheritedMode) ? inheritedMode : '')
	modeField.wrap.append(modeSel)
	grid.append(modeField.wrap)

	const layoutField = mkField('Channel layout')
	const layoutSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	for (const opt of DECKLINK_CHANNEL_LAYOUT_OPTIONS) {
		const o = document.createElement('option')
		o.value = opt.id
		o.textContent = opt.label
		layoutSel.append(o)
	}
	layoutSel.value = DECKLINK_CHANNEL_LAYOUT_OPTIONS.some((o) => o.id === cur.channelLayout) ? cur.channelLayout : 'stereo'
	layoutField.wrap.append(layoutSel)
	grid.append(layoutField.wrap)

	const latencyField = mkField('Latency')
	const latencySel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	for (const v of DECKLINK_LATENCY_OPTIONS) {
		const o = document.createElement('option')
		o.value = v
		o.textContent = v
		latencySel.append(o)
	}
	latencySel.value = DECKLINK_LATENCY_OPTIONS.includes(cur.latency) ? cur.latency : 'normal'
	latencyField.wrap.append(latencySel)
	grid.append(latencyField.wrap)

	const depthField = mkField('Buffer depth')
	const depthIn = Object.assign(document.createElement('input'), {
		type: 'number',
		min: '1',
		max: '3',
		className: 'device-view__destinations-type',
		value: String(cur.bufferDepth),
	})
	attachMathInput(depthIn, { decimals: 0 })
	depthField.wrap.append(depthIn)
	grid.append(depthField.wrap)

	const colorField = mkField('Color space')
	const colorSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	for (const v of DECKLINK_COLOR_SPACE_OPTIONS) {
		const o = document.createElement('option')
		o.value = v
		o.textContent = v
		colorSel.append(o)
	}
	colorSel.value = DECKLINK_COLOR_SPACE_OPTIONS.includes(cur.colorSpace) ? cur.colorSpace : 'bt709'
	colorField.wrap.append(colorSel)
	grid.append(colorField.wrap)

	const audioRow = Object.assign(document.createElement('label'), {
		className: 'device-view__field',
		style: 'grid-column:1 / -1;display:flex;align-items:center;gap:6px;margin-top:4px',
	})
	const audioCheck = Object.assign(document.createElement('input'), { type: 'checkbox' })
	audioCheck.checked = cur.embeddedAudio
	audioRow.append(audioCheck, Object.assign(document.createElement('span'), { textContent: 'Embedded audio on SDI' }))
	grid.append(audioRow)

	const lowLatencyRow = Object.assign(document.createElement('label'), {
		className: 'device-view__field',
		style: 'grid-column:1 / -1;display:flex;align-items:center;gap:6px;margin-top:4px',
	})
	const lowLatencyCheck = Object.assign(document.createElement('input'), { type: 'checkbox' })
	lowLatencyCheck.checked = cur.lowLatency === true
	lowLatencyRow.append(lowLatencyCheck, Object.assign(document.createElement('span'), { textContent: 'Low-latency mode' }))
	grid.append(lowLatencyRow)

	box.append(grid)
	h.append(box)

	let saving = false
	const persist = async () => {
		if (saving) return
		const selectedMode = String(modeSel.value || '').trim()
		if (!selectedMode || !STANDARD_VIDEO_MODES.includes(selectedMode)) {
			setStatus(statusEl, 'Select an SDI format.', false)
			return
		}
		saving = true
		const casparPatch = {
			ioDirection: 'out',
			decklinkOutputVideoMode: selectedMode,
			decklinkEmbeddedAudio: audioCheck.checked,
			decklinkChannelLayout: String(layoutSel.value || 'stereo'),
			decklinkLatency: String(latencySel.value || 'normal'),
			decklinkBufferDepth: Math.min(3, Math.max(1, parseInt(String(depthIn.value || '3'), 10) || 3)),
			decklinkColorSpace: String(colorSel.value || 'bt709'),
			decklinkLowLatency: lowLatencyCheck.checked,
		}
		if (conn?.caspar?.outputBinding) casparPatch.outputBinding = conn.caspar.outputBinding
		if (conn?.caspar?.decklinkKeyFill != null) casparPatch.decklinkKeyFill = conn.caspar.decklinkKeyFill
		if (conn?.caspar?.decklinkKeyDevice != null) casparPatch.decklinkKeyDevice = conn.caspar.decklinkKeyDevice
		if (conn?.caspar?.decklinkKeyer != null) casparPatch.decklinkKeyer = conn.caspar.decklinkKeyer
		try {
			await Actions.updateConnector(conn.id, { caspar: casparPatch })
			setCasparRestartDirty(true)
			setStatus(statusEl, 'SDI settings saved.', true)
			await load()
		} catch (e) {
			setStatus(statusEl, `Save failed: ${e?.message || e}`, false)
		} finally {
			saving = false
		}
	}

	for (const el of [modeSel, layoutSel, latencySel, colorSel, depthIn, audioCheck, lowLatencyCheck]) {
		el.addEventListener('change', () => void persist())
	}
}

export function renderDecklinkKeyFillControls(h, conn, { lastPayload, statusEl, load, setCasparRestartDirty }) {
	const { fillDevice, keyFillEnabled, keyDevice } = resolveDecklinkKeyFillState(conn, lastPayload)
	const keyIndices = collectDecklinkDeviceIndices(lastPayload, { exclude: fillDevice })

	const box = Object.assign(document.createElement('div'), {
		className: 'device-view__decklink-kf',
	})
	const row = Object.assign(document.createElement('div'), { className: 'device-view__decklink-kf-row' })

	const kfFieldId = `decklink_kf_on_${String(conn?.id || fillDevice).replace(/[^a-zA-Z0-9_-]/g, '_')}`
	const kfCheck = Object.assign(document.createElement('input'), { type: 'checkbox', id: kfFieldId })
	kfCheck.checked = keyFillEnabled
	const kfLbl = Object.assign(document.createElement('label'), { htmlFor: kfFieldId, textContent: 'Fill + key' })

	const keySel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	keySel.innerHTML = '<option value="0">Key port…</option>'
	for (const idx of keyIndices) {
		const opt = document.createElement('option')
		opt.value = String(idx)
		opt.textContent = String(idx)
		keySel.append(opt)
	}
	if (keyDevice > 0 && !keyIndices.includes(keyDevice)) {
		const opt = document.createElement('option')
		opt.value = String(keyDevice)
		opt.textContent = String(keyDevice)
		keySel.append(opt)
	}
	if (keyDevice > 0) keySel.value = String(keyDevice)
	else if (keyIndices.length) keySel.value = String(keyIndices[0])

	const syncKeyUi = () => {
		keySel.disabled = !kfCheck.checked
	}
	syncKeyUi()

	row.append(kfCheck, kfLbl, keySel)
	box.append(row)
	h.append(box)

	let saving = false
	const persist = async () => {
		if (saving) return
		saving = true
		const enabled = kfCheck.checked
		const kd = enabled ? parseInt(String(keySel.value || '0'), 10) || 0 : 0
		if (enabled && fillDevice > 0 && kd > 0 && kd === fillDevice) {
			setStatus(statusEl, 'Key port must differ from fill.', false)
			saving = false
			return
		}
		if (enabled && kd <= 0) {
			setStatus(statusEl, 'Choose key port.', false)
			saving = false
			return
		}
		const casparPatch = {
			ioDirection: 'out',
			decklinkKeyFill: enabled,
			decklinkKeyDevice: enabled ? kd : 0,
			decklinkKeyer: 'internal',
		}
		if (conn?.caspar?.outputBinding) casparPatch.outputBinding = conn.caspar.outputBinding
		try {
			await Actions.updateConnector(conn.id, { caspar: casparPatch })
			setCasparRestartDirty(true)
			setStatus(statusEl, enabled ? `Key on port ${kd}.` : 'Fill only.', true)
			await load()
		} catch (e) {
			setStatus(statusEl, `Save failed: ${e?.message || e}`, false)
		} finally {
			saving = false
		}
	}

	kfCheck.addEventListener('change', () => {
		syncKeyUi()
		if (kfCheck.checked && (parseInt(String(keySel.value || '0'), 10) || 0) <= 0 && keyIndices.length) {
			keySel.value = String(keyIndices[0])
		}
		void persist()
	})
	keySel.addEventListener('change', () => void persist())
}

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

export function renderDecklinkOutputSection(outputSection, conn, { lastPayload, statusEl, load, setCasparRestartDirty, isCurrentlyInput, ioDir }) {
	if (isCurrentlyInput) {
		appendDecklinkSectionNote(
			outputSection,
			'This port is in input mode. Stop input above to use it as a program / fill+key output.',
		)
	} else {
		if (ioDir === DECKLINK_IO_UNASSIGNED) {
			appendDecklinkSectionNote(
				outputSection,
				'Unassigned SDI port. Cable a screen destination here to use as program output, or configure fill+key below.',
			)
		} else {
			appendDecklinkSectionNote(outputSection, 'Program output, fill+key pairs, and destination mapping.')
		}
		renderDecklinkOutputInheritControls(outputSection, conn, { lastPayload })
		renderDecklinkConsumerSettingsControls(outputSection, conn, { lastPayload, statusEl, load, setCasparRestartDirty })
		renderDecklinkKeyFillControls(outputSection, conn, { lastPayload, statusEl, load, setCasparRestartDirty })
	}
}

/**
 * DeckLink IO controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { api } from '../lib/api-client.js'
import { CASPAR_HOST } from './device-view-helpers.js'
import { DECKLINK_REAR_ORDER_KEY, readSavedDecklinkOrder, orderDecklinkConnectors } from '../lib/device-view-decklink-order.js'
import {
	collectDecklinkDeviceIndices,
	resolveDecklinkKeyFillState,
} from '../lib/device-view-decklink-keyfill.js'
import { decklinkInputForSlot, decklinkSlotFromConnector, routeForDecklinkSlot } from '../lib/input-channels.js'
import { STANDARD_VIDEO_MODES } from './device-view-destinations-inspector.js'
import { normalizeDecklinkIoDirection, DECKLINK_IO_UNASSIGNED } from '../lib/decklink-io-direction.js'

const DECKLINK_LATENCY_OPTIONS = ['normal', 'low', 'default']
const DECKLINK_COLOR_SPACE_OPTIONS = ['bt709', 'bt601', 'bt2020']
const DECKLINK_CHANNEL_LAYOUT_OPTIONS = [
	{ id: 'stereo', label: 'Stereo' },
	{ id: 'mono', label: 'Mono' },
	{ id: '8ch', label: '8ch (discrete)' },
]

function decklinkOutputStatusForConnector(lastPayload, connectorId) {
	const outputs = Array.isArray(lastPayload?.live?.decklink?.outputs) ? lastPayload.live.decklink.outputs : []
	return outputs.find((o) => String(o?.connectorId || '') === String(connectorId || '')) || null
}

function formatInheritedDecklinkMode(inherited) {
	if (!inherited) return '—'
	const mode = String(inherited.standardModeId || inherited.videoMode || '').trim()
	const w = inherited.width
	const h = inherited.height
	const fps = inherited.fps
	if (mode && w && h && fps) return `${mode} (${w}×${h} @ ${fps} Hz)`
	if (mode) return mode
	if (w && h && fps) return `${w}×${h} @ ${fps} Hz`
	return '—'
}

function renderDecklinkOutputInheritControls(h, conn, { lastPayload }) {
	const status = decklinkOutputStatusForConnector(lastPayload, conn?.id)
	const box = Object.assign(document.createElement('div'), { className: 'device-view__decklink-output-inherit' })

	appendDecklinkSectionHeading(box, 'SDI output')
	appendDecklinkSectionNote(
		box,
		'SDI format is the physical raster (e.g. 1080p50, 2160p50). Upstream canvas is passed through at 1:1 — no scaling. Larger canvas overflows; smaller canvas does not fill the SDI frame.'
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
		})
	)

	if (canvasW && canvasH && sdiMode) {
		box.append(
			Object.assign(document.createElement('p'), {
				className: 'device-view__note',
				style: 'font-size:11px',
				textContent: `1:1 passthrough ${canvasW}×${canvasH} → SDI ${sdiMode}`,
			})
		)
	} else if (sdiMode) {
		box.append(
			Object.assign(document.createElement('p'), {
				className: 'device-view__note',
				style: 'font-size:11px',
				textContent: `SDI format: ${sdiMode}`,
			})
		)
	}

	if (status && !status.ok) {
		box.append(
			Object.assign(document.createElement('p'), {
				className: 'device-view__decklink-io-note device-view__decklink-io-note--warn',
				textContent: status.reason || 'Wire a destination feed to this SDI port.',
			})
		)
	} else if (status?.reason) {
		box.append(
			Object.assign(document.createElement('p'), {
				className: 'device-view__note',
				style: 'font-size:11px',
				textContent: status.reason,
			})
		)
	} else if (inherited?.outputModeSource === 'override') {
		box.append(
			Object.assign(document.createElement('p'), {
				className: 'device-view__note',
				style: 'font-size:11px',
				textContent: 'Channel pixels map 1:1 onto the SDI raster (crop or letterbox, never scaled).',
			})
		)
	}

	h.append(box)
}

function readDecklinkConsumerCaspar(conn) {
	const c = conn?.caspar || {}
	return {
		outputVideoMode: String(c.decklinkOutputVideoMode || '').trim(),
		embeddedAudio: c.decklinkEmbeddedAudio !== false && c.decklinkEmbeddedAudio !== 'false',
		channelLayout: String(c.decklinkChannelLayout || 'stereo').toLowerCase(),
		latency: String(c.decklinkLatency || 'normal').toLowerCase(),
		bufferDepth: Math.min(3, Math.max(1, parseInt(String(c.decklinkBufferDepth ?? 3), 10) || 3)),
		colorSpace: String(c.decklinkColorSpace || 'bt709').toLowerCase(),
	}
}

function renderDecklinkConsumerSettingsControls(h, conn, { lastPayload, statusEl, load, setCasparRestartDirty }) {
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

	for (const el of [modeSel, layoutSel, latencySel, colorSel, depthIn, audioCheck]) {
		el.addEventListener('change', () => void persist())
	}
}

function decklinkMergedConnectors(lastPayload) {
	const sug = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
	const deckIo = sug.filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'decklink_io')
	const deckOut = sug.filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'decklink_out')
	return [...deckIo, ...deckOut].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
}

function renderDecklinkKeyFillControls(h, conn, { lastPayload, statusEl, load, setCasparRestartDirty }) {
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

function appendDecklinkSectionHeading(parent, text) {
	parent.append(
		Object.assign(document.createElement('h4'), {
			className: 'device-view__decklink-io-heading',
			textContent: text,
		})
	)
}

function appendDecklinkSectionNote(parent, text) {
	parent.append(
		Object.assign(document.createElement('p'), {
			className: 'device-view__decklink-io-note',
			textContent: text,
		})
	)
}

export function renderDeckLinkIoControls(h, conn, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty }) {
	renderDecklinkRearOrderEditor(h, { lastPayload, load })

	if (conn?.kind === 'decklink_out') {
		renderDecklinkOutputInheritControls(h, conn, { lastPayload })
		renderDecklinkConsumerSettingsControls(h, conn, { lastPayload, statusEl, load, setCasparRestartDirty })
		renderDecklinkKeyFillControls(h, conn, { lastPayload, statusEl, load, setCasparRestartDirty })
		return
	}

	const ioDir = normalizeDecklinkIoDirection(conn?.caspar)
	const devNum = parseInt(String(conn?.externalRef || '0'), 10) || 0
	const slot = decklinkSlotFromConnector(conn)
	const channelMap = lastPayload?.live?.caspar?.channelMap || currentSettings?.channelMap || {}
	const inputEntry = decklinkInputForSlot(channelMap, slot)
	const isCurrentlyInput = ioDir === 'in'

	const ioWrap = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })

	const inputSection = Object.assign(document.createElement('div'), { className: 'device-view__decklink-io-section' })
	appendDecklinkSectionHeading(inputSection, 'Input')
	appendDecklinkSectionNote(
		inputSection,
		'Each DeckLink input uses its own Caspar channel so you can meter and route it independently. Drag the input from Sources onto other layers.'
	)

	if (isCurrentlyInput) {
		const removeBtn = Object.assign(document.createElement('button'), {
			className: 'header-btn',
			textContent: 'Stop input',
			style: 'width:100%',
		})
		removeBtn.onclick = async () => {
			removeBtn.disabled = true
			try {
				if (inputEntry?.channel != null) {
					const layer = inputEntry.layer ?? slot
					const cl = `${inputEntry.channel}-${layer}`
					try {
						await api.post('/api/raw', { cmd: `STOP ${cl}` })
						await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` })
					} catch (e) {
						/* best effort */
					}
				}
				const routeValue = routeForDecklinkSlot(channelMap, slot) || `decklink://${devNum}`
				try {
					const rm = await api.post('/api/device-view', { removeExtraLiveSource: { value: routeValue } })
					if (Array.isArray(rm?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
						window.__highascgApplyExtraLiveSources(rm.extraLiveSources)
					}
				} catch (e) {
					/* best effort */
				}
				await Actions.updateConnector(conn.id, { caspar: { ioDirection: DECKLINK_IO_UNASSIGNED } })
				setCasparRestartDirty(true)
				setStatus(statusEl, `Port ${devNum}: unassigned.`, true)
				await load()
			} catch (e) {
				setStatus(statusEl, `Failed: ${e?.message || e}`, false)
				removeBtn.disabled = false
			}
		}
		inputSection.appendChild(removeBtn)

		if (inputEntry?.channel != null) {
			inputSection.append(
				Object.assign(document.createElement('p'), {
					className: 'device-view__note',
					style: 'margin-top:8px;font-size:11px',
					textContent: `Live on ch ${inputEntry.channel} · layer ${inputEntry.layer ?? slot} · ${inputEntry.route || ''}`,
				})
			)
		}
	} else {
		const formBox = Object.assign(document.createElement('div'), { className: 'device-view__decklink-input-setup' })

		if (inputEntry == null && ioDir !== DECKLINK_IO_UNASSIGNED) {
			appendDecklinkSectionNote(
				formBox,
				`Configure DeckLink input count in Settings (slot ${slot} needs a dedicated channel). Apply Caspar config and restart before using this port as input.`
			)
		} else if (ioDir === DECKLINK_IO_UNASSIGNED) {
			appendDecklinkSectionNote(
				formBox,
				'Starts a dedicated Caspar host channel for this SDI port. After restart, the input loops on that channel.'
			)
		}

		const activateBtn = Object.assign(document.createElement('button'), {
			className: 'header-btn',
			textContent: 'Start an input',
			style: 'width:100%;margin-top:8px',
		})

		activateBtn.onclick = async () => {
			activateBtn.disabled = true

			try {
				await Actions.updateConnector(conn.id, { caspar: { ioDirection: 'in' } })

				const refetched = await Actions.loadDeviceView()
				const newMap = refetched?.live?.caspar?.channelMap || refetched?.suggested?.channelMap || {}
				const entry = decklinkInputForSlot(newMap, slot)
				const layer = entry?.layer ?? slot
				const playCh = entry?.channel

				if (playCh != null && devNum > 0) {
					try {
						await api.post('/api/raw', { cmd: `PLAY ${playCh}-${layer} DECKLINK ${devNum}` })
					} catch (e) {
						console.warn('[decklink-input] immediate PLAY failed', e)
					}

					const routeValue = entry?.route || routeForDecklinkSlot(newMap, slot)
					if (routeValue) {
						const liveSource = {
							value: routeValue,
							type: 'route',
							routeType: 'decklink',
							label: entry?.label || `DeckLink ${slot}`,
							decklinkSlot: slot,
							inputsChannel: playCh,
							inputsLayer: layer,
							decklinkDevice: devNum,
							connectorId: conn.id,
						}
						try {
							const addRes = await api.post('/api/device-view', { addExtraLiveSource: liveSource })
							if (Array.isArray(addRes?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
								window.__highascgApplyExtraLiveSources(addRes.extraLiveSources)
							}
						} catch (e) {
							console.warn('[decklink-input] add extra live source failed', e)
						}
					}
				} else {
					setStatus(statusEl, `Port marked input. Set decklink_input_count ≥ ${slot} and restart Caspar.`, false)
				}

				setCasparRestartDirty(true)
				setStatus(statusEl, playCh != null ? `Port ${devNum} is input on ch ${playCh}.` : `Port ${devNum} is input.`, true)
				await load()
			} catch (e) {
				setStatus(statusEl, `Failed: ${e?.message || e}`, false)
				activateBtn.disabled = false
			}
		}

		formBox.appendChild(activateBtn)
		inputSection.appendChild(formBox)
	}

	ioWrap.appendChild(inputSection)

	ioWrap.append(Object.assign(document.createElement('hr'), { className: 'device-view__section-divider' }))

	const outputSection = Object.assign(document.createElement('div'), { className: 'device-view__decklink-io-section' })
	appendDecklinkSectionHeading(outputSection, 'Output')

	if (isCurrentlyInput) {
		appendDecklinkSectionNote(
			outputSection,
			'This port is in input mode. Stop input above to use it as a program / fill+key output.'
		)
	} else {
		if (ioDir === DECKLINK_IO_UNASSIGNED) {
			appendDecklinkSectionNote(
				outputSection,
				'Unassigned SDI port. Cable a screen destination here to use as program output, or configure fill+key below.'
			)
		} else {
			appendDecklinkSectionNote(outputSection, 'Program output, fill+key pairs, and destination mapping.')
		}
		renderDecklinkOutputInheritControls(outputSection, conn, { lastPayload })
		renderDecklinkConsumerSettingsControls(outputSection, conn, { lastPayload, statusEl, load, setCasparRestartDirty })
		renderDecklinkKeyFillControls(outputSection, conn, { lastPayload, statusEl, load, setCasparRestartDirty })
	}

	ioWrap.appendChild(outputSection)
	h.append(ioWrap)
}

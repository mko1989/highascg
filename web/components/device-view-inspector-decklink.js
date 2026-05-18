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

		// Premium, highly transparent Active Route Card
		if (inputsCh != null) {
			const routeStr = `route://${inputsCh}-${devNum}`
			const activeCard = Object.assign(document.createElement('div'), {
				style: 'margin-top: 10px; width: 100%; background: #202020; border: 1px solid #444; border-radius: 6px; padding: 10px; box-shadow: inset 0 0 6px rgba(0,0,0,0.4);'
			})
			activeCard.innerHTML = `
				<div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
					<span style="display: inline-block; width: 8px; height: 8px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 6px #22c55e; animation: pulse-green 1.5s infinite;"></span>
					<span style="font-weight: bold; font-size: 11px; color: #bbb; text-transform: uppercase;">Active Input Port</span>
				</div>
				<div style="font-size: 11px; color: #888; margin-bottom: 8px;">
					Playing on channel <strong style="color:#eee">${inputsCh}</strong>, layer <strong style="color:#eee">${devNum}</strong>
				</div>
				<div style="font-size: 10px; color: #aaa; margin-bottom: 4px;">ACTIVE ROUTE STRING</div>
				<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: #151515; border: 1px solid #333; border-radius: 4px; padding: 4px 6px;">
					<code style="font-family: monospace; font-size: 11.5px; color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${routeStr}</code>
					<button class="header-btn" style="padding: 2px 6px; font-size: 10px; margin: 0; flex-shrink: 0;" id="copy-decklink-route-btn">Copy</button>
				</div>
				<style>
					@keyframes pulse-green {
						0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
						70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
						100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
					}
				</style>
			`
			
			const copyBtn = activeCard.querySelector('#copy-decklink-route-btn')
			if (copyBtn) {
				copyBtn.onclick = () => {
					navigator.clipboard.writeText(routeStr).then(() => {
						const originalText = copyBtn.textContent
						copyBtn.textContent = 'Copied!'
						copyBtn.style.borderColor = '#22c55e'
						copyBtn.style.color = '#22c55e'
						setTimeout(() => {
							copyBtn.textContent = originalText
							copyBtn.style.borderColor = ''
							copyBtn.style.color = ''
						}, 1500)
					}).catch((err) => {
						console.error('[decklink-input] Copy failed', err)
					})
				}
			}
			ioWrap.appendChild(activeCard)
		}
	} else {
		// New premium configuration form for setting BNC as Input
		const formBox = Object.assign(document.createElement('div'), {
			style: 'width:100%; border: 1px dashed #444; border-radius: 6px; padding: 12px; background: #222228; margin-top: 8px;'
		})
		
		const currentHostType = String(currentSettings?.casparServer?.decklink_inputs_host || 'multiview_if_match')
		const currentInputsMode = String(currentSettings?.casparServer?.inputs_channel_mode || '1080p5000')
		
		const mvrActive = lastPayload?.live?.caspar?.channelMap?.multiviewCh != null || currentSettings?.channelMap?.multiviewCh != null
		const mvrWarning = !mvrActive ? '<div style="color: #e3a008; font-size: 10px; margin-top: 4px;">⚠️ No active multiview destination found. Configure one in Destinations first.</div>' : ''

		formBox.innerHTML = `
			<div style="font-weight: bold; margin-bottom: 8px; font-size: 11.5px; color: var(--accent); letter-spacing: 0.05em; text-transform: uppercase;">Configure as Input Port</div>
			<p style="font-size: 11px; opacity: 0.85; margin: 0 0 12px; line-height: 1.4;">
				This port will capture an external SDI feed. Select the hosting/routing layout in CasparCG:
			</p>
			
			<div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px;">
				<label style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer; font-size: 11.5px;">
					<input type="radio" name="decklink_host_choice" value="multiview" ${currentHostType !== 'dedicated' ? 'checked' : ''} style="margin-top: 2px;" />
					<div>
						<strong>Option A: Play on Multiview layers (under MV content)</strong>
						<div style="font-size: 10px; opacity: 0.65; margin-top: 2px; line-height: 1.3;">
							Hosts on existing Multiview channel layers (layers 1-8). Highly efficient; no extra channels created.
						</div>
						${mvrWarning}
					</div>
				</label>
				
				<label style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer; font-size: 11.5px;">
					<input type="radio" name="decklink_host_choice" value="dedicated" ${currentHostType === 'dedicated' ? 'checked' : ''} style="margin-top: 2px;" />
					<div>
						<strong>Option B: Dedicated Inputs-Only Channel</strong>
						<div style="font-size: 10px; opacity: 0.65; margin-top: 2px; line-height: 1.3;">
							Generates a new dedicated inputs-only channel slot in the CasparCG configuration.
						</div>
					</div>
				</label>
			</div>
			
			<div id="decklink_video_mode_wrapper" style="border-top: 1px solid #333; padding-top: 8px; margin-bottom: 12px;">
				<label style="display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px;">
					<span>Video Mode:</span>
					<select id="decklink_video_mode_select" class="device-view__destinations-type" style="padding: 2px 4px; font-size: 11px; margin: 0; width: auto; min-width: 120px;">
						<option value="1080p5000">1080p50</option>
						<option value="1080p5994">1080p59.94</option>
						<option value="1080p6000">1080p60</option>
						<option value="720p5000">720p50</option>
						<option value="720p5994">720p59.94</option>
						<option value="2160p5000">2160p50</option>
					</select>
				</label>
			</div>
		`
		
		const hostRadios = formBox.querySelectorAll('input[name="decklink_host_choice"]')
		const videoModeWrap = formBox.querySelector('#decklink_video_mode_wrapper')
		const videoModeSelect = formBox.querySelector('#decklink_video_mode_select')
		
		if (videoModeSelect) {
			videoModeSelect.value = currentInputsMode
		}
		
		const updateFormVisibility = () => {
			const selected = formBox.querySelector('input[name="decklink_host_choice"]:checked')?.value
			videoModeWrap.style.display = selected === 'dedicated' ? 'flex' : 'none'
		}
		
		hostRadios.forEach((r) => r.addEventListener('change', updateFormVisibility))
		updateFormVisibility()

		const activateBtn = Object.assign(document.createElement('button'), {
			className: 'header-btn',
			textContent: '▶ Activate Input Port',
			style: 'width: 100%; font-weight: 600;',
		})
		
		activateBtn.onclick = async () => {
			activateBtn.disabled = true
			const selected = formBox.querySelector('input[name="decklink_host_choice"]:checked')?.value
			const selectedVideoMode = videoModeSelect?.value || '1080p5000'
			
			try {
				const csPatch = {
					decklink_inputs_host_channel_enabled: true
				}
				
				if (selected === 'multiview') {
					csPatch.decklink_inputs_host = 'multiview_if_match'
					const mvMode = currentSettings?.casparServer?.multiview_mode || lastPayload?.live?.caspar?.multiview_mode || '1080p5000'
					csPatch.inputs_channel_mode = mvMode
				} else {
					csPatch.decklink_inputs_host = 'dedicated'
					csPatch.inputs_channel_mode = selectedVideoMode
				}
				
				// 1. Save settings patch
				await Actions.saveSettingsPatch({ casparServer: csPatch })
				
				// 2. Set connector as input on device view graph
				await Actions.updateConnector(conn.id, { caspar: { ioDirection: 'in' } })
				
				// 3. Trigger immediate play if inputs channel is available
				const refetched = await Actions.loadDeviceView()
				const newMap = refetched?.live?.caspar?.channelMap || refetched?.suggested?.channelMap || {}
				const newInputsCh = newMap.inputsCh
				
				const layer = devNum > 0 ? devNum : 1
				
				if (newInputsCh != null) {
					try {
						await api.post('/api/raw', { cmd: `PLAY ${newInputsCh}-${layer} DECKLINK ${devNum}` })
					} catch (e) {
						console.warn('[decklink-input] immediate PLAY failed', e)
					}
					
					// Add to extra live sources
					const routeValue = `route://${newInputsCh}-${layer}`
					const liveSource = {
						value: routeValue,
						type: 'route',
						routeType: 'decklink',
						label: `DeckLink ${devNum}`,
						decklinkSlot: layer,
						inputsChannel: newInputsCh,
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
				
				setCasparRestartDirty(true)
				
				let msg = `DeckLink ${devNum} set as input.`
				if (selected === 'dedicated') {
					msg += ` Created new dedicated inputs channel (${selectedVideoMode}). Caspar restart required.`
				} else {
					if (newInputsCh != null) {
						msg += ` Playing on multiview channel ${newInputsCh}, layer ${layer}.`
					} else {
						msg += ` Configured to host on multiview layers. Multiview setup required.`
					}
				}
				
				setStatus(statusEl, msg, true)
				await load()
			} catch (e) {
				setStatus(statusEl, `Failed: ${e?.message || e}`, false)
				activateBtn.disabled = false
			}
		}
		
		formBox.appendChild(activateBtn)
		ioWrap.appendChild(formBox)

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

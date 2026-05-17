/**
 * CasparCG Rear Panel Rendering for Device View.
 */
import { CASPAR_HOST, decklinkInputState, stateClass, connectorById } from './device-view-helpers.js'
import { DECKLINK_REAR_ORDER_KEY, readSavedDecklinkOrder, orderDecklinkConnectors } from '../lib/device-view-decklink-order.js'

let gpuEditMode = false
let decklinkEditMode = false

export function renderCasparBand(ctx) {
	const { live, lastPayload, selectDevice, onPortClick, onPortStartCable, selectedConnectorId, cableSourceId } = ctx
	const casparBand = document.createElement('div')
	casparBand.className = 'device-view__band device-view__band--caspar'
	if (gpuEditMode) casparBand.classList.add('device-view--edit-mode')
	const cc = live.caspar
	casparBand.innerHTML = `<h3>Rear panel</h3><p class="device-view__note">Connected: <strong>${
		cc?.connected ? 'yes' : 'no'
	}</strong> · ${
		cc?.host != null && cc?.port != null ? `${cc.host}:${cc.port}` : ''
	}</p><div class="device-view__backpanel device-view__backpanel--caspar"><div class="device-view__backpanel-slots" data-caspar-slots></div><div class="device-view__backpanel-overlay" data-caspar-overlay></div></div>`
	
	const slotsEl = casparBand.querySelector('[data-caspar-slots]')
	const casparOverlay = casparBand.querySelector('[data-caspar-overlay]')
	const gpuInventoryRaw = Array.isArray(live?.gpu?.connectors) ? live.gpu.connectors : []
	const gpuInventory = gpuInventoryRaw.filter((inv) => {
		const name = String(inv?.shortName || inv?.name || '').trim().toLowerCase()
		if (!name) return false
		if (/^card\d+($|[\s:])/.test(name) || /^gpu\d+($|[\s:])/.test(name) || /^renderd\d+($|[\s:])/.test(name)) return false
		return true
	})
	const graphConnectors = Array.isArray(lastPayload?.graph?.connectors) ? lastPayload.graph.connectors : []
	const suggestedConnectors = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
	const allConnectors = [...graphConnectors, ...suggestedConnectors]
	const gpuOuts = allConnectors
		.filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'gpu_out')
		.filter((c, i, arr) => arr.findIndex((x) => x?.id === c?.id) === i)
	const gpuPhysicalPorts = Array.isArray(live?.gpu?.physicalMap?.ports) ? live.gpu.physicalMap.ports : []
	const deckIo = (lastPayload?.suggested?.connectors || []).filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'decklink_io')
	const deckOut = (lastPayload?.suggested?.connectors || []).filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'decklink_out')
	const streamOut = (lastPayload?.suggested?.connectors || []).filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'stream_out')
	const recordOut = (lastPayload?.suggested?.connectors || []).filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'record_out')
	const audioOuts = (lastPayload?.suggested?.connectors || []).filter((c) => c && c.deviceId === CASPAR_HOST && (c.kind === 'audio_out' || c.kind === 'audio_in'))
	const audioInventory = Array.isArray(live?.audio?.portaudio) ? live.audio.portaudio : []
	const casparConnectors = (lastPayload?.suggested?.connectors || []).filter(
		(c) => c && c.deviceId === CASPAR_HOST && ['gpu_out', 'decklink_out', 'decklink_in', 'audio_out', 'audio_in', 'stream_out', 'record_out'].includes(c.kind)
	)

	const slots = []
	const shortDp = (v) => String(v || '').trim().toUpperCase().replace(/^DP-?/i, '')
	const normGpuName = (v) => String(v || '').trim().replace(/^card\d+-/i, '').toLowerCase()
	const gpuConnectorIdFromName = (v) => {
		const base = String(v || '').trim().replace(/^card\d+-/i, '')
		if (!base) return ''
		return `gpu_${base.toUpperCase()}`
	}
	const gpuDisplays = Array.isArray(live?.gpu?.displays) ? live.gpu.displays : []

	/** RandR names may be DP-0 or card0-DP-0 depending on source. */
	const normRandr = (v) => String(v || '').trim().toUpperCase().replace(/^CARD\d+-/i, '')
	/**
	 * Map a UI slot's RandR pair to the canonical graph connector id (e.g. gpu_p0).
	 * Prefer runtime.activePort when it matches the slot pair so cabling uses the same id as suggested.connectors.
	 */
	const resolveCanonicalGpuConnectorId = (pairs, physicalPorts, suggestedGpuOuts) => {
		if (!Array.isArray(pairs) || !pairs.length) return ''
		const set = new Set(pairs.map((p) => normRandr(p)).filter(Boolean))
		if (set.size === 0) return ''
		for (const p of physicalPorts || []) {
			const act = normRandr(p?.runtime?.activePort)
			if (act && set.has(act)) return String(p.physicalPortId || '').trim()
		}
		for (const p of physicalPorts || []) {
			const a = normRandr(p?.pair?.dpA)
			const b = normRandr(p?.pair?.dpB)
			if ((a && set.has(a)) || (b && set.has(b))) return String(p.physicalPortId || '').trim()
		}
		for (const c of suggestedGpuOuts || []) {
			const ref = normRandr(c?.externalRef)
			if (ref && set.has(ref)) return String(c.id || '').trim()
			const a = normRandr(c?.gpuPhysical?.pair?.dpA)
			const b = normRandr(c?.gpuPhysical?.pair?.dpB)
			if ((a && set.has(a)) || (b && set.has(b))) return String(c.id || '').trim()
		}
		return ''
	}
	
	const gpuModel = String(live?.gpu?.model || '').toUpperCase()
	const gpuLayoutPresets = {
		'2080': [
			{ id: 'gpu_p0_1', label: 'DP 0/1', pairs: ['DP-0', 'DP-1'], type: 'dp' },
			{ id: 'gpu_p2_3', label: 'HDMI 0/1', pairs: ['HDMI-0', 'HDMI-1'], type: 'hdmi' },
			{ id: 'gpu_p4_5', label: 'DP 2/3', pairs: ['DP-2', 'DP-3'], type: 'dp' },
			{ id: 'gpu_p6_7', label: 'DP 4/5', pairs: ['DP-4', 'DP-5'], type: 'dp' },
		],
		'DEFAULT': [
			{ id: 'gpu_p0_1', label: 'DP 0/1', pairs: ['DP-0', 'DP-1'], type: 'dp' },
			{ id: 'gpu_p2_3', label: 'HDMI 0/1', pairs: ['HDMI-0', 'HDMI-1'], type: 'hdmi' },
			{ id: 'gpu_p4_5', label: 'DP 2/3', pairs: ['DP-2', 'DP-3'], type: 'dp' },
			{ id: 'gpu_p6_7', label: 'DP 4/5', pairs: ['DP-4', 'DP-5'], type: 'dp' },
		]
	}
	const defaultGpuItems = gpuModel.includes('2080') ? gpuLayoutPresets['2080'] : gpuLayoutPresets['DEFAULT']
	const savedLayout = localStorage.getItem('gpu_custom_layout')
	const customGpuItems = savedLayout ? JSON.parse(savedLayout) : [...defaultGpuItems]
	
	defaultGpuItems.forEach(def => {
		if (!customGpuItems.find(x => x.id === def.id)) {
			customGpuItems.push({ ...def })
		}
	})

	document.addEventListener('gpu-layout-changed', (e) => {
		const { id, pairs, label, hidden } = e.detail
		const item =
			customGpuItems.find((x) => x.id === id) ||
			customGpuItems.find(
				(x) => resolveCanonicalGpuConnectorId(x.pairs, gpuPhysicalPorts, gpuOuts) === String(id || '').trim()
			)
		if (item) {
			if (label) item.label = label
			if (Array.isArray(pairs)) {
				item.pairs = pairs
				item.type = pairs.some(p => String(p).toLowerCase().includes('hdmi')) ? 'hdmi' : 'dp'
			}
			item.hidden = !!hidden
			
			const connected = item.pairs.some((pName) =>
				connectedDisplays.some((d) => d.connected && normRandr(d.name) === normRandr(pName))
			)
			item.connected = connected
			const canonicalId =
				resolveCanonicalGpuConnectorId(item.pairs, gpuPhysicalPorts, gpuOuts) || item.id
			
			const element = casparOverlay.querySelector(`[data-layout-slot-id="${item.id}"]`)
			if (element) {
				const labelEl = element.querySelector('.device-view__panel-marker-label')
				if (labelEl) labelEl.textContent = item.label
				
				element.className =
					'device-view__panel-marker ' +
					resolveStatusClass({ ...item, connectorId: canonicalId, kind: 'gpu_out' })
				if (gpuEditMode) element.classList.add('device-view__panel-marker--editable')
				element.classList.add('device-view__panel-marker--gpu')
				
				if (hidden) {
					element.style.display = 'none'
				} else {
					element.style.display = ''
				}
			}
		}
	})
	
	document.addEventListener('gpu-layout-save', (e) => {
		const fromInspector = e?.detail?.items
		const toSave = Array.isArray(fromInspector) ? fromInspector : customGpuItems
		localStorage.setItem('gpu_custom_layout', JSON.stringify(toSave))
		alert('GPU layout saved to local storage!')
	})
	
	document.addEventListener('gpu-layout-export', (e) => {
		const fromInspector = e?.detail?.items
		const toExport = Array.isArray(fromInspector) ? fromInspector : customGpuItems
		const gpuModel = live?.gpu?.model || 'NVIDIA_GPU'
		const totalPorts = toExport.length
		const filename = `${gpuModel}_${totalPorts}ports_layout.json`.replace(/\s+/g, '_')
		
		const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(toExport, null, 2))
		const downloadAnchorNode = document.createElement('a')
		downloadAnchorNode.setAttribute("href",     dataStr)
		downloadAnchorNode.setAttribute("download", filename)
		document.body.appendChild(downloadAnchorNode)
		downloadAnchorNode.click()
		downloadAnchorNode.remove()
	})

	const connectedDisplays = live?.gpu?.displays || []
	
	const items = customGpuItems.map((item, i) => {
		const connected = item.pairs.some((pName) =>
			connectedDisplays.some((d) => d.connected && normRandr(d.name) === normRandr(pName))
		)
		const disp = connectedDisplays.find(
			(d) => d.connected && item.pairs.some((p) => normRandr(p) === normRandr(d.name))
		)
		const canonicalId = resolveCanonicalGpuConnectorId(item.pairs, gpuPhysicalPorts, gpuOuts) || item.id
		
		return {
			id: canonicalId,
			layoutSlotId: item.id,
			icon: item.type === 'hdmi' ? '/assets/hdmi-port-icon.svg' : '/assets/display-port-icon.svg',
			label: item.label,
			kind: 'gpu_out',
			index: i,
			connected,
			hidden: item.hidden,
			pairs: item.pairs,
			monitor: disp?.displayName || '',
			resolution: disp?.resolution || '',
			refreshHz: disp?.refreshHz || null,
			isVirtual: !connected
		}
	})
	
	slots.push({ title: 'GPU', items })
	let decklinkRearOrderIds = []
	if (deckIo.length || deckOut.length) {
		const deckMerged = [...deckIo, ...deckOut].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
		const savedOrder = readSavedDecklinkOrder()
		const { ordered, orderIds } = orderDecklinkConnectors(deckMerged, savedOrder)
		decklinkRearOrderIds = orderIds
		const ioItems = ordered.map((c) => ({
			id: c.id,
			icon: '/assets/bnc_female_axis.svg',
			label: c.label || c.id,
			kind: c.kind,
			index: c.index != null ? Number(c.index) : null,
		}))
		if (ioItems.length) {
			slots.push({
				title: 'DeckLink',
				items: ioItems,
				deckOrderIds: ordered.map((c) => String(c.id)),
				deckPersistedOrder: savedOrder.length > 0,
			})
		}
	}
	slots.push({
		title: 'Stream',
		items: streamOut.map((c) => ({ id: c.id, icon: '/assets/ethernet-port-icon.svg', label: c.label || c.id, kind: 'stream_out' })),
	})
	slots.push({
		title: 'Record',
		items: recordOut.map((c) => ({ id: c.id, icon: '/assets/ethernet-port-icon.svg', label: c.label || c.id, kind: 'record_out' })),
	})
	// Audio outputs: user-managed list (like stream/record), not auto-enumerated
	const audioOutputsList = Array.isArray(ctx.lastPayload?.audioOutputs || ctx.currentSettings?.audioOutputs) ? (ctx.lastPayload?.audioOutputs || ctx.currentSettings?.audioOutputs) : []
	const audioItems = audioOutputsList.map((ao) => {
		const id = String(ao.id || '').trim()
		const graphConn = audioOuts.find(c => c.id === id)
		return {
			id: id || graphConn?.id,
			icon: '/assets/jack-svg.svg',
			label: String(ao.label || ao.name || id).slice(0, 80),
			kind: 'audio_out',
			deviceName: ao.deviceName || '',
		}
	})
	slots.push({ title: 'Audio', items: audioItems })

	if (slotsEl) {
		slotsEl.innerHTML = ''
		slots.forEach((slot, sIdx) => {
			const slotEl = document.createElement('div')
			slotEl.className = 'device-view__backpanel-slot'
			const titleEl = document.createElement('div')
			titleEl.className = 'device-view__backpanel-slot-title'
			titleEl.textContent = slot.title
			
			if (slot.title === 'GPU') {
				const editBtn = document.createElement('button')
				editBtn.type = 'button'
				editBtn.className = 'device-view__backpanel-slot-edit'
				editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`
				editBtn.title = 'Edit GPU Layout'
				editBtn.style.marginLeft = '8px'
				editBtn.style.cursor = 'pointer'
				editBtn.style.background = 'none'
				editBtn.style.border = 'none'
				editBtn.style.color = gpuEditMode ? '#007bff' : '#ccc'
				
				editBtn.addEventListener('click', (ev) => {
					ev.preventDefault()
					ev.stopPropagation()
					gpuEditMode = !gpuEditMode
					editBtn.style.color = gpuEditMode ? '#007bff' : '#ccc'
					casparBand.classList.toggle('device-view--edit-mode', gpuEditMode)
					
					const markers = casparOverlay.querySelectorAll('.device-view__panel-marker--gpu')
					markers.forEach(m => {
						m.draggable = gpuEditMode
						if (gpuEditMode) {
							m.classList.add('device-view__panel-marker--editable')
							if (m.dataset.hidden === 'true') {
								m.style.display = ''
								m.style.opacity = '0.3'
							}
						} else {
							m.classList.remove('device-view__panel-marker--editable')
							if (m.dataset.hidden === 'true') {
								m.style.display = 'none'
							}
						}
					})
					
					if (gpuEditMode && customGpuItems.length > 0) {
						// Auto-select the first marker to open the inspector with Layout Editor
						const firstItem = customGpuItems[0]
						const connected = firstItem.pairs.some((pName) =>
							connectedDisplays.some((d) => d.connected && normRandr(d.name) === normRandr(pName))
						)
						const canonicalId = resolveCanonicalGpuConnectorId(firstItem.pairs, gpuPhysicalPorts, gpuOuts) || firstItem.id
						const connectorCtx = {
							type: 'gpu_out',
							connector: { id: canonicalId, kind: 'gpu_out', label: firstItem.label, layoutSlotId: firstItem.id, isVirtual: !connected, pairs: firstItem.pairs },
						}
						onPortClick(`caspar_overlay:${canonicalId}:`, canonicalId, connectorCtx)
					}
				})
				titleEl.appendChild(editBtn)
			}

			if (slot.title === 'DeckLink') {
				const editBtn = document.createElement('button')
				editBtn.type = 'button'
				editBtn.className = 'device-view__backpanel-slot-edit'
				editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`
				editBtn.title =
					'Edit DeckLink port order — drag markers on the rear panel, or use Save / Export / Load in the inspector (same as GPU layout).'
				editBtn.style.marginLeft = '8px'
				editBtn.style.cursor = 'pointer'
				editBtn.style.background = 'none'
				editBtn.style.border = 'none'
				editBtn.style.color = decklinkEditMode ? '#007bff' : '#ccc'
				editBtn.addEventListener('click', (ev) => {
					ev.preventDefault()
					ev.stopPropagation()
					decklinkEditMode = !decklinkEditMode
					editBtn.style.color = decklinkEditMode ? '#007bff' : '#ccc'
					casparBand.classList.toggle('device-view--edit-mode-decklink', decklinkEditMode)
					casparOverlay.querySelectorAll('.device-view__panel-marker--decklink-rear-slot').forEach((m) => {
						m.draggable = decklinkEditMode
						if (decklinkEditMode) m.classList.add('device-view__panel-marker--editable')
						else m.classList.remove('device-view__panel-marker--editable')
					})
					if (decklinkEditMode && decklinkRearOrderIds.length) {
						const firstId = decklinkRearOrderIds[0]
						const allDl = [...deckIo, ...deckOut]
						const conn = allDl.find((c) => String(c.id) === String(firstId))
						if (conn) {
							onPortClick(`caspar_overlay:${firstId}:`, firstId, { type: conn.kind, connector: conn })
						}
					}
				})
				titleEl.appendChild(editBtn)
			}
			
			if (slot.title === 'Stream' || slot.title === 'Record' || slot.title === 'Audio') {
				const plus = document.createElement('button')
				plus.type = 'button'
				plus.className = 'device-view__backpanel-slot-plus'
				plus.textContent = '+'
				plus.title = `Add new ${slot.title.toLowerCase()} output`
				plus.addEventListener('click', (ev) => {
					ev.preventDefault()
					ev.stopPropagation()
					if (slot.title === 'Stream') ctx.onAddStreamOutput?.()
					else if (slot.title === 'Record') ctx.onAddRecordOutput?.()
					else ctx.onAddAudioOutput?.()
				})
				titleEl.appendChild(plus)
			}
			
			const connectorsContainer = document.createElement('div')
			connectorsContainer.className = 'device-view__backpanel-slot-connectors'
			slot.container = connectorsContainer

			slotEl.appendChild(titleEl)
			slotEl.appendChild(connectorsContainer)
			slotsEl.appendChild(slotEl)
		})
	}

	// Add the Apply GPU button to the bottom-left of the panel area
	const panelControls = document.createElement('div')
	panelControls.className = 'device-view__backpanel-controls'
	const applyBtn = document.createElement('button')
	applyBtn.type = 'button'
	applyBtn.className = 'device-view__backpanel-slot-apply'
	applyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> <span>Apply GPU Layout</span>`
	applyBtn.title = 'Apply GPU-driven X11 layout and persist for reboot'
	applyBtn.addEventListener('click', async (ev) => {
		ev.preventDefault()
		ev.stopPropagation()
		if (!confirm('Apply GPU output layout now and persist for reboot?')) return
		try {
			await ctx.onApplyGpuSettings?.()
		} catch (e) {
			// Handler normally sets status; this covers unexpected throws before statusEl updates.
			console.error('[device-view] onApplyGpuSettings', e)
		}
	})
	panelControls.appendChild(applyBtn)
	casparBand.appendChild(panelControls)

	const kindTitle = (kind) => {
		if (kind === 'gpu_out') return 'GPU / program bus output'
		if (kind === 'decklink_in') return 'DeckLink input (capture)'
		if (kind === 'decklink_out') return 'DeckLink program output'
		if (kind === 'caspar_mv_out') return 'Multiview channel output'
		if (kind === 'audio_out') return 'Audio output'
		if (kind === 'audio_in') return 'Audio input'
		return kind || 'connector'
	}

	let markerItems = []
	if (slots.length) {
		slots.forEach((slot, sIdx) => {
			const x = ((sIdx + 0.4) / slots.length) * 100
			let items = [...slot.items]

			if (slot.title === 'DeckLink' && items.length >= 4 && !slot.deckPersistedOrder) {
				// Special request: 4 2 3 1 from top
				const p1 = items.find((it) => String(it.label).includes('1') || it.index === 0)
				const p2 = items.find((it) => String(it.label).includes('2') || it.index === 1)
				const p3 = items.find((it) => String(it.label).includes('3') || it.index === 2)
				const p4 = items.find((it) => String(it.label).includes('4') || it.index === 3)
				if (p1 && p2 && p3 && p4) {
					// We only swap the first 4 if there are more
					const others = items.filter((it) => ![p1, p2, p3, p4].includes(it))
					items = [p4, p2, p3, p1, ...others]
				}
			}

			const n = items.length
			const maxRows = 4
			const numCols = Math.ceil(n / maxRows)

			items.forEach((it, i) => {
				let yBase = 20
				let yRange = 64
				if (slot.title === 'DeckLink' && n === 4) {
					yBase = 12
					yRange = 48
				}

				let currentX = x
				let currentY
				if ((slot.title === 'Stream' || slot.title === 'Record' || slot.title === 'Audio') && n > maxRows) {
					const col = Math.floor(i / maxRows)
					const row = i % maxRows
					const itemsInThisCol = Math.min(maxRows, n - col * maxRows)
					const colSpacing = (100 / slots.length) * 0.45
					currentX = x + (col - (numCols - 1) / 2) * colSpacing
					currentY = itemsInThisCol > 1 ? yBase + (row / (itemsInThisCol - 1)) * yRange : 40
				} else {
					const visualRow = slot.title === 'GPU' ? (n - 1 - i) : i
					currentY = n > 1 ? yBase + (visualRow / (n - 1)) * yRange : 40
				}

				markerItems.push({
					connectorId: it.id,
					layoutSlotId: it.layoutSlotId,
					hwId: it.hwId,
					kind: it.kind,
					x: currentX,
					y: currentY,
					index: it.index != null ? it.index + 1 : i + 1,
					label: it.label,
					labelHtml: it.labelHtml,
					icon: it.icon,
					isVirtual: it.isVirtual,
					connected: it.connected,
					pairs: it.pairs,
					container: slot.container,
				})
			})

			if (slot.title === 'DeckLink') {
				// Add REF port at the bottom with a bigger gap
				markerItems.push({
					connectorId: null,
					label: 'REF',
					icon: '/assets/bnc_female_axis.svg',
					x,
					y: 88,
					kind: 'decklink_ref',
					container: slot.container,
				})
			}
		})
	} else {
		markerItems = casparConnectors.slice(0, 32).map((c, idx) => {
			const col = idx % 16
			const row = Math.floor(idx / 16)
			return { connectorId: c.id, kind: c.kind, x: 3 + col * 6, y: 28 + row * 24, index: c.index ?? idx + 1, label: c.label || c.id }
		})
	}

	const kindToIcon = (kind) => {
		if (kind === 'gpu_out') return '/assets/hdmi-port-icon.svg'
		if (kind?.startsWith('decklink') || kind === 'caspar_mv_out') return '/assets/bnc_female_axis.svg'
		if (kind === 'audio_out') return '/assets/jack-svg.svg'
		if (kind === 'stream_out' || kind === 'record_out') return '/assets/ethernet-port-icon.svg'
		return '/assets/bnc_female_axis.svg'
	}

	const resolveStatusClass = (it) => {
		if (!it.connectorId) return stateClass('off')
		if (it.kind === 'gpu_out') {
			return stateClass(it.connected ? 'ok' : 'off')
		}
		const conn = connectorById(lastPayload, it.connectorId)
		if (!conn) return ''
		if (it.kind === 'decklink_in' || it.kind === 'decklink_io') {
			const st = live.decklink?.inputs?.find(x => String(x.device) === String(conn.externalRef))
			if (st) return stateClass(decklinkInputState(st).level)
		}
		if (it.kind === 'stream_out') {
			const active = !!(live.streaming?.activeOutputs?.some(id => String(id) === String(it.connectorId)))
			return stateClass(active ? 'ok' : 'off')
		}
		if (it.kind === 'record_out') {
			const active = !!(live.recording?.activeOutputs?.some(id => String(id) === String(it.connectorId)))
			return stateClass(active ? 'ok' : 'off')
		}
		if (it.kind === 'audio_out') {
			return stateClass('ok')
		}
		return stateClass('ok')
	}

	markerItems.forEach((it) => {
		if (!casparOverlay) return
		const marker = document.createElement('button')
		marker.type = 'button'
		marker.className = 'device-view__panel-marker ' + resolveStatusClass(it)
		
		const kind = String(it.kind || '')
		if (it.kind === 'gpu_out') marker.classList.add('device-view__panel-marker--gpu')
		if (it.kind === 'decklink_in') marker.classList.add('device-view__panel-marker--dli')
		if (it.kind === 'decklink_out' || it.kind === 'decklink_io') marker.classList.add('device-view__panel-marker--dlo')
		const isDecklinkRearSlot = it.kind === 'decklink_io' || it.kind === 'decklink_in' || it.kind === 'decklink_out'
		if (isDecklinkRearSlot) marker.classList.add('device-view__panel-marker--decklink-rear-slot')
		if (it.kind === 'stream_out') marker.classList.add('device-view__panel-marker--stream')
		if (it.kind === 'record_out') marker.classList.add('device-view__panel-marker--record')
		if (it.kind === 'audio_out') marker.classList.add('device-view__panel-marker--audio')
		if (it.kind === 'decklink_ref') marker.classList.add('device-view__panel-marker--decklink-ref')
		if (it.isVirtual) marker.classList.add('device-view__panel-marker--virtual')
		if (it.hidden) {
			marker.dataset.hidden = 'true'
			marker.style.display = 'none'
		}
		
		const monitorPart = it.kind === 'gpu_out'
			? ` · ${it.connected ? 'connected' : 'disconnected'}${it.monitor ? ` · ${it.monitor}` : ''}${it.resolution ? ` · ${it.resolution}` : ''}${Number.isFinite(it.refreshHz) ? ` @ ${it.refreshHz}Hz` : ''}`
			: ''
		marker.title = it.isVirtual
			? `${it.label} (Physical port, unmapped)${monitorPart}`
			: `${it.label} — ${kindTitle(kind)} · id ${it.connectorId}${monitorPart}`

		const iconPath = it.icon || kindToIcon(kind)
		
		const colIndex = Math.floor(((it.index || 1) - 1) / 4)
		const labelDirClass = colIndex % 2 === 0 ? 'device-view__panel-marker-label--left' : 'device-view__panel-marker-label--right'

		marker.innerHTML = `
			<div class="device-view__panel-status-glow"></div>
			<img src="${iconPath}" class="device-view__panel-connector-img" alt="${kind}" />
			<span class="device-view__panel-marker-label ${labelDirClass}">${it.labelHtml || it.label}</span>
		`

		if (it.connectorId) {
			marker.setAttribute('data-connector-id', it.connectorId)
			if (it.kind === 'gpu_out' && it.layoutSlotId) {
				marker.setAttribute('data-layout-slot-id', it.layoutSlotId)
			}
			if (isDecklinkRearSlot) {
				marker.draggable = decklinkEditMode || it.kind === 'decklink_io' || it.kind === 'decklink_in'
				marker.addEventListener('dragstart', (ev) => {
					if (decklinkEditMode) {
						ev.dataTransfer.setData('application/x-highascg-decklink-rear', JSON.stringify({ connectorId: it.connectorId }))
						ev.dataTransfer.effectAllowed = 'move'
					} else if (it.kind === 'decklink_io' || it.kind === 'decklink_in') {
						ev.dataTransfer.setData('application/x-highascg-connector', JSON.stringify({ connectorId: it.connectorId, kind: it.kind }))
						ev.dataTransfer.effectAllowed = 'copyLink'
					}
				})
				marker.addEventListener('dragover', (ev) => {
					if (!decklinkEditMode) return
					ev.preventDefault()
					ev.dataTransfer.dropEffect = 'move'
				})
				marker.addEventListener('drop', (ev) => {
					if (!decklinkEditMode) return
					ev.preventDefault()
					const raw = ev.dataTransfer.getData('application/x-highascg-decklink-rear')
					if (!raw) return
					let dragData
					try {
						dragData = JSON.parse(raw)
					} catch {
						return
					}
					const dropId = String(it.connectorId)
					const dragId = String(dragData.connectorId || '')
					if (!dragId || dragId === dropId) return
					const parentSlot = marker.closest('.device-view__backpanel-slot-connectors')
					if (!parentSlot) return
					const dragElement = parentSlot.querySelector(`[data-connector-id="${CSS.escape(dragId)}"]`)
					const dropElement = marker
					if (dragElement && dropElement) {
						const parent = dragElement.parentNode
						const dragNext = dragElement.nextSibling
						if (dragNext === dropElement) {
							parent.insertBefore(dropElement, dragElement)
						} else if (dropElement.nextSibling === dragElement) {
							parent.insertBefore(dragElement, dropElement)
						} else {
							parent.insertBefore(dragElement, dropElement)
							parent.insertBefore(dropElement, dragNext)
						}
						const dragIdx = decklinkRearOrderIds.indexOf(dragId)
						const dropIdx = decklinkRearOrderIds.indexOf(dropId)
						if (dragIdx >= 0 && dropIdx >= 0) {
							const t = decklinkRearOrderIds[dragIdx]
							decklinkRearOrderIds[dragIdx] = decklinkRearOrderIds[dropIdx]
							decklinkRearOrderIds[dropIdx] = t
						}
						try {
							localStorage.setItem(DECKLINK_REAR_ORDER_KEY, JSON.stringify(decklinkRearOrderIds))
						} catch (e) {
							console.warn('[device-view] decklink order persist', e)
						}
					}
				})
			}
			
			if (it.kind === 'gpu_out') {
				marker.draggable = gpuEditMode
				marker.addEventListener('dragstart', (ev) => {
					if (!gpuEditMode) return
					const layoutId = it.layoutSlotId || it.connectorId
					ev.dataTransfer.setData('application/x-highascg-gpu-port', JSON.stringify({ id: layoutId }))
					ev.dataTransfer.effectAllowed = 'move'
				})
				
				marker.addEventListener('dragover', (ev) => {
					if (!gpuEditMode) return
					ev.preventDefault()
					ev.dataTransfer.dropEffect = 'move'
				})
				
				marker.addEventListener('drop', (ev) => {
					if (!gpuEditMode) return
					ev.preventDefault()
					const data = ev.dataTransfer.getData('application/x-highascg-gpu-port')
					if (!data) return
					const dragData = JSON.parse(data)
					const dropLayoutId = it.layoutSlotId || it.connectorId
					if (dragData.id !== dropLayoutId) {
						const parentSlot = marker.closest('.device-view__backpanel-slot-connectors')
						if (!parentSlot) return
						const dragElement = parentSlot.querySelector(`[data-layout-slot-id="${dragData.id}"]`)
						const dropElement = marker
						
						if (dragElement && dropElement) {
							const parent = dragElement.parentNode
							const dragNext = dragElement.nextSibling
							
							// Swap DOM nodes
							if (dragNext === dropElement) {
								parent.insertBefore(dropElement, dragElement)
							} else if (dropElement.nextSibling === dragElement) {
								parent.insertBefore(dragElement, dropElement)
							} else {
								parent.insertBefore(dragElement, dropElement)
								parent.insertBefore(dropElement, dragNext)
							}
							
							// Swap in array
							const dragIdx = customGpuItems.findIndex(x => x.id === dragData.id)
							const dropIdx = customGpuItems.findIndex(x => x.id === dropLayoutId)
							if (dragIdx >= 0 && dropIdx >= 0) {
								const temp = customGpuItems[dragIdx]
								customGpuItems[dragIdx] = customGpuItems[dropIdx]
								customGpuItems[dropIdx] = temp
							}
						}
					}
				})
			}
			const connectorCtx = {
				type: kind,
				connector: { id: it.connectorId, kind, label: it.label, layoutSlotId: it.layoutSlotId, isVirtual: it.isVirtual, pairs: it.pairs },
			}
			marker.addEventListener('click', () => {
				onPortClick(`caspar_overlay:${it.connectorId}:`, it.connectorId, connectorCtx)
			})
			const dot = document.createElement('span')
			dot.className = 'device-view__connector-dot device-view__connector-dot--left'
			dot.title = 'Start or complete cable at this connector'
			dot.setAttribute('data-connector-id', it.connectorId)
			if (it.pairs) {
				dot.setAttribute('data-real-ids', it.pairs.join(','))
			}
			dot.addEventListener('click', (ev) => {
				ev.preventDefault()
				ev.stopPropagation()
				const targetId = it.connectorId
				if (onPortStartCable) onPortStartCable(`caspar_overlay:${targetId}:`, targetId, connectorCtx)
				else onPortClick(`caspar_overlay:${targetId}:`, targetId, connectorCtx)
			})
			marker.appendChild(dot)
		} else {
			marker.style.cursor = 'default'
			marker.classList.add('device-view__panel-marker--disabled')
		}
		
		if (selectedConnectorId && it.connectorId === selectedConnectorId) marker.classList.add('device-view__panel-marker--selected')
		if (cableSourceId && it.connectorId === cableSourceId) marker.classList.add('device-view__panel-marker--armed')
		if (it.container) {
			it.container.append(marker)
		} else {
			casparOverlay.append(marker)
		}
	})

	casparBand.addEventListener('click', (ev) => {
		if (ev.target?.closest?.('[data-port-key], [data-connector-id], .device-view__panel-marker')) return
		selectDevice(CASPAR_HOST, live)
	})
	return casparBand
}

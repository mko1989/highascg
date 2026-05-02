/**
 * CasparCG Rear Panel Rendering for Device View.
 */
import { CASPAR_HOST, decklinkInputState, stateClass, connectorById } from './device-view-helpers.js'

export function renderCasparBand(ctx) {
	const { live, lastPayload, selectDevice, onPortClick, onPortStartCable, selectedConnectorId, cableSourceId } = ctx
	const casparBand = document.createElement('div')
	casparBand.className = 'device-view__band device-view__band--caspar'
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
	if (gpuPhysicalPorts.length) {
		const gpuByPhysicalId = new Map(gpuOuts.map((c) => [String(c?.id || ''), c]))
		const items = gpuPhysicalPorts
			.slice()
			.sort((a, b) => Number(a?.slotOrder || 0) - Number(b?.slotOrder || 0))
			.map((p, i) => {
				const pid = String(p?.physicalPortId || `gpu_p${i}`)
				const conn = gpuByPhysicalId.get(pid) || null
				const active = String(p?.runtime?.activePort || '').trim()
				const pairA = String(p?.pair?.dpA || '').trim()
				const pairB = String(p?.pair?.dpB || '').trim()
				const pair = [pairA, pairB].filter(Boolean).join('/')
				const pairShort = [shortDp(pairA), shortDp(pairB)].filter(Boolean).join('/')
				const activeShort = shortDp(active)
				const label = `DP(${pairShort || '?'})`
				const labelHtml = activeShort ? `DP(${pairShort || '?'}) <strong>${activeShort}</strong>` : label
				const connected = !!p?.runtime?.connected
				const res = String(p?.runtime?.resolution || '').trim()
				const hz = Number.isFinite(Number(p?.runtime?.refreshHz)) ? Number(p.runtime.refreshHz) : null
				const monitor = String(p?.runtime?.displayName || '').trim()
				return {
					id: conn?.id || pid,
					icon: '/assets/display-port-icon.svg',
					label,
					kind: 'gpu_out',
					index: Number.isFinite(Number(p?.slotOrder)) ? Number(p.slotOrder) : i,
					isVirtual: !conn,
					labelHtml,
					monitor,
					connected,
					resolution: res,
					refreshHz: hz,
				}
			})
		slots.push({ title: 'GPU', items })
	} else if (gpuInventory.length) {
		const usedGpuConnectorIds = new Set()
		const items = gpuInventory.map((inv, i) => {
			const invName = normGpuName(inv?.shortName || inv?.name)
			const wantedGpuId = gpuConnectorIdFromName(inv?.shortName || inv?.name)
			const suggestedByExactId =
				gpuOuts.find((c) => !usedGpuConnectorIds.has(c?.id) && String(c?.id || '').toLowerCase() === wantedGpuId.toLowerCase()) ||
				null
			const suggestedByName =
				gpuOuts.find((c) => !usedGpuConnectorIds.has(c?.id) && normGpuName(c?.externalRef) === invName) ||
				gpuOuts.find((c) => !usedGpuConnectorIds.has(c?.id) && normGpuName(c?.label) === invName) ||
				null
			const suggestedByIndex = gpuOuts.find((c) => !usedGpuConnectorIds.has(c?.id) && Number(c.index) === i) || null
			const suggested = suggestedByExactId || suggestedByName || suggestedByIndex || gpuOuts[i]
			if (suggested?.id) usedGpuConnectorIds.add(suggested.id)
			const t = String(inv?.type || '').toLowerCase()
			const icon = t === 'hdmi' ? '/assets/hdmi-port-icon.svg' : '/assets/display-port-icon.svg'
			let label = String(inv?.shortName || inv?.name || '').trim() || `GPU ${i + 1}`
			// Clean up Linux-style device names and make them more readable (e.g. HDMI-A-1 -> HDMI 1)
			label = label.replace(/^(card\d+|renderD\d+)-/i, '').replace(/-(A|B|C|D)-/i, ' ').replace(/-/g, ' ')
			const labelLc = label.toLowerCase()
			if (labelLc.includes('card') || labelLc.includes('gpu') || labelLc.includes('renderd') || !label) {
				label = `GPU ${i + 1}`
			}
			const markerConnectorId = suggested?.id || wantedGpuId || ''
			
			// Match with runtime display info
			const disp = gpuDisplays.find(d => normGpuName(d.name) === invName) || gpuDisplays[i]
			const connected = !!disp?.connected
			
			return {
				id: markerConnectorId,
				hwId: `gpu_hw_${i}`,
				icon,
				label,
				kind: 'gpu_out',
				isVirtual: !suggested,
				index: i,
				connected,
				monitor: disp?.displayName || '',
				resolution: disp?.resolution || '',
				refreshHz: disp?.refreshHz || null
			}
		})
		slots.push({ title: 'GPU', items })
	} else if (gpuOuts.length) {
		const items = gpuOuts
			.filter((c) => {
				const label = String(c?.label || c?.id || '').trim().toLowerCase()
				return !/^card\d+($|[\s:])/.test(label) && !/^gpu\d+($|[\s:])/.test(label)
			})
			.map((c, i) => {
				let label = String(c.label || c.id).replace(/^(card\d+|renderD\d+)-/i, '').replace(/-(A|B|C|D)-/i, ' ').replace(/-/g, ' ')
				if (label.toLowerCase().includes('card') || label.toLowerCase().includes('gpu') || !label) {
					label = `GPU ${i + 1}`
				}
				const disp = gpuDisplays.find(d => normGpuName(d.name) === normGpuName(c.externalRef)) || gpuDisplays[i]
				return { 
					id: c.id, 
					icon: '/assets/display-port-icon.svg', 
					label, 
					kind: 'gpu_out', 
					index: i,
					connected: !!disp?.connected,
					monitor: disp?.displayName || '',
					resolution: disp?.resolution || '',
					refreshHz: disp?.refreshHz || null
				}
			})
		slots.push({ title: 'GPU', items })
	}
	if (deckIo.length || deckOut.length) {
		const ioItems = [...deckIo, ...deckOut]
			.filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
			.map((c) => ({
				id: c.id,
				icon: '/assets/bnc_female_axis.svg',
				label: c.label || c.id,
				kind: c.kind,
				index: c.index != null ? Number(c.index) : null,
			}))
		if (ioItems.length) slots.push({ title: 'DeckLink', items: ioItems })
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
			icon: '/assets/ethernet-port-icon.svg',
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
			
			slotEl.appendChild(titleEl)
			slotsEl.appendChild(slotEl)
		})
	}

	// Add the Apply GPU button to the bottom-left of the panel area
	const panelControls = document.createElement('div')
	panelControls.className = 'device-view__backpanel-controls'
	const applyBtn = document.createElement('button')
	applyBtn.type = 'button'
	applyBtn.className = 'device-view__backpanel-slot-apply'
	applyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> <span>Apply GPU & OS</span>`
	applyBtn.title = 'Apply GPU & OS settings (restarts display manager)'
	applyBtn.addEventListener('click', (ev) => {
		ev.preventDefault()
		ev.stopPropagation()
		if (confirm('Apply GPU settings and restart Display Manager? This will flicker all screens.')) {
			ctx.onApplyGpuSettings?.()
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

			if (slot.title === 'DeckLink' && items.length >= 4) {
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
				let yBase = 14
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
					hwId: it.hwId,
					kind: it.kind,
					x: currentX,
					y: currentY,
					index: it.index != null ? it.index + 1 : i + 1,
					label: it.label,
					labelHtml: it.labelHtml,
					icon: it.icon,
					isVirtual: it.isVirtual,
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
		if (kind === 'stream_out' || kind === 'record_out' || kind === 'audio_out') return '/assets/ethernet-port-icon.svg'
		return '/assets/bnc_female_axis.svg'
	}

	const resolveStatusClass = (it) => {
		if (!it.connectorId) return stateClass('off')
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
		if (it.kind === 'stream_out' || it.kind === 'record_out' || it.kind === 'audio_out') marker.classList.add('device-view__panel-marker--aud')
		if (it.isVirtual) marker.classList.add('device-view__panel-marker--virtual')
		
		marker.style.left = `${it.x}%`
		marker.style.top = `${it.y}%`
		const monitorPart = it.kind === 'gpu_out'
			? ` · ${it.connected ? 'connected' : 'disconnected'}${it.monitor ? ` · ${it.monitor}` : ''}${it.resolution ? ` · ${it.resolution}` : ''}${Number.isFinite(it.refreshHz) ? ` @ ${it.refreshHz}Hz` : ''}`
			: ''
		marker.title = it.isVirtual
			? `${it.label} (Physical port, unmapped)${monitorPart}`
			: `${it.label} — ${kindTitle(kind)} · id ${it.connectorId}${monitorPart}`

		const iconPath = it.icon || kindToIcon(kind)

		marker.innerHTML = `
			<div class="device-view__panel-status-glow"></div>
			<img src="${iconPath}" class="device-view__panel-connector-img" alt="${kind}" />
			<span class="device-view__panel-marker-label">${it.labelHtml || it.label}</span>
		`

		if (it.connectorId) {
			marker.setAttribute('data-connector-id', it.connectorId)
			if (it.kind === 'decklink_io' || it.kind === 'decklink_in') {
				marker.draggable = true
				marker.addEventListener('dragstart', (ev) => {
					ev.dataTransfer.setData('application/x-highascg-connector', JSON.stringify({ connectorId: it.connectorId, kind: it.kind }))
					ev.dataTransfer.effectAllowed = 'copyLink'
				})
			}
			const connectorCtx = { type: kind, connector: { id: it.connectorId, kind, label: it.label } }
			marker.addEventListener('click', () => {
				onPortClick(`caspar_overlay:${it.connectorId}:`, it.connectorId, connectorCtx)
			})
			const dot = document.createElement('span')
			dot.className = 'device-view__connector-dot device-view__connector-dot--left'
			dot.title = 'Start or complete cable at this connector'
			dot.setAttribute('data-connector-id', it.connectorId)
			dot.addEventListener('click', (ev) => {
				ev.preventDefault()
				ev.stopPropagation()
				if (onPortStartCable) onPortStartCable(`caspar_overlay:${it.connectorId}:`, it.connectorId, connectorCtx)
				else onPortClick(`caspar_overlay:${it.connectorId}:`, it.connectorId, connectorCtx)
			})
			marker.appendChild(dot)
		} else {
			marker.style.opacity = '0.4'
			marker.style.cursor = 'default'
			marker.classList.add('device-view__panel-marker--disabled')
		}
		
		if (selectedConnectorId && it.connectorId === selectedConnectorId) marker.classList.add('device-view__panel-marker--selected')
		if (cableSourceId && it.connectorId === cableSourceId) marker.classList.add('device-view__panel-marker--armed')
		casparOverlay.append(marker)
	})

	casparBand.addEventListener('click', (ev) => {
		if (ev.target?.closest?.('[data-port-key], [data-connector-id], .device-view__panel-marker')) return
		selectDevice(CASPAR_HOST, live)
	})
	return casparBand
}

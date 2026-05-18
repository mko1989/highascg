import { DECKLINK_REAR_ORDER_KEY } from '../lib/device-view-decklink-order.js'
import { casparRearKindTitle, casparRearKindToIcon } from './device-view-caspar-render-helpers.js'

export function buildCasparRearMarkerLayoutItems(slots, casparConnectors) {
	const markerItems = []
	if (slots.length) {
		slots.forEach((slot, sIdx) => {
			const x = ((sIdx + 0.4) / slots.length) * 100
			let items = [...slot.items]

			if (slot.title === 'DeckLink' && items.length >= 4 && !slot.deckPersistedOrder) {
				const p1 = items.find((it) => String(it.label).includes('1') || it.index === 0)
				const p2 = items.find((it) => String(it.label).includes('2') || it.index === 1)
				const p3 = items.find((it) => String(it.label).includes('3') || it.index === 2)
				const p4 = items.find((it) => String(it.label).includes('4') || it.index === 3)
				if (p1 && p2 && p3 && p4) {
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
					hidden: it.hidden,
					container: slot.container,
				})
			})

			if (slot.title === 'DeckLink') {
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
		return markerItems
	}
	return casparConnectors.slice(0, 32).map((c, idx) => {
		const col = idx % 16
		const row = Math.floor(idx / 16)
		return { connectorId: c.id, kind: c.kind, x: 3 + col * 6, y: 28 + row * 24, index: c.index ?? idx + 1, label: c.label || c.id }
	})
}

export function appendCasparRearPanelMarkers({
	casparOverlay,
	markerItems,
	resolveStatusClass,
	getGpuEditMode,
	getDecklinkEditMode,
	customGpuItems,
	decklinkRearOrderIds,
	selectedConnectorId,
	cableSourceId,
	onPortClick,
	onPortStartCable,
}) {
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
			: `${it.label} — ${casparRearKindTitle(kind)} · id ${it.connectorId}${monitorPart}`

		const iconPath = it.icon || casparRearKindToIcon(kind)

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
				marker.draggable = getDecklinkEditMode() || it.kind === 'decklink_io' || it.kind === 'decklink_in'
				marker.addEventListener('dragstart', (ev) => {
					if (getDecklinkEditMode()) {
						ev.dataTransfer.setData('application/x-highascg-decklink-rear', JSON.stringify({ connectorId: it.connectorId }))
						ev.dataTransfer.effectAllowed = 'move'
					} else if (it.kind === 'decklink_io' || it.kind === 'decklink_in') {
						ev.dataTransfer.setData('application/x-highascg-connector', JSON.stringify({ connectorId: it.connectorId, kind: it.kind }))
						ev.dataTransfer.effectAllowed = 'copyLink'
					}
				})
				marker.addEventListener('dragover', (ev) => {
					if (!getDecklinkEditMode()) return
					ev.preventDefault()
					ev.dataTransfer.dropEffect = 'move'
				})
				marker.addEventListener('drop', (ev) => {
					if (!getDecklinkEditMode()) return
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
				marker.draggable = getGpuEditMode()
				marker.addEventListener('dragstart', (ev) => {
					if (!getGpuEditMode()) return
					const layoutId = it.layoutSlotId || it.connectorId
					ev.dataTransfer.setData('application/x-highascg-gpu-port', JSON.stringify({ id: layoutId }))
					ev.dataTransfer.effectAllowed = 'move'
				})

				marker.addEventListener('dragover', (ev) => {
					if (!getGpuEditMode()) return
					ev.preventDefault()
					ev.dataTransfer.dropEffect = 'move'
				})

				marker.addEventListener('drop', (ev) => {
					if (!getGpuEditMode()) return
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

							if (dragNext === dropElement) {
								parent.insertBefore(dropElement, dragElement)
							} else if (dropElement.nextSibling === dragElement) {
								parent.insertBefore(dragElement, dropElement)
							} else {
								parent.insertBefore(dragElement, dropElement)
								parent.insertBefore(dropElement, dragNext)
							}

							const dragIdx = customGpuItems.findIndex((x) => x.id === dragData.id)
							const dropIdx = customGpuItems.findIndex((x) => x.id === dropLayoutId)
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
}

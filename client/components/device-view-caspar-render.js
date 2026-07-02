/**
 * CasparCG Rear Panel Rendering for Device View.
 */
import { CASPAR_HOST } from './device-view-helpers.js'
import { readSavedDecklinkOrder, orderDecklinkConnectors } from '../lib/device-view-decklink-order.js'
import {
	normRandrCaspar,
	resolveCanonicalGpuConnectorId,
	createCasparRearMarkerStatusResolver,
} from './device-view-caspar-render-helpers.js'
import {
	buildGpuLayoutItemsFromLive,
	buildGpuSelectablePortEntries,
	clearGpuLayoutPrefs,
	entryToRearPanelGpuItem,
	layoutItemsFromGpuEntries,
} from '../lib/device-view-gpu-port-list.js'
import { setStatus } from './device-view-ui-utils.js'
import { traceGpuLayoutRearPanelRender } from '../lib/device-view-gpu-layout-debug.js'
import {
	bindCasparGpuLayoutDocumentListeners,
	saveGpuLayoutToStorage,
} from './device-view-caspar-render-gpu-doc-listeners.js'
import * as Actions from './device-view-actions.js'
import { buildCasparRearMarkerLayoutItems, appendCasparRearPanelMarkers } from './device-view-caspar-render-markers.js'

let gpuEditMode = false
let decklinkEditMode = false

export function renderCasparBand(ctx) {
	const { live, lastPayload, selectDevice, onPortClick, onPortStartCable, selectedConnectorId, cableSourceId, load, statusEl } = ctx
	const casparBand = document.createElement('div')
	casparBand.className = 'device-view__band device-view__band--caspar'
	if (gpuEditMode) casparBand.classList.add('device-view--edit-mode')
	const cc = live.caspar
	casparBand.innerHTML = `<h3>Rear panel</h3><div class="device-view__backpanel device-view__backpanel--caspar"><div class="device-view__backpanel-slots" data-caspar-slots></div><div class="device-view__backpanel-overlay" data-caspar-overlay></div></div>`

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

	const resolveStatusClass = createCasparRearMarkerStatusResolver({ live, lastPayload })

	const connectedDisplays = live?.gpu?.displays || []

	const graphGpuOuts = graphConnectors.filter((c) => c?.kind === 'gpu_out' || c?.kind === 'gpu_output')
	const gpuListEntries = buildGpuSelectablePortEntries({
		live,
		suggestedGpuOuts: gpuOuts,
		graphGpuOuts,
		savedTopology: ctx.currentSettings?.gpuPhysicalTopology || lastPayload?.gpuPhysicalTopology || null,
		hideDisconnectedByDefault: false,
	})
	const gpuLayoutItems = layoutItemsFromGpuEntries(gpuListEntries)

	bindCasparGpuLayoutDocumentListeners({
		casparOverlay,
		customGpuItems: gpuLayoutItems,
		gpuPhysicalPorts,
		gpuOuts,
		live,
		resolveStatusClass,
		getGpuEditMode: () => gpuEditMode,
	})

	const items = gpuListEntries.map((entry) =>
		entryToRearPanelGpuItem(entry, connectedDisplays, gpuInventory),
	)

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
		items: recordOut.map((c) => ({ id: c.id, icon: '/assets/record-port-icon.svg', label: c.label || c.id, kind: 'record_out' })),
	})
	const audioOutputsList = Array.isArray(ctx.lastPayload?.audioOutputs || ctx.currentSettings?.audioOutputs) ? (ctx.lastPayload?.audioOutputs || ctx.currentSettings?.audioOutputs) : []
	const audioItems = audioOutputsList.map((ao) => {
		const id = String(ao.id || '').trim()
		const graphConn = audioOuts.find((c) => c.id === id)
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
		const col1 = document.createElement('div')
		col1.className = 'device-view__backpanel-column'
		const col2 = document.createElement('div')
		col2.className = 'device-view__backpanel-column'
		const col3 = document.createElement('div')
		col3.className = 'device-view__backpanel-column'

		slotsEl.appendChild(col1)
		slotsEl.appendChild(col2)
		slotsEl.appendChild(col3)

		slots.forEach((slot, sIdx) => {
			const slotEl = document.createElement('div')
			slotEl.className = 'device-view__backpanel-slot'
			const titleEl = document.createElement('div')
			titleEl.className = 'device-view__backpanel-slot-title'
			titleEl.textContent = slot.title

			if (slot.title === 'GPU') {
				const hiddenGpuCount = gpuListEntries.filter((e) => e.hidden).length
				if (hiddenGpuCount > 0) {
					const hiddenHint = document.createElement('span')
					hiddenHint.className = 'device-view__backpanel-slot-hint'
					hiddenHint.textContent = ` (${hiddenGpuCount} hidden)`
					hiddenHint.title = 'Open GPU layout editor (pencil) and click Show all'
					titleEl.appendChild(hiddenHint)
				}
				const editBtn = document.createElement('button')
				editBtn.type = 'button'
				editBtn.className = 'device-view__backpanel-slot-edit'
				editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`
				editBtn.title = 'Edit GPU layout — reorder ports, Show all, or Reset Layout (xrandr)'
				editBtn.style.marginLeft = '8px'
				editBtn.style.cursor = 'pointer'
				editBtn.style.background = 'none'
				editBtn.style.border = 'none'
				editBtn.style.color = gpuEditMode ? '#007bff' : '#ccc'

				const showAllBtn = Object.assign(document.createElement('button'), {
					type: 'button',
					className: 'device-view__backpanel-slot-edit',
					textContent: 'Show all',
					title: 'Show every GPU port on the rear panel',
				})
				showAllBtn.style.marginLeft = '4px'
				showAllBtn.style.fontSize = '10px'
				showAllBtn.style.display = gpuEditMode ? '' : 'none'
				showAllBtn.addEventListener('click', async (ev) => {
					ev.preventDefault()
					ev.stopPropagation()
					const items = buildGpuLayoutItemsFromLive(live, gpuOuts).map((x) => ({ ...x, hidden: false }))
					saveGpuLayoutToStorage(items)
					if (statusEl) setStatus(statusEl, 'All GPU ports shown', true)
					if (load) await load()
				})

				const clearLayoutBtn = Object.assign(document.createElement('button'), {
					type: 'button',
					className: 'device-view__backpanel-slot-edit',
					textContent: 'Clear layout',
					title: 'Discard saved GPU layout and rebuild from detected outputs',
				})
				clearLayoutBtn.style.marginLeft = '4px'
				clearLayoutBtn.style.fontSize = '10px'
				clearLayoutBtn.style.color = '#ff9f9f'
				clearLayoutBtn.style.display = gpuEditMode ? '' : 'none'
				clearLayoutBtn.addEventListener('click', async (ev) => {
					ev.preventDefault()
					ev.stopPropagation()
					if (!confirm('Clear saved GPU layout and rebuild from detected outputs?')) return
					clearGpuLayoutPrefs()
					await Actions.resetGpuLayout()
					if (statusEl) setStatus(statusEl, 'GPU layout cleared — refreshed from detected outputs', true)
					if (load) await load()
				})

				editBtn.addEventListener('click', (ev) => {
					ev.preventDefault()
					ev.stopPropagation()
					gpuEditMode = !gpuEditMode
					editBtn.style.color = gpuEditMode ? '#007bff' : '#ccc'
					casparBand.classList.toggle('device-view--edit-mode', gpuEditMode)
					showAllBtn.style.display = gpuEditMode ? '' : 'none'
					clearLayoutBtn.style.display = gpuEditMode ? '' : 'none'

					const markers = casparOverlay.querySelectorAll('.device-view__panel-marker--gpu')
					markers.forEach((m) => {
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

					if (gpuEditMode && gpuLayoutItems.length > 0) {
						const firstItem = gpuLayoutItems[0]
						const connected = firstItem.pairs.some((pName) =>
							connectedDisplays.some((d) => d.connected && normRandrCaspar(d.name) === normRandrCaspar(pName))
						)
						const canonicalId = resolveCanonicalGpuConnectorId(firstItem.pairs, gpuPhysicalPorts, gpuOuts) || firstItem.id
						const connectorCtx = {
							type: 'gpu_out',
							connector: { id: canonicalId, kind: 'gpu_out', label: firstItem.label, layoutSlotId: firstItem.id, isVirtual: !connected, pairs: firstItem.pairs },
						}
						onPortClick(`caspar_overlay:${canonicalId}:`, canonicalId, connectorCtx)
					}
					if (load) void load()
				})
				titleEl.append(showAllBtn, clearLayoutBtn, editBtn)
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

			if (slot.title === 'GPU') {
				const details = document.createElement('details')
				details.className = 'device-view__gpu-folder'
				const summary = document.createElement('summary')
				summary.textContent = 'Disconnected'
				details.appendChild(summary)
				const discContainer = document.createElement('div')
				discContainer.className = 'device-view__gpu-folder-list'
				details.appendChild(discContainer)
				
				slot.disconnectedContainer = discContainer
				slot.folderDetails = details
			}

			slotEl.appendChild(titleEl)
			slotEl.appendChild(connectorsContainer)

			if (sIdx === 0 || sIdx === 3) {
				col1.appendChild(slotEl)
			} else if (sIdx === 1 || sIdx === 4) {
				col2.appendChild(slotEl)
			} else {
				col3.appendChild(slotEl)
			}
		})
	}



	const markerItems = buildCasparRearMarkerLayoutItems(slots, casparConnectors)

	traceGpuLayoutRearPanelRender({
		live,
		lastPayload,
		gpuOuts,
		gpuListEntries,
		items,
		markerItems,
		gpuEditMode,
	})

	appendCasparRearPanelMarkers({
		casparOverlay,
		markerItems,
		resolveStatusClass,
		getGpuEditMode: () => gpuEditMode,
		getDecklinkEditMode: () => decklinkEditMode,
		customGpuItems: gpuLayoutItems,
		decklinkRearOrderIds,
		selectedConnectorId,
		cableSourceId,
		onPortClick,
		onPortStartCable,
		live,
	})

	const gpuSlot = slots.find(s => s.title === 'GPU')
	if (gpuSlot && gpuSlot.folderDetails && gpuSlot.disconnectedContainer.childNodes.length > 0) {
		gpuSlot.folderDetails.querySelector('summary').textContent = `Disconnected (${gpuSlot.disconnectedContainer.childNodes.length})`
		gpuSlot.container.appendChild(gpuSlot.folderDetails)
	}

	casparBand.addEventListener('click', (ev) => {
		if (ev.target?.closest?.('[data-port-key], [data-connector-id], .device-view__panel-marker')) return
		selectDevice(CASPAR_HOST, live)
	})
	return casparBand
}

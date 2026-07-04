/**
 * Shared rear-panel connector data for classic backplane and simple node layout (WO-82).
 */
import { CASPAR_HOST } from './device-view-helpers.js'
import { readSavedDecklinkOrder, orderDecklinkConnectors } from '../lib/device-view-decklink-order.js'
import { createCasparRearMarkerStatusResolver } from './device-view-caspar-render-helpers.js'
import {
	buildGpuSelectablePortEntries,
	entryToRearPanelGpuItem,
	layoutItemsFromGpuEntries,
} from '../lib/device-view-gpu-port-list.js'
import { buildCasparRearMarkerLayoutItems } from './device-view-caspar-render-markers.js'

/** @returns {object} slots, markerItems, resolveStatusClass, and related rear-panel context */
export function buildCasparRearPanelData(ctx) {
	const { live, lastPayload } = ctx
	const gpuInventoryRaw = Array.isArray(live?.gpu?.connectors) ? live.gpu.connectors : []
	const gpuInventory = gpuInventoryRaw.filter((inv) => {
		const name = String(inv?.shortName || inv?.name || '').trim().toLowerCase()
		if (!name) return false
		if (/^card\d+($|[\s:])/.test(name) || /^gpu\d+($|[\s:])/.test(name) || /^renderd\d+($|[\s:])/.test(name)) return false
		return true
	})
	const graphConnectors = Array.isArray(lastPayload?.graph?.connectors) ? lastPayload.graph.connectors : []
	const suggestedConnectors = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
	const gpuOuts = [...graphConnectors, ...suggestedConnectors]
		.filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'gpu_out')
		.filter((c, i, arr) => arr.findIndex((x) => x?.id === c?.id) === i)
	const deckIo = (lastPayload?.suggested?.connectors || []).filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'decklink_io')
	const deckOut = (lastPayload?.suggested?.connectors || []).filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'decklink_out')
	const streamOut = (lastPayload?.suggested?.connectors || []).filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'stream_out')
	const v4l2Out = (lastPayload?.suggested?.connectors || []).filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'v4l2_out')
	const recordOut = (lastPayload?.suggested?.connectors || []).filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'record_out')
	const audioOuts = (lastPayload?.suggested?.connectors || []).filter(
		(c) => c && c.deviceId === CASPAR_HOST && (c.kind === 'audio_out' || c.kind === 'audio_in'),
	)
	const v4l2Ins = (lastPayload?.suggested?.connectors || []).filter(
		(c) => c && c.deviceId === CASPAR_HOST && c.kind === 'v4l2_in',
	)
	const casparConnectors = (lastPayload?.suggested?.connectors || []).filter(
		(c) =>
			c &&
			c.deviceId === CASPAR_HOST &&
			['gpu_out', 'decklink_out', 'audio_out', 'audio_in', 'v4l2_in', 'v4l2_out', 'stream_out', 'record_out'].includes(c.kind),
	)

	const slots = []
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
	const socketCount = gpuListEntries.filter((e) => /^gpu_p\d+$/i.test(String(e?.connectorId || ''))).length || undefined
	const gpuLayoutItems = layoutItemsFromGpuEntries(gpuListEntries)
	const items = gpuListEntries.map((entry) =>
		entryToRearPanelGpuItem(entry, connectedDisplays, gpuInventory, socketCount),
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
	if (v4l2Ins.length) {
		slots.push({
			title: 'USB video',
			items: v4l2Ins.map((c) => ({
				id: c.id,
				icon: '/assets/hdmi-port-icon.svg',
				label: c.label || c.id,
				kind: 'v4l2_in',
				index: c.index != null ? Number(c.index) : null,
				devicePath: c.externalRef || '',
			})),
		})
	}
	slots.push({
		title: 'Stream',
		items: streamOut.map((c) => ({ id: c.id, icon: '/assets/ethernet-port-icon.svg', label: c.label || c.id, kind: 'stream_out' })),
	})
	slots.push({
		title: 'Virtual cam',
		items: v4l2Out.map((c) => ({
			id: c.id,
			icon: '/assets/hdmi-port-icon.svg',
			label: c.label || c.id,
			kind: 'v4l2_out',
			devicePath: c.externalRef || '',
		})),
	})
	slots.push({
		title: 'Record',
		items: recordOut.map((c) => ({ id: c.id, icon: '/assets/record-port-icon.svg', label: c.label || c.id, kind: 'record_out' })),
	})
	const audioOutputsList = Array.isArray(ctx.lastPayload?.audioOutputs || ctx.currentSettings?.audioOutputs)
		? ctx.lastPayload?.audioOutputs || ctx.currentSettings?.audioOutputs
		: []
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

	const markerItems = buildCasparRearMarkerLayoutItems(slots, casparConnectors)

	return {
		slots,
		casparConnectors,
		markerItems,
		resolveStatusClass,
		gpuListEntries,
		gpuLayoutItems,
		items,
		decklinkRearOrderIds,
		deckIo,
		deckOut,
		v4l2Ins,
		gpuOuts,
		gpuPhysicalPorts: Array.isArray(live?.gpu?.physicalMap?.ports) ? live.gpu.physicalMap.ports : [],
		gpuEffectiveTopology: Array.isArray(live?.gpu?.physicalMap?.effectiveTopology)
			? live.gpu.physicalMap.effectiveTopology
			: [],
		connectedDisplays,
	}
}

/**
 * Materialize missing GPU / destination connectors in the saved device graph before addEdge.
 * Topology-only rear-panel jacks (e.g. gpu_p3) are visible in the UI but may be absent from
 * graph/suggested until explicitly written — syncFromLive can also strip them.
 */
import { CASPAR_HOST } from '../components/device-view-helpers.js'
import {
	gpuPhysicalPortCableId,
	resolveTopologyForDeviceView,
} from './device-view-gpu-port-list.js'
import { findScreenDestinationById } from './device-view-host-channels.js'

const HOST_DEVICE = { id: CASPAR_HOST, role: 'caspar_host', label: 'Caspar / HighAsCG host' }
const DEST_DEVICE = { id: 'destinations', role: 'destinations', label: 'Screen destinations' }

/** @param {string} portId @param {object[] | null | undefined} topology @param {object | null | undefined} payload */
function minimalGpuOutConnector(portId, topology, payload) {
	const id = gpuPhysicalPortCableId(portId)
	if (!/^gpu_p\d+$/i.test(id)) return null
	const row = (topology || []).find((t) => String(t?.physicalPortId || '').trim() === id) || null
	const ports = Array.isArray(payload?.live?.gpu?.physicalMap?.ports) ? payload.live.gpu.physicalMap.ports : []
	const physical = ports.find((p) => String(p?.physicalPortId || '').trim() === id) || null
	const suggested = (payload?.suggested?.connectors || []).find((c) => c?.id === id) || null
	if (suggested) return { ...suggested }
	const pairs = row
		? [row.dpA, row.dpB].filter(Boolean).map(String)
		: physical?.pair
			? [physical.pair.dpA, physical.pair.dpB].filter(Boolean).map(String)
			: []
	const active = String(physical?.runtime?.activePort || pairs[0] || id).trim()
	const pairName =
		String(physical?.pair?.name || '').trim() ||
		(pairs.length ? pairs.join('/') : '')
	return {
		id,
		deviceId: CASPAR_HOST,
		kind: 'gpu_out',
		label: id.replace(/^gpu_p/i, 'P'),
		externalRef: active,
		caspar: { bus: 'pgm', mainIndex: 0 },
		...(pairName || row || physical?.pair
			? {
					gpuPhysical: {
						pair: {
							dpA: String(row?.dpA || physical?.pair?.dpA || pairs[0] || ''),
							dpB: String(row?.dpB || physical?.pair?.dpB || pairs[1] || ''),
							name: pairName,
						},
						slotOrder: Number.isFinite(Number(row?.slotOrder))
							? Number(row.slotOrder)
							: Number(physical?.slotOrder) || 0,
					},
				}
			: {}),
	}
}

/** @param {string} connectorId @param {object | null | undefined} payload */
function minimalDestinationInConnector(connectorId, payload) {
	const id = String(connectorId || '').trim()
	if (!id.startsWith('dst_in_')) return null
	const externalRef = id.slice('dst_in_'.length).trim()
	if (!externalRef) return null
	const existing =
		(payload?.graph?.connectors || []).find((c) => c?.id === id) ||
		(payload?.suggested?.connectors || []).find((c) => c?.id === id)
	if (existing) return { ...existing }
	const destinations = Array.isArray(payload?.screenDestinations?.destinations)
		? payload.screenDestinations.destinations
		: []
	const d = destinations.find((x) => String(x?.id || '').trim() === externalRef) || findScreenDestinationById(payload, externalRef)
	return {
		id,
		deviceId: 'destinations',
		kind: 'destination_in',
		externalRef,
		label: String(d?.label || externalRef),
	}
}

/**
 * @param {object | null | undefined} payload
 * @param {object | null | undefined} settings
 * @param {string[]} connectorIds
 * @returns {{ graph: object, addedIds: string[] }}
 */
export function patchGraphWithMissingCableConnectors(payload, settings, connectorIds) {
	const topology = resolveTopologyForDeviceView(payload, settings)
	const base = payload?.graph && typeof payload.graph === 'object' ? payload.graph : null
	const graph = base
		? JSON.parse(JSON.stringify(base))
		: { version: 1, devices: [HOST_DEVICE], connectors: [], edges: [] }
	if (!Array.isArray(graph.devices)) graph.devices = []
	if (!Array.isArray(graph.connectors)) graph.connectors = []
	if (!Array.isArray(graph.edges)) graph.edges = []
	if (!graph.devices.some((d) => d?.id === CASPAR_HOST)) graph.devices.push(HOST_DEVICE)

	const have = new Set(graph.connectors.map((c) => String(c?.id || '').trim()).filter(Boolean))
	const addedIds = []

	for (const rawId of connectorIds || []) {
		const id = gpuPhysicalPortCableId(String(rawId || '').trim())
		if (!id || have.has(id)) continue
		let row = null
		if (/^gpu_p\d+$/i.test(id)) row = minimalGpuOutConnector(id, topology, payload)
		else if (id.startsWith('dst_in_')) row = minimalDestinationInConnector(id, payload)
		if (!row) continue
		if (row.deviceId === 'destinations' && !graph.devices.some((d) => d?.id === 'destinations')) {
			graph.devices.push(DEST_DEVICE)
		}
		graph.connectors.push(row)
		have.add(id)
		addedIds.push(id)
	}

	return { graph, addedIds }
}

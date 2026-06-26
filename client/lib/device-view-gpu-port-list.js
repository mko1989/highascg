/**
 * Build selectable GPU output entries from server live.gpu (physicalMap + suggested).
 *
 * Server payload (GET /api/device-view → `live.gpu`), simplified:
 *
 * ```json
 * {
 *   "model": "NVIDIA GeForce ...",
 *   "displays": [
 *     { "name": "DP-3", "connected": true, "resolution": "1920x1080", "refreshHz": 60 }
 *   ],
 *   "physicalMap": {
 *     "topologySource": "drm",
 *     "ports": [
 *       {
 *         "physicalPortId": "gpu_p0",
 *         "slotOrder": 0,
 *         "pair": { "name": "DP-0/DP-1", "dpA": "DP-0", "dpB": "DP-1" },
 *         "runtime": {
 *           "connected": false,
 *           "activePort": "DP-1",
 *           "xrandrName": "card1-DP-1",
 *           "displayName": "card1-DP-1",
 *           "resolution": "",
 *           "refreshHz": null
 *         }
 *       }
 *     ]
 *   }
 * }
 * ```
 *
 * Rear panel: **one jack per physical DP socket** when the server probe lists separate
 * connectors (modetest topology). Legacy dual-DP brackets still show one jack per pair.
 * `suggested.connectors` (`kind: "gpu_out"`, ids like `gpu_p0`) align with those ports.
 * Extra `displays[]` rows only add jacks when not already driven by a port's active runtime.
 */
export {
	GPU_CUSTOM_LAYOUT_KEY,
	GPU_REAR_PORT_COUNT_OVERRIDE_KEY,
	RTX_20_30_SOCKET_COUNT,
} from './device-view-gpu-port-constants.js'
export {
	clearGpuLayoutPrefs,
	gpuLayoutItemsToPhysicalTopology,
	readGpuLayoutPrefs,
} from './device-view-gpu-port-layout-prefs.js'
export {
	buildGpuEntriesFromTopology,
	buildRawGpuPortEntriesFromLive,
	collectGpuConnectorIdsInGraph,
} from './device-view-gpu-port-entries.js'
export {
	layoutItemsFromGpuEntries,
	mergeGpuLayoutEntriesWithPrefs,
	resolveGpuSlotIdFromSavedLayout,
} from './device-view-gpu-port-merge.js'
export {
	defaultClientGpuTopology,
	detectRtx2030QuadFromLive,
	reconcileTopologyWithLiveDisplays,
	resolveEffectiveGpuTopology,
	resolveTopologyForDeviceView,
} from './device-view-gpu-port-topology.js'
export {
	collectGpuPortNameOptions,
	consolidateBracketSplitEntries,
	countUsableGpuConnectorInventory,
	displaysMatchingPairs,
	gpuPhysicalPortCableId,
	gpuSplitConnectorId,
	hasDrmGpuPhysicalMap,
	isPrimaryTopologySocket,
	resolveExpectedGpuPhysicalPortCount,
} from './device-view-gpu-port-utils.js'

import {
	buildGpuEntriesFromTopology,
	buildRawGpuPortEntriesFromLive,
} from './device-view-gpu-port-entries.js'
import { readGpuLayoutPrefs } from './device-view-gpu-port-layout-prefs.js'
import {
	layoutItemsFromGpuEntries,
	mergeGpuLayoutEntriesWithPrefs,
} from './device-view-gpu-port-merge.js'
import {
	reconcileTopologyWithLiveDisplays,
	resolveEffectiveGpuTopology,
} from './device-view-gpu-port-topology.js'
import { consolidateBracketSplitEntries, displaysMatchingPairs, isPrimaryTopologySocket } from './device-view-gpu-port-utils.js'

/**
 * Layout-editor rows from current live GPU data (no saved prefs).
 * @param {object} [live]
 * @param {object[]} [suggestedGpuOuts]
 */
export function buildGpuLayoutItemsFromLive(live, suggestedGpuOuts = [], savedTopology = null) {
	return layoutItemsFromGpuEntries(
		buildGpuSelectablePortEntries({
			live,
			suggestedGpuOuts,
			savedTopology,
			layoutPrefs: { byId: new Map(), orderIds: [] },
			hideDisconnectedByDefault: false,
		}),
	)
}

/**
 * Build GPU rear-panel entries from live server data (physical map + suggested + all RandR outputs).
 * @param {{ live: object, suggestedGpuOuts?: object[], graphGpuOuts?: object[], layoutPrefs?: { byId: Map, orderIds: string[] }, savedTopology?: object[], hideDisconnectedByDefault?: boolean }} opts
 * @returns {Array<object>}
 */
export function buildGpuSelectablePortEntries({
	live,
	suggestedGpuOuts = [],
	graphGpuOuts = [],
	layoutPrefs = null,
	savedTopology = null,
	hideDisconnectedByDefault = null,
}) {
	const prefs = layoutPrefs ?? readGpuLayoutPrefs()
	const topology = reconcileTopologyWithLiveDisplays(
		resolveEffectiveGpuTopology(savedTopology, prefs),
		live,
	)
	let base = buildGpuEntriesFromTopology(topology, live, suggestedGpuOuts, graphGpuOuts)

	const raw = consolidateBracketSplitEntries(
		buildRawGpuPortEntriesFromLive(live, suggestedGpuOuts, graphGpuOuts),
	)
	const baseIds = new Set(base.map((e) => String(e?.connectorId || '').trim()))
	for (const e of raw) {
		const id = String(e?.connectorId || '').trim()
		if (/^gpu_p\d+(__.*)?$/i.test(id)) continue
		if (!id || baseIds.has(id)) continue
		base.push(e)
		baseIds.add(id)
	}

	const hideDefault =
		hideDisconnectedByDefault !== null ? hideDisconnectedByDefault : false
	return mergeGpuLayoutEntriesWithPrefs(base, prefs, {
		defaultHideDisconnected: hideDefault,
		connectedDisplays: Array.isArray(live?.gpu?.displays) ? live.gpu.displays : [],
		connectors: Array.isArray(live?.gpu?.connectors) ? live.gpu.connectors : [],
		topology,
	})
}

export function entryToRearPanelGpuItem(entry, connectedDisplays = [], connectors = []) {
	const pairs = Array.isArray(entry.pairs) ? entry.pairs : []
	const hits = displaysMatchingPairs(pairs, connectedDisplays, connectors)
	const livePresent = !!(entry.livePresent || hits.length > 0)
	const connected = !!(entry.connected || (livePresent && entry.resolution && entry.resolution !== 'unknown'))
	const inDeviceGraph = entry.inDeviceGraph === true
	return {
		id: entry.connectorId,
		layoutSlotId: entry.layoutSlotId || entry.connectorId,
		icon: entry.icon,
		label: entry.label,
		kind: 'gpu_out',
		index: entry.index,
		connected,
		livePresent,
		topologySlot: entry.topologySlot === true || isPrimaryTopologySocket(entry.connectorId),
		hidden: entry.hidden,
		pairs,
		monitor: entry.monitor || '',
		resolution: entry.resolution || '',
		refreshHz: entry.refreshHz,
		inDeviceGraph,
		isVirtual: !inDeviceGraph,
	}
}

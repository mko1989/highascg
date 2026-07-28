import { normRandrCaspar } from './device-view-randr-norm.js'
import { traceGpuLayoutMergeComplete } from './device-view-gpu-layout-debug.js'
import {
	entryFromInferredPhysicalPort,
	entryFromTopologyRow,
} from './device-view-gpu-port-entries.js'
import { getLastGpuLayoutTraceSeq } from './device-view-gpu-port-trace-state.js'
import { isPrimaryTopologySocket } from './device-view-gpu-port-utils.js'

/**
 * Map RandR pair names to layout slot id (gpu_pN) from saved rear-panel layout or settings topology.
 * @param {string[]} pairs
 * @param {{ byId?: Map<string, object> }} [prefs]
 * @param {object[] | null} [savedTopology]
 */
export function resolveGpuSlotIdFromSavedLayout(pairs, _prefs = null, savedTopology = null) {
	const want = new Set((pairs || []).map((p) => normRandrCaspar(p)).filter(Boolean))
	if (!want.size) return ''
	for (const row of Array.isArray(savedTopology) ? savedTopology : []) {
		const canonical = String(row?.physicalPortId || '').trim()
		if (!/^gpu_p\d+$/i.test(canonical)) continue
		for (const p of [row.dpA, row.dpB].filter(Boolean)) {
			if (want.has(normRandrCaspar(p))) return canonical
		}
	}
	return ''
}

/**
 * Apply saved order/hidden/labels from localStorage onto port entries.
 * @param {object[]} entries
 * @param {{ byId?: Map<string, object>, orderIds?: string[] }} [prefs]
 * @param {{ defaultHideDisconnected?: boolean, connectedDisplays?: object[], connectors?: object[], topology?: object[] }} [opts]
 */
export function mergeGpuLayoutEntriesWithPrefs(entries, prefs, { defaultHideDisconnected = false, connectedDisplays = [], _connectors = [], topology = null } = {}) {
	const connectedNames = new Set(
		(connectedDisplays || [])
			.filter((d) => d?.connected)
			.map((d) => normRandrCaspar(d.name))
			.filter(Boolean),
	)
	const liveIds = new Set(entries.map((e) => String(e.connectorId || e.layoutSlotId || '').trim()).filter(Boolean))
	const byIdRaw = prefs?.byId || new Map()
	const orderIds = (topology || [])
		.map((t) => String(t?.physicalPortId || '').trim())
		.filter((id) => /^gpu_p\d+$/i.test(id))
	const decisions = []
	const socketCount = Array.isArray(topology) && topology.length ? topology.length : undefined
	const merged = entries.map((entry) => {
		const id = String(entry.connectorId || entry.layoutSlotId || '').trim()
		const saved = byIdRaw.get(id)
		let hiddenReason
		let hidden
		if (saved != null) {
			hidden = !!saved.hidden
			hiddenReason = hidden ? 'localStorage hidden=true' : 'localStorage hidden=false'
		} else if (defaultHideDisconnected) {
			hidden = !entry.connected
			hiddenReason = hidden ? 'defaultHideDisconnected (disconnected)' : 'defaultHideDisconnected (connected)'
		} else {
			hidden = !!entry.hidden
			hiddenReason = hidden ? 'entry.hidden' : 'visible (default)'
		}
		const pairs = entry.pairs
		let livePresent = !!entry.livePresent
		let connected = !!entry.connected
		let monitor = entry.monitor || ''
		decisions.push({
			id,
			hidden,
			hiddenReason,
			inSavedPrefs: saved != null,
			savedHidden: saved != null ? !!saved.hidden : null,
			connected,
			livePresent,
			label: entry.label,
			orphanSavedPref: false,
		})
		return {
			...entry,
			hidden,
			connected,
			livePresent,
			monitor,
			label: saved?.label ? String(saved.label) : entry.label,
			pairs,
			topologySlot: entry.topologySlot === true || isPrimaryTopologySocket(id, socketCount),
		}
	})
	for (const savedId of byIdRaw.keys()) {
		if (!liveIds.has(String(savedId).trim())) {
			decisions.push({
				id: savedId,
				hidden: !!byIdRaw.get(savedId)?.hidden,
				hiddenReason: 'orphan saved pref (pruned — not in live rear panel list)',
				inSavedPrefs: true,
				savedHidden: !!byIdRaw.get(savedId)?.hidden,
				connected: null,
				label: byIdRaw.get(savedId)?.label,
				orphanSavedPref: true,
			})
		}
	}
	traceGpuLayoutMergeComplete(getLastGpuLayoutTraceSeq(), merged, decisions)
	let result = merged
	const mergedIds = new Set(merged.map((e) => String(e.connectorId || '').trim()))
	for (const slotId of orderIds) {
		const id = String(slotId).trim()
		if (!id || mergedIds.has(id)) continue
		const m = /^gpu_p(\d+)$/i.exec(id)
		if (!m) continue
		const saved = byIdRaw.get(id)
		const topoRow = (topology || []).find((t) => String(t?.physicalPortId || '').trim() === id)
		const inferred = topoRow
			? entryFromTopologyRow(topoRow, connectedDisplays, [], [], result.length)
			: entryFromInferredPhysicalPort(parseInt(m[1], 10), [], connectedDisplays, topology)
		if (saved?.pairs?.length) {
			inferred.pairs = [...saved.pairs]
		}
		if (saved?.label) inferred.label = String(saved.label)
		if (saved?.hidden != null) inferred.hidden = !!saved.hidden
		result.push(inferred)
		mergedIds.add(id)
	}
	if (!orderIds.length) return result
	const rank = (id) => {
		const i = orderIds.indexOf(id)
		return i >= 0 ? i : 9000 + result.findIndex((e) => e.connectorId === id)
	}
	return [...result].sort((a, b) => rank(a.connectorId) - rank(b.connectorId))
}

/** Layout-editor / localStorage row shape from port entries. */
export function layoutItemsFromGpuEntries(entries) {
	return entries.map((e) => {
		const pairs = [...(e.pairs || [])]
		if (!pairs.length && e.monitor) pairs.push(e.monitor)
		const blob = [...pairs, e.monitor].join(' ').toUpperCase()
		return {
			id: e.connectorId,
			label: e.label,
			pairs,
			type: blob.includes('HDMI') ? 'hdmi' : blob.includes('EDP') ? 'edp' : 'dp',
			hidden: !!e.hidden,
		}
	})
}

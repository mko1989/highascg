import { normRandrCaspar } from '../components/device-view-caspar-render-helpers.js'
import { readGpuLayoutPrefs } from './device-view-gpu-port-layout-prefs.js'

/** RTX 20/30 backplate order: DP 0/1, HDMI, DP 2/3, DP 4/5. */
export function defaultClientGpuTopology() {
	return [
		{ physicalPortId: 'gpu_p0', slotOrder: 0, dpA: 'DP-0', dpB: 'DP-1', connectorNumber: 0, location: 0 },
		{ physicalPortId: 'gpu_p1', slotOrder: 1, dpA: 'HDMI-0', dpB: 'HDMI-1', connectorNumber: 1, location: 1 },
		{ physicalPortId: 'gpu_p2', slotOrder: 2, dpA: 'DP-2', dpB: 'DP-3', connectorNumber: 2, location: 2 },
		{ physicalPortId: 'gpu_p3', slotOrder: 3, dpA: 'DP-4', dpB: 'DP-5', connectorNumber: 3, location: 3 },
	]
}

/** Fill gpu_p0..p3 when saved layout only has 3 rows (stale prefs). */
function mergeTopologyWithDefaultSockets(rows) {
	const defaults = defaultClientGpuTopology()
	const byId = new Map((rows || []).map((r) => [String(r?.physicalPortId || '').trim(), r]))
	const merged = defaults.map((def, idx) => {
		const cur = byId.get(def.physicalPortId)
		if (!cur) return { ...def }
		return {
			...def,
			...cur,
			physicalPortId: def.physicalPortId,
			dpA: String(cur.dpA || def.dpA || '').trim(),
			dpB: String(cur.dpB || def.dpB || '').trim(),
			slotOrder: idx,
			connectorNumber: idx,
			location: idx,
		}
	})
	for (const row of rows || []) {
		const id = String(row?.physicalPortId || '').trim()
		if (!id || defaults.some((d) => d.physicalPortId === id)) continue
		merged.push(row)
	}
	return merged.map((row, idx) => ({
		...row,
		slotOrder: idx,
		connectorNumber: idx,
		location: idx,
	}))
}

function topologyRowsFromLayoutPrefs(prefs) {
	const order =
		(prefs?.orderIds || []).length > 0
			? prefs.orderIds
			: [...(prefs?.byId || new Map()).keys()]
	if (!order.length || !prefs?.byId?.size) return []
	const rows = []
	for (const rawId of order) {
		const item = prefs.byId.get(rawId)
		if (!item) continue
		const physicalPortId = String(item.id || rawId).replace(/__.*$/i, '')
		if (!/^gpu_p\d+$/i.test(physicalPortId)) continue
		const pairs = Array.isArray(item.pairs) ? item.pairs.filter(Boolean) : []
		rows.push({
			physicalPortId,
			slotOrder: rows.length,
			dpA: String(pairs[0] || '').trim(),
			dpB: String(pairs[1] || '').trim(),
			connectorNumber: rows.length,
			location: rows.length,
		})
	}
	return rows
}

/**
 * Saved settings topology + localStorage layout; layout wins, else settings, else client default.
 * Always includes all four RTX 20/30 sockets (gpu_p0..gpu_p3).
 * @param {object[] | null | undefined} savedTopology
 * @param {{ byId?: Map<string, object>, orderIds?: string[] }} [layoutPrefs]
 */
export function resolveEffectiveGpuTopology(savedTopology, layoutPrefs = null) {
	const prefs = layoutPrefs || readGpuLayoutPrefs()
	const fromPrefs = topologyRowsFromLayoutPrefs(prefs)
	if (fromPrefs.length) return mergeTopologyWithDefaultSockets(fromPrefs)
	if (Array.isArray(savedTopology) && savedTopology.length) {
		return mergeTopologyWithDefaultSockets(savedTopology)
	}
	return defaultClientGpuTopology()
}

function connectedLiveRandrNames(live) {
	const out = new Set()
	for (const d of live?.gpu?.displays || []) {
		if (!d || d.connected === false) continue
		const n = normRandrCaspar(d?.name)
		if (n) out.add(n)
	}
	return out
}

function bracketHasLiveRandr(connected, dpA, dpB) {
	const a = normRandrCaspar(dpA)
	const b = normRandrCaspar(dpB)
	return (a && connected.has(a)) || (b && connected.has(b))
}

/** xrandr shows DP-0, HDMI-0, DP-2, DP-4 (or bracket alternates) — RTX 20/30 quad. */
export function detectRtx2030QuadFromLive(live) {
	const connected = connectedLiveRandrNames(live)
	if (connected.size < 4) return false
	const rtx = defaultClientGpuTopology()
	let matched = 0
	for (const row of rtx) {
		if (bracketHasLiveRandr(connected, row.dpA, row.dpB)) matched++
	}
	return matched >= 4
}

/** Prefer live xrandr over stale saved pair → gpu_pN map (fixes DP-4 on gpu_unmapped). */
export function reconcileTopologyWithLiveDisplays(topology, live) {
	const connected = connectedLiveRandrNames(live)
	if (!connected.size) return topology
	if (detectRtx2030QuadFromLive(live)) return defaultClientGpuTopology()
	const rtx = defaultClientGpuTopology()
	const merged = mergeTopologyWithDefaultSockets(topology)
	return merged.map((row, idx) => {
		const def = rtx.find((r) => r.physicalPortId === row.physicalPortId)
		if (!def) return row
		if (bracketHasLiveRandr(connected, row.dpA, row.dpB)) return row
		if (bracketHasLiveRandr(connected, def.dpA, def.dpB)) {
			return {
				...row,
				dpA: def.dpA,
				dpB: def.dpB,
				slotOrder: idx,
				connectorNumber: idx,
				location: idx,
			}
		}
		return row
	})
}

/**
 * Topology for cabling + server persist: server-reconciled map, else live xrandr, else saved/default.
 * @param {object | null | undefined} payload
 * @param {object | null | undefined} settings
 */
export function resolveTopologyForDeviceView(payload, settings = null) {
	const fromMap = payload?.live?.gpu?.physicalMap?.effectiveTopology
	if (Array.isArray(fromMap) && fromMap.length) return fromMap
	const base = resolveEffectiveGpuTopology(
		payload?.gpuPhysicalTopology || settings?.gpuPhysicalTopology,
	)
	return reconcileTopologyWithLiveDisplays(base, payload?.live)
}

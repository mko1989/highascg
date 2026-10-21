import { readGlobalPref, writeGlobalPref } from './client-prefs.js'

/** Remove the saved rear-panel order/hidden/port mapping (shared on the node, WO-598 D, + localStorage). */
export function clearGpuLayoutPrefs() {
	writeGlobalPref('gpuLayout', null)
}

/** @param {object[]} items rear-panel layout rows (hidden flags + labels) */
export function saveGpuLayoutPrefs(items) {
	if (Array.isArray(items)) writeGlobalPref('gpuLayout', items)
}

/** @returns {{ byId: Map<string, object>, orderIds: string[] }} */
export function readGpuLayoutPrefs() {
	try {
		const arr = readGlobalPref('gpuLayout')
		if (!Array.isArray(arr)) return { byId: new Map(), orderIds: [] }
		const byId = new Map()
		const orderIds = []
		for (const item of arr) {
			const id = String(item?.id || '').trim()
			if (!id || !/^gpu_p\d+(__[A-Za-z0-9_]+)?$/i.test(id)) continue
			byId.set(id, item)
			orderIds.push(id)
		}
		return { byId, orderIds }
	} catch {
		return { byId: new Map(), orderIds: [] }
	}
}

/** Saved layout row → server `gpuPhysicalTopology` (persisted in settings). */
export function gpuLayoutItemsToPhysicalTopology(items) {
	if (!Array.isArray(items)) return []
	return items
		.map((item, idx) => {
			const rawId = String(item?.id || '').trim()
			const m = rawId.match(/^(gpu_p\d+)/i)
			if (!m) return null
			const pairs = Array.isArray(item.pairs) ? item.pairs.filter(Boolean) : []
			return {
				physicalPortId: m[1],
				slotOrder: idx,
				dpA: String(pairs[0] || '').trim(),
				dpB: String(pairs[1] || '').trim(),
				connectorNumber: idx,
				location: idx,
			}
		})
		.filter(Boolean)
}

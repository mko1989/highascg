import { readGpuLayoutPrefs } from './device-view-gpu-port-layout-prefs.js'
import { GPU_CUSTOM_LAYOUT_KEY } from './device-view-gpu-port-constants.js'

export const GPU_CUSTOM_LAYOUT_BAK_KEY = 'gpu_custom_layout.bak'
export const GPU_LAYOUT_MIGRATED_KEY = 'gpu_custom_layout_migrated_v108'

function topologyRowsFromLegacyLayoutPrefs(prefs) {
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
		if (!pairs.length) continue
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
 * One-time: push localStorage layout order/pairs to server, keep hidden flags only.
 * @param {(topology: object[]) => Promise<unknown>} saveTopology
 * @returns {Promise<boolean>} true when legacy order was migrated
 */
export async function migrateLegacyGpuLayoutPrefsToServer(saveTopology) {
	try {
		if (localStorage.getItem(GPU_LAYOUT_MIGRATED_KEY) === '1') return false
		const prefs = readGpuLayoutPrefs()
		const rows = topologyRowsFromLegacyLayoutPrefs(prefs)
		if (rows.length && typeof saveTopology === 'function') {
			await saveTopology(rows)
		}
		const raw = localStorage.getItem(GPU_CUSTOM_LAYOUT_KEY)
		if (raw) localStorage.setItem(GPU_CUSTOM_LAYOUT_BAK_KEY, raw)
		const hiddenOnly = (prefs.orderIds || [])
			.map((id) => {
				const item = prefs.byId.get(id)
				if (!item) return null
				return {
					id: String(item.id || id).trim(),
					hidden: !!item.hidden,
					pairs: [],
					label: String(item.label || '').trim(),
				}
			})
			.filter(Boolean)
		if (hiddenOnly.length) {
			localStorage.setItem(GPU_CUSTOM_LAYOUT_KEY, JSON.stringify(hiddenOnly))
		} else {
			localStorage.removeItem(GPU_CUSTOM_LAYOUT_KEY)
		}
		localStorage.setItem(GPU_LAYOUT_MIGRATED_KEY, '1')
		return rows.length > 0
	} catch {
		return false
	}
}

import { normRandrCaspar } from './device-view-randr-norm.js'

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

/** @deprecated Server publishes effectiveTopology — kept for legacy quad detection only. */
export function detectRtx2030QuadFromLive(live) {
	const topology = live?.gpu?.physicalMap?.effectiveTopology
	if (!Array.isArray(topology) || topology.length < 4) return false
	const connected = connectedLiveRandrNames(live)
	if (connected.size < 4) return false
	let matched = 0
	for (const row of topology.slice(0, 4)) {
		if (bracketHasLiveRandr(connected, row.dpA, row.dpB)) matched++
	}
	return matched >= 4
}

/** @deprecated Use server physicalMap.effectiveTopology. */
export function reconcileTopologyWithLiveDisplays(topology, _live) {
	return Array.isArray(topology) ? topology : []
}

/**
 * Settings topology only (localStorage order/pairs no longer win).
 * @param {object[] | null | undefined} savedTopology
 */
export function resolveEffectiveGpuTopology(savedTopology) {
	if (Array.isArray(savedTopology) && savedTopology.length) return savedTopology
	return []
}

/**
 * Topology for cabling + rear panel: server-reconciled map, else saved settings.
 * @param {object | null | undefined} payload
 * @param {object | null | undefined} settings
 */
export function resolveTopologyForDeviceView(payload, settings = null) {
	const fromMap = payload?.live?.gpu?.physicalMap?.effectiveTopology
	if (Array.isArray(fromMap) && fromMap.length) return fromMap
	const saved = payload?.gpuPhysicalTopology || settings?.gpuPhysicalTopology
	if (Array.isArray(saved) && saved.length) return saved
	const suggested = payload?.live?.gpu?.physicalMap?.suggestedTopology
	if (Array.isArray(suggested) && suggested.length) return suggested
	return []
}

export function gpuTopologyMismatchActive(payload) {
	return !!payload?.live?.gpu?.physicalMap?.topologyMismatch
}

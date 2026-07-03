import { gpuPhysicalPortCableId } from '../lib/device-view-gpu-port-list.js'
import { resolveTopologyForDeviceView } from '../lib/device-view-gpu-port-topology.js'
import { normRandrCaspar } from './device-view-caspar-render-helpers.js'

/**
 * Caspar screen index (1–4) from the physical rear jack (gpu_p0 → 1, gpu_p2 → 3).
 * Used for OS/xrandr settings keys (`screen_N_system_id`, EDID list, etc.) — not cable routing.
 */
export function resolveGpuPhysicalScreenIndex(conn, lastPayload) {
	const id = gpuPhysicalPortCableId(conn?.id || '')
	const m = /^gpu_p(\d+)$/i.exec(id)
	if (m) {
		const n = parseInt(m[1], 10)
		if (Number.isFinite(n) && n >= 0) return Math.max(1, Math.min(4, n + 1))
	}
	const ports = Array.isArray(lastPayload?.live?.gpu?.physicalMap?.ports) ? lastPayload.live.gpu.physicalMap.ports : []
	const p = ports.find((x) => String(x?.physicalPortId || '').trim() === id) || null
	if (p != null && Number.isFinite(Number(p.slotOrder))) {
		return Math.max(1, Math.min(4, Number(p.slotOrder) + 1))
	}
	const slot = Number(conn?.gpuPhysical?.slotOrder)
	if (Number.isFinite(slot) && slot >= 0) return Math.max(1, Math.min(4, Math.round(slot) + 1))
	return resolveGpuScreenNumber(conn, lastPayload)
}

/**
 * Resolves Caspar screen index (1–4) for a GPU output connector from graph / bindings.
 * Must match `calculateLayoutPositions` graph-bound logic: screen index from binding / destination, not GPU list order.
 */
export function resolveGpuScreenNumber(conn, lastPayload) {
	const ob = conn?.caspar?.outputBinding
	if (ob && String(ob.type || '').toLowerCase() === 'screen') {
		const idx = parseInt(String(ob.index ?? ''), 10)
		if (Number.isFinite(idx) && idx >= 1) return Math.max(1, Math.min(4, idx))
	}
	const edges = lastPayload?.graph?.edges || []
	const inEdge = edges.find((e) => String(e?.sinkId || '') === String(conn?.id || ''))
	if (inEdge) {
		const srcId = String(inEdge.sourceId || '')
		if (srcId.startsWith('dst_in_')) {
			const dstId = srcId.slice('dst_in_'.length)
			const dests = lastPayload?.screenDestinations?.destinations || []
			const d = dests.find((x) => String(x?.id || '') === dstId)
			if (d) {
				const dMode = String(d.mode || 'pgm_prv').toLowerCase()
				if (dMode !== 'multiview' && dMode !== 'stream') {
					const ms = parseInt(String(d.mainScreenIndex ?? 0), 10) || 0
					return Math.max(1, Math.min(4, ms + 1))
				}
			}
		}
	}
	const mainIdx = Number(conn?.caspar?.mainIndex)
	if (Number.isFinite(mainIdx) && mainIdx >= 0) return Math.max(1, Math.min(4, Math.round(mainIdx) + 1))
	const sug = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
	const gpu = sug.filter((x) => x && x.kind === 'gpu_out')
	const idx = gpu.findIndex((x) => String(x?.id || '') === String(conn?.id || ''))
	return idx >= 0 ? Math.max(1, Math.min(4, idx + 1)) : 1
}

/** GPU output routed to a multiview Caspar channel (binding or cabled multiview destination). */
export function gpuOutputIsMultiviewBound(conn, lastPayload) {
	const ob = conn?.caspar?.outputBinding
	if (ob && String(ob.type || '').toLowerCase() === 'multiview') return true
	const edges = lastPayload?.graph?.edges || []
	const inEdge = edges.find((e) => String(e?.sinkId || '') === String(conn?.id || ''))
	if (!inEdge) return false
	const srcId = String(inEdge.sourceId || '')
	if (!srcId.startsWith('dst_in_')) return false
	const dstId = srcId.slice('dst_in_'.length)
	const dests = lastPayload?.screenDestinations?.destinations || []
	const d = dests.find((x) => String(x?.id || '') === dstId)
	return !!d && String(d.mode || '').toLowerCase() === 'multiview'
}

/** Live RandR display row for a rear GPU jack (topology pair → active output). */
export function resolveGpuDetectedDisplay(conn, lastPayload) {
	const ports = Array.isArray(lastPayload?.live?.gpu?.physicalMap?.ports) ? lastPayload.live.gpu.physicalMap.ports : []
	const displays = Array.isArray(lastPayload?.live?.gpu?.displays) ? lastPayload.live.gpu.displays : []
	const canonicalId = gpuPhysicalPortCableId(conn?.id || '')
	const byId = ports.find((p) => String(p?.physicalPortId || '').trim() === canonicalId) || null
	const topo = resolveTopologyForDeviceView(lastPayload, lastPayload?._settings)
	const topoRow = topo.find((t) => String(t?.physicalPortId || '').trim() === canonicalId) || null
	const pairNames = []
	if (topoRow) {
		if (topoRow.dpA) pairNames.push(String(topoRow.dpA).trim())
		if (topoRow.dpB) pairNames.push(String(topoRow.dpB).trim())
	} else if (byId?.pair) {
		if (byId.pair.dpA) pairNames.push(String(byId.pair.dpA).trim())
		if (byId.pair.dpB) pairNames.push(String(byId.pair.dpB).trim())
	} else if (conn?.gpuPhysical?.pair) {
		if (conn.gpuPhysical.pair.dpA) pairNames.push(String(conn.gpuPhysical.pair.dpA).trim())
		if (conn.gpuPhysical.pair.dpB) pairNames.push(String(conn.gpuPhysical.pair.dpB).trim())
	}
	const findDisplay = (name) => {
		const want = normRandrCaspar(name)
		if (!want) return null
		return displays.find((x) => normRandrCaspar(x?.name) === want) || null
	}
	if (byId) {
		const activePort = String(byId?.runtime?.activePort || byId?.runtime?.xrandrName || '').trim()
		if (activePort) {
			const activeNorm = normRandrCaspar(activePort)
			if (pairNames.some((p) => normRandrCaspar(p) === activeNorm)) {
				const d = findDisplay(activePort)
				if (d) return d
			}
		}
	}
	for (const name of pairNames) {
		const d = findDisplay(name)
		if (d?.connected) return d
	}
	for (const name of pairNames) {
		const d = findDisplay(name)
		if (d) return d
	}
	return null
}

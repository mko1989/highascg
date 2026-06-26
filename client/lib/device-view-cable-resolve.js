/**
 * Resolve UI connector ids to persisted graph ids before POST addEdge.
 * One cable per physical socket (gpu_pN). DP-N / DP-(N+1) on the same jack share gpu_pN.
 */
import { normRandrCaspar } from '../components/device-view-caspar-render-helpers.js'
import { readGpuLayoutPrefs, resolveGpuSlotIdFromSavedLayout, gpuPhysicalPortCableId } from './device-view-gpu-port-list.js'

/**
 * @param {object | null | undefined} payload
 * @param {string} connectorId
 */
export function canonicalCableConnectorId(payload, connectorId) {
	const id = String(connectorId || '').trim()
	if (!id) return id

	const fromGpu = gpuPhysicalPortCableId(id)
	if (/^gpu_p\d+$/i.test(fromGpu) && /^gpu_p\d+/i.test(id)) return fromGpu

	if (/^(DP|HDMI|EDP)-\d+$/i.test(id)) {
		const want = normRandrCaspar(id)
		const fromLayout = resolveGpuSlotIdFromSavedLayout(
			[id],
			readGpuLayoutPrefs(),
			payload?.gpuPhysicalTopology || payload?.settings?.gpuPhysicalTopology,
		)
		if (fromLayout) return fromLayout

		const ports = Array.isArray(payload?.live?.gpu?.physicalMap?.ports) ? payload.live.gpu.physicalMap.ports : []
		for (const p of ports) {
			const parent = String(p?.physicalPortId || '').trim()
			if (!parent) continue
			const pairA = normRandrCaspar(p?.pair?.dpA)
			const pairB = normRandrCaspar(p?.pair?.dpB)
			if (want === pairA || want === pairB) return parent
			const rt = p?.runtime && typeof p.runtime === 'object' ? p.runtime : {}
			if (
				normRandrCaspar(rt.activePort) === want ||
				normRandrCaspar(rt.xrandrName) === want ||
				normRandrCaspar(rt.displayName) === want
			) {
				return parent
			}
			for (const key of ['connectorA', 'connectorB']) {
				const sn = p?.probe?.[key]?.shortName
				if (sn && normRandrCaspar(sn) === want) return parent
			}
		}
		const all = [
			...(Array.isArray(payload?.graph?.connectors) ? payload.graph.connectors : []),
			...(Array.isArray(payload?.suggested?.connectors) ? payload.suggested.connectors : []),
		].filter((c) => c?.kind === 'gpu_out')
		for (const c of all) {
			const ref = normRandrCaspar(c.externalRef || c.label || '')
			if (ref === want) return gpuPhysicalPortCableId(String(c.id || ''))
		}
	}

	return id
}

/**
 * @param {object | null | undefined} payload
 * @param {string} sourceId
 * @param {string} sinkId
 */
export function resolveCableEdgeIds(payload, sourceId, sinkId) {
	return {
		sourceId: canonicalCableConnectorId(payload, sourceId),
		sinkId: canonicalCableConnectorId(payload, sinkId),
	}
}

/** @param {object | null | undefined} payload @param {string} sinkId */
export function findGpuSinkCableConflict(payload, sinkId) {
	const sid = gpuPhysicalPortCableId(String(sinkId || '').trim())
	if (!sid) return null
	const edges = Array.isArray(payload?.graph?.edges) ? payload.graph.edges : []
	return edges.find((e) => gpuPhysicalPortCableId(String(e?.sinkId || '').trim()) === sid) || null
}

/** @param {string} raw */
export function isUnknownCableConnectorError(raw) {
	const r = String(raw || '').trim().toLowerCase()
	return r === 'unknown_sink' || r === 'unknown_source' || r.includes('unknown_sink') || r.includes('unknown_source')
}

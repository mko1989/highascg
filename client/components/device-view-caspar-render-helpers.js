import { decklinkInputState, stateClass, connectorById } from './device-view-helpers.js'
import { isDecklinkIoIn, isDecklinkIoOut } from '../lib/decklink-io-direction.js'

/** RandR names may be DP-0 or card0-DP-0 depending on source. */
export function normRandrCaspar(v) {
	return String(v || '').trim().toUpperCase().replace(/^CARD\d+-/i, '')
}

function layoutSlotIdForPairs(pairs, effectiveTopology) {
	const want = new Set((pairs || []).map((p) => normRandrCaspar(p)).filter(Boolean))
	if (!want.size) return ''
	if (Array.isArray(effectiveTopology)) {
		for (const row of effectiveTopology) {
			const slotId = String(row?.physicalPortId || '').trim()
			if (!/^gpu_p\d+$/i.test(slotId)) continue
			for (const p of [row.dpA, row.dpB].filter(Boolean)) {
				if (want.has(normRandrCaspar(p))) return slotId
			}
		}
	}
	return ''
}

/**
 * Map a UI slot's RandR pair to the canonical graph connector id (e.g. gpu_p0).
 * Server effectiveTopology is authoritative for pair → socket mapping.
 */
export function resolveCanonicalGpuConnectorId(pairs, physicalPorts, suggestedGpuOuts, effectiveTopology = null) {
	if (!Array.isArray(pairs) || !pairs.length) return ''
	const fromLayout = layoutSlotIdForPairs(pairs, effectiveTopology)
	if (fromLayout) return fromLayout
	const set = new Set(pairs.map((p) => normRandrCaspar(p)).filter(Boolean))
	if (set.size === 0) return ''
	for (const p of physicalPorts || []) {
		const act = normRandrCaspar(p?.runtime?.activePort)
		if (act && set.has(act)) return String(p.physicalPortId || '').trim()
	}
	for (const p of physicalPorts || []) {
		const a = normRandrCaspar(p?.pair?.dpA)
		const b = normRandrCaspar(p?.pair?.dpB)
		if ((a && set.has(a)) || (b && set.has(b))) return String(p.physicalPortId || '').trim()
	}
	for (const c of suggestedGpuOuts || []) {
		const ref = normRandrCaspar(c?.externalRef)
		if (ref && set.has(ref)) return String(c.id || '').trim()
		const a = normRandrCaspar(c?.gpuPhysical?.pair?.dpA)
		const b = normRandrCaspar(c?.gpuPhysical?.pair?.dpB)
		if ((a && set.has(a)) || (b && set.has(b))) return String(c.id || '').trim()
	}
	return ''
}

export function casparRearKindTitle(kind) {
	if (kind === 'gpu_out') return 'GPU / program bus output'
	if (kind === 'decklink_out') return 'DeckLink program output'
	if (kind === 'caspar_mv_out') return 'Multiview channel output'
	if (kind === 'audio_out') return 'Audio output'
	if (kind === 'audio_in') return 'Audio input'
	if (kind === 'v4l2_in') return 'USB video input (V4L2)'
	if (kind === 'v4l2_out') return 'Virtual camera (v4l2loopback)'
	return kind || 'connector'
}

export function casparRearKindToIcon(kind) {
	if (kind === 'gpu_out') return '/assets/hdmi-port-icon.svg'
	if (kind?.startsWith('decklink') || kind === 'caspar_mv_out') return '/assets/bnc_female_axis.svg'
	if (kind === 'audio_out') return '/assets/jack-svg.svg'
	if (kind === 'v4l2_in') return '/assets/hdmi-port-icon.svg'
	if (kind === 'v4l2_out') return '/assets/hdmi-port-icon.svg'
	if (kind === 'stream_out') return '/assets/ethernet-port-icon.svg'
	if (kind === 'record_out') return '/assets/record-port-icon.svg'
	return '/assets/bnc_female_axis.svg'
}

export function createCasparRearMarkerStatusResolver({ live, lastPayload }) {
	return (it) => {
		if (!it.connectorId) return stateClass('off')
		if (it.kind === 'gpu_out') {
			if (it.connected) return stateClass('ok')
			if (it.livePresent) return stateClass('warn')
			return stateClass('off')
		}
		const conn = connectorById(lastPayload, it.connectorId)
		if (!conn) return ''
		const isDecklinkOutput =
			it.kind === 'decklink_out' ||
			(it.kind === 'decklink_io' && isDecklinkIoOut(conn))
		if (isDecklinkOutput) {
			const outputs = Array.isArray(live?.decklink?.outputs) ? live.decklink.outputs : []
			const st = outputs.find((o) => String(o?.connectorId || '') === String(it.connectorId || ''))
			if (st && !st.ok) return stateClass('warn')
			if (st?.ok) return stateClass('ok')
			if (isDecklinkIoOut(conn)) {
				return stateClass('warn')
			}
		}
		if (it.kind === 'decklink_io' && isDecklinkIoIn(conn)) {
			const st = live.decklink?.inputs?.find((x) => String(x.device) === String(conn.externalRef))
			if (st) return stateClass(decklinkInputState(st).level)
		}
		if (it.kind === 'stream_out') {
			const active = !!(live.streaming?.activeOutputs?.some((id) => String(id) === String(it.connectorId)))
			return stateClass(active ? 'ok' : 'off')
		}
		if (it.kind === 'v4l2_out') {
			const active = !!(live?.virtualCamera?.running || live?.virtualCameraStatus?.running)
			return stateClass(active ? 'ok' : 'off')
		}
		if (it.kind === 'record_out') {
			const active = !!(live.recording?.activeOutputs?.some((id) => String(id) === String(it.connectorId)))
			return stateClass(active ? 'ok' : 'off')
		}
		if (it.kind === 'audio_out') {
			return stateClass('ok')
		}
		return stateClass('ok')
	}
}

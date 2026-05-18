import { decklinkInputState, stateClass, connectorById } from './device-view-helpers.js'

/** RandR names may be DP-0 or card0-DP-0 depending on source. */
export function normRandrCaspar(v) {
	return String(v || '').trim().toUpperCase().replace(/^CARD\d+-/i, '')
}

/**
 * Map a UI slot's RandR pair to the canonical graph connector id (e.g. gpu_p0).
 * Prefer runtime.activePort when it matches the slot pair so cabling uses the same id as suggested.connectors.
 */
export function resolveCanonicalGpuConnectorId(pairs, physicalPorts, suggestedGpuOuts) {
	if (!Array.isArray(pairs) || !pairs.length) return ''
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
	if (kind === 'decklink_in') return 'DeckLink input (capture)'
	if (kind === 'decklink_out') return 'DeckLink program output'
	if (kind === 'caspar_mv_out') return 'Multiview channel output'
	if (kind === 'audio_out') return 'Audio output'
	if (kind === 'audio_in') return 'Audio input'
	return kind || 'connector'
}

export function casparRearKindToIcon(kind) {
	if (kind === 'gpu_out') return '/assets/hdmi-port-icon.svg'
	if (kind?.startsWith('decklink') || kind === 'caspar_mv_out') return '/assets/bnc_female_axis.svg'
	if (kind === 'audio_out') return '/assets/jack-svg.svg'
	if (kind === 'stream_out' || kind === 'record_out') return '/assets/ethernet-port-icon.svg'
	return '/assets/bnc_female_axis.svg'
}

export function createCasparRearMarkerStatusResolver({ live, lastPayload }) {
	return (it) => {
		if (!it.connectorId) return stateClass('off')
		if (it.kind === 'gpu_out') {
			return stateClass(it.connected ? 'ok' : 'off')
		}
		const conn = connectorById(lastPayload, it.connectorId)
		if (!conn) return ''
		if (it.kind === 'decklink_in' || it.kind === 'decklink_io') {
			const st = live.decklink?.inputs?.find((x) => String(x.device) === String(conn.externalRef))
			if (st) return stateClass(decklinkInputState(st).level)
		}
		if (it.kind === 'stream_out') {
			const active = !!(live.streaming?.activeOutputs?.some((id) => String(id) === String(it.connectorId)))
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

export const CASPAR_HOST = 'caspar_host'

/**
 * @param {any} payload
 * @param {string} id
 * @returns {any}
 */
export function connectorById(payload, id) {
	const graphList = payload?.graph?.connectors || []
	const sugList = payload?.suggested?.connectors || []
	const direct = graphList.find((c) => c && c.id === id) || sugList.find((c) => c && c.id === id) || null
	if (direct) return direct
	const sid = String(id || '').trim()
	if (!sid.startsWith('dst_in_')) return null
	const externalRef = sid.slice('dst_in_'.length).trim()
	if (!externalRef) return null
	const destinations = Array.isArray(payload?.tandemTopology?.destinations) ? payload.tandemTopology.destinations : []
	const d = destinations.find((x) => String(x?.id || '').trim() === externalRef) || null
	// Fallback synthetic destination connector keeps cable UX stable if connector lists are stale.
	return {
		id: sid,
		deviceId: 'destinations',
		kind: 'destination_in',
		externalRef,
		label: String(d?.label || externalRef),
	}
}

/**
 * @param {any} c
 * @returns {'caspar_out'|'caspar_in'|'destination_out'|'pixel_mapping_in'|'pixel_mapping_out'|'other'}
 */
export function connectorRole(c) {
	if (!c) return 'other'
	if (c.deviceId === CASPAR_HOST && (c.kind === 'gpu_out' || c.kind === 'decklink_out' || c.kind === 'caspar_mv_out' || c.kind === 'stream_out' || c.kind === 'record_out' || c.kind === 'audio_out')) return 'caspar_out'
	if (c.deviceId === CASPAR_HOST && c.kind === 'decklink_io') {
		return String(c.caspar?.ioDirection || 'in').toLowerCase() === 'out' ? 'caspar_out' : 'caspar_in'
	}
	if (c.deviceId === 'destinations' && c.kind === 'destination_in') return 'destination_out'
	if (c.kind === 'pixel_map_in') return 'pixel_mapping_in'
	if (c.kind === 'pixel_map_out') return 'pixel_mapping_out'
	return 'other'
}

/**
 * Order two endpoints for an edge.
 * Rules:
 * 1. destination_out -> caspar_out (Direct)
 * 2. destination_out -> pixel_mapping_in
 * 3. pixel_mapping_out -> caspar_out
 * @param {string} cableSourceId
 * @param {string} clickedId
 * @param {(id: string) => any} getConn
 * @returns {{ sourceId: string, sinkId: string } | null}
 */
export function orderEdgeForDeviceView(cableSourceId, clickedId, getConn) {
	const a = getConn(cableSourceId)
	const b = getConn(clickedId)
	if (!a || !b) return null
	const ra = connectorRole(a)
	const rb = connectorRole(b)

	// Helper to check source/sink pairs
	const check = (srcRole, sinkRole) => {
		if (ra === srcRole && rb === sinkRole) return { sourceId: cableSourceId, sinkId: clickedId }
		if (rb === srcRole && ra === sinkRole) return { sourceId: clickedId, sinkId: cableSourceId }
		return null
	}

	// 1. destination_out -> caspar_out
	const direct = check('destination_out', 'caspar_out')
	if (direct) return direct

	// 2. destination_out -> pixel_mapping_in
	const toMapping = check('destination_out', 'pixel_mapping_in')
	if (toMapping) return toMapping

	// 3. pixel_mapping_out -> caspar_out
	const fromMapping = check('pixel_mapping_out', 'caspar_out')
	if (fromMapping) return fromMapping

	return null
}

/**
 * @param {'ok'|'warn'|'err'|'off'|'unknown'} level
 * @returns {string}
 */
export function stateClass(level) {
	if (level === 'ok') return ' device-view__port--ok'
	if (level === 'warn') return ' device-view__port--warn'
	if (level === 'err') return ' device-view__port--err'
	if (level === 'off') return ' device-view__port--off'
	return ''
}

/**
 * @param {any} input
 * @returns {{ level: 'ok'|'warn'|'err'|'off'|'unknown', text: string }}
 */
export function decklinkInputState(input) {
	const s = String(input?.state || '').trim()
	if (s === 'ready') return { level: 'ok', text: 'ready' }
	if (s === 'disabled') return { level: 'off', text: 'disabled' }
	if (s === 'unassigned') return { level: 'off', text: 'device 0' }
	if (s === 'conflict_output_device' || s === 'duplicate_device') return { level: 'warn', text: s }
	if (s === 'failed') return { level: 'err', text: 'failed' }
	return { level: 'unknown', text: s || 'unknown' }
}


/**
 * Resolves a logical connector ID based on type and metadata.
 */
export function resolveConnectorId(lastPayload, type, data) {
	const sc = lastPayload?.suggested?.connectors || []
	if (type === 'gpu') {
		const gpus = sc.filter(c => c.kind === 'gpu_out')
		const displayName = String(data?.display?.name || '').trim().toUpperCase()
		const physicalPorts = Array.isArray(lastPayload?.live?.gpu?.physicalMap?.ports) ? lastPayload.live.gpu.physicalMap.ports : []
		if (displayName) {
			const byPhysicalActive = physicalPorts.find((p) => String(p?.runtime?.activePort || '').trim().toUpperCase() === displayName)
			if (byPhysicalActive?.physicalPortId) {
				const byPid = gpus.find((c) => String(c?.id || '') === String(byPhysicalActive.physicalPortId))
				if (byPid?.id) return byPid.id
			}
			const byRef = gpus.find((c) => String(c?.externalRef || '').trim().toUpperCase() === displayName)
			if (byRef?.id) return byRef.id
			const byLabel = gpus.find((c) => String(c?.label || '').trim().toUpperCase() === displayName)
			if (byLabel?.id) return byLabel.id
			const canonical = `gpu_${displayName.replace(/^CARD\d+-/i, '')}`
			const byId = gpus.find((c) => String(c?.id || '').trim().toUpperCase() === canonical.toUpperCase())
			if (byId?.id) return byId.id
		}
		if (Number.isFinite(Number(data?.index))) {
			const bySlot = gpus.find((c) => Number(c?.gpuPhysical?.slotOrder) === Number(data.index))
			if (bySlot?.id) return bySlot.id
		}
		return gpus[data.index]?.id || ''
	}
	if (type === 'decklink_in') {
		const slot = parseInt(String(data?.input?.slot ?? 0), 10) || 0
		const io = sc.find(c => c.kind === 'decklink_io' && Number(c?.index) === Math.max(0, slot - 1))
		if (io?.id) return io.id
		return sc.find(c => c.id === 'dli_' + slot)?.id || ''
	}
	if (type === 'decklink_out') return sc.find(c => c.id === 'dlo_s' + data.output.screen)?.id || ''
	if (type === 'decklink_mv') return sc.find(c => c.id === 'dlo_mv')?.id || ''
	return ''
}

/**
 * Checks if a connector is either in the graph or suggested.
 */
export function isConnectorVisible(lastPayload, id) {
	if (!id) return false
	const graphArr = lastPayload?.graph?.connectors || []
	const suggestedArr = lastPayload?.suggested?.connectors || []
	if (!graphArr.length) return suggestedArr.length ? suggestedArr.some(c => c.id === id) : true
	return graphArr.some(c => c.id === id) || suggestedArr.some(c => c.id === id)
}

/**
 * Finds the input connector ID for a given screen destination.
 */
export function resolveDestinationSinkConnectorId(lastPayload, d) {
	const graphConn = Array.isArray(lastPayload?.graph?.connectors) ? lastPayload.graph.connectors : []
	const suggestedConn = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
	const allConn = [...graphConn, ...suggestedConn]
	const byDestination = allConn.find(c => c.kind === 'destination_in' && String(c.externalRef || '') === String(d?.id || ''))
	if (byDestination?.id) return byDestination.id
	const byIdConvention = allConn.find((c) => String(c?.id || '') === `dst_in_${String(d?.id || '')}`)
	if (byIdConvention?.id) return byIdConvention.id
	const did = String(d?.id || '').trim()
	return did ? `dst_in_${did}` : ''
}

/**
 * Returns a human-friendly label for a connector ID.
 */
export function friendlyConnectorLabel(lastPayload, connectorId) {
	const id = String(connectorId || '').trim()
	if (!id) return 'unknown'
	const conn = connectorById(lastPayload, id)
	if (conn?.kind === 'destination_in') {
		const did = String(conn?.externalRef || '').trim()
		const intents = Array.isArray(lastPayload?.live?.caspar?.destinationIntent?.items) ? lastPayload.live.caspar.destinationIntent.items : []
		const intent = intents.find((x) => String(x?.id || '').trim() === did) || null
		if (intent?.mode === 'multiview') {
			const n = Number.isFinite(Number(intent?.mainScreenIndex)) ? Number(intent.mainScreenIndex) + 1 : 1
			return `dst_mv${n}`
		}
		const n = Number.isFinite(Number(intent?.mainScreenIndex)) ? Number(intent.mainScreenIndex) + 1 : null
		if (n && n > 0) return `dst_ch${n}`
		if (did === 'multiview') return 'dst_mv1'
		const clean = did.replace(/^dst_/, '')
		return clean ? `dst_out_${clean}` : 'dst_out'
	}
	if (conn?.kind === 'stream_out') {
		const n = id.match(/(\d+)/)?.[1]
		return n ? `str${n}` : (conn?.label || id)
	}
	if (conn?.kind === 'record_out') {
		const n = id.match(/(\d+)/)?.[1]
		return n ? `rec${n}` : (conn?.label || id)
	}
	if (conn?.kind === 'gpu_out') {
		const pid = String(conn?.id || '')
		if (/^gpu_p\d+$/i.test(pid)) {
			const pair = String(conn?.gpuPhysical?.pair?.name || '').trim()
			return pair ? `${pid} (${pair})` : pid
		}
		const name = String(conn?.label || conn?.externalRef || '')
		return name ? `gpu_${name}` : id
	}
	if (conn?.kind === 'decklink_io' || conn?.kind === 'decklink_out' || conn?.kind === 'decklink_in') {
		const ext = parseInt(String(conn?.externalRef ?? ''), 10)
		if (Number.isFinite(ext) && ext > 0) return `decklink_${ext}`
		const slotFromId = id.match(/(?:^|_)(\d+)$/)?.[1]
		if (slotFromId) return `decklink_${slotFromId}`
		const idx = parseInt(String(conn?.index ?? ''), 10)
		if (Number.isFinite(idx) && idx >= 0) return `decklink_${idx + 1}`
		return 'decklink'
	}
	return String(conn?.label || id)
}

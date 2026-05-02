'use strict'

const { normalizeDeviceGraph, validateDeviceGraph } = require('./device-graph-core')
const { DEFAULT_DEVICE_ID, PH_DEVICE_ID, DEST_DEVICE_ID, slug } = require('./device-graph-constants')

function isCasparOutputConnector(c) {
	const ioOut = c && c.deviceId === DEFAULT_DEVICE_ID && c.kind === 'decklink_io' && String(c.caspar?.ioDirection || '').toLowerCase() === 'out'
	return !!(c && c.deviceId === DEFAULT_DEVICE_ID && (c.kind === 'gpu_out' || c.kind === 'decklink_out' || c.kind === 'caspar_mv_out' || c.kind === 'stream_out' || c.kind === 'record_out' || c.kind === 'audio_out' || ioOut))
}
function isPhInputConnector(c) { return !!(c && c.deviceId === PH_DEVICE_ID && c.kind === 'ph_in') }
function isPhOutputConnector(c) { return !!(c && c.deviceId === PH_DEVICE_ID && c.kind === 'ph_out') }
function isDestinationInputConnector(c) { return !!(c && c.deviceId === DEST_DEVICE_ID && c.kind === 'destination_in') }
function isDecklinkIoInputConnector(c) { return !!(c && c.deviceId === DEFAULT_DEVICE_ID && c.kind === 'decklink_io' && String(c.caspar?.ioDirection || 'in').toLowerCase() !== 'out') }

function edgeConnectAllowed(graph, sourceId, sinkId) {
	const g = graph && typeof graph === 'object' ? graph : null
	if (!g || !sourceId || !sinkId) return { ok: false, reason: 'missing_ids' }
	if (sourceId === sinkId) return { ok: false, reason: 'self_loop' }
	const by = new Map((g.connectors || []).map((c) => [c.id, c]))
	const a = by.get(sourceId)
	const b = by.get(sinkId)
	if (!a) return { ok: false, reason: 'unknown_source' }
	if (!b) return { ok: false, reason: 'unknown_sink' }
	if (isDestinationInputConnector(a) && isCasparOutputConnector(b)) return { ok: true }
	if (isCasparOutputConnector(a) && isDestinationInputConnector(b)) return { ok: true }
	return { ok: false, reason: 'allowed: destination_to_output' }
}

function ensureConnectorsFromSuggested(baseGraph, connectorIds, suggested) {
	const g = normalizeDeviceGraph(baseGraph)
	const ids = Array.isArray(connectorIds) ? connectorIds.map((x) => String(x).trim()).filter(Boolean) : []
	const sug = suggested && typeof suggested === 'object' ? suggested : { devices: [], connectors: [] }
	const devMap = new Map(g.devices.map((d) => [d.id, d]))
	for (const d of sug.devices || []) if (d && d.id && !devMap.has(d.id)) devMap.set(d.id, d)
	const bySug = new Map((sug.connectors || []).map((c) => (c && c.id ? [c.id, c] : null)).filter(Boolean))
	const connMap = new Map(g.connectors.map((c) => [c.id, c]))
	for (const id of ids) {
		if (connMap.has(id)) continue
		const fromSuggested = bySug.get(id)
		if (fromSuggested) {
			connMap.set(id, fromSuggested)
			continue
		}
		// Keep cable UX robust when destination connector lists are stale.
		// Device View uses `dst_in_<destinationId>` as a stable destination feed id.
		if (id.startsWith('dst_in_')) {
			const externalRef = id.slice('dst_in_'.length).trim()
			if (!externalRef) continue
			if (!devMap.has(DEST_DEVICE_ID)) {
				devMap.set(DEST_DEVICE_ID, { id: DEST_DEVICE_ID, role: 'destinations', label: 'Destinations' })
			}
			connMap.set(id, {
				id,
				deviceId: DEST_DEVICE_ID,
				kind: 'destination_in',
				externalRef,
				label: externalRef,
			})
		}
	}
	g.devices = [...devMap.values()]
	g.connectors = [...connMap.values()]
	return normalizeDeviceGraph(g)
}

function addEdgeToGraph(baseGraph, sourceId, sinkId) {
	const s = String(sourceId || '').trim()
	const t = String(sinkId || '').trim()
	let g = normalizeDeviceGraph(baseGraph)
	const a = edgeConnectAllowed(g, s, t)
	if (!a.ok) return { ok: false, reason: a.reason, graph: g }
	const by = new Map((g.connectors || []).map((c) => [String(c?.id || ''), c]))
	const sinkConn = by.get(t)
	// Physical/consumer outputs are single-input endpoints: one destination feed max.
	if (isCasparOutputConnector(sinkConn) && (g.edges || []).some((e) => String(e?.sinkId || '') === t)) {
		return { ok: false, reason: 'sink_already_connected', graph: g }
	}
	if ((g.edges || []).some((e) => e && e.sourceId === s && e.sinkId === t)) return { ok: false, reason: 'duplicate', graph: g }
	let eid = `e_${slug(s)}_${slug(t)}`
	if (eid.length > 96) eid = eid.slice(0, 96)
	const edges = [...(g.edges || []), { id: eid, sourceId: s, sinkId: t }]
	g = normalizeDeviceGraph({ ...g, edges })
	const v = validateDeviceGraph(g)
	if (!v.ok) return { ok: false, reason: v.errors.join('; '), graph: normalizeDeviceGraph(baseGraph) }
	return { ok: true, graph: g }
}

function removeEdgeById(baseGraph, edgeId) {
	const eid = String(edgeId || '').trim()
	const g = normalizeDeviceGraph(baseGraph)
	g.edges = (g.edges || []).filter((e) => e && e.id !== eid)
	return normalizeDeviceGraph(g)
}

module.exports = {
	isCasparOutputConnector,
	isPhInputConnector,
	isPhOutputConnector,
	isDestinationInputConnector,
	isDecklinkIoInputConnector,
	edgeConnectAllowed,
	ensureConnectorsFromSuggested,
	addEdgeToGraph,
	removeEdgeById,
}

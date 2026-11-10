'use strict'

const { normalizeDeviceGraph, validateDeviceGraph } = require('./device-graph-core')
const { DEFAULT_DEVICE_ID, DEST_DEVICE_ID, slug } = require('./device-graph-constants')
const { isDecklinkIoOutputSink, isDecklinkIoIn } = require('./decklink-io-direction')

function isCasparOutputConnector(c) {
	const ioOut = c && c.deviceId === DEFAULT_DEVICE_ID && c.kind === 'decklink_io' && isDecklinkIoOutputSink(c)
	return !!(c && c.deviceId === DEFAULT_DEVICE_ID && (c.kind === 'gpu_out' || c.kind === 'decklink_out' || c.kind === 'caspar_mv_out' || c.kind === 'stream_out' || c.kind === 'record_out' || c.kind === 'audio_out' || c.kind === 'v4l2_out' || ioOut))
}
function isDestinationInputConnector(c) { return !!(c && c.deviceId === DEST_DEVICE_ID && c.kind === 'destination_in') }
function isDecklinkIoInputConnector(c) { return !!(c && c.deviceId === DEFAULT_DEVICE_ID && c.kind === 'decklink_io' && isDecklinkIoIn(c)) }
function isPixelMapInputConnector(c) { return !!(c && c.kind === 'pixel_map_in') }
function isPixelMapOutputConnector(c) { return !!(c && c.kind === 'pixel_map_out') }

function edgeConnectAllowed(graph, sourceId, sinkId) {
	const g = graph && typeof graph === 'object' ? graph : null
	if (!g || !sourceId || !sinkId) return { ok: false, reason: 'missing_ids' }
	if (sourceId === sinkId) return { ok: false, reason: 'self_loop' }
	const by = new Map((g.connectors || []).map((c) => [c.id, c]))
	const a = by.get(sourceId)
	const b = by.get(sinkId)
	if (!a) return { ok: false, reason: 'unknown_source' }
	if (!b) return { ok: false, reason: 'unknown_sink' }
	// Supported cable patterns in Device View:
	// 1) destination_out <-> caspar_out
	// 2) destination_out <-> pixel_mapping_in
	// 3) pixel_mapping_out <-> caspar_out
	if (isDestinationInputConnector(a) && isCasparOutputConnector(b)) return { ok: true }
	if (isCasparOutputConnector(a) && isDestinationInputConnector(b)) return { ok: true }
	if (isDestinationInputConnector(a) && isPixelMapInputConnector(b)) return { ok: true }
	if (isPixelMapInputConnector(a) && isDestinationInputConnector(b)) return { ok: true }
	if (isPixelMapOutputConnector(a) && isCasparOutputConnector(b)) return { ok: true }
	if (isCasparOutputConnector(a) && isPixelMapOutputConnector(b)) return { ok: true }
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

/** Connector ids for a screen destination feed (`dst_in_<id>` and matching externalRef). */
function destinationInputConnectorIds(graph, destinationId) {
	const did = String(destinationId || '').trim()
	const ids = new Set()
	if (!did) return ids
	ids.add(`dst_in_${did}`)
	for (const c of graph?.connectors || []) {
		if (c?.kind === 'destination_in' && String(c?.externalRef || '').trim() === did) {
			ids.add(String(c.id))
		}
	}
	return ids
}

/**
 * Drop cables and destination_in connectors when a screen destination is removed.
 * @param {object} baseGraph
 * @param {string} destinationId
 */
function pruneDestinationFromGraph(baseGraph, destinationId) {
	const g = normalizeDeviceGraph(baseGraph)
	const dropIds = destinationInputConnectorIds(g, destinationId)
	if (!dropIds.size) return g
	g.edges = (g.edges || []).filter((e) => {
		const s = String(e?.sourceId || '')
		const t = String(e?.sinkId || '')
		return !dropIds.has(s) && !dropIds.has(t)
	})
	g.connectors = (g.connectors || []).filter((c) => !dropIds.has(String(c?.id || '')))
	return normalizeDeviceGraph(g)
}

/** A generated screen-destination id (`dst_<stamp>_<n>`, `dst_operator_gui`) — never a host channel (`host_…`). */
const DEST_ID_RE = /^dst_(?:[a-z0-9]+_\d+|operator_gui)$/

/**
 * WO-1029: cables left behind by a destination that no longer exists on this server (a destination removed on a
 * linked server is pruned only there, so its cable stayed here, invisible — no card — and kept its sink "occupied":
 * the operator could not cable anything else into that mapping input).
 * @param {object} graph
 * @param {string[]} destinationIds ids in this server's screen destinations
 * @returns {object[]} the orphan edges
 */
function orphanDestinationEdges(graph, destinationIds) {
	const known = new Set((destinationIds || []).map(String))
	return (graph?.edges || []).filter((e) => {
		const src = String(e?.sourceId || '')
		if (!src.startsWith('dst_in_')) return false
		const ref = src.slice('dst_in_'.length)
		return DEST_ID_RE.test(ref) && !known.has(ref)
	})
}

/** The graph without its orphan destination cables (and their connectors), plus what was taken out. */
function withoutOrphanDestinationEdges(graph, destinationIds, onlySinkId) {
	const orphans = orphanDestinationEdges(graph, destinationIds).filter((e) => !onlySinkId || String(e.sinkId) === String(onlySinkId))
	if (!orphans.length) return { graph, orphans }
	const gone = new Set(orphans.map((e) => e.id))
	const edges = (graph.edges || []).filter((e) => !gone.has(e.id))
	const stillUsed = new Set(edges.flatMap((e) => [String(e.sourceId), String(e.sinkId)]))
	const dead = new Set(orphans.map((e) => String(e.sourceId)).filter((id) => !stillUsed.has(id)))
	return { graph: { ...graph, edges, connectors: (graph.connectors || []).filter((c) => !dead.has(String(c?.id))) }, orphans }
}

module.exports = {
	orphanDestinationEdges,
	withoutOrphanDestinationEdges,
	isCasparOutputConnector,
	isDestinationInputConnector,
	isDecklinkIoInputConnector,
	edgeConnectAllowed,
	ensureConnectorsFromSuggested,
	addEdgeToGraph,
	removeEdgeById,
	pruneDestinationFromGraph,
	destinationInputConnectorIds,
}

/**
 * device-view-matrix-ports.js — WO-365: the matrix grid's row/column extraction, lifted out of
 * device-view-matrix.js so it is testable without importing the whole Device View component
 * tree (the render module pulls modals and the settings store, which fetch on import).
 *
 * Pure: payload in, {sources, sinks} out.
 */
import { connectorById } from '../components/device-view-helpers.js'
import { listAllScreenDestinationsForDeviceView, listHostChannelDestinations } from './device-view-host-channels.js'

/**
 * Caspar output connectors take exactly ONE destination feed. Mirror of `isCasparOutputConnector`
 * in src/config/device-graph-edges.js, whose `addEdgeToGraph` rejects a second edge to such a sink
 * with `sink_already_connected` — a rule the matrix used to skip entirely, because it writes the
 * whole graph through settings instead of going through addEdge (WO-373).
 * @param {object} payload @param {string} sinkId
 */
export function isSingleInputSinkId(payload, sinkId) {
	const kind = String(connectorById(payload, String(sinkId || ''))?.kind || '')
	return ['gpu_out', 'decklink_out', 'decklink_io', 'caspar_mv_out', 'stream_out', 'record_out', 'audio_out', 'v4l2_out'].includes(
		kind,
	)
}

export function extractMatrixPorts(payload) {
	const sources = []
	const sinks = []

	const addedIds = new Set()
	/* WO-365: every BARE graph id already represented by a row, half-split or not. WO-364 moved
	 * the dedupe key to `id#half` for pair destinations, which left the bare id absent from
	 * `addedIds` — so section 4's fallback re-added every cabled pgm_prv destination a THIRD
	 * time under "Other Sources" (owner: "the prv is listed twice"). That ghost row had no half,
	 * so cabling from it wrote an edge with no outputLayer note: a silent second PGM. */
	const consumedIds = new Set()
	const addPort = (id, label, isSource, group, half) => {
		/* WO-364: a pgm_prv destination contributes TWO rows sharing one graph id — dedupe on
		 * id+half so the PRV row survives the id check. */
		const dedupeKey = half ? `${id}#${half}` : id
		if (!id || addedIds.has(dedupeKey)) return
		addedIds.add(dedupeKey)
		consumedIds.add(id)
		const port = { id, label, group, half: half || null }
		if (isSource) sources.push(port)
		else sinks.push(port)
	}

	// 1. Screen destinations + pinned host channels (matrix sources / left column)
	const dests = listAllScreenDestinationsForDeviceView(payload)
	const seenDestIds = new Set()
	for (const d of dests) {
		const isHost = String(d?.mode || '') === 'host_channel' || d?.virtual === true
		const group = isHost ? 'Host channels' : 'Destinations'
		seenDestIds.add(String(d?.id || ''))
		if (String(d?.mode || 'pgm_prv') === 'pgm_prv' && !isHost) {
			/* WO-364: PRV is a real routable bus — split the pair into two matrix rows. */
			addPort(`dst_in_${d.id}`, `${d.label || d.id} — PGM`, true, group, 'pgm')
			addPort(`dst_in_${d.id}`, `${d.label || d.id} — PRV`, true, group, 'prv')
		} else {
			addPort(`dst_in_${d.id}`, d.label || d.id, true, group)
		}
	}
	for (const h of listHostChannelDestinations(payload)) {
		if (!h?.id || seenDestIds.has(String(h.id))) continue
		addPort(`dst_in_${h.id}`, h.label || h.id, true, 'Host channels')
	}

	// 2. Pixel Maps — split: in on top (sink), each out on left (source)
	const mapNodes = (payload?.graph?.devices || []).filter((d) => d.role === 'pixel_mapping')
	const connectors = payload?.graph?.connectors || []
	for (const node of mapNodes) {
		const label = node.label || node.id
		const inConn = connectors.find((c) => c.deviceId === node.id && c.kind === 'pixel_map_in')
		if (inConn) addPort(inConn.id, `${label} In`, false, 'Pixel Maps')
		const outConns = connectors
			.filter((c) => c.deviceId === node.id && c.kind === 'pixel_map_out')
			.sort((a, b) => (Number(a?.index) || 0) - (Number(b?.index) || 0))
		for (const out of outConns) {
			const n = (Number(out.index) || 0) + 1
			addPort(out.id, `${label} Out ${n}`, true, 'Pixel Maps')
		}
	}

	// 3. Decklink & GPU
	const sug = Array.isArray(payload?.suggested?.connectors) ? payload.suggested.connectors : []
	for (const c of sug) {
		if (!c || !c.id) continue
		const label = c.label || c.externalRef || c.id
		const isSink = c.kind === 'gpu_out' || c.kind === 'decklink_out' || c.kind === 'decklink_io' || c.kind === 'caspar_mv_out' || c.kind === 'stream_out' || c.kind === 'record_out' || c.kind === 'audio_out' || c.kind === 'v4l2_out'
		const isSrc = c.kind === 'audio_in' || c.kind === 'v4l2_in'
		
		let group = 'Outputs'
		if (c.kind.includes('decklink')) group = 'DeckLink'
		if (c.kind.includes('gpu')) group = 'GPU'
		if (c.kind === 'v4l2_in') group = 'USB video'
		if (c.kind.includes('stream') || c.kind.includes('record')) group = 'Streams/Records'
		
		if (isSink) addPort(c.id, label, false, group)
		if (isSrc) addPort(c.id, label, true, group)
	}

	// 4. Any remaining graph edges (synthetic/virtual ports)
	const edges = Array.isArray(payload?.graph?.edges) ? payload.graph.edges : []
	for (const e of edges) {
		// WO-365: test the BARE id — a half-split port is already on screen under `id#half`.
		if (e.sourceId && !consumedIds.has(e.sourceId)) {
			const c = connectorById(payload, e.sourceId)
			addPort(e.sourceId, c?.label || e.sourceId, true, 'Other Sources')
		}
		if (e.sinkId && !consumedIds.has(e.sinkId)) {
			const c = connectorById(payload, e.sinkId)
			addPort(e.sinkId, c?.label || e.sinkId, false, 'Other Outputs')
		}
	}

	return { sources, sinks }
}

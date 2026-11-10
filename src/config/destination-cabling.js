'use strict'

/**
 * WO-1029 plan 07 (C2) — the ONE "is this destination cabled on this server" predicate.
 *
 * A destination is cabled here when one of its sources (`dst_in_<id>`, any `destination_in` connector whose
 * externalRef is its id, legacy `dst_ch<mainIdx+1>` / `dst_mv<n>`) reaches a PHYSICAL SINK of this server's own
 * device graph by a directed path. The path may pass through mapping nodes (`pixel_map_in` → the same node's
 * `pixel_map_out` connectors → their cables): a mapping node with no cabled output does not count.
 *
 * Physical sinks (SINK_KINDS): GPU, DeckLink out (`decklink_io` in an output direction, legacy `decklink_out`),
 * stream, record, audio out, Caspar multiview out, the virtual camera (`v4l2_out`), NDI out (`ndi_out`, when it
 * exists) and the two virtual connectors of plan 07 — Art-Net sender (`artnet_out`, O11) and Local use
 * (`local_use`, O3). Not counted: multiview cells, previews, thumbnails, GUI windows (they are not cables).
 *
 * An edge whose sink connector is not described in the graph counts as a cable: the far end is unknown, and a
 * port that drops out of the connector list (an unplugged monitor) must not renumber the channels — and that is
 * what every caller did before this module (cluster-fanout cabledIds counted any edge with a sink).
 *
 * Orphan cables (a `dst_in_<id>` edge of a destination that is not in this server's list, device-graph-edges.js
 * orphanDestinationEdges) never count: only destinations in the list are asked about.
 *
 * Computed from local config only — a peer going offline never changes the answer (plan 2.1).
 */

const { isDecklinkIoOutputSink } = require('./decklink-io-direction')
const { readEdgeOutputLayer } = require('./device-graph-output-mapping')

const SINK_KINDS = new Set([
	'gpu_out',
	'decklink_out',
	'stream_out',
	'record_out',
	'audio_out',
	'caspar_mv_out',
	'v4l2_out',
	'ndi_out',
	'artnet_out',
	'local_use',
])

const MAIN_EXCLUDED = new Set(['multiview', 'stream', 'operator_gui'])

function isPhysicalSink(conn) {
	if (!conn) return false
	if (conn.kind === 'decklink_io') return isDecklinkIoOutputSink(conn)
	return SINK_KINDS.has(String(conn.kind || ''))
}

/** Graph + destination list from a config (`deviceGraph`, `screenDestinations`) or a device view (`graph`). */
function graphOf(src) {
	const g = src?.deviceGraph || src?.graph || {}
	return {
		connectors: Array.isArray(g.connectors) ? g.connectors : [],
		edges: Array.isArray(g.edges) ? g.edges : [],
	}
}

/** The destination list, or null when the config predates destinations (legacy: screen_count decides). */
function destinationListOf(src) {
	const list = src?.screenDestinations?.destinations
	return Array.isArray(list) ? list.filter((d) => d && typeof d.id === 'string' && d.id) : null
}

function createCablingContext(src) {
	const g = graphOf(src)
	const byId = new Map(g.connectors.map((c) => [String(c?.id || ''), c]))
	/** @type {Map<string, Array<{ sinkId: string, layer: number }>>} */
	const out = new Map()
	for (const e of g.edges) {
		const s = String(e?.sourceId || '')
		const t = String(e?.sinkId || '').trim()
		if (!s || !t) continue
		if (!out.has(s)) out.set(s, [])
		out.get(s).push({ sinkId: t, layer: readEdgeOutputLayer(e) })
	}
	const mapOutsByNode = new Map()
	for (const c of g.connectors) {
		if (c?.kind !== 'pixel_map_out') continue
		const node = String(c.deviceId || '')
		if (!mapOutsByNode.has(node)) mapOutsByNode.set(node, [])
		mapOutsByNode.get(node).push(String(c.id))
	}
	return { g, byId, out, mapOutsByNode, list: destinationListOf(src) }
}

function sourceIdsFor(dest, ctx) {
	const id = String(dest.id)
	const ids = new Set([`dst_in_${id}`])
	for (const c of ctx.g.connectors) {
		if (c?.kind === 'destination_in' && String(c.externalRef || '').trim() === id) ids.add(String(c.id))
	}
	const mode = String(dest.mode || 'pgm_prv')
	if (!MAIN_EXCLUDED.has(mode)) ids.add(`dst_ch${Math.max(0, parseInt(String(dest.mainScreenIndex ?? 0), 10) || 0) + 1}`)
	if (mode === 'multiview' && ctx.list) {
		const n = ctx.list.filter((d) => String(d.mode || '') === 'multiview').indexOf(dest) + 1
		if (n > 0) ids.add(`dst_mv${n}`)
	}
	return [...ids]
}

/** Physical sinks reached from one source id (through mapping nodes with cabled outputs). */
function sinksFrom(sourceId, ctx) {
	const found = []
	const seen = new Set()
	const queue = [sourceId]
	while (queue.length) {
		const cur = queue.shift()
		if (seen.has(cur)) continue
		seen.add(cur)
		for (const { sinkId } of ctx.out.get(cur) || []) {
			const conn = ctx.byId.get(sinkId)
			if (!conn) found.push({ id: sinkId, kind: null })
			else if (conn.kind === 'pixel_map_in') queue.push(...(ctx.mapOutsByNode.get(String(conn.deviceId || '')) || []))
			else if (isPhysicalSink(conn)) found.push({ id: sinkId, kind: String(conn.kind) })
		}
	}
	return found
}

/**
 * Per-bus detail of one destination's cabling on this server (plan 2.2).
 * `pgm` / `prv`: a cable from the destination's PGM half (`outputLayer` < 2) / PRV half (`outputLayer` ≥ 2,
 * device-graph-destination-wiring.js) reaches a physical sink. `sinks`: the sinks reached, `{ id, kind }`
 * (kind null = the edge's sink connector is not in the graph).
 * @returns {{ known: boolean, cabled: boolean, pgm: boolean, prv: boolean, sinks: Array<{ id: string, kind: string|null }> }}
 */
function destinationCabling(src, destId, ctx = createCablingContext(src)) {
	const id = String(destId || '')
	const none = { known: false, cabled: false, pgm: false, prv: false, sinks: [] }
	const list = ctx.list
	const dest = list ? list.find((d) => d.id === id) : null
	if (!dest) return none
	let pgm = false
	let prv = false
	const sinks = []
	for (const sid of sourceIdsFor(dest, ctx)) {
		for (const first of ctx.out.get(sid) || []) {
			const conn = ctx.byId.get(first.sinkId)
			let reached
			if (!conn) reached = [{ id: first.sinkId, kind: null }]
			else if (conn.kind === 'pixel_map_in') {
				const outs = ctx.mapOutsByNode.get(String(conn.deviceId || '')) || []
				reached = outs.flatMap((o) => sinksFrom(o, ctx))
			} else reached = isPhysicalSink(conn) ? [{ id: first.sinkId, kind: String(conn.kind) }] : []
			if (!reached.length) continue
			if (first.layer >= 2) prv = true
			else pgm = true
			for (const r of reached) if (!sinks.some((x) => x.id === r.id)) sinks.push(r)
		}
	}
	return { known: true, cabled: pgm || prv, pgm, prv, sinks }
}

/** Is destination `destId` cabled to a physical sink in this server's own device graph? (plan 2.1) */
function cabledHere(src, destId) {
	return destinationCabling(src, destId).cabled
}

/** Ids of every destination in this server's list that is cabled here (orphan cables never count). */
function cabledDestinationIds(src) {
	const ctx = createCablingContext(src)
	const out = new Set()
	for (const d of ctx.list || []) if (destinationCabling(src, d.id, ctx).cabled) out.add(d.id)
	return out
}

/**
 * Which screen indices this server outputs (plan 2.2): index i is local when a main-bus destination at i, or a
 * `stream`-mode destination naming i, is cabled here. Operator GUI / multiview / host channel are not screens.
 * `null` when the config has no destination list (legacy: the rule does not apply, every screen stays local).
 * @returns {null | { local: boolean[], hosts: Array<{ idx: number, destId: string|null, here: boolean, pgm: boolean, prv: boolean }> }}
 */
function localScreenPlan(src, screenCount) {
	const ctx = createCablingContext(src)
	if (!ctx.list) return null
	const n = Math.max(0, screenCount | 0)
	const local = Array.from({ length: n }, () => false)
	const hosts = Array.from({ length: n }, (_, idx) => ({ idx, destId: null, here: false, pgm: false, prv: false }))
	for (const d of ctx.list) {
		const mode = String(d.mode || 'pgm_prv')
		if (mode === 'multiview' || mode === 'operator_gui') continue
		const idx = Math.max(0, parseInt(String(d.mainScreenIndex ?? 0), 10) || 0)
		if (idx >= n) continue
		const c = destinationCabling(src, d.id, ctx)
		const h = hosts[idx]
		if (mode !== 'stream' && h.destId == null) h.destId = d.id
		// host_channel is a per-server input, never a remote screen (plan 2.2: unchanged)
		const here = mode === 'host_channel' || c.cabled
		if (here) {
			local[idx] = true
			h.here = true
			h.pgm = h.pgm || c.pgm || mode === 'host_channel'
			h.prv = h.prv || c.prv
		}
	}
	return { local, hosts }
}

module.exports = {
	SINK_KINDS,
	isPhysicalSink,
	createCablingContext,
	destinationCabling,
	cabledHere,
	cabledDestinationIds,
	localScreenPlan,
}

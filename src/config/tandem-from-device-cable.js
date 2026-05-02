'use strict'

const { normalizeTandemTopology, normalizeSignalPath } = require('./tandem-topology')
const { PH_DEVICE_ID, DEFAULT_DEVICE_ID } = require('./device-graph')

/**
 * Infer which Caspar “main” (0–3) a device-view source connector best represents.
 * @param {any} c
 * @returns {number}
 */
function inferMainIndexFromSourceConnector(c) {
	if (!c) return 0
	if (c.deviceId !== DEFAULT_DEVICE_ID) return 0
	if (c.kind === 'gpu_out') return 0
	if (c.id === 'dlo_mv') return 0
	if (c.id && /^dlo_s\d+$/.test(String(c.id))) {
		const s = parseInt(String(c.id).replace(/^dlo_s/, ''), 10)
		if (Number.isFinite(s)) return Math.max(0, s - 1)
	}
	if (c.caspar && c.caspar.mainIndex != null) {
		return Math.max(0, parseInt(String(c.caspar.mainIndex), 10) || 0)
	}
	return 0
}

/**
 * Stable id so add/remove and Settings round-trip can target the same row.
 * @param {any} sourceConn
 * @param {any} sinkConn
 * @returns {string | null}
 */
function buildTandemPathIdForCable(sourceConn, sinkConn) {
	if (!sourceConn || !sinkConn || sinkConn.deviceId !== PH_DEVICE_ID || sinkConn.kind !== 'ph_in') return null
	const ph = parseInt(String(sinkConn.externalRef), 10)
	if (!Number.isFinite(ph)) return null
	const m = inferMainIndexFromSourceConnector(sourceConn)
	return `dv_m${m}_ph${ph}`
}

/**
 * @param {any} topology
 * @param {any} graph — normalized device graph with connectors
 * @param {string} sourceId
 * @param {string} sinkId
 * @returns {object}
 */
function upsertTandemPathFromCableConnectors(topology, graph, sourceId, sinkId) {
	const t = normalizeTandemTopology(topology)
	const by = new Map((graph.connectors || []).map((c) => [c.id, c]))
	const src = by.get(sourceId)
	const snk = by.get(sinkId)
	if (!src || !snk) return t
	const pid = buildTandemPathIdForCable(src, snk)
	if (!pid) return t
	const ph = parseInt(String(snk.externalRef), 10)
	if (!Number.isFinite(ph)) return t
	const main = inferMainIndexFromSourceConnector(src)
	const bus = src.caspar && src.caspar.bus === 'prv' ? 'prv' : 'pgm'
	const path = normalizeSignalPath({
		id: pid,
		label: `Cable: ${String(src.label || src.id).slice(0, 40)} → PH ${ph}`,
		kind: 'caspar_in',
		phInterfaceId: ph,
		caspar: { bus, mainIndex: main },
		edidLabel: '',
		notes: 'Linked from Device view (Caspar out → PixelHue in).',
	})
	if (!path) return t
	const others = t.signalPaths.filter((p) => p && p.id !== pid)
	return normalizeTandemTopology({ ...t, signalPaths: [...others, path] })
}

/**
 * @param {any} topology
 * @param {any} graph
 * @param {string} sourceId
 * @param {string} sinkId
 * @returns {object}
 */
function removeTandemPathForCableConnectors(topology, graph, sourceId, sinkId) {
	const t = normalizeTandemTopology(topology)
	const by = new Map((graph.connectors || []).map((c) => [c.id, c]))
	const src = by.get(sourceId)
	const snk = by.get(sinkId)
	if (!src || !snk) return t
	const pid = buildTandemPathIdForCable(src, snk)
	if (!pid) return t
	return normalizeTandemTopology({
		...t,
		signalPaths: t.signalPaths.filter((p) => p && p.id !== pid),
	})
}

module.exports = {
	upsertTandemPathFromCableConnectors,
	removeTandemPathForCableConnectors,
	buildTandemPathIdForCable,
	inferMainIndexFromSourceConnector,
}

'use strict'

const defaults = require('./defaults')
const { normalizeTandemTopology } = require('./tandem-topology')
const { DEFAULT_DEVICE_ID } = require('./device-graph-constants')

function buildGpuLegacyToPhysicalMap() {
	const rows = Array.isArray(defaults?.gpuPhysicalTopology) ? defaults.gpuPhysicalTopology : []
	const out = new Map()
	for (const r of rows) {
		if (!r || typeof r !== 'object') continue
		const pid = String(r.physicalPortId || '').trim()
		if (!pid) continue
		const ports = [r.dpA, r.dpB]
		for (const p of ports) {
			const m = String(p || '').trim().toUpperCase().match(/^DP-(\d+)$/)
			if (!m) continue
			const n = parseInt(m[1], 10)
			if (!Number.isFinite(n)) continue
			out.set(`gpu_DP-${n}`.toUpperCase(), pid)
		}
	}
	return out
}

function normalizeDeviceGraph(raw) {
	const base = defaults.deviceGraph && typeof defaults.deviceGraph === 'object' ? defaults.deviceGraph : {}
	const x = raw && typeof raw === 'object' ? raw : {}
	const rawDevices = Array.isArray(x.devices) && x.devices.length
		? x.devices
		: Array.isArray(base.devices) && base.devices.length
			? base.devices
			: [{ id: DEFAULT_DEVICE_ID, role: 'caspar_host', label: 'Caspar / HighAsCG host' }]
	const outDev = rawDevices
		.map((d) => {
			if (!d || typeof d !== 'object') return null
			const id = String(d.id || '').trim()
			if (!id) return null
			return {
				id,
				role: String(d.role || 'caspar_host').trim() || 'caspar_host',
				label: String(d.label != null && d.label !== '' ? d.label : id).trim() || 'Device',
				...(d.hostRef != null && d.hostRef !== '' ? { hostRef: String(d.hostRef) } : {}),
				...(d.settings && typeof d.settings === 'object' ? { settings: d.settings } : {}),
			}
		})
		.filter(Boolean)
	if (!outDev.length) outDev.push({ id: DEFAULT_DEVICE_ID, role: 'caspar_host', label: 'Caspar / HighAsCG host' })
	const connectors = Array.isArray(x.connectors) ? x.connectors : Array.isArray(base.connectors) ? base.connectors : []
	const gpuLegacyMap = buildGpuLegacyToPhysicalMap()
	const conns = connectors
		.map((c) => {
			if (!c || typeof c !== 'object') return null
			const id = String(c.id || '').trim()
			if (!id) return null
			const deviceId = String(c.deviceId || outDev[0].id).trim() || outDev[0].id
			let nextId = id
			if (String(c.kind || '').trim() === 'gpu_out') {
				const mapped = gpuLegacyMap.get(id.toUpperCase())
				if (mapped) nextId = mapped
			}
			return {
				id: nextId,
				deviceId,
				kind: String(c.kind || 'unknown').trim() || 'unknown',
				index: c.index != null && c.index !== '' ? parseInt(String(c.index), 10) : undefined,
				label: String(c.label != null ? c.label : id).trim() || id,
				...(c.alias != null && c.alias !== '' ? { alias: String(c.alias) } : {}),
				...(c.caspar && typeof c.caspar === 'object' ? { caspar: c.caspar } : {}),
				...(c.externalRef != null && c.externalRef !== '' ? { externalRef: String(c.externalRef) } : {}),
				...(c.edidLabel != null && c.edidLabel !== '' ? { edidLabel: String(c.edidLabel) } : {}),
			}
		})
		.filter(Boolean)
	// Deduplicate by connector id after legacy GPU id normalization.
	.reduce((acc, c) => {
		if (!acc.some((x) => x.id === c.id)) acc.push(c)
		return acc
	}, [])
	const edges = Array.isArray(x.edges) ? x.edges : Array.isArray(base.edges) ? base.edges : []
	const eds = edges
		.map((e) => {
			if (!e || typeof e !== 'object') return null
			const id = String(e.id || '').trim()
			if (!id) return null
			let sourceId = String(e.sourceId || '').trim()
			let sinkId = String(e.sinkId || '').trim()
			const srcGpuMapped = gpuLegacyMap.get(sourceId.toUpperCase())
			const sinkGpuMapped = gpuLegacyMap.get(sinkId.toUpperCase())
			if (srcGpuMapped) sourceId = srcGpuMapped
			if (sinkGpuMapped) sinkId = sinkGpuMapped
			return {
				id,
				sourceId,
				sinkId,
				...(e.tandemPathId != null && e.tandemPathId !== '' ? { tandemPathId: String(e.tandemPathId) } : {}),
				...(e.note != null && e.note !== '' ? { note: String(e.note) } : {}),
				...(e.edid && typeof e.edid === 'object' ? { edid: e.edid } : {}),
			}
		})
		.filter((e) => e && e.sourceId && e.sinkId)
	const layoutBase = base.layout && typeof base.layout === 'object' && !Array.isArray(base.layout) ? base.layout : {}
	const layout = x.layout && typeof x.layout === 'object' && !Array.isArray(x.layout) ? { ...layoutBase, ...x.layout } : { ...layoutBase }
	const _meta = x._meta && typeof x._meta === 'object' ? { ...x._meta } : undefined
	return { version: 1, devices: outDev, connectors: conns, edges: eds, ...(Object.keys(layout).length ? { layout } : {}), ...(_meta && Object.keys(_meta).length ? { _meta } : {}) }
}

function validateDeviceGraph(graph) {
	const g = graph && typeof graph === 'object' ? graph : null
	const errors = []
	if (!g) return { ok: false, errors: ['graph is missing'] }
	if (g.version !== 1) errors.push('unsupported version')
	const dIds = new Set((g.devices || []).map((d) => d.id))
	for (const c of g.connectors || []) if (!dIds.has(c.deviceId)) errors.push(`connector ${c.id} references missing deviceId ${c.deviceId}`)
	const cIds = new Set((g.connectors || []).map((c) => c.id))
	for (const e of g.edges || []) {
		if (!cIds.has(e.sourceId)) errors.push(`edge ${e.id} missing source connector ${e.sourceId}`)
		if (!cIds.has(e.sinkId)) errors.push(`edge ${e.id} missing sink connector ${e.sinkId}`)
		if (e.sourceId === e.sinkId) errors.push(`edge ${e.id} is a self-loop`)
	}
	const pair = new Set()
	for (const e of g.edges || []) {
		const k = `${e.sourceId}→${e.sinkId}`
		if (pair.has(k)) errors.push(`duplicate edge ${e.sourceId} → ${e.sinkId}`)
		pair.add(k)
	}
	return { ok: errors.length === 0, errors }
}

function graphFromTandemTopology(rawTandem) {
	const tandem = normalizeTandemTopology(rawTandem)
	return normalizeDeviceGraph({
		version: 1,
		devices: [{ id: DEFAULT_DEVICE_ID, role: 'caspar_host', label: 'Caspar / HighAsCG host' }],
		connectors: [],
		edges: [],
		_meta: { tandemPathCount: tandem.signalPaths ? tandem.signalPaths.length : 0, migration: 'tandem_baseline' },
	})
}

module.exports = { normalizeDeviceGraph, validateDeviceGraph, graphFromTandemTopology }

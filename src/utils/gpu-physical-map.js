'use strict'

function normalizePortName(v) {
	const s = String(v || '').trim().toUpperCase().replace(/^CARD\d+-/i, '')
	if (!s) return ''
	const m = s.match(/^(DP|HDMI|DVI|VGA|E-?DP)-?(\d+)$/)
	if (m) return `${m[1].replace('E-DP', 'EDP')}-${parseInt(m[2], 10)}`
	return s
}

function canonicalPairName(a, b) {
	const aa = normalizePortName(a)
	const bb = normalizePortName(b)
	if (!aa && !bb) return ''
	if (!aa) return bb
	if (!bb) return aa
	return [aa, bb].sort().join('/')
}

function defaultTopology() {
	return [
		{ physicalPortId: 'gpu_p0', slotOrder: 0, dpA: 'DP-6', dpB: 'DP-7', connectorNumber: 0, location: 0 },
		{ physicalPortId: 'gpu_p1', slotOrder: 1, dpA: 'DP-4', dpB: 'DP-5', connectorNumber: 1, location: 1 },
		{ physicalPortId: 'gpu_p2', slotOrder: 2, dpA: 'DP-0', dpB: 'DP-1', connectorNumber: 2, location: 2 },
		{ physicalPortId: 'gpu_p3', slotOrder: 3, dpA: 'DP-2', dpB: 'DP-3', connectorNumber: 3, location: 3 },
	]
}

function readTopologyFromConfig(cfg) {
	const arr = Array.isArray(cfg?.gpuPhysicalTopology) ? cfg.gpuPhysicalTopology : null
	if (!arr || !arr.length) return defaultTopology()
	const out = []
	for (const row of arr) {
		if (!row || typeof row !== 'object') continue
		const id = String(row.physicalPortId || '').trim()
		if (!id) continue
		out.push({
			physicalPortId: id,
			slotOrder: Number.isFinite(Number(row.slotOrder)) ? Number(row.slotOrder) : out.length,
			dpA: normalizePortName(row.dpA),
			dpB: normalizePortName(row.dpB),
			connectorNumber: Number.isFinite(Number(row.connectorNumber)) ? Number(row.connectorNumber) : null,
			location: Number.isFinite(Number(row.location)) ? Number(row.location) : null,
		})
	}
	return out.length ? out.sort((a, b) => a.slotOrder - b.slotOrder) : defaultTopology()
}

function buildGpuPhysicalMap({ config, displays, connectors }) {
	const topology = readTopologyFromConfig(config)
	const displayByName = new Map(
		(Array.isArray(displays) ? displays : [])
			.map((d) => d && typeof d === 'object' ? d : null)
			.filter(Boolean)
			.map((d) => [normalizePortName(d.name), d])
	)
	const connectorByName = new Map(
		(Array.isArray(connectors) ? connectors : [])
			.map((c) => c && typeof c === 'object' ? c : null)
			.filter(Boolean)
			.map((c) => [normalizePortName(c.shortName || c.name), c])
	)

	const usedDisplays = new Set()
	const ports = topology.map((t) => {
		const a = normalizePortName(t.dpA)
		const b = normalizePortName(t.dpB)
		const aDisplay = a ? displayByName.get(a) || null : null
		const bDisplay = b ? displayByName.get(b) || null : null
		const aConn = a ? connectorByName.get(a) || null : null
		const bConn = b ? connectorByName.get(b) || null : null
		const activeRuntimePort = aDisplay ? a : (bDisplay ? b : null)
		const connected = !!(aDisplay || bDisplay)
		const activeDisplay = aDisplay || bDisplay || null

		if (aDisplay) usedDisplays.add(a)
		if (bDisplay) usedDisplays.add(b)

		return {
			physicalPortId: t.physicalPortId,
			slotOrder: t.slotOrder,
			connectorNumber: t.connectorNumber,
			location: t.location,
			pair: { dpA: a, dpB: b, name: canonicalPairName(a, b) },
			runtime: {
				activePort: activeRuntimePort,
				candidatePorts: [a, b].filter(Boolean),
				connected,
				displayName: activeDisplay?.name || '',
				resolution: activeDisplay?.resolution || '',
				refreshHz: Number.isFinite(activeDisplay?.refreshHz) ? activeDisplay.refreshHz : null,
				casparScreenIndex: activeDisplay?.casparScreenIndex || null,
				casparMode: activeDisplay?.casparMode || null
			},
			probe: {
				connectorA: aConn ? { name: aConn.name || '', shortName: aConn.shortName || '', connected: !!aConn.connected } : null,
				connectorB: bConn ? { name: bConn.name || '', shortName: bConn.shortName || '', connected: !!bConn.connected } : null,
			},
			confidence: connected ? 'high' : 'medium',
		}
	})

	// Append connected displays not in topology
	let nextUnmappedIdx = 0
	for (const [name, display] of displayByName) {
		if (usedDisplays.has(name)) continue
		const conn = connectorByName.get(name) || null
		ports.push({
			physicalPortId: `gpu_unmapped_${nextUnmappedIdx++}`,
			slotOrder: 100 + nextUnmappedIdx,
			connectorNumber: null,
			location: null,
			pair: { dpA: name, dpB: '', name },
			runtime: {
				activePort: name,
				candidatePorts: [name],
				connected: true,
				displayName: display.name || '',
				resolution: display.resolution || '',
				refreshHz: Number.isFinite(display.refreshHz) ? display.refreshHz : null,
				casparScreenIndex: display.casparScreenIndex || null,
				casparMode: display.casparMode || null
			},
			probe: {
				connectorA: conn ? { name: conn.name || '', shortName: conn.shortName || '', connected: !!conn.connected } : null,
				connectorB: null,
			},
			confidence: 'high',
			unmapped: true,
		})
	}

	return {
		topologySource: Array.isArray(config?.gpuPhysicalTopology) && config.gpuPhysicalTopology.length ? 'config' : 'default',
		ports,
	}
}

module.exports = {
	normalizePortName,
	buildGpuPhysicalMap,
}


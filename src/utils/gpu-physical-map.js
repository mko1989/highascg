'use strict'

const { getGpuModel } = require('./hardware-info')
const { resolveDefaultTopologyForGpu } = require('./known-gpu-topology')
const {
	normalizePortName,
} = require('./gpu-topology-xrandr')
const { discoverGpuPhysicalTopology, cardFromDrmName } = require('./gpu-topology-drm')
const {
	normalizeTopologyRows,
	reconcileTopologyWithLiveDisplays,
	topologyDiffers,
} = require('./gpu-topology-reconcile')
const { resolveDisplayByDrmHeuristic } = require('./gpu-display-alias')

function canonicalPairName(a, b) {
	const aa = normalizePortName(a)
	const bb = normalizePortName(b)
	if (!aa && !bb) return ''
	if (!aa) return bb
	if (!bb) return aa
	return [aa, bb].sort().join('/')
}

/**
 * @param {object} cfg
 * @param {string|null} gpuModel
 * @returns {{ rows: object[], source: string }}
 */
function resolvePhysicalTopology(cfg, gpuModel) {
	const arr = Array.isArray(cfg?.gpuPhysicalTopology) ? cfg.gpuPhysicalTopology : null
	if (arr?.length) {
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
				...(row.drmName ? { drmName: row.drmName } : {}),
				...(row.drmCard ? { drmCard: row.drmCard } : {}),
			})
		}
		if (out.length) {
			return { rows: out.sort((a, b) => a.slotOrder - b.slotOrder), source: 'config' }
		}
	}

	const probed = discoverGpuPhysicalTopology({ config: cfg })
	if (probed?.rows?.length) {
		return { rows: probed.rows, source: probed.source }
	}

	const knownRows = resolveDefaultTopologyForGpu(gpuModel)
	if (knownRows.length) {
		return { rows: knownRows, source: gpuModel ? 'known-gpu' : 'default' }
	}

	return { rows: [], source: 'default' }
}

function drmLookupKey(name) {
	return String(name || '').trim().toLowerCase()
}

function buildGpuPhysicalMap({ config, displays, connectors }) {
	const gpuModel = getGpuModel()
	const { rows: topology, source: topologySource } = resolvePhysicalTopology(config, gpuModel)
	const savedConfig = Array.isArray(config?.gpuPhysicalTopology) ? config.gpuPhysicalTopology : []
	const probe = discoverGpuPhysicalTopology({ config })
	const discoveredRows = probe?.rows || null
	const displayList = (Array.isArray(displays) ? displays : [])
		.map((d) => (d && typeof d === 'object' ? d : null))
		.filter(Boolean)
	const connectorList = (Array.isArray(connectors) ? connectors : [])
		.map((c) => (c && typeof c === 'object' ? c : null))
		.filter(Boolean)

	const displayByName = new Map(displayList.map((d) => [normalizePortName(d.name), d]))
	const displayByDrm = new Map()
	const displayByDrmShort = new Map()
	for (const d of displayList) {
		if (d?.drmName) displayByDrm.set(drmLookupKey(d.drmName), d)
		if (d?.drmConnector) displayByDrmShort.set(normalizePortName(d.drmConnector), d)
		if (d?.xrandrName) displayByName.set(normalizePortName(d.xrandrName), d)
	}
	const connectorByName = new Map(
		connectorList.map((c) => [normalizePortName(c.shortName || c.name), c]),
	)
	const connectorByDrm = new Map(connectorList.map((c) => [drmLookupKey(c.name), c]))

	const lookupDisplay = (topologyRow, normName, usedDisplayKeys) => {
		const normKey = normalizePortName(normName)
		if (normKey && !usedDisplayKeys.has(normKey)) {
			const direct = displayList.find(
				(d) => d?.connected !== false && normalizePortName(d.name) === normKey,
			)
			if (direct) return { display: direct, key: normKey }
		}

		const drm = drmLookupKey(topologyRow?.drmName)
		if (drm && displayByDrm.has(drm)) {
			const d = displayByDrm.get(drm)
			return { display: d, key: normalizePortName(d.xrandrName || d.name) }
		}
		const drmShort = normalizePortName(
			String(topologyRow?.drmName || '')
				.replace(/^card\d+-/i, '')
				.trim(),
		)
		if (drmShort && displayByDrmShort.has(drmShort)) {
			const d = displayByDrmShort.get(drmShort)
			return { display: d, key: normalizePortName(d.xrandrName || d.name) }
		}
		if (normName && displayByName.has(normName)) {
			const d = displayByName.get(normName)
			return { display: d, key: normalizePortName(d.xrandrName || d.name) }
		}
		return resolveDisplayByDrmHeuristic(topologyRow, displayList, connectorByDrm, usedDisplayKeys)
	}

	const lookupConnector = (topologyRow, normName) => {
		const drm = drmLookupKey(topologyRow?.drmName)
		if (drm && connectorByDrm.has(drm)) return connectorByDrm.get(drm)
		const card = String(topologyRow?.drmCard || '').trim().toLowerCase()
		if (card && normName) {
			for (const c of connectorList) {
				if (cardFromDrmName(c.name) !== card) continue
				if (normalizePortName(c.shortName || c.name) === normName) return c
			}
		}
		if (normName && connectorByName.has(normName)) return connectorByName.get(normName)
		return null
	}

	const usedDisplays = new Set()
	const displayForConnectorXrandr = (conn) => {
		if (!conn?.xrandrName) return null
		const key = normalizePortName(conn.xrandrName)
		if (!key) return null
		return (
			displayList.find((d) => d?.connected !== false && normalizePortName(d.name) === key) || null
		)
	}

	const ports = topology.map((t) => {
		const a = normalizePortName(t.dpA)
		const b = normalizePortName(t.dpB)
		const aHit = a ? lookupDisplay(t, a, usedDisplays) : null
		const bHit = b
			? lookupDisplay({ ...t, drmName: t.drmNameB || t.drmName }, b, usedDisplays)
			: null
		const aConn = lookupConnector(t, a)
		const bConn = b
			? lookupConnector({ ...t, drmName: t.drmNameB || '' }, b)
			: null
		let aDisplay = aHit?.display || displayForConnectorXrandr(aConn) || null
		let bDisplay = bHit?.display || displayForConnectorXrandr(bConn) || null
		const xrandrName = aDisplay?.name || bDisplay?.name || ''
		const activeRuntimePort = xrandrName
			? normalizePortName(xrandrName)
			: aDisplay
				? a
				: bDisplay
					? b
					: null
		const connected = !!(aDisplay || bDisplay || aConn?.connected || bConn?.connected)
		const activeDisplay = aDisplay || bDisplay || null

		if (aDisplay) usedDisplays.add(normalizePortName(aDisplay.name))
		if (bDisplay && bDisplay !== aDisplay) usedDisplays.add(normalizePortName(bDisplay.name))

		return {
			physicalPortId: t.physicalPortId,
			slotOrder: t.slotOrder,
			connectorNumber: t.connectorNumber,
			location: t.location,
			drmCard: t.drmCard || '',
			drmName: t.drmName || '',
			...(t.drmNameB ? { drmNameB: t.drmNameB } : {}),
			pair: { dpA: a, dpB: b, name: canonicalPairName(a, b) },
			runtime: {
				activePort: activeRuntimePort,
				xrandrName: xrandrName || null,
				candidatePorts: [a, b].filter(Boolean),
				connected,
				displayName: activeDisplay?.name || t.drmName || '',
				monitor: activeDisplay?.monitor || activeDisplay?.edid?.parsed || null,
				edid: activeDisplay?.edid || null,
				resolution: activeDisplay?.resolution || '',
				refreshHz: Number.isFinite(activeDisplay?.refreshHz) ? activeDisplay.refreshHz : null,
				casparScreenIndex: activeDisplay?.casparScreenIndex || null,
				casparMode: activeDisplay?.casparMode || null,
			},
			probe: {
				connectorA: aConn
					? { name: aConn.name || '', shortName: aConn.shortName || '', connected: !!aConn.connected }
					: null,
				connectorB: bConn
					? { name: bConn.name || '', shortName: bConn.shortName || '', connected: !!bConn.connected }
					: null,
			},
			confidence: connected ? 'high' : 'medium',
		}
	})

	// Connected outputs that still do not match any topology row.
	let nextUnmappedIdx = 0
	for (const display of displayList) {
		const key = normalizePortName(display.name)
		if (!key || usedDisplays.has(key)) continue
		const conn = connectorByDrm.get(drmLookupKey(display.name)) || connectorByName.get(key) || null
		usedDisplays.add(key)
		ports.push({
			physicalPortId: `gpu_unmapped_${nextUnmappedIdx++}`,
			slotOrder: 100 + nextUnmappedIdx,
			connectorNumber: null,
			location: null,
			drmCard: cardFromDrmName(display.name),
			drmName: display.name || '',
			pair: { dpA: key, dpB: '', name: key },
			runtime: {
				activePort: key,
				xrandrName: display.name || null,
				candidatePorts: [key],
				connected: true,
				displayName: display.name || '',
				monitor: display.monitor || display.edid?.parsed || null,
				edid: display.edid || null,
				resolution: display.resolution || '',
				refreshHz: Number.isFinite(display.refreshHz) ? display.refreshHz : null,
				casparScreenIndex: display.casparScreenIndex || null,
				casparMode: display.casparMode || null,
			},
			probe: {
				connectorA: conn
					? { name: conn.name || '', shortName: conn.shortName || '', connected: !!conn.connected }
					: null,
				connectorB: null,
			},
			confidence: 'high',
			unmapped: true,
		})
	}

	const cards = [...new Set(ports.map((p) => p.drmCard).filter(Boolean))]

	const baseForReconcile =
		topologySource === 'config' && savedConfig.length ? savedConfig : topology
	const effectiveTopology = reconcileTopologyWithLiveDisplays(
		baseForReconcile,
		displayList,
		discoveredRows,
	)
	let suggestedTopology = null
	if (
		savedConfig.length &&
		discoveredRows?.length &&
		config?.gpuPhysicalTopologyOperatorSaved &&
		topologyDiffers(savedConfig, discoveredRows)
	) {
		suggestedTopology = normalizeTopologyRows(discoveredRows)
	}

	return {
		topologySource,
		cards,
		ports,
		effectiveTopology,
		...(suggestedTopology ? { suggestedTopology, topologyMismatch: true } : {}),
	}
}

module.exports = {
	normalizePortName,
	buildGpuPhysicalMap,
	resolvePhysicalTopology,
}

'use strict'

const fs = require('fs')
const path = require('path')
const { getGpuModel } = require('./hardware-info')
const {
	normalizePortName,
} = require('./gpu-topology-xrandr')
const { discoverGpuPhysicalTopology, cardFromDrmName } = require('./gpu-topology-drm')
const { resolveDisplayByDrmHeuristic } = require('./gpu-display-alias')

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
		{ physicalPortId: 'gpu_p3', slotOrder: 0, dpA: 'DP-3', dpB: '', connectorNumber: 3, location: 3 },
		{ physicalPortId: 'gpu_p2', slotOrder: 1, dpA: 'DP-2', dpB: '', connectorNumber: 2, location: 2 },
		{ physicalPortId: 'gpu_p1', slotOrder: 2, dpA: 'HDMI-0', dpB: 'HDMI-1', connectorNumber: 1, location: 1 },
		{ physicalPortId: 'gpu_p0', slotOrder: 3, dpA: 'DP-1', dpB: '', connectorNumber: 0, location: 0 },
	]
}

/**
 * @param {object} cfg
 * @param {string|null} gpuModel
 * @returns {{ rows: object[], source: string }}
 */
function resolvePhysicalTopology(cfg, gpuModel) {
	const probed = discoverGpuPhysicalTopology({ config: cfg })
	if (probed?.rows?.length) {
		return { rows: probed.rows, source: probed.source }
	}

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
			})
		}
		if (out.length) {
			return { rows: out.sort((a, b) => a.slotOrder - b.slotOrder), source: 'config' }
		}
	}

	if (gpuModel) {
		try {
			const { REPO_ROOT } = require('../repo-paths')
			const knownPath = path.join(REPO_ROOT, 'data/known-gpus.json')
			if (fs.existsSync(knownPath)) {
				const known = JSON.parse(fs.readFileSync(knownPath, 'utf8'))
				if (known[gpuModel]) {
					return { rows: known[gpuModel], source: 'known-gpu' }
				}
			}
		} catch (e) {
			console.error(`[gpu-physical-map] Failed to load known-gpus.json:`, e.message)
		}
	}

	return { rows: defaultTopology(), source: 'default' }
}

function drmLookupKey(name) {
	return String(name || '').trim().toLowerCase()
}

function buildGpuPhysicalMap({ config, displays, connectors }) {
	const gpuModel = getGpuModel()
	const { rows: topology, source: topologySource } = resolvePhysicalTopology(config, gpuModel)
	const displayList = (Array.isArray(displays) ? displays : [])
		.map((d) => (d && typeof d === 'object' ? d : null))
		.filter(Boolean)
	const connectorList = (Array.isArray(connectors) ? connectors : [])
		.map((c) => (c && typeof c === 'object' ? c : null))
		.filter(Boolean)

	const displayByName = new Map(displayList.map((d) => [normalizePortName(d.name), d]))
	const displayByDrm = new Map(displayList.map((d) => [drmLookupKey(d.name), d]))
	const connectorByName = new Map(
		connectorList.map((c) => [normalizePortName(c.shortName || c.name), c]),
	)
	const connectorByDrm = new Map(connectorList.map((c) => [drmLookupKey(c.name), c]))

	const lookupDisplay = (topologyRow, normName, usedDisplayKeys) => {
		const drm = drmLookupKey(topologyRow?.drmName)
		if (drm && displayByDrm.has(drm)) {
			const d = displayByDrm.get(drm)
			return { display: d, key: normalizePortName(d.name) }
		}
		if (normName && displayByName.has(normName)) {
			const d = displayByName.get(normName)
			return { display: d, key: normName }
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
	const ports = topology.map((t) => {
		const a = normalizePortName(t.dpA)
		const b = normalizePortName(t.dpB)
		const aHit = a ? lookupDisplay(t, a, usedDisplays) : null
		const bHit = b
			? lookupDisplay({ ...t, drmName: t.drmNameB || t.drmName }, b, usedDisplays)
			: null
		const aDisplay = aHit?.display || null
		const bDisplay = bHit?.display || null
		const aConn = lookupConnector(t, a)
		const bConn = b
			? lookupConnector({ ...t, drmName: t.drmNameB || '' }, b)
			: null
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

		if (aHit?.key) usedDisplays.add(aHit.key)
		if (bHit?.key) usedDisplays.add(bHit.key)

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
				candidatePorts: [key],
				connected: true,
				displayName: display.name || '',
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

	return {
		topologySource,
		cards,
		ports,
	}
}

module.exports = {
	normalizePortName,
	buildGpuPhysicalMap,
	resolvePhysicalTopology,
}

'use strict'

const fs = require('fs')
const path = require('path')
const { getGpuModel } = require('./hardware-info')
const {
	normalizePortName,
	discoverGpuPhysicalTopologyFromXrandr,
} = require('./gpu-topology-xrandr')

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
	const fromXrandr = discoverGpuPhysicalTopologyFromXrandr()
	if (fromXrandr?.length) {
		return { rows: fromXrandr, source: 'xrandr' }
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

function buildGpuPhysicalMap({ config, displays, connectors }) {
	const gpuModel = getGpuModel()
	const { rows: topology, source: topologySource } = resolvePhysicalTopology(config, gpuModel)
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

	// Connected outputs that still do not match any A/B pair (non DP/HDMI or odd enumeration).
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
		topologySource,
		ports,
	}
}

module.exports = {
	normalizePortName,
	buildGpuPhysicalMap,
	resolvePhysicalTopology,
}

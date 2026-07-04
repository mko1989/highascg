'use strict'

const { getGpuConnectorInventory } = require('./hardware-info')
const {
	normalizePortName,
	discoverGpuPhysicalTopologyFromXrandr,
	parseXrandrVideoOutputNames,
	parseXrandrConnectedNames,
} = require('./gpu-topology-xrandr')
const { isSkippableDrmConnector, groupConnectorsByDrmCard } = require('./gpu-topology-drm-parse')
const { buildRowsForDrmCard } = require('./gpu-topology-drm-rows')

function buildTopologyRowsFromDrmConnectors(connectors, opts = {}) {
	const list = (Array.isArray(connectors) ? connectors : []).filter(
		(c) => c && typeof c === 'object' && !isSkippableDrmConnector(c.shortName || c.name),
	)
	if (!list.length) return null

	const xrandrRaw = opts.xrandrRaw || ''
	const xrandrOutputs = parseXrandrVideoOutputNames(xrandrRaw)
	const xrandrConnected = parseXrandrConnectedNames(xrandrRaw)
	const xrandrNames = new Set(
		xrandrOutputs.map((n) => normalizePortName(n)).filter(Boolean),
	)

	let cardGroups = groupConnectorsByDrmCard(list)
	if (Array.isArray(opts.cardOrder) && opts.cardOrder.length) {
		const order = opts.cardOrder.map((c) => String(c || '').toLowerCase()).filter(Boolean)
		const reordered = new Map()
		for (const card of order) {
			if (cardGroups.has(card)) reordered.set(card, cardGroups.get(card))
		}
		for (const [card, group] of cardGroups) {
			if (!reordered.has(card)) reordered.set(card, group)
		}
		cardGroups = reordered
	}

	const merged = []
	for (const [drmCard, group] of cardGroups) {
		const onCard = group
			.map((c) => {
				const drmName = String(c.name || '').trim()
				const short = String(c.shortName || drmName.replace(/^card\d+-/i, '')).trim()
				return {
					drmName,
					short,
					norm: normalizePortName(short || drmName),
					connected: !!c.connected,
					type: String(c.type || 'unknown'),
				}
			})
			.filter((c) => c.norm)
		merged.push(...buildRowsForDrmCard(drmCard, onCard, xrandrNames, xrandrOutputs, {
			pairAdjacentDp: opts.pairAdjacentDp,
			xrandrConnected,
		}))
	}

	if (!merged.length) return null

	return merged.map((row, i) => ({
		physicalPortId: `gpu_p${i}`,
		slotOrder: i,
		dpA: row.dpA,
		dpB: row.dpB,
		connectorNumber: i,
		location: i,
		drmName: row.drmName,
		...(row.drmNameB ? { drmNameB: row.drmNameB } : {}),
		drmCard: row.drmCard,
	}))
}

function discoverGpuPhysicalTopologyFromDrm(opts = {}) {
	const cfg = opts?.config && typeof opts.config === 'object' ? opts.config : {}
	let preferredCard = ''
	const drmDev = String(cfg?.streaming?.drmDevice || '').trim()
	const m = drmDev.match(/card(\d+)/i)
	if (m) preferredCard = `card${m[1]}`

	const connectors = getGpuConnectorInventory() || []
	const cardOrder = preferredCard ? [preferredCard] : []
	const pairAdjacentDp = cfg.gpuPhysicalPairAdjacentDp !== false
	return buildTopologyRowsFromDrmConnectors(connectors, {
		xrandrRaw: opts.xrandrRaw,
		cardOrder,
		pairAdjacentDp,
	})
}

function discoverGpuPhysicalTopology(opts = {}) {
	const cfg = opts.config && typeof opts.config === 'object' ? opts.config : {}
	let xrandrRaw = opts.xrandrRaw
	if (xrandrRaw == null) {
		try {
			const { getDisplaysXrandrDetailed } = require('./hardware-info')
			xrandrRaw = getDisplaysXrandrDetailed()?.raw || ''
		} catch {
			xrandrRaw = ''
		}
		if (!xrandrRaw) {
			try {
				const { readBootXrandrSnapshot } = require('./boot-xrandr-snapshot')
				xrandrRaw = readBootXrandrSnapshot()?.raw || ''
			} catch {
				xrandrRaw = ''
			}
		}
	}

	const xrandrOpts = {
		flatPorts: cfg.gpuPhysicalFlatXrandrPorts === true,
		pairAdjacentDp: cfg.gpuPhysicalPairAdjacentDp !== false,
	}
	const fromXrandr = discoverGpuPhysicalTopologyFromXrandr(xrandrRaw, xrandrOpts)
	if (fromXrandr?.length) {
		return { rows: fromXrandr, source: 'xrandr', cards: ['card0'] }
	}

	const fromDrm = discoverGpuPhysicalTopologyFromDrm(opts)
	if (fromDrm?.length) {
		const cards = [...new Set(fromDrm.map((r) => r.drmCard).filter(Boolean))]
		return { rows: fromDrm, source: 'drm', cards: cards.length ? cards : ['card0'] }
	}

	return null
}

module.exports = {
	buildTopologyRowsFromDrmConnectors,
	discoverGpuPhysicalTopologyFromDrm,
	discoverGpuPhysicalTopology,
}

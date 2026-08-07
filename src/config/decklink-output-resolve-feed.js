'use strict'

const { getModeDimensions } = require('./config-modes')
const { destinationsFromConfig } = require('./screen-destinations')

function feedFromScreenConfig(config, screenN) {
	const n = Math.max(1, parseInt(String(screenN), 10) || 1)
	const mode = String(config[`screen_${n}_mode`] || '1080p5000').trim() || '1080p5000'
	const dims = getModeDimensions(mode, config, n)
	return {
		sourceKind: 'screen',
		sourceLabel: `Program ${n}`,
		videoMode: dims.modeId,
		width: dims.width,
		height: dims.height,
		fps: dims.fps,
	}
}

function feedFromMultiviewConfig(config, mvN = 1) {
	const n = Math.max(1, parseInt(String(mvN), 10) || 1)
	const mode = String(config[`multiview_${n}_mode`] || config.multiview_mode || '1080p5000').trim() || '1080p5000'
	const dims = getModeDimensions(mode, config, 1)
	return {
		sourceKind: 'multiview',
		sourceLabel: n > 1 ? `Multiview ${n}` : 'Multiview',
		videoMode: dims.modeId,
		width: dims.width,
		height: dims.height,
		fps: dims.fps,
	}
}

function feedFromDestination(dest) {
	if (!dest || typeof dest !== 'object') return null
	const mode = String(dest.mode || 'pgm_prv')
	const videoMode = String(dest.videoMode || '1080p5000').trim() || '1080p5000'
	const width = Math.max(64, parseInt(String(dest.width ?? 1920), 10) || 1920)
	const height = Math.max(64, parseInt(String(dest.height ?? 1080), 10) || 1080)
	const fps = Math.max(1, parseFloat(String(dest.fps ?? 50)) || 50)
	const label = String(dest.label || dest.id || 'Destination')
	if (mode === 'multiview') {
		return {
			sourceKind: 'destination_multiview',
			sourceLabel: label,
			videoMode,
			width,
			height,
			fps,
		}
	}
	return {
		sourceKind: 'destination',
		sourceLabel: label,
		videoMode,
		width,
		height,
		fps,
	}
}

function resolveTerminalSourceId(config, startSourceId) {
	const g = config?.deviceGraph
	if (!g || !Array.isArray(g.connectors)) return String(startSourceId || '').trim()
	const edges = Array.isArray(g.edges) ? g.edges : []
	const byId = new Map(g.connectors.map((c) => [String(c?.id || ''), c]))
	const seen = new Set()
	const queue = [String(startSourceId || '').trim()]

	while (queue.length) {
		const cur = queue.shift()
		if (!cur || seen.has(cur)) continue
		seen.add(cur)

		if (
			cur.startsWith('dst_in_') ||
			cur.startsWith('dst_ch') ||
			cur.startsWith('dst_mv')
		) {
			return cur
		}

		if (cur.startsWith('caspar_pgm_') || cur === 'caspar_mv_out') {
			const inEdges = edges.filter((e) => String(e?.sinkId || '') === cur)
			if (inEdges.length) {
				for (const ie of inEdges) queue.push(String(ie?.sourceId || ''))
				continue
			}
			return cur
		}

		const conn = byId.get(cur)
		if (conn?.kind === 'destination_in') {
			const did = String(conn.externalRef || '').trim()
			if (did) return `dst_in_${did}`
		}

		if (conn?.kind === 'pixel_map_out') {
			const nodeId = String(conn.deviceId || '')
			const nodeInputs = g.connectors.filter(
				(c) => String(c?.deviceId || '') === nodeId && c?.kind === 'pixel_map_in'
			)
			for (const ni of nodeInputs) {
				for (const ie of edges.filter((e) => String(e?.sinkId || '') === String(ni?.id || ''))) {
					queue.push(String(ie?.sourceId || ''))
				}
			}
			continue
		}

		for (const ie of edges.filter((e) => String(e?.sinkId || '') === cur)) {
			queue.push(String(ie?.sourceId || ''))
		}
	}

	return ''
}

function feedFromTerminalSourceId(config, terminalId) {
	const destinations = destinationsFromConfig(config)
	const id = String(terminalId || '').trim()
	if (!id) return null

	if (id.startsWith('dst_in_')) {
		const destId = id.slice('dst_in_'.length)
		return feedFromDestination(destinations.find((d) => String(d?.id || '') === destId))
	}
	if (id.startsWith('dst_ch')) {
		const n = parseInt(id.slice('dst_ch'.length), 10)
		if (Number.isFinite(n) && n >= 1) {
			const dest = destinations.find((d) => (parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0) === n - 1)
			return feedFromDestination(dest) || feedFromScreenConfig(config, n)
		}
	}
	if (id.startsWith('dst_mv') || id === 'caspar_mv_out') {
		const mvDest = destinations.find((d) => String(d?.mode || '') === 'multiview')
		return feedFromDestination(mvDest) || feedFromMultiviewConfig(config)
	}
	if (id.startsWith('caspar_pgm_')) {
		const n = parseInt(id.slice('caspar_pgm_'.length), 10)
		if (Number.isFinite(n) && n >= 1) return feedFromScreenConfig(config, n)
	}
	return null
}

function feedFromOutputBinding(config, connector) {
	const binding = connector?.caspar?.outputBinding
	if (!binding || typeof binding !== 'object') return null
	if (binding.type === 'multiview') return feedFromMultiviewConfig(config)
	if (binding.type === 'screen') {
		const n = Math.max(1, parseInt(String(binding.index ?? 1), 10) || 1)
		return feedFromScreenConfig(config, n)
	}
	return null
}

function resolveUpstreamFeedForDecklinkConnector(config, connector) {
	const g = config?.deviceGraph
	const edges = Array.isArray(g?.edges) ? g.edges : []
	const incoming = edges.filter((e) => String(e?.sinkId || '') === String(connector?.id || ''))
	if (incoming.length) {
		const terminal = resolveTerminalSourceId(config, String(incoming[0]?.sourceId || ''))
		const feed = feedFromTerminalSourceId(config, terminal)
		if (feed) return { ...feed, cableResolved: true }
	}
	return { ...(feedFromOutputBinding(config, connector) || feedFromMultiviewConfig(config)), cableResolved: false }
}

module.exports = {
	feedFromScreenConfig,
	feedFromMultiviewConfig,
	resolveTerminalSourceId,
	resolveUpstreamFeedForDecklinkConnector,
}

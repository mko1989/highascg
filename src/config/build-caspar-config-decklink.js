'use strict'

const { destinationsFromConfig } = require('./screen-destinations')
const { isDecklinkIoOut } = require('./decklink-io-direction')
const {
	parseDecklinkDeviceIndex,
	readDecklinkKeyFillFromConnectorCaspar,
	writeDecklinkKeyFillToCasparServer,
	applyDecklinkConsumerSettingsFromConnector,
} = require('./decklink-key-fill')

function applyDecklinkOverridesToScreens(merged, appConfig) {
	const g = appConfig?.deviceGraph
	if (!g || !Array.isArray(g.connectors)) return

	const edges = Array.isArray(g.edges) ? g.edges : []
	const destinations = destinationsFromConfig(appConfig || {})
	const byId = new Map(g.connectors.map((c) => [String(c?.id || ''), c]))
	const outgoing = new Map()
	for (const e of edges) {
		const src = String(e?.sourceId || '')
		if (!src) continue
		if (!outgoing.has(src)) outgoing.set(src, [])
		outgoing.get(src).push(String(e?.sinkId || ''))
	}

	function applyDecklinkKeyFillFromConnector(merged, prefix, connector) {
		const keyFill = readDecklinkKeyFillFromConnectorCaspar(connector?.caspar)
		if (!keyFill.enabled) return
		writeDecklinkKeyFillToCasparServer(merged, prefix, {
			fillDevice: parseDecklinkDeviceIndex(connector?.externalRef),
			keyDevice: keyFill.keyDevice,
			keyer: keyFill.keyer,
		})
	}

	function resolveDestinationSourceForConnector(sourceId) {
		const seen = new Set()
		const queue = [String(sourceId || '')]
		while (queue.length) {
			const cur = queue.shift()
			if (!cur || seen.has(cur)) continue
			seen.add(cur)
			if (cur.startsWith('dst_in_') || cur.startsWith('dst_ch') || cur.startsWith('dst_mv') || cur.startsWith('caspar_pgm_') || cur === 'caspar_mv_out') return cur
			const conn = byId.get(cur)
			if (conn?.kind === 'destination_in') {
				const did = String(conn.externalRef || '').trim()
				if (did) return `dst_in_${did}`
			}
			if (conn?.kind === 'pixel_map_out') {
				const nodeId = String(conn.deviceId || '')
				const nodeInputs = g.connectors.filter((c) => String(c?.deviceId || '') === nodeId && c?.kind === 'pixel_map_in')
				for (const ni of nodeInputs) {
					const inEdges = edges.filter((e) => String(e?.sinkId || '') === String(ni?.id || ''))
					for (const ie of inEdges) queue.push(String(ie?.sourceId || ''))
				}
			}
		}
		return ''
	}

	function assignDecklinkToScreen(n, devNum, connector) {
		const existingTiles = merged[`screen_${n}_decklink_tiles`]
		if (Array.isArray(existingTiles) && existingTiles.length > 0) return
		merged[`screen_${n}_decklink_device`] = devNum
		if (merged[`screen_${n}_decklink_replace_screen`] === undefined) {
			merged[`screen_${n}_decklink_replace_screen`] = true
		}
		applyDecklinkKeyFillFromConnector(merged, `screen_${n}_`, connector)
		applyDecklinkConsumerSettingsFromConnector(merged, `screen_${n}_`, connector)
	}

	g.connectors.forEach((c) => {
		if (c.kind !== 'decklink_io' && c.kind !== 'decklink_out') return
		const devNum = parseInt(String(c.externalRef || ''), 10)
		if (!Number.isFinite(devNum) || devNum <= 0) return

		const incomingEdge = edges.find((e) => e.sinkId === c.id)
		if (!incomingEdge) {
			if (c.kind === 'decklink_io' && !isDecklinkIoOut(c)) return
			const binding = c.caspar?.outputBinding
			if (binding?.type === 'screen') {
				const n = Math.min(8, Math.max(1, parseInt(String(binding.index ?? 1), 10) || 1))
				assignDecklinkToScreen(n, devNum, c)
			} else if (binding?.type === 'multiview') {
				merged.multiview_decklink_device = devNum
				applyDecklinkKeyFillFromConnector(merged, 'multiview_', c)
				applyDecklinkConsumerSettingsFromConnector(merged, 'multiview_', c)
			}
			return
		}

		const sourceId = resolveDestinationSourceForConnector(String(incomingEdge.sourceId || ''))

		if (sourceId.startsWith('dst_in_') || sourceId.startsWith('dst_ch')) {
			let dest = null
			if (sourceId.startsWith('dst_in_')) {
				const destId = sourceId.slice('dst_in_'.length)
				dest = destinations.find((d) => String(d.id) === destId)
			} else {
				const n = parseInt(sourceId.slice('dst_ch'.length), 10)
				if (Number.isFinite(n) && n >= 1) {
					const idx = n - 1
					dest = destinations.find((d) => Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0) === idx)
				}
			}
			if (!dest) return
			if (String(dest.mode || '') === 'multiview') {
				merged.multiview_decklink_device = devNum
				applyDecklinkKeyFillFromConnector(merged, 'multiview_', c)
				applyDecklinkConsumerSettingsFromConnector(merged, 'multiview_', c)
			} else {
				const idx = Number.isFinite(Number(dest.mainScreenIndex)) ? Number(dest.mainScreenIndex) : 0
				const n = idx + 1
				assignDecklinkToScreen(n, devNum, c)
			}
		} else if (sourceId.startsWith('caspar_pgm_')) {
			const idx = parseInt(sourceId.slice('caspar_pgm_'.length), 10) - 1
			const n = idx + 1
			if (n > 0) assignDecklinkToScreen(n, devNum, c)
		} else if (sourceId === 'caspar_mv_out') {
			merged.multiview_decklink_device = devNum
			applyDecklinkKeyFillFromConnector(merged, 'multiview_', c)
			applyDecklinkConsumerSettingsFromConnector(merged, 'multiview_', c)
		}
	})
}

module.exports = { applyDecklinkOverridesToScreens }

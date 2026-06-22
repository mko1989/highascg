'use strict'

const { destinationsFromConfig } = require('./screen-destinations')
const { STANDARD_VIDEO_MODES } = require('./config-modes')

/**
 * Map pixel_mapping outputs onto the **program channel that feeds the node's input** (see `work/caspar_extended.config`):
 * destination panel resolution defines the Caspar channel video-mode; mapping only adds DeckLink `<subregion>` /
 * synced `<ports>` (or GPU head layout via xrandr) — it must not resize the channel.
 */
function resolvePixelMapFeedToProgramScreen(appConfig, nodeId) {
	const dg = appConfig?.deviceGraph
	if (!dg || !Array.isArray(dg.connectors) || !Array.isArray(dg.edges)) return null
	const connectors = dg.connectors
	const edges = dg.edges
	const destinations = destinationsFromConfig(appConfig || {})
	const inConn = connectors.find((c) => String(c?.deviceId || '') === nodeId && c.kind === 'pixel_map_in')
	if (!inConn) return null
	const inEdge = edges.find((e) => String(e?.sinkId || '') === String(inConn.id || ''))
	if (!inEdge) return null
	const srcId = String(inEdge.sourceId || '')
	if (srcId.startsWith('dst_in_')) {
		const destId = srcId.slice('dst_in_'.length)
		const dest = destinations.find((d) => String(d?.id || '') === destId)
		if (!dest) return null
		if (String(dest.mode || '') === 'multiview') return { kind: 'multiview' }
		const idx = Math.max(0, parseInt(String(dest.mainScreenIndex ?? 0), 10) || 0)
		return { kind: 'program', screenIndex: idx + 1 }
	}
	if (srcId.startsWith('dst_ch')) {
		const n = parseInt(srcId.slice('dst_ch'.length), 10)
		if (Number.isFinite(n) && n >= 1) return { kind: 'program', screenIndex: n }
	}
	if (srcId.startsWith('dst_mv')) return { kind: 'multiview' }
	if (srcId.startsWith('caspar_pgm_')) {
		const n = parseInt(srcId.slice('caspar_pgm_'.length), 10)
		if (Number.isFinite(n) && n >= 1) return { kind: 'program', screenIndex: n }
	}
	return null
}

function applyPixelMappingProgramScreens(merged, appConfig) {
	const dg = appConfig?.deviceGraph
	if (!dg || !Array.isArray(dg.devices) || !Array.isArray(dg.connectors) || !Array.isArray(dg.edges)) return

	const devices = dg.devices
	const connectors = dg.connectors
	const edges = dg.edges
	const byId = new Map(connectors.map((c) => [String(c?.id || ''), c]))
	const mappingNodes = devices.filter((d) => d && d.role === 'pixel_mapping')

	for (const node of mappingNodes) {
		const nodeId = String(node.id || '')
		if (!nodeId) continue

		const feed = resolvePixelMapFeedToProgramScreen(appConfig, nodeId)
		const outputs = Array.isArray(node.settings?.outputs) ? node.settings.outputs : []
		const mappings = Array.isArray(node.settings?.mappings) ? node.settings.mappings : []
		if (!outputs.length) continue

		const nodeOutConns = connectors.filter((c) => c.deviceId === nodeId && c.kind === 'pixel_map_out')

		if (feed?.kind === 'program') {
			let srcX = 0
			/** @type {{ device: number, srcX: number, srcY: number, destX: number, destY: number, width: number, height: number, videoMode: string }[]} */
			const tiles = []

			for (let idx = 0; idx < outputs.length; idx++) {
				const outDef = outputs[idx]
				const modeId = String(outDef?.mode || '1080p5000').trim()
				const spec = STANDARD_VIDEO_MODES[modeId]
				const w = spec?.width ?? 1920
				const h = spec?.height ?? 1080

				const slice = mappings.find((m) => String(m.outputId) === String(outDef?.id || ''))
				const tileSrcX = slice?.rect?.x ?? srcX
				const tileSrcY = slice?.rect?.y ?? 0
				const tileW = slice?.rect?.w ?? w
				const tileH = slice?.rect?.h ?? h

				const conn =
					nodeOutConns.find((c) => Number(c?.index) === idx) ||
					nodeOutConns.find((c) => String(c?.id || '') === `${nodeId}_${String(outDef?.id || '')}`) ||
					nodeOutConns.find((c) => String(c?.id || '').endsWith(`_${String(outDef?.id || '')}`))
				if (!conn) {
					srcX += w
					continue
				}
				const edge = edges.find((e) => String(e.sourceId) === String(conn.id))
				if (!edge) {
					srcX += w
					continue
				}
				const sink = byId.get(String(edge.sinkId || ''))
				if (!sink || (sink.kind !== 'decklink_io' && sink.kind !== 'decklink_out')) {
					srcX += w
					continue
				}
				const devNum = parseInt(String(sink.externalRef || ''), 10)
				if (!(Number.isFinite(devNum) && devNum > 0)) {
					srcX += w
					continue
				}

				tiles.push({
					device: devNum,
					srcX: tileSrcX,
					srcY: tileSrcY,
					destX: 0,
					destY: 0,
					width: tileW,
					height: tileH,
					videoMode: modeId,
				})
				srcX += w
			}

			if (tiles.length > 0) {
				const n = feed.screenIndex
				const hasGpuOut = nodeOutConns.some((conn) => {
					const edge = edges.find((e) => String(e.sourceId) === String(conn.id))
					if (!edge) return false
					const sink = byId.get(String(edge.sinkId || ''))
					return sink?.kind === 'gpu_out'
				})
				// Destination / applyDestinationOverridesToScreens already set channel video-mode.
				// Mapping defines DeckLink subregions on that canvas; GPU heads use mappingGpuOutputs separately.
				if (hasGpuOut) merged[`screen_${n}_screen_consumer`] = true
				if (merged[`screen_${n}_screen_consumer`] === true) merged[`screen_${n}_decklink_replace_screen`] = false
				else merged[`screen_${n}_decklink_replace_screen`] = true
				merged[`screen_${n}_decklink_tiles`] = tiles
				delete merged[`screen_${n}_decklink_device`]
				continue
			}
		}

		// GPU mapping head layout is applied via xrandr (mappingGpuOutputs) — do not override channel resolution.
		if (feed?.kind !== 'program') continue
	}
}

module.exports = { applyPixelMappingProgramScreens, resolvePixelMapFeedToProgramScreen }

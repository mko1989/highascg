'use strict'

const { destinationsFromConfig } = require('./screen-destinations')
const { STANDARD_VIDEO_MODES } = require('./config-modes')
const { computePixelMappingCanvasUnion } = require('../utils/mapping-gpu-os-layout')

/**
 * Map pixel_mapping outputs onto the **program channel that feeds the node's input** (see `work/caspar_extended.config`):
 * one wide custom video-mode plus a single `<decklink>` with `<subregion>` and synced `<ports>` for extra SDI devices.
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

		let hasNonDeckCable = false
		for (const c of nodeOutConns) {
			const e = edges.find((x) => String(x.sourceId) === String(c.id))
			if (!e) continue
			const sk = byId.get(String(e.sinkId || ''))
			if (!sk) continue
			if (sk.kind === 'decklink_io' || sk.kind === 'decklink_out') continue
			hasNonDeckCable = true
			break
		}

		if (feed?.kind === 'program' && !hasNonDeckCable) {
			let srcX = 0
			let maxH = 1080
			/** @type {{ device: number, srcX: number, srcY: number, destX: number, destY: number, width: number, height: number, videoMode: string }[]} */
			const tiles = []
			let fps = 50

			for (let idx = 0; idx < outputs.length; idx++) {
				const outDef = outputs[idx]
				const modeId = String(outDef?.mode || '1080p5000').trim()
				const spec = STANDARD_VIDEO_MODES[modeId]
				const w = spec?.width ?? 1920
				const h = spec?.height ?? 1080
				const f = spec?.fps ?? 50
				
				const slice = mappings.find(m => String(m.outputId) === String(outDef?.id || ''))
				const tileSrcX = slice?.rect?.x ?? srcX
				const tileSrcY = slice?.rect?.y ?? 0
				const tileW = slice?.rect?.w ?? w
				const tileH = slice?.rect?.h ?? h

				maxH = Math.max(maxH, tileSrcY + tileH)

				const conn =
					nodeOutConns.find((c) => Number(c?.index) === idx) ||
					nodeOutConns.find((c) => String(c?.id || '') === `${nodeId}_${String(outDef?.id || '')}`)
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
				fps = f
				srcX += w
			}

			if (tiles.length > 0) {
				const n = feed.screenIndex
				const totalW = tiles.reduce((acc, t) => acc + t.width, 0)
				merged[`screen_${n}_mode`] = 'custom'
				merged[`screen_${n}_custom_width`] = totalW
				merged[`screen_${n}_custom_height`] = maxH
				merged[`screen_${n}_custom_fps`] = fps
				// Keep screen consumer when destination is also cabled to GPU.
				if (merged[`screen_${n}_screen_consumer`] === true) merged[`screen_${n}_decklink_replace_screen`] = false
				else merged[`screen_${n}_decklink_replace_screen`] = true
				merged[`screen_${n}_decklink_tiles`] = tiles
				delete merged[`screen_${n}_decklink_device`]
				continue
			}
		}

		if (feed?.kind !== 'program') continue
		const n = feed.screenIndex
		const hasGpuOut = nodeOutConns.some((conn) => {
			const edge = edges.find((e) => String(e.sourceId) === String(conn.id))
			if (!edge) return false
			const sink = byId.get(String(edge.sinkId || ''))
			return !!(sink && (sink.kind === 'gpu_out' || sink.kind === 'gpu_output'))
		})
		if (!hasGpuOut) continue

		const union = computePixelMappingCanvasUnion(node)
		if (union && union.width > 0 && union.height > 0) {
			merged[`screen_${n}_mode`] = 'custom'
			merged[`screen_${n}_custom_width`] = union.width
			merged[`screen_${n}_custom_height`] = union.height
			merged[`screen_${n}_custom_fps`] = union.fps
		}
	}
}

module.exports = { applyPixelMappingProgramScreens, resolvePixelMapFeedToProgramScreen }

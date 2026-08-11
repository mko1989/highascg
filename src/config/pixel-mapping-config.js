'use strict'

const { destinationsFromConfig } = require('./screen-destinations')
const { resolveOutputPixelSize } = require('../utils/mapping-gpu-os-layout')
const { resolveDecklinkTileVideoMode } = require('./decklink-output-resolve')
const { getModeDimensions } = require('./config-modes')

/**
 * WO-485: the raster a DeckLink tile is cut FROM — the program channel's own canvas.
 * @param {Record<string, any>} merged
 * @param {number} n - 1-based screen index
 * @returns {{ width: number, height: number }}
 */
function programRasterFor(merged, n) {
	try {
		const dims = getModeDimensions(String(merged[`screen_${n}_mode`] || '1080p5000'), merged, n)
		if (dims?.width > 0 && dims?.height > 0) return { width: dims.width, height: dims.height }
	} catch {
		/* fall through */
	}
	return { width: 1920, height: 1080 }
}

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
			/* WO-485: tiles are cut from the CHANNEL raster, not from the output's mode size.
			 *
			 * Sizing a rect-less tile from `resolveOutputPixelSize` (the SDI mode, e.g. 3840x2160)
			 * and packing left-to-right by that width produced, on a 6144x1536 channel with two
			 * 2160p50 cards: device 1 = 3840x2160 @ x0, device 2 = 3840x2160 @ x3840 — overrunning
			 * the raster by 1536px horizontally and 624px vertically. Caspar then fetches an
			 * out-of-bounds region per card per frame; the DeckLink consumer owns the channel's
			 * synchronization clock (decklink_consumer.cpp:1266 — the screen consumer's is false),
			 * so when it cannot keep up the WHOLE channel slows. Measured on the box at ~80% speed,
			 * degrading to ~50% once two DeckLink INPUTS competed for the same card, and realtime
			 * with the DeckLink consumer removed. */
			const raster = programRasterFor(merged, feed.screenIndex)
			const rectlessCount = outputs.filter((o, i) => {
				const c =
					nodeOutConns.find((x) => Number(x?.index) === i) ||
					nodeOutConns.find((x) => String(x?.id || '').endsWith(`_${String(o?.id || '')}`))
				if (!c) return false
				const e = edges.find((x) => String(x.sourceId) === String(c.id))
				const sink = e && byId.get(String(e.sinkId || ''))
				if (!sink || (sink.kind !== 'decklink_io' && sink.kind !== 'decklink_out')) return false
				const sl = mappings.find((m) => String(m.outputId) === String(o?.id || ''))
				return !(sl?.rect && Number.isFinite(Number(sl.rect.x)) && Number.isFinite(Number(sl.rect.y)))
			}).length
			/** Even horizontal split of the raster across the rect-less DeckLink tiles. */
			const packW = rectlessCount > 0 ? Math.floor(raster.width / rectlessCount) : raster.width
			/** Horizontal pack position for DeckLink outputs that have no mapping rect yet. */
			let decklinkPackX = 0
			/** @type {{ device: number, srcX: number, srcY: number, destX: number, destY: number, width: number, height: number, videoMode: string }[]} */
			const tiles = []

			for (let idx = 0; idx < outputs.length; idx++) {
				const outDef = outputs[idx]
				const modeId = String(outDef?.mode || '1080p5000').trim()
				const { width: specW, height: specH } = resolveOutputPixelSize(outDef)

				const slice = mappings.find((m) => String(m.outputId) === String(outDef?.id || ''))
				const hasRect =
					slice?.rect &&
					Number.isFinite(Number(slice.rect.x)) &&
					Number.isFinite(Number(slice.rect.y))
				const tileW = slice?.rect?.w ?? (hasRect ? specW : packW)
				const tileH = slice?.rect?.h ?? (hasRect ? specH : raster.height)

				const conn =
					nodeOutConns.find((c) => Number(c?.index) === idx) ||
					nodeOutConns.find((c) => String(c?.id || '') === `${nodeId}_${String(outDef?.id || '')}`) ||
					nodeOutConns.find((c) => String(c?.id || '').endsWith(`_${String(outDef?.id || '')}`))
				if (!conn) continue
				const edge = edges.find((e) => String(e.sourceId) === String(conn.id))
				if (!edge) continue
				const sink = byId.get(String(edge.sinkId || ''))
				if (!sink || (sink.kind !== 'decklink_io' && sink.kind !== 'decklink_out')) continue
				const devNum = parseInt(String(sink.externalRef || ''), 10)
				if (!(Number.isFinite(devNum) && devNum > 0)) continue

				const tileSrcX = hasRect ? Number(slice.rect.x) : decklinkPackX
				const tileSrcY = hasRect ? Number(slice.rect.y) : 0
				if (!hasRect) decklinkPackX += tileW
				const tileFps = Math.max(1, parseFloat(String(outDef?.fps ?? 50)) || 50)
				const tileVideoMode = resolveDecklinkTileVideoMode({
					width: tileW,
					height: tileH,
					fps: tileFps,
					modeHint: modeId,
				})

				/* WO-485: a subregion outside the raster is always wrong, however it was derived —
				 * an authored rect can be stale after a destination resize just as easily as a
				 * packed default can overflow. Clamp both, and drop a tile that starts off-canvas. */
				const clampX = Math.max(0, Math.min(tileSrcX, raster.width))
				const clampY = Math.max(0, Math.min(tileSrcY, raster.height))
				const clampW = Math.max(0, Math.min(tileW, raster.width - clampX))
				const clampH = Math.max(0, Math.min(tileH, raster.height - clampY))
				if (clampW <= 0 || clampH <= 0) continue

				tiles.push({
					device: devNum,
					srcX: clampX,
					srcY: clampY,
					destX: 0,
					destY: 0,
					width: clampW,
					height: clampH,
					videoMode: tileVideoMode,
				})
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

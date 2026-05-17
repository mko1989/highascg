'use strict'

const { STANDARD_VIDEO_MODES } = require('../config/config-modes')

/** @typedef {{ sysId: string, x: number, y: number, width: number, height: number, mode: string, rate?: number|null, backend: string, nodeId: string, mapOutId: string, outputId?: string }} MappingGpuLayoutEntry */

function inferRefreshHzFromCasparMode(modeId) {
	const s = String(modeId || '').toLowerCase()
	if (!s) return null
	if (/(4997|5000|p50)(?:\b|_)/.test(s) || /50$/.test(s)) return 50
	if (/(5994|6000|p60)(?:\b|_)/.test(s) || /60$/.test(s)) return 60
	if (/(4795|4800|p48)(?:\b|_)/.test(s)) return 48
	if (/(2997|3000|p30)(?:\b|_)/.test(s)) return 30
	if (/(2497|2500|p25)(?:\b|_)/.test(s)) return 25
	if (/(2398|2400|p24)(?:\b|_)/.test(s)) return 24
	return null
}

/**
 * @param {object} mapOutConn
 * @param {object[]} outputs
 * @returns {{ outDef: object | null, outIdx: number }}
 */
function resolveOutputDefForMapOutConnector(mapOutConn, outputs) {
	const outs = Array.isArray(outputs) ? outputs : []
	if (!outs.length) return { outDef: null, outIdx: 0 }
	if (!mapOutConn) return { outDef: outs[0], outIdx: 0 }
	const idxRaw = mapOutConn.index
	if (idxRaw !== undefined && idxRaw !== null && idxRaw !== '') {
		const idx = parseInt(String(idxRaw), 10)
		if (Number.isFinite(idx) && idx >= 0 && idx < outs.length) return { outDef: outs[idx], outIdx: idx }
	}
	const cid = String(mapOutConn.id || '')
	for (let i = 0; i < outs.length; i++) {
		const oid = String(outs[i]?.id || '').trim()
		if (oid && (cid === `${String(mapOutConn.deviceId || '')}_${oid}` || cid.includes(oid))) {
			return { outDef: outs[i], outIdx: i }
		}
	}
	return { outDef: outs[0], outIdx: 0 }
}

/**
 * Union bounding size of a pixel-mapping node's logical canvas from `outputs` + `mappings`
 * (same rules as Caspar merge / GPU path in `pixel-mapping-config.js`).
 *
 * @param {{ settings?: { outputs?: object[], mappings?: object[] } }} node
 * @returns {{ width: number, height: number, fps: number } | null}
 */
function computePixelMappingCanvasUnion(node) {
	const outputs = Array.isArray(node?.settings?.outputs) ? node.settings.outputs : []
	const mappings = Array.isArray(node?.settings?.mappings) ? node.settings.mappings : []
	if (!outputs.length) return null
	let maxR = 0
	let maxB = 0
	let fpsForCanvas = 50
	let cumX = 0
	for (let idx = 0; idx < outputs.length; idx++) {
		const outDef = outputs[idx]
		const modeId = String(outDef?.mode || '1080p5000').trim()
		const spec = STANDARD_VIDEO_MODES[modeId]
		const w = spec?.width ?? 1920
		const h = spec?.height ?? 1080
		const f = spec?.fps ?? 50
		const slice = mappings.find((m) => String(m.outputId) === String(outDef?.id || ''))
		let px
		let py
		let pw
		let ph
		if (
			slice &&
			slice.rect &&
			Number.isFinite(Number(slice.rect.w)) &&
			Number(slice.rect.w) > 0 &&
			Number.isFinite(Number(slice.rect.h)) &&
			Number(slice.rect.h) > 0
		) {
			const rx = Number(slice.rect.x)
			const ry = Number(slice.rect.y)
			const rw = Number(slice.rect.w)
			const rh = Number(slice.rect.h)
			px = Number.isFinite(rx) ? rx : 0
			py = Number.isFinite(ry) ? ry : 0
			pw = rw
			ph = rh
		} else {
			px = cumX
			py = 0
			pw = w
			ph = h
			cumX += w
		}
		maxR = Math.max(maxR, px + pw)
		maxB = Math.max(maxB, py + ph)
		if (Number.isFinite(f) && f > 0) fpsForCanvas = f
	}
	if (maxR <= 0 || maxB <= 0) return null
	return { width: maxR, height: maxB, fps: fpsForCanvas }
}

/**
 * Builds xrandr-oriented layout rows for `pixel_map_out` → `gpu_out` edges (WO-40a).
 * Positions and sizes come from `node.settings.mappings[].rect` when present, else output mode dimensions.
 *
 * @param {Record<string, unknown>} config
 * @returns {{ mappingGpuOutputs: MappingGpuLayoutEntry[], mappingGpuBBox: { minX: number, minY: number, maxX: number, maxY: number } | null }}
 */
function buildMappingGpuLayoutArtifacts(config) {
	const dg = config?.deviceGraph
	const connectors = Array.isArray(dg?.connectors) ? dg.connectors : []
	const edges = Array.isArray(dg?.edges) ? dg.edges : []
	const devices = Array.isArray(dg?.devices) ? dg.devices : []
	if (!connectors.length || !edges.length) {
		return { mappingGpuOutputs: [], mappingGpuBBox: null }
	}

	const byId = new Map(connectors.map((c) => [String(c?.id || ''), c]))
	/** @type {Map<string, { width: number, height: number, fps: number } | null>} */
	const unionCache = new Map()

	/** @type {MappingGpuLayoutEntry[]} */
	const mappingGpuOutputs = []

	for (const e of edges) {
		const sink = byId.get(String(e?.sinkId || ''))
		if (!sink || (sink.kind !== 'gpu_out' && sink.kind !== 'gpu_output')) continue
		const src = byId.get(String(e?.sourceId || ''))
		if (!src || src.kind !== 'pixel_map_out') continue

		const nodeId = String(src.deviceId || '').trim()
		const node = devices.find((d) => d && d.id === nodeId && d.role === 'pixel_mapping')
		if (!node) continue

		const sysId = String(sink.externalRef || '').trim()
		if (!sysId) continue

		const outputs = Array.isArray(node.settings?.outputs) ? node.settings.outputs : []
		const mappings = Array.isArray(node.settings?.mappings) ? node.settings.mappings : []
		const { outDef } = resolveOutputDefForMapOutConnector(src, outputs)
		if (!outDef) continue

		const modeId = String(outDef.mode || '1080p5000').trim()
		const spec = STANDARD_VIDEO_MODES[modeId]
		const baseW = spec?.width ?? 1920
		const baseH = spec?.height ?? 1080
		const baseFps = spec?.fps ?? inferRefreshHzFromCasparMode(modeId) ?? 50

		const oid = String(outDef.id || '').trim()
		const slice = mappings.find((m) => String(m?.outputId || '') === oid)
		const rx = Number(slice?.rect?.x)
		const ry = Number(slice?.rect?.y)
		const rw = Number(slice?.rect?.w)
		const rh = Number(slice?.rect?.h)
		const x = Number.isFinite(rx) ? rx : 0
		const y = Number.isFinite(ry) ? ry : 0
		const w = Number.isFinite(rw) && rw > 0 ? rw : baseW
		const h = Number.isFinite(rh) && rh > 0 ? rh : baseH

		const headMode = String(node.settings?.osXrandrHeadMode || 'slice').toLowerCase()
		let union = unionCache.get(nodeId)
		if (union === undefined) {
			union = computePixelMappingCanvasUnion(node)
			unionCache.set(nodeId, union)
		}
		let mode = `${w}x${h}`
		let rate = Number.isFinite(baseFps) && baseFps > 0 ? baseFps : inferRefreshHzFromCasparMode(modeId)
		if (headMode === 'canvas' && union && union.width > 0 && union.height > 0) {
			mode = `${union.width}x${union.height}`
			const uHz = Number(union.fps)
			rate = Number.isFinite(uHz) && uHz > 0 ? uHz : inferRefreshHzFromCasparMode(modeId)
		}

		mappingGpuOutputs.push({
			sysId,
			x,
			y,
			width: w,
			height: h,
			mode,
			rate: rate != null && Number.isFinite(Number(rate)) ? Number(rate) : null,
			backend: 'xrandr',
			nodeId,
			mapOutId: String(src.id || ''),
			outputId: oid || undefined,
		})
	}

	if (!mappingGpuOutputs.length) {
		return { mappingGpuOutputs: [], mappingGpuBBox: null }
	}

	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const r of mappingGpuOutputs) {
		minX = Math.min(minX, r.x)
		minY = Math.min(minY, r.y)
		maxX = Math.max(maxX, r.x + r.width)
		maxY = Math.max(maxY, r.y + r.height)
	}
	const mappingGpuBBox =
		Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
			? { minX, minY, maxX, maxY }
			: null

	return { mappingGpuOutputs, mappingGpuBBox }
}

module.exports = {
	buildMappingGpuLayoutArtifacts,
	resolveOutputDefForMapOutConnector,
	computePixelMappingCanvasUnion,
}

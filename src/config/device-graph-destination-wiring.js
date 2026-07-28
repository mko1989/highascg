'use strict'

const { normalizeDeviceGraph } = require('./device-graph')
const { destinationsFromConfig } = require('./screen-destinations')
const { collectDestinationOutputEdges, readEdgeOutputLayer } = require('./device-graph-output-mapping')

/**
 * @param {object} appConfig
 */
function createDestinationWiringContext(appConfig) {
	const g = normalizeDeviceGraph(appConfig?.deviceGraph)
	const byId = new Map((g.connectors || []).map((c) => [String(c?.id || ''), c]))
	/** @type {Map<string, string[]>} */
	const outgoing = new Map()
	/** WO-364: same map minus PRV edges (note outputLayer >= 2) — used when deciding the PGM
	 * screen consumer, so a PRV-only GPU cable never force-enables screen_N's consumer. */
	const outgoingPgm = new Map()
	for (const e of g.edges || []) {
		const src = String(e?.sourceId || '')
		if (!src) continue
		if (!outgoing.has(src)) outgoing.set(src, [])
		outgoing.get(src).push(String(e?.sinkId || ''))
		if (readEdgeOutputLayer(e) < 2) {
			if (!outgoingPgm.has(src)) outgoingPgm.set(src, [])
			outgoingPgm.get(src).push(String(e?.sinkId || ''))
		}
	}
	return {
		g,
		byId,
		outgoing,
		outgoingPgm,
		destinations: destinationsFromConfig(appConfig || {}),
	}
}

/**
 * @param {object} dest
 * @param {number} destIndex
 * @param {ReturnType<typeof createDestinationWiringContext>} ctx
 */
function destinationSourceIds(dest, destIndex, ctx) {
	const out = new Set()
	const did = String(dest?.id || '').trim()
	if (did) out.add(`dst_in_${did}`)
	const n = destIndex + 1
	out.add(`dst_ch${n}`)
	if (String(dest?.mode || '') === 'multiview') out.add(`dst_mv${n}`)
	for (const c of ctx.g.connectors || []) {
		if (String(c?.kind || '') !== 'destination_in') continue
		const ref = String(c?.externalRef || '').trim()
		const cid = String(c?.id || '').trim()
		if (did && ref === did && cid) out.add(cid)
	}
	return [...out].filter(Boolean)
}

/**
 * @param {string} sourceId
 * @param {ReturnType<typeof createDestinationWiringContext>} ctx
 */
function reachesGpuFromSource(sourceId, ctx, opts = {}) {
	const queue = [String(sourceId || '')]
	const seen = new Set()
	const edgeMap = opts.pgmOnly && ctx.outgoingPgm ? ctx.outgoingPgm : ctx.outgoing
	while (queue.length) {
		const cur = queue.shift()
		if (!cur || seen.has(cur)) continue
		seen.add(cur)
		const next = edgeMap.get(cur) || []
		for (const sinkId of next) {
			const sink = ctx.byId.get(String(sinkId || ''))
			if (!sink) continue
			if (sink.kind === 'gpu_out') return true
			if (sink.kind === 'pixel_map_in') {
				const nodeId = String(sink.deviceId || '')
				const nodeOut = (ctx.g.connectors || []).filter(
					(c) => String(c?.deviceId || '') === nodeId && c?.kind === 'pixel_map_out',
				)
				for (const no of nodeOut) queue.push(String(no?.id || ''))
			}
		}
	}
	return false
}

/**
 * @param {object} dest
 * @param {number} destIndex
 * @param {ReturnType<typeof createDestinationWiringContext>} ctx
 */
function destinationReachesGpu(dest, destIndex, ctx) {
	return destinationSourceIds(dest, destIndex, ctx).some((src) => reachesGpuFromSource(src, ctx))
}

/**
 * @param {object} appConfig
 * @param {string} destinationId
 */
function destinationHasStreamOrRecordOutput(appConfig, destinationId) {
	const id = String(destinationId || '').trim()
	if (!id) return false
	return collectDestinationOutputEdges(appConfig).some(
		(e) => e.destinationId === id && (e.sink.kind === 'stream_out' || e.sink.kind === 'record_out'),
	)
}

/**
 * @param {object} dest
 * @param {number} destIndex
 * @param {ReturnType<typeof createDestinationWiringContext>} ctx
 */
function destinationHasDecklinkOutput(dest, destIndex, ctx) {
	for (const src of destinationSourceIds(dest, destIndex, ctx)) {
		const queue = [src]
		const seen = new Set()
		while (queue.length) {
			const cur = queue.shift()
			if (!cur || seen.has(cur)) continue
			seen.add(cur)
			for (const sinkId of ctx.outgoing.get(cur) || []) {
				const sink = ctx.byId.get(String(sinkId || ''))
				if (!sink) continue
				if (sink.kind === 'decklink_io' || sink.kind === 'decklink_out') return true
			}
		}
	}
	return false
}

/**
 * @param {object} appConfig
 * @param {object} dest
 * @param {number} destIndex
 */
function getDestinationOutputWiring(appConfig, dest, destIndex) {
	const ctx = createDestinationWiringContext(appConfig)
	return {
		gpu: destinationReachesGpu(dest, destIndex, ctx),
		stream: destinationHasStreamOrRecordOutput(appConfig, dest.id),
		decklink: destinationHasDecklinkOutput(dest, destIndex, ctx),
	}
}

/**
 * @param {{ gpu?: boolean, decklink?: boolean, stream?: boolean, streamingEnabled?: boolean }} w
 */
function deriveMultiviewOutputProfile(w) {
	const hasGpu = !!w.gpu
	const hasDeck = !!w.decklink
	const hasStream = !!w.stream && w.streamingEnabled !== false
	if (hasGpu && hasDeck && hasStream) return 'screen_stream_decklink'
	if (hasGpu && hasDeck) return 'screen_decklink'
	if (hasGpu && hasStream) return 'screen_stream'
	if (hasGpu) return 'screen_only'
	if (hasDeck && hasStream) return 'decklink_stream'
	if (hasDeck) return 'decklink_only'
	if (hasStream) return 'stream_only'
	return 'disabled'
}

/**
 * Device View graph → multiview screen / output profile (per multiview destination index).
 * @param {Record<string, unknown>} merged
 * @param {Record<string, unknown>} appConfig
 */
function applyMultiviewOutputOverridesFromCabling(merged, appConfig) {
	const g = appConfig?.deviceGraph
	if (!g || !Array.isArray(g.connectors)) return

	const ctx = createDestinationWiringContext(appConfig)
	const mvDests = ctx.destinations.filter((d) => String(d?.mode || '') === 'multiview')
	if (!mvDests.length) return

	const streamingOn =
		merged.streaming && merged.streaming.enabled !== false && merged.streaming.enabled !== 'false'

	for (let idx = 0; idx < mvDests.length; idx++) {
		const n = idx + 1
		const dest = mvDests[idx]
		const wiring = getDestinationOutputWiring(appConfig, dest, idx)
		const deckDev =
			parseInt(String(merged[`multiview_${n}_decklink_device`] || merged.multiview_decklink_device || '0'), 10) ||
			0
		const hasDeck = deckDev > 0 || wiring.decklink

		merged[`multiview_${n}_screen_consumer`] = wiring.gpu
		if (n === 1) merged.multiview_screen_consumer = wiring.gpu

		const profile = deriveMultiviewOutputProfile({
			gpu: wiring.gpu,
			decklink: hasDeck,
			stream: wiring.stream,
			streamingEnabled: streamingOn,
		})
		merged[`multiview_${n}_output_mode`] = profile
		if (n === 1) merged.multiview_output_mode = profile
	}
}

module.exports = {
	createDestinationWiringContext,
	destinationSourceIds,
	reachesGpuFromSource,
	destinationReachesGpu,
	destinationHasStreamOrRecordOutput,
	destinationHasDecklinkOutput,
	getDestinationOutputWiring,
	deriveMultiviewOutputProfile,
	applyMultiviewOutputOverridesFromCabling,
}

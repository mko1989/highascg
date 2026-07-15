'use strict'

const { normalizeDeviceGraph, isCasparOutputConnector } = require('./device-graph')
const { normalizeVirtualCameraConfig } = require('../virtual-output/v4l2-bridge-config')
const { resolveInputTargetToChannel } = require('./rtmp-output')
const { normalizeScreenDestinations } = require('./screen-destinations')

/**
 * @param {object} edge
 */
function readEdgeOutputLayer(edge) {
	const raw = edge?.note
	if (raw == null || raw === '') return 1
	if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(1, Math.round(raw))
	const s = String(raw || '').trim()
	if (!s) return 1
	try {
		const parsed = JSON.parse(s)
		const n = Number(parsed?.outputLayer)
		return Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1
	} catch {
		const m = s.match(/outputLayer\s*[:=]\s*(\d+)/i)
		return m ? Math.max(1, parseInt(m[1], 10) || 1) : 1
	}
}

/**
 * @param {object} destination
 */
function destinationToVideoSource(destination) {
	const mode = String(destination?.mode || 'pgm_prv')
	const mainIndex = Math.max(0, parseInt(String(destination?.mainScreenIndex ?? 0), 10) || 0)
	if (mode === 'multiview') return 'multiview'
	// WO-242: pixelmap is a PGM-only program bus too (dedicated channel), same source-id shape as pgm_only.
	if (mode === 'pgm_only' || mode === 'pgm_prv' || mode === 'pixelmap') return `program_${mainIndex + 1}`
	return 'program_1'
}

/**
 * Destination → Caspar output edges (stream, record, decklink, …).
 * @param {object} config
 */
function collectDestinationOutputEdges(config) {
	const graph = normalizeDeviceGraph(config?.deviceGraph)
	const byConn = new Map((graph.connectors || []).map((c) => [String(c.id), c]))
	const byDestId = new Map(
		(normalizeScreenDestinations(config?.screenDestinations).destinations || []).map((d) => [String(d?.id || ''), d]),
	)
	return (Array.isArray(graph.edges) ? graph.edges : [])
		.map((e) => {
			const source = byConn.get(String(e?.sourceId || ''))
			const sink = byConn.get(String(e?.sinkId || ''))
			if (!source || !sink) return null
			if (source.kind !== 'destination_in') return null
			if (!isCasparOutputConnector(sink)) return null
			const destinationId = String(source.externalRef || '').trim()
			if (!destinationId) return null
			const destination = byDestId.get(destinationId)
			if (!destination) return null
			const mainIndex = Math.max(0, parseInt(String(destination.mainScreenIndex ?? 0), 10) || 0)
			return {
				edge: e,
				sink,
				destinationId,
				destination,
				mode: String(destination.mode || 'pgm_prv'),
				mainIndex,
				layer: readEdgeOutputLayer(e),
				videoSource: destinationToVideoSource(destination),
			}
		})
		.filter(Boolean)
}

/**
 * Sync `streamingChannel.videoSource` and `recordOutputs[].source` from graph cabling.
 * Graph edges win over stale `program_1` defaults in persisted JSON.
 * @param {object} config - mutated in place
 * @returns {{ changed: boolean }}
 */
function applyStreamRecordMappingsFromGraph(config) {
	if (!config || typeof config !== 'object') return { changed: false }
	const edges = collectDestinationOutputEdges(config)
	if (!edges.length) return { changed: false }

	const groupedStreams = new Map()
	const groupedRecords = new Map()
	for (const item of edges) {
		if (item.sink.kind === 'stream_out') {
			const k = String(item.sink.id || '')
			if (!groupedStreams.has(k)) groupedStreams.set(k, [])
			groupedStreams.get(k).push(item)
		} else if (item.sink.kind === 'record_out') {
			const k = String(item.sink.id || '')
			if (!groupedRecords.has(k)) groupedRecords.set(k, [])
			groupedRecords.get(k).push(item)
		}
	}

	let changed = false

	for (const [, list] of groupedStreams.entries()) {
		const winner = list.slice().sort((a, b) => a.layer - b.layer)[0]
		if (!winner) continue
		if (!config.streamingChannel || typeof config.streamingChannel !== 'object') {
			config.streamingChannel = {}
		}
		const sc = config.streamingChannel
		if (String(sc.videoSource || '') !== winner.videoSource) {
			sc.videoSource = winner.videoSource
			changed = true
		}
		const sink = winner.sink || {}
		const q = String(sink?.caspar?.quality || '').trim()
		const url = String(sink?.caspar?.rtmpServerUrl || '').trim()
		const key = String(sink?.caspar?.streamKey || '').trim()
		if (q && sc.quality !== q) {
			sc.quality = q
			changed = true
		}
		if (url && sc.rtmpServerUrl !== url) {
			sc.rtmpServerUrl = url
			changed = true
		}
		if (key && sc.streamKey !== key) {
			sc.streamKey = key
			changed = true
		}
	}

	if (groupedRecords.size) {
		const next = Array.isArray(config.recordOutputs)
			? config.recordOutputs.map((x) => ({ ...x }))
			: []
		for (const [recordId, list] of groupedRecords.entries()) {
			const winner = list.slice().sort((a, b) => a.layer - b.layer)[0]
			if (!winner) continue
			const idx = next.findIndex((x) => String(x?.id || '') === recordId)
			if (idx >= 0) {
				if (String(next[idx].source || '') !== winner.videoSource) {
					next[idx] = { ...next[idx], source: winner.videoSource }
					changed = true
				}
			} else {
				next.push({
					id: recordId,
					label: recordId,
					enabled: true,
					name: recordId,
					source: winner.videoSource,
					crf: 26,
					videoCodec: 'h264',
					videoBitrateKbps: 4500,
					encoderPreset: 'veryfast',
					audioCodec: 'aac',
					audioBitrateKbps: 128,
				})
				changed = true
			}
		}
		if (changed) config.recordOutputs = next
	}

	return { changed }
}

/**
 * When a destination is cabled to v4l2_out, set virtualCamera.channel from that destination's video source.
 * @param {object} config - mutated in place
 * @returns {{ changed: boolean, channel?: number, videoSource?: string }}
 */
function applyVirtualCameraMappingsFromGraph(config) {
	if (!config || typeof config !== 'object') return { changed: false }
	const edges = collectDestinationOutputEdges(config).filter((e) => e.sink.kind === 'v4l2_out')
	if (!edges.length) return { changed: false }

	const winner = edges.slice().sort((a, b) => a.layer - b.layer)[0]
	if (!winner) return { changed: false }

	const ch = resolveInputTargetToChannel(config, winner.videoSource)
	if (ch == null || !Number.isFinite(ch) || ch < 1) return { changed: false }

	const cur = normalizeVirtualCameraConfig(config.virtualCamera)
	if (cur.channel === ch) return { changed: false, channel: ch, videoSource: winner.videoSource }

	config.virtualCamera = normalizeVirtualCameraConfig({ ...cur, channel: ch })
	return { changed: true, channel: ch, videoSource: winner.videoSource }
}

module.exports = {
	readEdgeOutputLayer,
	destinationToVideoSource,
	collectDestinationOutputEdges,
	applyStreamRecordMappingsFromGraph,
	applyVirtualCameraMappingsFromGraph,
}

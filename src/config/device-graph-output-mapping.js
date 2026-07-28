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
function destinationToVideoSource(destination, outputLayer) {
	const mode = String(destination?.mode || 'pgm_prv')
	const mainIndex = Math.max(0, parseInt(String(destination?.mainScreenIndex ?? 0), 10) || 0)
	if (mode === 'multiview') return 'multiview'
	/* WO-364: the PRV bus is a real Caspar channel — an edge cabled from the destination's PRV
	 * half (outputLayer 2, same note convention as the DeckLink "PRV:" labels) feeds preview_N.
	 * Only pgm_prv has a preview bus; pgm_only/pixelmap stay program-only. */
	if (mode === 'pgm_prv' && Number(outputLayer) >= 2) return `preview_${mainIndex + 1}`
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
		(normalizeScreenDestinations(config?.screenDestinations).destinations || []).map((d) => [String(d?.id || ''), d])
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
			if (!destination) {
				/* todos28.07.26 (owner): "i connected decklink input 4 host channel to a virtual
				 * camera output and on the output there is channel 1 ... it defaults to 1 instead of
				 * using the connection to determine the channel."
				 *
				 * HOST-CHANNEL destinations (decklink/live-audio input buses) are VIRTUAL — they are
				 * built for Device View from the channel map, never persisted into
				 * `screenDestinations`. So this lookup missed and the edge was dropped on the floor:
				 * the cable existed in the graph and meant nothing downstream. The connector itself
				 * carries the answer (`caspar.hostChannel`), so resolve from it instead.
				 *
				 * Such an edge has no `program_N`/`preview_N` name — `videoSource` stays null and
				 * consumers that write a source STRING must skip it (only the ones that take a
				 * channel NUMBER, i.e. the virtual camera, can honour it today). */
				const hostChannel = Math.max(0, parseInt(String(source?.caspar?.hostChannel ?? 0), 10) || 0)
				if (!hostChannel) return null
				return {
					edge: e,
					sink,
					destinationId,
					destination: null,
					mode: 'host_channel',
					mainIndex: 0,
					layer: readEdgeOutputLayer(e),
					videoSource: null,
					hostChannel,
				}
			}
			const mainIndex = Math.max(0, parseInt(String(destination.mainScreenIndex ?? 0), 10) || 0)
			const layer = readEdgeOutputLayer(e)
			return {
				edge: e,
				sink,
				destinationId,
				destination,
				mode: String(destination.mode || 'pgm_prv'),
				mainIndex,
				layer,
				videoSource: destinationToVideoSource(destination, layer),
				hostChannel: null,
			}
		})
		.filter(Boolean)
}

/**
 * WO-373 — which cable feeds an output when several land on the same sink.
 *
 * Owner, todos21.07.26: *"i connected pgm2 to rec output and pgm1 got recorded."* The old rule was
 * `list.sort((a, b) => a.layer - b.layer)[0]` — layer 1 (PGM) before layer 2 (PRV), which is right,
 * but two edges at the SAME layer compare equal and V8's sort is stable, so the winner was
 * whichever edge sat earliest in the graph: the cable cabled FIRST won, permanently. Cabling a
 * second destination to the same record output changed the UI and nothing else.
 *
 * A caspar output takes exactly one feed — `addEdgeToGraph` rejects a second edge to any
 * `record_out`/`stream_out`/`gpu_out`… with `sink_already_connected`
 * (src/config/device-graph-edges.js). Two same-layer edges on one sink is therefore a DATA ERROR,
 * reachable only through a whole-graph write that skips that rule (matrix view did exactly this
 * until WO-373; also config import and hand edits). So: pick deterministically by what the
 * operator means — the most recently cabled edge, i.e. the LAST in graph order — and say so in the
 * log rather than resolving it silently.
 *
 * @param {Array<object>} list edges landing on one sink (from collectDestinationOutputEdges)
 * @param {string} sinkId for the warning
 * @param {(msg: string) => void} [warn]
 * @returns {object | null}
 */
function pickOutputEdgeWinner(list, sinkId, warn) {
	const arr = (Array.isArray(list) ? list : []).filter(Boolean)
	if (arr.length <= 1) return arr[0] || null

	const layerOf = (e) => Math.max(1, Number(e?.layer) || 1)
	const minLayer = Math.min(...arr.map(layerOf))
	const sameLayer = arr.filter((e) => layerOf(e) === minLayer)
	const winner = sameLayer[sameLayer.length - 1]

	if (sameLayer.length > 1) {
		const say =
			typeof warn === 'function'
				? warn
				: (m) => {
						if (typeof console !== 'undefined') console.warn(m)
					}
		say(
			`[device-graph] ${sameLayer.length} cables feed ${sinkId || 'one output'} at the same layer ` +
				`(${sameLayer.map((e) => `${e.destinationId}→${e.videoSource}`).join(', ')}). An output takes ONE feed — ` +
				`using the most recently cabled (${winner.destinationId}→${winner.videoSource}). Remove the stale cable(s) in Device View.`
		)
	}
	return winner
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

	for (const [streamSinkId, list] of groupedStreams.entries()) {
		const winner = pickOutputEdgeWinner(list, streamSinkId)
		if (!winner) continue
		// todos28.07.26: host-channel sources have no program_N/preview_N name — `videoSource` is
		// the string this writes into config, so an unnameable source must be left alone rather
		// than blanking a working one.
		if (!winner.videoSource) continue
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
		if (q && sc.quality !== q) {
			sc.quality = q
			changed = true
		}
		// WO-261: stream credentials (rtmpServerUrl/streamKey) are project-scoped and live in the
		// active project ONLY. They are deliberately NOT copied from the device graph into config here —
		// doing so would resurrect a key in config after the one-shot migration blanked it.
	}

	if (groupedRecords.size) {
		const next = Array.isArray(config.recordOutputs) ? config.recordOutputs.map((x) => ({ ...x })) : []
		for (const [recordId, list] of groupedRecords.entries()) {
			const winner = pickOutputEdgeWinner(list, recordId)
			if (!winner) continue
			if (!winner.videoSource) continue // see the stream guard above
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

	const winner = pickOutputEdgeWinner(edges, edges[0]?.sink?.id || 'v4l2_out')
	if (!winner) return { changed: false }

	/* todos28.07.26: a host-channel source (decklink/live-audio input bus) knows its Caspar
	 * channel outright — it has no program_N name to resolve. */
	const ch = winner.hostChannel || resolveInputTargetToChannel(config, winner.videoSource)
	if (ch == null || !Number.isFinite(ch) || ch < 1) return { changed: false }

	const cur = normalizeVirtualCameraConfig(config.virtualCamera)
	if (cur.channel === ch) return { changed: false, channel: ch, videoSource: winner.videoSource }

	config.virtualCamera = normalizeVirtualCameraConfig({ ...cur, channel: ch })
	return { changed: true, channel: ch, videoSource: winner.videoSource }
}

module.exports = {
	readEdgeOutputLayer,
	pickOutputEdgeWinner,
	destinationToVideoSource,
	collectDestinationOutputEdges,
	applyStreamRecordMappingsFromGraph,
	applyVirtualCameraMappingsFromGraph,
}

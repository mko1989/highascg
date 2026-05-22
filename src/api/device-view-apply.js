/**
 * Device View "Apply" dry-run planning and execution.
 */
'use strict'

const { applyCasparConfigToDiskAndRestart } = require('./routes-caspar-config')
const { normalizeDeviceGraph } = require('../config/device-graph')
const { normalizeScreenDestinations } = require('../config/screen-destinations')
const { getChannelMap } = require('../config/routing')
const { readDecklinkKeyFillFromConnectorCaspar, writeDecklinkKeyFillToCasparServer } = require('../config/decklink-key-fill')

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

function applyDestinationOutputEdgesToCasparConfig(ctx, plan) {
	const graph = normalizeDeviceGraph(ctx.config?.deviceGraph)
	const map = getChannelMap(ctx.config || {})
	const byConn = new Map((graph.connectors || []).map((c) => [String(c.id), c]))
	const byDestId = new Map((normalizeScreenDestinations(ctx.config?.screenDestinations).destinations || []).map((d) => [String(d?.id || ''), d]))
	const edges = Array.isArray(graph.edges) ? graph.edges : []
	const destinationEdges = edges
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
			const mode = String(destination.mode || 'pgm_prv')
			const mainIndex = Math.max(0, parseInt(String(destination.mainScreenIndex ?? 0), 10) || 0)
			const layer = readEdgeOutputLayer(e)
			return { edge: e, sink, destinationId, destination, mode, mainIndex, layer }
		})
		.filter(Boolean)
	if (!destinationEdges.length) return { changed: false, warnings: [] }

	const nextCaspar = { ...((ctx.config && ctx.config.casparServer) || {}) }
	const nextStreaming = { ...((ctx.config && typeof ctx.config.streamingChannel === 'object') ? ctx.config.streamingChannel : {}) }
	const nextRecordOutputs = Array.isArray(ctx.config?.recordOutputs) ? ctx.config.recordOutputs.map((x) => ({ ...x })) : []
	const warnings = []
	const groupedByTarget = new Map()
	const groupedStreams = new Map()
	const groupedRecords = new Map()
	for (const item of destinationEdges) {
		const sink = item.sink
		if (sink.kind === 'stream_out') {
			const k = String(sink.id || '')
			if (!groupedStreams.has(k)) groupedStreams.set(k, [])
			groupedStreams.get(k).push(item)
			continue
		}
		if (sink.kind === 'record_out') {
			const k = String(sink.id || '')
			if (!groupedRecords.has(k)) groupedRecords.set(k, [])
			groupedRecords.get(k).push(item)
			continue
		}
		if (sink.kind === 'audio_out') {
			const k = String(sink.id || '')
			// Audio outputs are handled by the generator scanning the graph, 
			// but we add them to the plan for visibility.
			plan.actions.push({
				kind: 'audio_output_mapping',
				destinationId: item.destinationId,
				target: k,
				deviceName: String(sink.externalRef || ''),
				edgeId: String(item.edge?.id || ''),
			})
			continue
		}
		// We only materialize physical DeckLink targets into Caspar config.
		if (sink.kind !== 'decklink_out' && sink.kind !== 'decklink_io') continue
		const deviceNum = parseInt(String(sink.externalRef || 0), 10) || 0
		if (deviceNum <= 0) continue
		const targetKey =
			item.mode === 'multiview'
				? 'multiview'
				: `screen_${Math.max(1, item.mainIndex + 1)}`
		if (!groupedByTarget.has(targetKey)) groupedByTarget.set(targetKey, [])
		groupedByTarget.get(targetKey).push({ ...item, deviceNum })
	}

	for (const [targetKey, list] of groupedByTarget.entries()) {
		const ordered = list.slice().sort((a, b) => a.layer - b.layer)
		const winner = ordered[0]
		if (ordered.length > 1) {
			const other = ordered.slice(1).map((x) => `${x.deviceNum}`).join(', ')
			warnings.push({
				code: 'multiple_outputs_same_target',
				message: `Multiple mapped outputs for ${targetKey}; using layer ${winner.layer} (DeckLink ${winner.deviceNum}), skipped: ${other}.`,
				destinationId: winner.destinationId,
				target: targetKey,
			})
		}
		const keyFill = readDecklinkKeyFillFromConnectorCaspar(winner.sink?.caspar)
		if (targetKey === 'multiview') {
			nextCaspar.multiview_decklink_device = winner.deviceNum
			writeDecklinkKeyFillToCasparServer(nextCaspar, 'multiview_', {
				fillDevice: winner.deviceNum,
				keyDevice: keyFill.enabled ? keyFill.keyDevice : 0,
				keyer: keyFill.keyer,
			})
		} else {
			const n = parseInt(String(targetKey.replace(/^screen_/, '')), 10) || 1
			const prefix = `screen_${n}_`
			nextCaspar[`${prefix}decklink_device`] = winner.deviceNum
			nextCaspar[`${prefix}decklink_replace_screen`] = true
			writeDecklinkKeyFillToCasparServer(nextCaspar, prefix, {
				fillDevice: winner.deviceNum,
				keyDevice: keyFill.enabled ? keyFill.keyDevice : 0,
				keyer: keyFill.keyer,
			})
		}
		plan.actions.push({
			kind: 'caspar_output_mapping',
			destinationId: winner.destinationId,
			target: targetKey,
			decklinkDevice: winner.deviceNum,
			decklinkKeyDevice: keyFill.enabled ? keyFill.keyDevice : 0,
			decklinkKeyer: keyFill.enabled ? keyFill.keyer : null,
			layer: winner.layer,
			edgeId: String(winner.edge?.id || ''),
		})
	}
	for (const [streamId, list] of groupedStreams.entries()) {
		const ordered = list.slice().sort((a, b) => a.layer - b.layer)
		const winner = ordered[0]
		if (ordered.length > 1) {
			warnings.push({
				code: 'multiple_stream_sources',
				message: `Multiple mapped sources for ${streamId}; using layer ${winner.layer}.`,
				destinationId: winner.destinationId,
				target: streamId,
			})
		}
		let source = 'program_1'
		if (winner.mode === 'multiview') source = 'multiview'
		else if (winner.mode === 'pgm_only' || winner.mode === 'pgm_prv') source = `program_${Math.max(1, winner.mainIndex + 1)}`
		nextStreaming.enabled = true
		nextStreaming.videoSource = source
		const sink = winner.sink || {}
		const q = String(sink?.caspar?.quality || '').trim()
		const url = String(sink?.caspar?.rtmpServerUrl || '').trim()
		const key = String(sink?.caspar?.streamKey || '').trim()
		if (q) nextStreaming.quality = q
		if (url) nextStreaming.rtmpServerUrl = url
		if (key) nextStreaming.streamKey = key
		plan.actions.push({
			kind: 'stream_output_mapping',
			destinationId: winner.destinationId,
			target: streamId,
			videoSource: source,
			layer: winner.layer,
			edgeId: String(winner.edge?.id || ''),
		})
	}
	for (const [recordId, list] of groupedRecords.entries()) {
		const ordered = list.slice().sort((a, b) => a.layer - b.layer)
		const winner = ordered[0]
		if (ordered.length > 1) {
			warnings.push({
				code: 'multiple_record_sources',
				message: `Multiple mapped sources for ${recordId}; using layer ${winner.layer}.`,
				destinationId: winner.destinationId,
				target: recordId,
			})
		}
		let source = 'program_1'
		if (winner.mode === 'multiview') source = 'multiview'
		else if (winner.mode === 'pgm_only' || winner.mode === 'pgm_prv') source = `program_${Math.max(1, winner.mainIndex + 1)}`
		const idx = nextRecordOutputs.findIndex((x) => String(x?.id || '') === recordId)
		if (idx >= 0) nextRecordOutputs[idx] = { ...nextRecordOutputs[idx], source }
		else {
			nextRecordOutputs.push({
				id: recordId,
				label: recordId,
				enabled: true,
				name: recordId,
				source,
				crf: 26,
				videoCodec: 'h264',
				videoBitrateKbps: 4500,
				encoderPreset: 'veryfast',
				audioCodec: 'aac',
				audioBitrateKbps: 128,
			})
		}
		plan.actions.push({
			kind: 'record_output_mapping',
			destinationId: winner.destinationId,
			target: recordId,
			source,
			layer: winner.layer,
			edgeId: String(winner.edge?.id || ''),
		})
	}

	const changed = JSON.stringify(nextCaspar) !== JSON.stringify(ctx.config?.casparServer || {})
	const streamChanged = JSON.stringify(nextStreaming) !== JSON.stringify((ctx.config && ctx.config.streamingChannel) || {})
	const recordChanged = JSON.stringify(nextRecordOutputs) !== JSON.stringify(Array.isArray(ctx.config?.recordOutputs) ? ctx.config.recordOutputs : [])
	if (changed) {
		if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), casparServer: nextCaspar })
		ctx.config.casparServer = nextCaspar
	}
	if (streamChanged) {
		if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), streamingChannel: nextStreaming })
		ctx.config.streamingChannel = nextStreaming
	}
	if (recordChanged) {
		if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), recordOutputs: nextRecordOutputs })
		ctx.config.recordOutputs = nextRecordOutputs
	}
	return { changed: changed || streamChanged || recordChanged, warnings }
}

function buildApplyDryRunPlan(ctx) {
	const top = normalizeScreenDestinations(ctx.config?.screenDestinations)
	const map = getChannelMap(ctx.config || {})
	const blockers = []
	const warnings = []
	const actions = []
	const byDestination = []

	for (const d of top.destinations || []) {
		if (!d) continue
		const did = String(d.id || '')
		const label = d.label || did
		const mainIdx = Math.max(0, parseInt(d.mainScreenIndex, 10) || 0)
		const modeRaw = String(d.mode || 'pgm_prv')
		const mode =
			modeRaw === 'pgm_only' ? 'pgm_only' : modeRaw === 'multiview' ? 'multiview' : modeRaw === 'stream' ? 'stream' : 'pgm_prv'
		if (mode === 'stream') {
			const dActions = [
				{
					kind: 'streaming_channel_config',
					destinationId: did,
					stream: {
						type: String(d?.stream?.type || 'rtmp'),
						source: String(d?.stream?.source || 'program_1'),
						url: String(d?.stream?.url || ''),
						key: String(d?.stream?.key || ''),
						quality: String(d?.stream?.quality || 'medium'),
					},
				},
			]
			actions.push(...dActions)
			byDestination.push({
				id: did,
				label,
				mainIndex: null,
				mode,
				bus: null,
				pgmCh: null,
				prvCh: null,
				cableEdgeId: null,
				blockers: [],
				warnings: [],
				actions: dActions,
			})
			continue
		}
		const bus = d.caspar?.bus === 'prv' ? 'prv' : 'pgm'
		const dActions = [
			{
				kind: 'caspar_config_screen_mode',
				destinationId: did,
				mainIndex: mainIdx,
				screen: mainIdx + 1,
				videoMode: d.videoMode || '1080p5000',
				width: d.width || 1920,
				height: d.height || 1080,
				fps: d.fps || 50,
				channelIntent: {
					pgmCh: mode === 'multiview' ? map.multiviewCh : map.programChannels[mainIdx],
					prvCh: mode === 'pgm_only' || mode === 'multiview' ? null : map.previewChannels[mainIdx],
					mode,
				},
			},
		]
		actions.push(...dActions)
		byDestination.push({
			id: did,
			label,
			mainIndex: mainIdx,
			mode,
			bus,
			pgmCh: mode === 'multiview' ? map.multiviewCh : map.programChannels[mainIdx],
			prvCh: mode === 'pgm_only' || mode === 'multiview' ? null : map.previewChannels[mainIdx],
			cableEdgeId: null,
			blockers: [],
			warnings: [],
			actions: dActions,
		})
	}
	return { canApply: blockers.length === 0, blockers, warnings, actions, byDestination }
}

async function executeApplyPlan(ctx, opts = {}) {
	const plan = buildApplyDryRunPlan(ctx); const executed = [], skipped = [], errors = []
	const mappingRes = applyDestinationOutputEdgesToCasparConfig(ctx, plan)
	if (mappingRes && Array.isArray(mappingRes.warnings) && mappingRes.warnings.length) {
		plan.warnings.push(...mappingRes.warnings)
	}
	const streamAction = plan.actions.find((a) => a.kind === 'streaming_channel_config')
	if (streamAction) {
		const stream = streamAction.stream || {}
		const prev = (ctx.config && typeof ctx.config.streamingChannel === 'object') ? ctx.config.streamingChannel : {}
		const nextStreaming = {
			...prev,
			enabled: true,
			videoSource: String(stream.source || 'program_1'),
		}
		if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), streamingChannel: nextStreaming })
		ctx.config.streamingChannel = nextStreaming
		executed.push({ kind: 'streaming_channel_config', destinationId: streamAction.destinationId, videoSource: nextStreaming.videoSource })
	}
	let casparResult = { attempted: false, ok: false, message: '' }
	if (opts.applyCaspar !== false) {
		casparResult.attempted = true; try {
			const res = await applyCasparConfigToDiskAndRestart(ctx); const body = JSON.parse(String(res.body || '{}'))
			casparResult.ok = res.status < 300 && !body.error; casparResult.message = body.message || body.error || `Status ${res.status}`
		} catch (e) { casparResult.ok = false; casparResult.message = e.message; errors.push({ kind: 'caspar_apply', error: e.message }) }
	}
	return { ok: casparResult.ok && !errors.length, plan, caspar: casparResult, executed, skipped, errors }
}

module.exports = { buildApplyDryRunPlan, executeApplyPlan }

/**
 * Device View "Apply" dry-run planning and execution.
 */
'use strict'

const { applyCasparConfigToDiskAndRestart } = require('./routes-caspar-config')
const { normalizeScreenDestinations } = require('../config/screen-destinations')
const { getChannelMap } = require('../config/routing')
const { readDecklinkKeyFillFromConnectorCaspar, writeDecklinkKeyFillToCasparServer } = require('../config/decklink-key-fill')
const {
	collectDestinationOutputEdges,
	applyStreamRecordMappingsFromGraph,
	applyVirtualCameraMappingsFromGraph,
} = require('../config/device-graph-output-mapping')
const { getDestinationOutputWiring } = require('../config/device-graph-destination-wiring')
const { destinationsFromConfig } = require('../config/screen-destinations')

function applyDestinationOutputEdgesToCasparConfig(ctx, plan) {
	const destinationEdges = collectDestinationOutputEdges(ctx.config || {})
	if (!destinationEdges.length) return { changed: false, warnings: [] }

	const nextCaspar = { ...((ctx.config && ctx.config.casparServer) || {}) }
	const streamSync = {
		deviceGraph: ctx.config?.deviceGraph,
		screenDestinations: ctx.config?.screenDestinations,
		streamingChannel: { ...((ctx.config && ctx.config.streamingChannel) || {}) },
		recordOutputs: Array.isArray(ctx.config?.recordOutputs) ? ctx.config.recordOutputs.map((x) => ({ ...x })) : [],
		virtualCamera: { ...((ctx.config && ctx.config.virtualCamera) || {}) },
	}
	const streamRecordRes = applyStreamRecordMappingsFromGraph(streamSync)
	const vcamRes = applyVirtualCameraMappingsFromGraph(streamSync)
	const nextStreaming = streamSync.streamingChannel
	const nextRecordOutputs = streamSync.recordOutputs
	const nextVirtualCamera = streamSync.virtualCamera
	const warnings = []
	const groupedByTarget = new Map()

	for (const item of destinationEdges) {
		const sink = item.sink
		if (sink.kind === 'v4l2_out') {
			plan.actions.push({
				kind: 'virtual_camera_mapping',
				destinationId: item.destinationId,
				target: String(sink.id || 'vcam_1'),
				videoSource: item.videoSource,
				layer: item.layer,
				edgeId: String(item.edge?.id || ''),
			})
			continue
		}
		if (sink.kind === 'stream_out' || sink.kind === 'record_out') {
			if (sink.kind === 'stream_out') {
				plan.actions.push({
					kind: 'stream_output_mapping',
					destinationId: item.destinationId,
					target: String(sink.id || ''),
					videoSource: item.videoSource,
					layer: item.layer,
					edgeId: String(item.edge?.id || ''),
				})
			} else {
				plan.actions.push({
					kind: 'record_output_mapping',
					destinationId: item.destinationId,
					target: String(sink.id || ''),
					source: item.videoSource,
					layer: item.layer,
					edgeId: String(item.edge?.id || ''),
				})
			}
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
			const destList = destinationsFromConfig(ctx.config || {})
			const destIdx = destList.findIndex((d) => String(d?.id || '') === String(winner.destinationId || ''))
			const dest = destIdx >= 0 ? destList[destIdx] : null
			const wiring = dest ? getDestinationOutputWiring(ctx.config || {}, dest, destIdx) : { gpu: false }
			nextCaspar[`${prefix}decklink_device`] = winner.deviceNum
			nextCaspar[`${prefix}decklink_replace_screen`] = !wiring.gpu
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
	const casparServerChanged = JSON.stringify(nextCaspar) !== JSON.stringify(ctx.config?.casparServer || {})
	const changed = casparServerChanged
	const streamChanged = streamRecordRes.changed || JSON.stringify(nextStreaming) !== JSON.stringify((ctx.config && ctx.config.streamingChannel) || {})
	const recordChanged = streamRecordRes.changed || JSON.stringify(nextRecordOutputs) !== JSON.stringify(Array.isArray(ctx.config?.recordOutputs) ? ctx.config.recordOutputs : [])
	const vcamChanged = vcamRes.changed || JSON.stringify(nextVirtualCamera) !== JSON.stringify(ctx.config?.virtualCamera || {})
	if (changed) {
		if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), casparServer: nextCaspar })
		ctx.config.casparServer = nextCaspar
	}
	if (streamChanged) {
		nextStreaming.enabled = true
		if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), streamingChannel: nextStreaming })
		ctx.config.streamingChannel = nextStreaming
	}
	if (recordChanged) {
		if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), recordOutputs: nextRecordOutputs })
		ctx.config.recordOutputs = nextRecordOutputs
	}
	if (vcamChanged) {
		if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), virtualCamera: nextVirtualCamera })
		ctx.config.virtualCamera = nextVirtualCamera
	}
	return {
		changed: changed || streamChanged || recordChanged || vcamChanged,
		warnings,
		// WO-172 T172.1/T172.3: exposed so callers (syncDeviceViewToCaspar) can skip the heavy
		// write+restart for stream/record/vcam-only syncs — only casparServer (DeckLink/screen
		// output mapping) changes require regenerating and restarting Caspar. Source-channel sync
		// (videoSource / recordOutputs[].source / virtualCamera.channel) is a config-write-only
		// operation; the next Start/PLAY reads the fresh config (A172.1).
		casparServerChanged,
		streamChanged,
		recordChanged,
		vcamChanged,
	}
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

module.exports = { buildApplyDryRunPlan, executeApplyPlan, applyDestinationOutputEdgesToCasparConfig }

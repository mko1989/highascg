'use strict'

const defaults = require('./defaults')
const { mergeAudioRoutingIntoConfig } = require('./config-generator')
const { normalizeRtmpConfig } = require('./rtmp-output')
const { resolveMainScreenCount, getChannelMap } = require('./routing-map')
const { STANDARD_VIDEO_MODES } = require('./config-modes')
const { normalizeTandemTopology } = require('./tandem-topology')

/**
 * @param {Record<string, unknown>} appConfig
 * @returns {Array<any>}
 */
function getDestinationList(appConfig) {
	const top = normalizeTandemTopology(appConfig && appConfig.tandemTopology)
	const list = Array.isArray(top?.destinations) ? top.destinations : []
	return list.filter((d) => d && typeof d === 'object')
}

/**
 * Project destination panel state into Caspar generator screen settings.
 * Priority: destination `videoMode` when standard, otherwise destination `width/height/fps` as custom mode.
 * @param {Record<string, unknown>} merged
 * @param {Record<string, unknown>} appConfig
 */
function applyDestinationOverridesToScreens(merged, appConfig) {
	const rawList =
		appConfig &&
			appConfig.tandemTopology &&
			typeof appConfig.tandemTopology === 'object' &&
			Array.isArray(appConfig.tandemTopology.destinations)
			? appConfig.tandemTopology.destinations
			: []
	const list = getDestinationList(appConfig)
	if (!list.length) return
	const routable = list.filter((d) => {
		const mode = String(d?.mode || 'pgm_prv')
		return mode !== 'multiview' && mode !== 'stream'
	})
	if (!routable.length) return
	const mainIdxs = routable.map((d) => Math.max(0, parseInt(String(d.mainScreenIndex ?? 0), 10) || 0))
	const dstCount = Math.max(...mainIdxs, 0) + 1
	merged.screen_count = Math.max(1, dstCount)

	const hasPanelOverrides = rawList.some(
		(d) => d && typeof d === 'object' && ('mode' in d || 'videoMode' in d || 'width' in d || 'height' in d || 'fps' in d)
	)
	if (!hasPanelOverrides) return
	for (let idx = 0; idx < merged.screen_count; idx++) {
		const perMain = routable.filter((d) => (parseInt(String(d.mainScreenIndex ?? 0), 10) || 0) === idx)
		if (!perMain.length) continue
		const picked = perMain.find((d) => String(d.mode || 'pgm_prv') === 'pgm_prv') || perMain[0]
		const modeRaw = String(picked.videoMode || '').trim()
		const width = Math.max(64, parseInt(String(picked.width ?? 0), 10) || 0)
		const height = Math.max(64, parseInt(String(picked.height ?? 0), 10) || 0)
		const fps = Math.max(1, parseFloat(String(picked.fps ?? 50)) || 50)
		const n = idx + 1
		if (modeRaw && STANDARD_VIDEO_MODES[modeRaw]) {
			merged[`screen_${n}_mode`] = modeRaw
			continue
		}
		if (width > 0 && height > 0) {
			merged[`screen_${n}_mode`] = 'custom'
			merged[`screen_${n}_custom_width`] = width
			merged[`screen_${n}_custom_height`] = height
			merged[`screen_${n}_custom_fps`] = fps
		}
	}
}

function applyDecklinkOverridesToScreens(merged, appConfig) {
	const g = appConfig?.deviceGraph
	if (!g || !Array.isArray(g.connectors)) return

	const edges = Array.isArray(g.edges) ? g.edges : []
	const destinations = Array.isArray(appConfig?.tandemTopology?.destinations) ? appConfig.tandemTopology.destinations : []

	g.connectors.forEach((c) => {
		if (c.kind !== 'decklink_io') return
		const devNum = parseInt(String(c.externalRef || ''), 10)
		if (!Number.isFinite(devNum) || devNum <= 0) return

		const incomingEdge = edges.find((e) => e.sinkId === c.id)
		if (!incomingEdge) {
			// Fallback to legacy binding if no cable exists
			if (c.caspar?.ioDirection !== 'out') return
			const binding = c.caspar?.outputBinding
			if (binding?.type === 'screen') {
				const n = Math.min(8, Math.max(1, parseInt(String(binding.index ?? 1), 10) || 1))
				merged[`screen_${n}_decklink_device`] = devNum
				if (merged[`screen_${n}_decklink_replace_screen`] === undefined) merged[`screen_${n}_decklink_replace_screen`] = true
			} else if (binding?.type === 'multiview') {
				merged.multiview_decklink_device = devNum
			}
			return
		}

		const sourceId = String(incomingEdge.sourceId || '')
		
		if (sourceId.startsWith('dst_in_')) {
			// Cabled to a Destination feed
			const destId = sourceId.slice('dst_in_'.length)
			const dest = destinations.find((d) => String(d.id) === destId)
			if (!dest) return
			if (String(dest.mode || '') === 'multiview') {
				merged.multiview_decklink_device = devNum
			} else {
				const idx = Number.isFinite(Number(dest.mainScreenIndex)) ? Number(dest.mainScreenIndex) : 0
				const n = idx + 1
				merged[`screen_${n}_decklink_device`] = devNum
				if (merged[`screen_${n}_decklink_replace_screen`] === undefined) merged[`screen_${n}_decklink_replace_screen`] = true
			}
		} else if (sourceId.startsWith('caspar_pgm_')) {
			// Cabled directly to a raw Caspar Program output
			const idx = parseInt(sourceId.slice('caspar_pgm_'.length), 10) - 1
			const n = idx + 1
			if (n > 0) {
				merged[`screen_${n}_decklink_device`] = devNum
				if (merged[`screen_${n}_decklink_replace_screen`] === undefined) merged[`screen_${n}_decklink_replace_screen`] = true
			}
		} else if (sourceId === 'caspar_mv_out') {
			merged.multiview_decklink_device = devNum
		}
	})
}

function applyAudioOutputOverridesToScreens(merged, appConfig) {
	const audioOutputs = Array.isArray(appConfig?.audioOutputs) ? appConfig.audioOutputs : []
	const destinations = Array.isArray(appConfig?.tandemTopology?.destinations) ? appConfig.tandemTopology.destinations : []
	const edges = Array.isArray(appConfig?.deviceGraph?.edges) ? appConfig.deviceGraph.edges : []

	if (audioOutputs.length > 0) {
		merged.caspar_global_portaudio = true
	}

	// Map each audio output to the corresponding screen in Caspar via cabling.
	audioOutputs.forEach((out) => {
		if (!out || !out.deviceName) return
		const id = String(out.id).trim()

		// Find edge pointing to this audio output
		const edge = edges.find((e) => String(e.sinkId) === id)
		if (!edge) return

		// Source is likely a destination feed: dst_in_DESTID
		const srcId = String(edge.sourceId)
		let destId = ''
		if (srcId.startsWith('dst_in_')) {
			destId = srcId.slice('dst_in_'.length)
		}

		const dest = destinations.find((d) => String(d.id) === destId)
		if (!dest) return

		const isMv = String(dest.mode || '') === 'multiview'
		const idx = Number.isFinite(Number(dest.mainScreenIndex)) ? Number(dest.mainScreenIndex) : 0
		const prefix = isMv ? 'multiview_' : `screen_${idx + 1}_`

		if (!merged[`${prefix}portaudio_consumers`]) {
			merged[`${prefix}portaudio_consumers`] = []
		}

		const layout = String(out.channelLayout || 'stereo')
		const chCount = layout === '16ch' ? 16 : layout === '8ch' ? 8 : layout === '4ch' ? 4 : 2

		const consumer = {
			deviceName: out.deviceName,
			hostApi: out.hostApi || 'auto',
			outputChannels: chCount,
			audioLayout: layout,
			bufferFrames: parseInt(String(out.bufferFrames), 10) || 128,
			latencyMs: parseInt(String(out.latencyMs), 10) || 40,
			fifoMs: parseInt(String(out.fifoMs), 10) || 50,
			autoTune: out.autoTuneLatency !== false && out.autoTuneLatency !== 'false',
		}

		merged[`${prefix}portaudio_consumers`.replace('__', '_')].push(consumer)
		merged[`${prefix}portaudio_enabled`] = true // Backward compat for checks

		// Ensure we are in custom_live profile if we are using PortAudio
		if (merged.caspar_build_profile === 'stock' || !merged.caspar_build_profile) {
			merged.caspar_build_profile = 'custom_live'
		}
	})
}

function applyMappingOverridesToScreens(merged, appConfig) {
	const map = getChannelMap(appConfig)
	if (!map.mappingChannels || !map.mappingChannels.length) return

	const dg = appConfig?.deviceGraph || {}
	const edges = Array.isArray(dg.edges) ? dg.edges : []
	const connectors = Array.isArray(dg.connectors) ? dg.connectors : []
	const devices = Array.isArray(dg.devices) ? dg.devices : []
	const hardwareDisplays = Array.isArray(appConfig?.hardware?.displays) ? appConfig.hardware.displays : []

	map.mappingChannels.forEach((mc) => {
		const n = mc.ch
		const edge = edges.find((e) => String(e.sourceId) === mc.connectorId)
		if (!edge) return

		const sinkConn = connectors.find((c) => String(c.id) === edge.sinkId)
		if (!sinkConn) return

		// Get mode from node settings
		const node = devices.find((d) => d.id === mc.nodeId)
		const nodeConn = connectors.find((c) => c.id === mc.connectorId)
		const outputSettings = Array.isArray(node?.settings?.outputs)
			? node.settings.outputs.find((o) => o.id === nodeConn?.id?.split('_').pop() || o.id === nodeConn?.index)
			: null
		const mode = String(outputSettings?.mode || '1080p50').trim()

		if (sinkConn.kind === 'decklink_io') {
			const devNum = parseInt(String(sinkConn.externalRef || ''), 10)
			if (Number.isFinite(devNum) && devNum > 0) {
				merged[`screen_${n}_decklink_device`] = devNum
				merged[`screen_${n}_decklink_replace_screen`] = true
				const { STANDARD_VIDEO_MODES } = require('./config-modes')
				if (STANDARD_VIDEO_MODES[mode]) {
					merged[`screen_${n}_mode`] = mode
				}
			}
		} else if (sinkConn.kind === 'gpu_output') {
			const displayId = String(sinkConn.externalRef || '')
			const disp = hardwareDisplays.find((d) => String(d.id) === displayId)
			if (disp) {
				merged[`screen_${n}_mode`] = 'custom'
				merged[`screen_${n}_custom_width`] = disp.width
				merged[`screen_${n}_custom_height`] = disp.height
				merged[`screen_${n}_custom_fps`] = disp.fps || 60
			}
		}
	})
}

/**
 * Flat config for {@link buildConfigXml}: persisted `casparServer` + `audioRouting` + `streaming`
 * + OSC ports for the `<osc>` predefined client block (same machine → 127.0.0.1).
 * @param {Record<string, unknown>} appConfig - `ctx.config` / highascg.config.json shape
 * @returns {Record<string, unknown>}
 */
function buildCasparGeneratorFlatConfig(appConfig) {
	const base = { ...(defaults.casparServer || {}), ...((appConfig && appConfig.casparServer) || {}) }
	const merged = mergeAudioRoutingIntoConfig({
		...base,
		audioRouting: { ...(defaults.audioRouting || {}), ...((appConfig && appConfig.audioRouting) || {}) },
		streaming: (appConfig && appConfig.streaming) || {},
	})
	const lp = appConfig && appConfig.osc && appConfig.osc.listenPort != null ? Number(appConfig.osc.listenPort) : 6251
	const port = Number.isFinite(lp) ? lp : 6251
	merged.osc_port = port
	if (merged.osc_target_port == null || merged.osc_target_port === '') merged.osc_target_port = port
	else merged.osc_target_port = parseInt(String(merged.osc_target_port), 10) || port
	const host = String(merged.osc_target_host || '127.0.0.1').trim() || '127.0.0.1'
	merged.osc_target_host = host
	merged.highascg_host = host
	/** Same rule as {@link getChannelMap}: max of root `screen_count` and `casparServer.screen_count`. */
	merged.screen_count = resolveMainScreenCount(appConfig || {})
	applyDestinationOverridesToScreens(merged, appConfig || {})
	applyDecklinkOverridesToScreens(merged, appConfig || {})
	applyAudioOutputOverridesToScreens(merged, appConfig || {})
	applyMappingOverridesToScreens(merged, appConfig || {})
	merged.rtmp = normalizeRtmpConfig(appConfig && appConfig.rtmp)
	merged.streamingChannel = {
		...(defaults.streamingChannel || {}),
		...(appConfig && appConfig.streamingChannel && typeof appConfig.streamingChannel === 'object'
			? appConfig.streamingChannel
			: {}),
	}
	merged.tandemTopology = normalizeTandemTopology(appConfig && appConfig.tandemTopology)
	
	// Attach layout-related bits for buildChannelsSection -> calculateLayoutPositions
	merged.deviceGraph = appConfig && appConfig.deviceGraph
	merged.x11_horizontal_swap = appConfig && appConfig.x11_horizontal_swap
	
	// Copy legacy screen/mv settings that are top-level in appConfig
	if (appConfig) {
		for (let i = 1; i <= 16; i++) {
			const prefix = `screen_${i}_`
			if (appConfig[prefix + 'system_id']) merged[prefix + 'system_id'] = appConfig[prefix + 'system_id']
			if (appConfig[prefix + 'os_mode']) merged[prefix + 'os_mode'] = appConfig[prefix + 'os_mode']
			if (appConfig[prefix + 'os_rate']) merged[prefix + 'os_rate'] = appConfig[prefix + 'os_rate']
			if (appConfig[prefix + 'os_x'] !== undefined) merged[prefix + 'os_x'] = appConfig[prefix + 'os_x']
			if (appConfig[prefix + 'os_y'] !== undefined) merged[prefix + 'os_y'] = appConfig[prefix + 'os_y']
		}
		if (appConfig.multiview_system_id) merged.multiview_system_id = appConfig.multiview_system_id
		if (appConfig.multiview_os_mode) merged.multiview_os_mode = appConfig.multiview_os_mode
		if (appConfig.multiview_os_rate) merged.multiview_os_rate = appConfig.multiview_os_rate
		if (appConfig.multiview_os_x !== undefined) merged.multiview_os_x = appConfig.multiview_os_x
		if (appConfig.multiview_os_y !== undefined) merged.multiview_os_y = appConfig.multiview_os_y
	}
	
	return merged
}

module.exports = { buildCasparGeneratorFlatConfig }

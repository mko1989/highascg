'use strict'

const defaults = require('./defaults')
const { mergeAudioRoutingIntoConfig } = require('./config-generator')
const { normalizeRtmpConfig } = require('./rtmp-output')
const { resolveMainScreenCount } = require('./routing')
const { normalizeScreenDestinations } = require('./screen-destinations')
const { applyPixelMappingProgramScreens } = require('./pixel-mapping-config')
const { applyStreamRecordMappingsFromGraph } = require('./device-graph-output-mapping')
const { applyMultiviewOutputOverridesFromCabling } = require('./device-graph-destination-wiring')
const {
	copyLegacyScreenAndMultiviewSettings,
	applyLayoutPositionsToMerged,
} = require('./build-caspar-generator-layout-sync')
const {
	applyNdiStreamOutputsToScreens,
	applyDestinationOverridesToScreens,
	applyMultiviewDestinationOverrides,
	applyScreenConsumerOverridesFromCabling,
} = require('./build-caspar-generator-config-screens')
const {
	applyDecklinkOverridesToScreens,
	reconcileDecklinkScreenConsumerFlags,
} = require('./build-caspar-generator-config-decklink')
const {
	applyDestinationAudioLayoutsToScreens,
	applyAudioOutputOverridesToScreens,
} = require('./build-caspar-generator-config-audio')

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
	/** Same rule as routing-map `screen_count`: max of root `screen_count` and `casparServer.screen_count`. */
	merged.screen_count = resolveMainScreenCount(appConfig || {})
	applyDestinationOverridesToScreens(merged, appConfig || {})
	applyMultiviewDestinationOverrides(merged, appConfig || {})
	applyPixelMappingProgramScreens(merged, appConfig || {})
	applyDecklinkOverridesToScreens(merged, appConfig || {})
	applyScreenConsumerOverridesFromCabling(merged, appConfig || {})
	applyMultiviewOutputOverridesFromCabling(merged, appConfig || {})
	const { applyPhysicalPortConsumerFlagsToScreens } = require('./screen-consumer-port-resolve')
	applyPhysicalPortConsumerFlagsToScreens(merged, appConfig || {})
	applyNdiStreamOutputsToScreens(merged, appConfig || {})
	reconcileDecklinkScreenConsumerFlags(merged)
	applyDestinationAudioLayoutsToScreens(merged, appConfig || {})
	applyAudioOutputOverridesToScreens(merged, appConfig || {})
	merged.rtmp = normalizeRtmpConfig(appConfig && appConfig.rtmp)
	merged.composePreview = {
		...(defaults.composePreview || {}),
		...(appConfig && appConfig.composePreview && typeof appConfig.composePreview === 'object'
			? appConfig.composePreview
			: {}),
	}
	merged.streamingChannel = {
		...(defaults.streamingChannel || {}),
		...(appConfig && appConfig.streamingChannel && typeof appConfig.streamingChannel === 'object'
			? appConfig.streamingChannel
			: {}),
	}
	merged.screenDestinations = normalizeScreenDestinations(appConfig?.screenDestinations)
	// WO-268: the generator reads operatorTools (cefInteractiveBridge, cefRemoteDebuggingPort,
	// and now cefEnableGpu) but the flat config never carried it — those flags silently used
	// their fallbacks on the production path. Pass it through.
	merged.operatorTools = {
		...((appConfig && typeof appConfig.operatorTools === 'object' && appConfig.operatorTools) || {}),
	}
	merged.extraLiveSources = Array.isArray(appConfig?.extraLiveSources) ? appConfig.extraLiveSources : []

	// Attach layout-related bits for buildChannelsSection -> calculateLayoutPositions
	merged.deviceGraph = appConfig && appConfig.deviceGraph
	merged.x11_horizontal_swap = appConfig && appConfig.x11_horizontal_swap

	copyLegacyScreenAndMultiviewSettings(merged, appConfig)
	applyLayoutPositionsToMerged(merged)

	try {
		applyStreamRecordMappingsFromGraph({
			deviceGraph: appConfig?.deviceGraph,
			screenDestinations: appConfig?.screenDestinations,
			streamingChannel: merged.streamingChannel,
			recordOutputs: Array.isArray(appConfig?.recordOutputs) ? appConfig.recordOutputs : [],
		})
	} catch (_) {}

	return merged
}

module.exports = { buildCasparGeneratorFlatConfig }

/**
 * Channel routing and DeckLink inputs — route strings, preview CG, multiview, startup wiring.
 */
'use strict'

const Map = require('./routing-map')
const Setup = require('./routing-setup')

/**
 * @param {object} self - app context (amcp, config, log)
 * @param {number} srcChannel
 * @param {number} srcLayer
 * @param {number} dstChannel
 * @param {number} dstLayer
 */
async function routeToLayer(self, srcChannel, srcLayer, dstChannel, dstLayer) {
	const route = Map.getRouteString(srcChannel, srcLayer)
	return self.amcp.play(dstChannel, dstLayer, route)
}

module.exports = {
	getChannelMap: Map.getChannelMap,
	getRouteString: Map.getRouteString,
	resolveMainScreenCount: Map.resolveMainScreenCount,
	resolveStreamingChannelRoute: Map.resolveStreamingChannelRoute,
	resolveStreamingChannelRouteForRole: Map.resolveStreamingChannelRouteForRole,
	routeToLayer,
	readCasparSetting: Map.readCasparSetting,
	resolveDecklinkInputDeviceIndex: Map.resolveDecklinkInputDeviceIndex,
	setupInputsChannel: Setup.setupInputsChannel,
	setupLiveAudioInputs: Setup.setupLiveAudioInputs,
	setupLiveAudioPgmRoutes: Setup.setupLiveAudioPgmRoutes,
	setupAudioPreviewBus: Setup.setupAudioPreviewBus,
	setupPreviewChannel: Setup.setupPreviewChannel,
	setupMultiview: Setup.setupMultiview,
	setupAllRouting: Setup.setupAllRouting,
	normalizeAudioPreview: require('./audio-preview').normalizeAudioPreview,
	resolveAudioPreviewChannel: require('./audio-preview').resolveAudioPreviewChannel,
	listConfiguredLiveAudioSlots: require('./live-audio-input').listConfiguredLiveAudioSlots,
	resolveLiveAudioRouteString: require('./live-audio-input').resolveLiveAudioRouteString,
	normalizeAlsaCaptureUri: require('./live-audio-input').normalizeAlsaCaptureUri,
}

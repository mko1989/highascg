/**
 * Channel routing and DeckLink inputs — route strings, preview CG, multiview, startup wiring.
 */
'use strict'

const routingMapLib = require('./routing-map')
const Setup = require('./routing-setup')

/**
 * @param {object} self - app context (amcp, config, log)
 * @param {number} srcChannel
 * @param {number} srcLayer
 * @param {number} dstChannel
 * @param {number} dstLayer
 */
async function routeToLayer(self, srcChannel, srcLayer, dstChannel, dstLayer) {
	const route = routingMapLib.getRouteString(srcChannel, srcLayer)
	return self.amcp.play(dstChannel, dstLayer, route)
}

module.exports = {
	getChannelMap: routingMapLib.getChannelMap,
	getRouteString: routingMapLib.getRouteString,
	resolveMainScreenCount: routingMapLib.resolveMainScreenCount,
	resolveStreamingChannelRoute: routingMapLib.resolveStreamingChannelRoute,
	resolveStreamingChannelRouteForRole: routingMapLib.resolveStreamingChannelRouteForRole,
	routeToLayer,
	readCasparSetting: routingMapLib.readCasparSetting,
	resolveDecklinkInputDeviceIndex: routingMapLib.resolveDecklinkInputDeviceIndex,
	setupInputsChannel: Setup.setupInputsChannel,
	setupLiveAudioInputs: Setup.setupLiveAudioInputs,
	setupV4l2Inputs: Setup.setupV4l2Inputs,
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
	ensureLiveAudioRouting: Setup.ensureLiveAudioRouting,
	ensureV4l2InputRouting: Setup.ensureV4l2InputRouting,
	listConfiguredV4l2Slots: require('../capture/v4l2-input-config').listConfiguredV4l2Slots,
}

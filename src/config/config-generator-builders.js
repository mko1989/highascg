'use strict'

/**
 * HighAsCG — CasparCG Config Generator Builders.
 * This file is a facade that re-exports functions from specialized modules.
 */

const utils = require('./config-generator-utils')
const audioRouting = require('./config-generator-audio-routing')
const audioXml = require('./config-generator-audio-xml')
const screenXml = require('./config-generator-screen-xml')
const oscXml = require('./config-generator-osc-xml')

module.exports = {
	// Utils
	parseOptionalPixel: utils.parseOptionalPixel,
	escapeXml: utils.escapeXml,
	padStringArray: utils.padStringArray,
	padBoolArray: utils.padBoolArray,
	ffmpegPathFromAlsaId: utils.ffmpegPathFromAlsaId,
	isCustomLiveProfile: utils.isCustomLiveProfile,

	// Audio Routing
	normalizeAudioRouting: audioRouting.normalizeAudioRouting,
	mergeAudioRoutingIntoConfig: audioRouting.mergeAudioRoutingIntoConfig,
	getProgramChannelAudioLayouts: audioRouting.getProgramChannelAudioLayouts,
	getExtraAudioChannelLayouts: audioRouting.getExtraAudioChannelLayouts,

	// Audio XML
	defaultFfmpegAudioArgs: audioXml.defaultFfmpegAudioArgs,
	buildAudioLayoutsXml: audioXml.buildAudioLayoutsXml,
	buildScreenFfmpegConsumersXml: audioXml.buildScreenFfmpegConsumersXml,
	buildStreamingFfmpegConsumerXml: audioXml.buildStreamingFfmpegConsumerXml,
	buildExtraAudioFfmpegConsumersXml: audioXml.buildExtraAudioFfmpegConsumersXml,
	channelLayoutElementXml: audioXml.channelLayoutElementXml,
	buildCustomLiveRootXml: audioXml.buildCustomLiveRootXml,
	buildPortAudioConsumerXml: audioXml.buildPortAudioConsumerXml,
	buildMonitorChannelXml: audioXml.buildMonitorChannelXml,
	buildProgramSystemAudioXml: audioXml.buildProgramSystemAudioXml,
	buildPreviewSystemAudioXml: audioXml.buildPreviewSystemAudioXml,

	// Screen XML
	buildScreenConsumerExtrasXml: screenXml.buildScreenConsumerExtrasXml,
	buildProgramScreenConsumerInnerXml: screenXml.buildProgramScreenConsumerInnerXml,
	buildMultiviewScreenConsumerInnerXml: screenXml.buildMultiviewScreenConsumerInnerXml,

	// OSC XML
	buildOscConfigurationXml: oscXml.buildOscConfigurationXml,
}

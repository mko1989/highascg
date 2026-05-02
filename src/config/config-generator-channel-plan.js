'use strict'

const { getModeDimensions, getExtraAudioModeDimensions } = require('./config-modes')
const { screenModeString } = require('./config-generator-mode-helpers')
const { readCasparSetting } = require('./routing-map')

/**
 * @param {Record<string, unknown>} config
 * @param {ReturnType<import('./routing').getChannelMap>} routeMap
 */
function buildChannelPlan(config, routeMap) {
	const screenCount = routeMap.screenCount
	const multiviewEnabled = config.multiview_enabled !== false && config.multiview_enabled !== 'false'
	const decklinkCount = Math.min(8, Math.max(0, parseInt(String(config.decklink_input_count || 0), 10) || 0))
	const extraAudioCount = Math.min(4, Math.max(0, parseInt(String(config.extra_audio_channel_count || 0), 10) || 0))

	const screens = []
	for (let n = 1; n <= screenCount; n++) {
		const mode = screenModeString(config, n)
		const dims = getModeDimensions(mode, config, n)
		screens.push({ n, dims })
	}
	const extraAudio = []
	for (let i = 1; i <= extraAudioCount; i++) {
		const dims = getExtraAudioModeDimensions(config, i)
		extraAudio.push({ i, dims })
	}
	const multiviewChannels = Array.isArray(routeMap.multiviewChannels) ? routeMap.multiviewChannels : (routeMap.multiviewCh != null ? [routeMap.multiviewCh] : [])
	const multiviews = []
	for (const ch of multiviewChannels) {
		const mode = String(readCasparSetting(config, 'multiview_mode') ?? '1080p5000')
		const dims = getModeDimensions(mode, config, ch)
		multiviews.push({ ch, dims })
	}

	return {
		screens,
		extraAudio,
		multiviewEnabled,
		multiviews,
		decklinkCount,
		inputsHostChannelEnabled: routeMap.inputsHostChannelEnabled === true,
		streamingChannelEnabled: routeMap.streamingCh != null,
		/** Extra `<channel>` in caspar config only when not attaching RTMP/record to an existing channel */
		streamingChannelDedicatedSlot: routeMap.streamingCh != null && routeMap.streamingDedicatedChannelSlot === true,
	}
}

module.exports = { buildChannelPlan }

'use strict'

const { getModeDimensions, getExtraAudioModeDimensions } = require('./config-modes')
const { screenModeString } = require('./config-generator-mode-helpers')
const { readCasparSetting } = require('./routing-map')
const { destinationsFromConfig } = require('./screen-destinations')

/**
 * @param {Record<string, unknown>} config
 * @param {ReturnType<import('./routing').getChannelMap>} routeMap
 */
function buildChannelPlan(config, routeMap) {
	const screenCount = routeMap.screenCount
	// Must match {@link ../routing-map#getChannelMap}: nested casparServer.decklink_input_count counts too,
	// or routing burns inputsCh/nextCh while this plan assumed 0 → rogue empty `<channel>` placeholders.
	const decklinkCount = typeof routeMap.decklinkCount === 'number' ? routeMap.decklinkCount : 0
	const liveAudioCount = typeof routeMap.liveAudioCount === 'number' ? routeMap.liveAudioCount : 0
	const extraAudioCount = Array.isArray(routeMap.audioOnlyChannels) ? routeMap.audioOnlyChannels.length : 0

	// WO-242: pixelmap screens are still "mains" (screenCount/programCh indexing) but render via a
	// native <artnet> consumer instead of the generic PGM screen-consumer chain — flag them here so
	// config-generator-channels.js can special-case their <channel> body.
	const pixelmapByMain = new Map()
	for (const dest of destinationsFromConfig(config)) {
		if (dest && dest.mode === 'pixelmap') {
			pixelmapByMain.set(Math.max(0, parseInt(String(dest.mainScreenIndex ?? 0), 10) || 0), dest)
		}
	}
	const screens = []
	for (let n = 1; n <= screenCount; n++) {
		const mode = screenModeString(config, n)
		const dims = getModeDimensions(mode, config, n)
		const pixelmap = pixelmapByMain.get(n - 1) || null
		screens.push({ n, dims, pixelmap })
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

	/** Emit multiview `<channel>` blocks only when routing allocated multiview slot(s). */
	const multiviewEnabled = multiviewChannels.length > 0

	// WO-53: one Caspar channel per live input (DeckLink = full mode, ALSA = cheap mode).
	const inputChannels = Array.isArray(routeMap.inputChannels) ? routeMap.inputChannels : []

	return {
		screens,
		extraAudio,
		multiviewEnabled,
		multiviews,
		inputChannels,
		decklinkCount,
		liveAudioCount,
		inputsHostChannelEnabled: routeMap.inputsHostChannelEnabled === true,
		streamingChannelEnabled: routeMap.streamingCh != null,
		/** Extra `<channel>` in caspar config only when not attaching RTMP/record to an existing channel */
		streamingChannelDedicatedSlot: routeMap.streamingCh != null && routeMap.streamingDedicatedChannelSlot === true,
	}
}

module.exports = { buildChannelPlan }

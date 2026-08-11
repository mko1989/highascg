'use strict'

const { findStandardModeId, getModeDimensions, getExtraAudioModeDimensions, STANDARD_VIDEO_MODES } = require('./config-modes')
const { screenModeString } = require('./config-generator-mode-helpers')
const { readCasparSetting } = require('./routing-map')
const { destinationsFromConfig } = require('./screen-destinations')

/**
 * WO-243: dims for an `operator_gui` utility channel, sourced from the destination's own
 * width/height/fps/videoMode fields — NOT from `screen_${n}_custom_*` config keys (unlike
 * {@link getModeDimensions}'s `'custom'` branch), since operator_gui does not occupy a
 * mainScreenIndex/screen-numbered slot for those keys to apply to.
 * @param {ReturnType<import('./screen-destinations').normalizeDestination>} dest
 * @returns {{ width: number, height: number, fps: number, modeId: string, isCustom: boolean }}
 */
function operatorGuiModeDimensions(dest) {
	const videoMode = String(dest?.videoMode || 'custom')
	const std = STANDARD_VIDEO_MODES[videoMode]
	if (std) return { ...std, modeId: videoMode, isCustom: false }
	const width = Math.max(64, parseInt(String(dest?.width ?? 1920), 10) || 1920)
	const height = Math.max(64, parseInt(String(dest?.height ?? 1080), 10) || 1080)
	const fps = Math.max(1, parseFloat(String(dest?.fps ?? 50)) || 50)
	/* WO-484: a destination saved as `custom` still describes a shipped mode more often than not —
	 * the operator GUI at 1920x1080@50 is 1080p5000. Resolve to the standard id so no duplicate
	 * <video-mode> is registered. Both halves matter: the emitter refuses duplicates, so a resolver
	 * that kept minting `1920x1080` here would leave the channel referencing a mode that was never
	 * registered, and Caspar refuses to start on an unknown video-mode id. */
	const stdId = findStandardModeId(width, height, fps)
	if (stdId) return { ...STANDARD_VIDEO_MODES[stdId], modeId: stdId, isCustom: false }
	return { width, height, fps, modeId: `${width}x${height}`, isCustom: true }
}

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

	// WO-243: operator_gui utility channel(s) — mirrors the multiview plan-entry shape exactly
	// (top-level `{ ch, dims, dest }` array, NOT nested inside `screens[]` like pixelmap, since
	// operator_gui does not occupy a mainScreenIndex slot — see routing-map.js's ogDests block).
	const operatorGuiChannels = Array.isArray(routeMap.operatorGuiChannels) ? routeMap.operatorGuiChannels : (routeMap.operatorGuiCh != null ? [routeMap.operatorGuiCh] : [])
	const ogDests = destinationsFromConfig(config).filter((d) => d && d.mode === 'operator_gui')
	const operatorGuis = []
	for (let i = 0; i < operatorGuiChannels.length; i++) {
		const dest = ogDests[i] || null
		if (!dest) continue
		operatorGuis.push({ ch: operatorGuiChannels[i], dims: operatorGuiModeDimensions(dest), dest })
	}
	const operatorGuiEnabled = operatorGuis.length > 0

	// WO-53: one Caspar channel per live input (DeckLink = full mode, ALSA = cheap mode).
	const inputChannels = Array.isArray(routeMap.inputChannels) ? routeMap.inputChannels : []

	return {
		screens,
		extraAudio,
		multiviewEnabled,
		multiviews,
		operatorGuiEnabled,
		operatorGuis,
		inputChannels,
		decklinkCount,
		liveAudioCount,
		inputsHostChannelEnabled: routeMap.inputsHostChannelEnabled === true,
		streamingChannelEnabled: routeMap.streamingCh != null,
		/** Extra `<channel>` in caspar config only when not attaching RTMP/record to an existing channel */
		streamingChannelDedicatedSlot: routeMap.streamingCh != null && routeMap.streamingDedicatedChannelSlot === true,
	}
}

module.exports = { buildChannelPlan, operatorGuiModeDimensions }

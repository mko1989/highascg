'use strict'

const { STANDARD_VIDEO_MODES } = require('./config-modes')
const { destinationsFromConfig } = require('./screen-destinations')
const {
	reachesGpuFromSource,
	createDestinationWiringContext,
	destinationSourceIds,
} = require('./device-graph-destination-wiring')
const { destinationAudioLayoutsByMain } = require('./screen-destinations')
const { normalizeProgramLayout } = require('./audio-channel-layouts')

function getDestinationList(appConfig) {
	const list = destinationsFromConfig(appConfig || {})
	return list.filter((d) => d && typeof d === 'object')
}

function parseCustomVideoModeString(modeRaw) {
	const s = String(modeRaw || '').trim().toLowerCase()
	if (!s) return null
	const m = s.match(/^(\d{2,5})x(\d{2,5})(?:p|@)?(\d+(?:\.\d+)?)?$/i)
	if (!m) return null
	const w = Math.max(64, parseInt(m[1], 10) || 0)
	const h = Math.max(64, parseInt(m[2], 10) || 0)
	const fps = Math.max(1, parseFloat(m[3] || '50') || 50)
	if (!w || !h) return null
	return { w, h, fps }
}

function applyDestinationOverridesToScreens(merged, appConfig) {
	const rawList = destinationsFromConfig(appConfig || {})
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
		const picked = perMain.find((d) => d.videoMode && d.videoMode !== '1080p5000') || perMain.find((d) => String(d.mode || 'pgm_prv') === 'pgm_prv') || perMain[0]
		const modeRaw = String(picked.videoMode || '').trim()
		const width = Math.max(64, parseInt(String(picked.width ?? 0), 10) || 0)
		const height = Math.max(64, parseInt(String(picked.height ?? 0), 10) || 0)
		const fps = Math.max(1, parseFloat(String(picked.fps ?? 50)) || 50)
		const n = idx + 1
		if (modeRaw && STANDARD_VIDEO_MODES[modeRaw]) {
			merged[`screen_${n}_mode`] = modeRaw
			continue
		}
		const customFromMode = parseCustomVideoModeString(modeRaw)
		if (customFromMode) {
			merged[`screen_${n}_mode`] = 'custom'
			merged[`screen_${n}_custom_width`] = customFromMode.w
			merged[`screen_${n}_custom_height`] = customFromMode.h
			merged[`screen_${n}_custom_fps`] = customFromMode.fps
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

function applyMultiviewDestinationOverrides(merged, appConfig) {
	const list = destinationsFromConfig(appConfig || {})
	const mvDest = list.find((d) => d && String(d.mode || '') === 'multiview')
	if (!mvDest) return

	const modeRaw = String(mvDest.videoMode || '').trim()
	const width = Math.max(64, parseInt(String(mvDest.width ?? 0), 10) || 0)
	const height = Math.max(64, parseInt(String(mvDest.height ?? 0), 10) || 0)
	const fps = Math.max(1, parseFloat(String(mvDest.fps ?? 50)) || 50)

	if (modeRaw && STANDARD_VIDEO_MODES[modeRaw]) {
		merged.multiview_mode = modeRaw
		return
	}
	const customFromMode = parseCustomVideoModeString(modeRaw)
	if (customFromMode) {
		merged.multiview_mode = 'custom'
		merged.multiview_custom_width = customFromMode.w
		merged.multiview_custom_height = customFromMode.h
		merged.multiview_custom_fps = customFromMode.fps
		return
	}
	if (width > 0 && height > 0) {
		merged.multiview_mode = 'custom'
		merged.multiview_custom_width = width
		merged.multiview_custom_height = height
		merged.multiview_custom_fps = fps
	}
}

function applyScreenConsumerOverridesFromCabling(merged, appConfig) {
	const destinations = destinationsFromConfig(appConfig || {})
	const ctx = createDestinationWiringContext(appConfig)
	if (!ctx.g.connectors?.length || !destinations.length) return

	for (const dest of destinations) {
		const mode = String(dest?.mode || 'pgm_prv')
		if (mode === 'multiview' || mode === 'stream') continue
		const idx = Math.max(0, parseInt(String(dest?.mainScreenIndex ?? 0), 10) || 0)
		const n = idx + 1
		const srcCandidates = destinationSourceIds(dest, idx, ctx)
		merged[`screen_${n}_screen_consumer`] = srcCandidates.some((src) => reachesGpuFromSource(src, ctx))
	}
}

function reconcileDecklinkScreenConsumerFlags(merged) {
	const sc = Math.min(16, Math.max(1, parseInt(String(merged.screen_count || 4), 10) || 4))
	for (let n = 1; n <= sc; n++) {
		const tiles = merged[`screen_${n}_decklink_tiles`]
		const decklinkDevice = parseInt(String(merged[`screen_${n}_decklink_device`] || '0'), 10) || 0
		const hasDecklink = decklinkDevice > 0 || (Array.isArray(tiles) && tiles.length > 0)
		if (!hasDecklink) continue
		const wantsScreen =
			merged[`screen_${n}_screen_consumer`] === true || merged[`screen_${n}_screen_consumer`] === 'true'
		merged[`screen_${n}_decklink_replace_screen`] = !wantsScreen
	}
}

function applyDestinationAudioLayoutsToScreens(merged, appConfig) {
	const sc = Math.min(16, Math.max(1, parseInt(String(merged.screen_count || 4), 10) || 4))
	const byMain = destinationAudioLayoutsByMain(appConfig || {})
	for (let n = 1; n <= sc; n++) {
		const layout = byMain[n - 1] != null ? normalizeProgramLayout(String(byMain[n - 1])) : 'stereo'
		merged[`screen_${n}_audio_layout`] = layout
	}
}

module.exports = {
	parseCustomVideoModeString,
	applyDestinationOverridesToScreens,
	applyMultiviewDestinationOverrides,
	applyScreenConsumerOverridesFromCabling,
	reconcileDecklinkScreenConsumerFlags,
	applyDestinationAudioLayoutsToScreens,
}

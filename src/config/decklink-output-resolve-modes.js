'use strict'

const { STANDARD_VIDEO_MODES } = require('./config-modes')
const { defaultVideoModeForProjectFps, default2160VideoModeForProjectFps, normalizeProjectFps } = require('./project-fps')

const FPS_TOLERANCE = 0.02

function fpsNear(a, b) {
	return Math.abs(Number(a) - Number(b)) <= FPS_TOLERANCE
}

function matchStandardDecklinkVideoMode(feed) {
	const videoMode = String(feed?.videoMode || '').trim()
	if (videoMode && STANDARD_VIDEO_MODES[videoMode]) {
		return { decklinkVideoMode: videoMode, isCustom: false, mappedFromCustom: false }
	}

	const width = Math.max(0, parseInt(String(feed?.width ?? 0), 10) || 0)
	const height = Math.max(0, parseInt(String(feed?.height ?? 0), 10) || 0)
	const fps = Math.max(1, parseFloat(String(feed?.fps ?? 50)) || 50)

	for (const [id, spec] of Object.entries(STANDARD_VIDEO_MODES)) {
		if (!spec) continue
		if (spec.width === width && spec.height === height && fpsNear(spec.fps, fps)) {
			return { decklinkVideoMode: id, isCustom: false, mappedFromCustom: videoMode === 'custom' || !STANDARD_VIDEO_MODES[videoMode] }
		}
	}

	return { decklinkVideoMode: null, isCustom: true, mappedFromCustom: false }
}

const DECKLINK_AUTO_SDI_HEIGHT_1080 = 1080

function pickAutoDecklinkSdiFormatForFeed(feed) {
	const match = matchStandardDecklinkVideoMode(feed)
	if (match.decklinkVideoMode) {
		return {
			decklinkVideoMode: match.decklinkVideoMode,
			source: 'exact',
			mappedFromCustom: match.mappedFromCustom,
			autoTier: null,
		}
	}

	const width = Math.max(0, parseInt(String(feed?.width ?? 0), 10) || 0)
	const height = Math.max(0, parseInt(String(feed?.height ?? 0), 10) || 0)
	if (width <= 0 && height <= 0) {
		return { decklinkVideoMode: null, source: 'none', mappedFromCustom: false, autoTier: null }
	}

	const fps = normalizeProjectFps(feed?.fps ?? 50)
	const use2160 = height > DECKLINK_AUTO_SDI_HEIGHT_1080
	const decklinkVideoMode = use2160 ? default2160VideoModeForProjectFps(fps) : defaultVideoModeForProjectFps(fps)
	return {
		decklinkVideoMode,
		source: 'auto',
		mappedFromCustom: true,
		autoTier: use2160 ? '2160p' : '1080p',
	}
}

function readConnectorDecklinkOutputVideoMode(connector) {
	return String(connector?.caspar?.decklinkOutputVideoMode || '').trim()
}

function resolveEffectiveDecklinkVideoMode(feed, connectorOverride = '') {
	const override = String(connectorOverride || '').trim()
	if (override && STANDARD_VIDEO_MODES[override]) {
		return { decklinkVideoMode: override, source: 'override', mappedFromCustom: false, autoTier: null }
	}
	const picked = pickAutoDecklinkSdiFormatForFeed(feed)
	if (picked.decklinkVideoMode) {
		return {
			decklinkVideoMode: picked.decklinkVideoMode,
			source: picked.source === 'exact' ? 'exact' : 'auto',
			mappedFromCustom: picked.mappedFromCustom,
			autoTier: picked.autoTier,
		}
	}
	return { decklinkVideoMode: null, source: 'none', mappedFromCustom: false, autoTier: null }
}

function buildDecklinkPassthroughSubregion(feed) {
	const width = Math.max(0, parseInt(String(feed?.width ?? 0), 10) || 0)
	const height = Math.max(0, parseInt(String(feed?.height ?? 0), 10) || 0)
	if (width <= 0 || height <= 0) return null
	return { srcX: 0, srcY: 0, destX: 0, destY: 0, width, height }
}

function resolveDecklinkTileVideoMode(tile) {
	const width = Math.max(0, parseInt(String(tile?.width ?? 0), 10) || 0)
	const height = Math.max(0, parseInt(String(tile?.height ?? 0), 10) || 0)
	const fps = Math.max(1, parseFloat(String(tile?.fps ?? 50)) || 50)
	const modeHint = String(tile?.modeHint || '').trim()
	if (modeHint && STANDARD_VIDEO_MODES[modeHint]) return modeHint
	const byDims = matchStandardDecklinkVideoMode({ videoMode: 'custom', width, height, fps })
	if (byDims.decklinkVideoMode) return byDims.decklinkVideoMode
	if (height > 0 && height <= 1080) {
		if (fpsNear(fps, 50)) return '1080p5000'
		if (fpsNear(fps, 59.94)) return '1080p5994'
		if (fpsNear(fps, 60)) return '1080p6000'
		if (fpsNear(fps, 25)) return '1080p2500'
		if (fpsNear(fps, 24)) return '1080p2400'
		if (fpsNear(fps, 23.98)) return '1080p2398'
	}
	return modeHint && STANDARD_VIDEO_MODES[modeHint] ? modeHint : '1080p5000'
}

function pickDecklinkParentVideoMode(tiles) {
	if (!Array.isArray(tiles) || tiles.length === 0) return '1080p5000'
	let bestMode = String(tiles[0]?.videoMode || '1080p5000')
	let bestPx = 0
	for (const t of tiles) {
		const mode = String(t?.videoMode || '1080p5000')
		const spec = STANDARD_VIDEO_MODES[mode]
		const px = spec ? spec.width * spec.height : (Number(t?.width) || 0) * (Number(t?.height) || 0)
		if (px >= bestPx) {
			bestPx = px
			bestMode = mode
		}
	}
	return bestMode
}

function channelVideoModeForDecklinkConsumer(opts) {
	const channelModeId = String(opts.channelModeId || '1080p5000').trim() || '1080p5000'
	const decklinkVideoMode = String(opts.decklinkVideoMode || '').trim()
	if (!decklinkVideoMode || !STANDARD_VIDEO_MODES[decklinkVideoMode]) return channelModeId

	const hasScreen = opts.hasScreenConsumer === true
	const isCustom = opts.isChannelCustom === true

	if (!hasScreen || opts.decklinkReplaceScreen === true) return decklinkVideoMode
	if (isCustom && hasScreen) return channelModeId
	return decklinkVideoMode
}

module.exports = {
	matchStandardDecklinkVideoMode,
	pickAutoDecklinkSdiFormatForFeed,
	readConnectorDecklinkOutputVideoMode,
	resolveEffectiveDecklinkVideoMode,
	buildDecklinkPassthroughSubregion,
	resolveDecklinkTileVideoMode,
	pickDecklinkParentVideoMode,
	channelVideoModeForDecklinkConsumer,
}

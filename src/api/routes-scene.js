'use strict'

const { handleSceneTake } = require('./routes-scene-take')
const { handleAudioOnlyLookStop } = require('./routes-scene-take-audio-only')
const { handlePreviewLiveRegister, handlePreviewLiveClear } = require('./routes-scene-preview')
const { handleBorderLines, handleBorderPresetCrossfade } = require('./routes-scene-border')
const { handleGlobalBorderControl } = require('./routes-scene-global-border')
const { handleTakeLook } = require('./routes-scene-take-look')
const { handlePreviewPush } = require('./routes-scene-preview-push')

async function handlePost(path, body, ctx) {
	if (path === '/api/scene/take') {
		if (!ctx.amcp) return null
		return handleSceneTake(body, ctx)
	}
	if (path === '/api/scene/take-look') {
		// WO-598 C1: take / stage a stored look by id — payload built server-side.
		if (!ctx.amcp) return null
		return handleTakeLook(body, ctx)
	}
	if (path === '/api/scene/preview-push') {
		// WO-598 C2: re-push an edited look onto PRV by id — nudge (geometry) or re-take (content), server-decided.
		if (!ctx.amcp) return null
		return handlePreviewPush(body, ctx)
	}
	if (path === '/api/scene/audio-only/stop') {
		if (!ctx.amcp) return null
		return handleAudioOnlyLookStop(body, ctx)
	}
	if (path === '/api/scene/live/preview') {
		return handlePreviewLiveRegister(body, ctx)
	}
	if (path === '/api/scene/live/preview/clear') {
		return handlePreviewLiveClear(body, ctx)
	}
	if (path === '/api/scene/border-lines') {
		return handleBorderLines(body, ctx)
	}
	if (path === '/api/scene/border-preset-crossfade') {
		return handleBorderPresetCrossfade(body, ctx)
	}
	if (path === '/api/scene/global-border') {
		return handleGlobalBorderControl(body, ctx)
	}
	return null
}

module.exports = { handlePost, handleSceneTake, handlePreviewLiveRegister, handlePreviewLiveClear }

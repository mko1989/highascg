'use strict'

const { handleSceneTake } = require('./routes-scene-take')
const { handleAudioOnlyLookStop } = require('./routes-scene-take-audio-only')
const { handlePreviewLiveRegister, handlePreviewLiveClear } = require('./routes-scene-preview')
const { handleBorderLines, handleBorderPresetCrossfade } = require('./routes-scene-border')

async function handlePost(path, body, ctx) {
	if (path === '/api/scene/take') {
		if (!ctx.amcp) return null
		return handleSceneTake(body, ctx)
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
	return null
}

module.exports = { handlePost, handleSceneTake, handlePreviewLiveRegister, handlePreviewLiveClear }

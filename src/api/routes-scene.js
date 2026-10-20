'use strict'

const { handleSceneTake } = require('./routes-scene-take')
const { handleAudioOnlyLookStop } = require('./routes-scene-take-audio-only')
const { handlePreviewLiveRegister, handlePreviewLiveClear } = require('./routes-scene-preview')
const { handleBorderLines, handleBorderPresetCrossfade } = require('./routes-scene-border')
const { handleGlobalBorderControl } = require('./routes-scene-global-border')
const { handleTakeLook } = require('./routes-scene-take-look')
const { handlePreviewPush } = require('./routes-scene-preview-push')
const { handleNewLayer } = require('./routes-scene-new-layer')
const { handleLayerFit } = require('./routes-scene-layer-tools')

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
	if (path === '/api/scene/new-layer') {
		// WO-600 F: build (not store) the layer a media drop creates — same client modules as the web.
		return handleNewLayer(body, ctx)
	}
	if (path === '/api/scene/new-look') {
		// WO-623 B: build (not store) a new look — deck "+" / media dropped on blank deck space.
		return require('./routes-scene-new-look').handleNewLook(body, ctx)
	}
	if (path === '/api/scene/layer-fit') {
		// WO-601: refit a layer for its content sizing (web reapplyLayerFrameForContentFit) — computed, not stored.
		return handleLayerFit(body, ctx)
	}
	if (path === '/api/scene/layer-reload') {
		// WO-601: HTML template "Reload page" with server-resolved channels + physical layers.
		if (!ctx.amcp) return null
		return require('./routes-scene-layer-tools').handleLayerReload(body, ctx)
	}
	if (path === '/api/scene/lower-third') {
		// WO-601: Godot lower-third inspector actions (resolve / update / play / clear), web lower-third-cg-data.js.
		return require('./routes-scene-lower-third').handleSceneLowerThird(body, ctx)
	}
	if (path === '/api/scene/countdown') {
		// WO-601: Godot countdown inspector actions (set / start / pause / reset) with edit-bus routing.
		return require('./routes-scene-countdown').handleSceneCountdown(body, ctx)
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

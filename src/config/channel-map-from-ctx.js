/**
 * Same channelMap shape as GET /state — built from config + Caspar INFO CONFIG XML.
 * Server StateManager snapshots do not include channelMap; engine code must call this with app ctx.
 */
'use strict'

const { getChannelMap } = require('./routing')
const { buildChannelResolutionMap } = require('./server-info-config')
const { resolveProgramAudioLayoutsForConfig } = require('./program-audio-layouts')
const { resolveProjectFps } = require('./project-fps')
const {
	configuredDecklinkInputCount,
	decklinkInputsConfiguredInSettings,
} = require('./decklink-input-slots')

/**
 * @param {object} ctx — app context (`config`, `gatheredInfo`, …)
 */
function buildChannelMap(ctx) {
	const cfg = ctx.config || {}
	const map = getChannelMap(cfg, ctx.switcherOutputBusByChannel)
	const projectFps = resolveProjectFps(cfg)
	const defaultRes = { w: 1920, h: 1080, fps: projectFps }
	const infoXml = (ctx.gatheredInfo && ctx.gatheredInfo.infoConfig) || ''
	const serverByCh = infoXml.trim() ? buildChannelResolutionMap(infoXml) : {}

	function pickRes(channelNum) {
		const r = serverByCh[channelNum]
		if (r && r.w > 0 && r.h > 0) {
			return { w: r.w, h: r.h, fps: r.fps > 0 ? r.fps : projectFps }
		}
		return { ...defaultRes }
	}

	const programChannels = (map.programChannels || []).map((_, i) => map.programCh(i + 1))
	const previewChannels = (map.programChannels || []).map((_, i) => map.previewCh(i + 1))

	const programResolutions = programChannels.map((ch) => pickRes(ch))
	const previewResolutions = previewChannels.map((ch) => pickRes(ch))
	const dlFromConfig = ctx.gatheredInfo?.decklinkFromConfig || {}
	const configuredDlCount = configuredDecklinkInputCount(cfg)
	const trustSavedConfig = decklinkInputsConfiguredInSettings(cfg)
	const decklinkCount =
		map.decklinkCount > 0
			? map.decklinkCount
			: trustSavedConfig
				? (configuredDlCount ?? 0)
				: (dlFromConfig.decklinkCount ?? 0)
	const liveAudioCount = map.liveAudioCount > 0 ? map.liveAudioCount : 0
	const v4l2InputCount = map.v4l2InputCount > 0 ? map.v4l2InputCount : 0
	const inputsCh =
		map.decklinkCount > 0 || liveAudioCount > 0 || v4l2InputCount > 0 || map.inputsHostChannelEnabled
			? map.inputsCh
			: trustSavedConfig
				? map.inputsCh ?? null
				: (dlFromConfig.inputsCh ?? null)
	const inputsResolution = trustSavedConfig ? null : (dlFromConfig.inputsResolution ?? null)
	const { normalizeAudioPreview, resolveAudioPreviewChannel } = require('./audio-preview')
	const audioPreview = normalizeAudioPreview(cfg)
	const audioPreviewCh = resolveAudioPreviewChannel(cfg, map)

	const channelResolutionsByChannel = {}
	for (const k of Object.keys(serverByCh)) {
		const n = parseInt(k, 10)
		if (Number.isFinite(n)) channelResolutionsByChannel[n] = { ...serverByCh[n] }
	}

	const audioOnlyResolutions = (map.audioOnlyChannels || []).map((ch) => pickRes(ch))

	// WO-53: one dedicated channel per live input (isolated VU). DeckLink = full mode, ALSA = cheap mode.
	const inputChannels = (Array.isArray(map.inputChannels) ? map.inputChannels : []).map((m) => ({
		kind: m.kind,
		slot: m.slot,
		channel: m.channel,
		layer: m.layer,
		mode: m.mode,
		route: m.route,
		label: m.label,
		sourceId: m.sourceId,
		resolution: pickRes(m.channel),
	}))
	const decklinkInputChannels = Array.isArray(map.decklinkInputChannels) ? map.decklinkInputChannels : []
	const liveAudioInputChannels = Array.isArray(map.liveAudioInputChannels) ? map.liveAudioInputChannels : []
	const v4l2InputChannels = Array.isArray(map.v4l2InputChannels) ? map.v4l2InputChannels : []

	return {
		screenCount: map.screenCount,
		/** Custom PGM/PRV channel rows (Settings → Caspar); used for main tabs labels when non-empty. */
		virtualMainChannels: map.virtualMainChannels || [],
		decklinkCount,
		liveAudioCount,
		v4l2InputCount,
		decklinkInputsHost: map.decklinkInputsHost || 'dedicated',
		inputsOnMvr: !!map.inputsOnMvr,
		audioPreview,
		audioPreviewCh,
		programChannels,
		previewChannels,
		switcherBus1Channels: Array.isArray(map.switcherBus1Channels) ? map.switcherBus1Channels.slice(0, map.screenCount) : [],
		switcherBusChannels: Array.isArray(map.switcherBusChannels) ? map.switcherBusChannels.slice(0, map.screenCount) : [],
		transitionModel: String(map.transitionModel || 'legacy_layer'),
		previewEnabledByMain: Array.isArray(map.previewEnabledByMain) ? map.previewEnabledByMain.slice(0, map.screenCount) : [],
		multiviewCh: map.multiviewCh,
		multiviewChannels: Array.isArray(map.multiviewChannels) ? map.multiviewChannels : (map.multiviewCh != null ? [map.multiviewCh] : []),
		streamingCh: map.streamingCh,
		streamingContentLayer: map.streamingContentLayer,
		inputsCh,
		programResolutions,
		previewResolutions,
		inputsResolution,
		channelResolutionsByChannel,
		programAudioLayouts: resolveProgramAudioLayoutsForConfig(cfg, map.screenCount),
		audioOnlyChannels: map.audioOnlyChannels,
		audioOnlyLayouts: [],
		audioOnlyResolutions: audioOnlyResolutions,
		inputChannels,
		decklinkInputChannels,
		liveAudioInputChannels,
		v4l2InputChannels,
		hostLiveChannels: Array.isArray(map.hostLiveChannels) ? map.hostLiveChannels : [],
		webpageHostChannels: Array.isArray(map.webpageHostChannels) ? map.webpageHostChannels : [],
		ndiHostChannels: Array.isArray(map.ndiHostChannels) ? map.ndiHostChannels : [],
	}
}

module.exports = { buildChannelMap }

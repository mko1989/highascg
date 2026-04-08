/**
 * Same channelMap shape as GET /state — built from config + Caspar INFO CONFIG XML.
 * Server StateManager snapshots do not include channelMap; engine code must call this with app ctx.
 */
'use strict'

const { getChannelMap } = require('./routing')
const { buildChannelResolutionMap } = require('./server-info-config')

/**
 * @param {object} ctx — app context (`config`, `gatheredInfo`, …)
 */
function buildChannelMap(ctx) {
	const cfg = ctx.config || {}
	const map = getChannelMap(cfg)
	const defaultRes = { w: 1920, h: 1080, fps: 50 }
	const infoXml = (ctx.gatheredInfo && ctx.gatheredInfo.infoConfig) || ''
	const serverByCh = infoXml.trim() ? buildChannelResolutionMap(infoXml) : {}

	function pickRes(channelNum) {
		const r = serverByCh[channelNum]
		if (r && r.w > 0 && r.h > 0) return { w: r.w, h: r.h, fps: r.fps }
		return { ...defaultRes }
	}

	const programResolutions = (map.programChannels || []).map((ch) => pickRes(ch))
	const previewResolutions = (map.previewChannels || []).map((ch) => pickRes(ch))
	const dlFromConfig = ctx.gatheredInfo?.decklinkFromConfig || {}
	const cfgDlExplicitZero = cfg.decklink_input_count != null && String(cfg.decklink_input_count) === '0'
	const decklinkCount = map.decklinkCount > 0 ? map.decklinkCount : cfgDlExplicitZero ? 0 : (dlFromConfig.decklinkCount ?? 0)
	const inputsCh = map.decklinkCount > 0 ? map.inputsCh : cfgDlExplicitZero ? null : (dlFromConfig.inputsCh ?? null)
	const inputsResolution = dlFromConfig.inputsResolution ?? null

	const channelResolutionsByChannel = {}
	for (const k of Object.keys(serverByCh)) {
		const n = parseInt(k, 10)
		if (Number.isFinite(n)) channelResolutionsByChannel[n] = { ...serverByCh[n] }
	}

	const audioOnlyResolutions = (map.audioOnlyChannels || []).map((ch) => pickRes(ch))

	return {
		screenCount: map.screenCount,
		decklinkCount,
		programChannels: Array.from({ length: map.screenCount }, (_, i) => map.programCh(i + 1)),
		previewChannels: Array.from({ length: map.screenCount }, (_, i) => map.previewCh(i + 1)),
		multiviewCh: map.multiviewCh,
		inputsCh,
		programResolutions,
		previewResolutions,
		inputsResolution,
		channelResolutionsByChannel,
		programAudioLayouts: [],
		audioOnlyChannels: map.audioOnlyChannels,
		audioOnlyLayouts: [],
		audioOnlyResolutions: audioOnlyResolutions,
	}
}

module.exports = { buildChannelMap }

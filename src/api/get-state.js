/**
 * Full HTTP/WebSocket state snapshot (simplified vs companion — no config-generator video modes).
 */

'use strict'

const { getChannelMap } = require('../config/routing')
const liveSceneState = require('../state/live-scene-state')
const playbackTracker = require('../state/playback-tracker')
const { parseCinfMedia } = require('../media/cinf-parse')
const { buildChannelResolutionMap } = require('../config/server-info-config')

/**
 * @param {object} ctx — app context (state, config, gatheredInfo, …)
 */
function getState(ctx) {
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

	/** Per Caspar channel index (1-based), from INFO CONFIG when available */
	const channelResolutionsByChannel = {}
	for (const k of Object.keys(serverByCh)) {
		const n = parseInt(k, 10)
		if (Number.isFinite(n)) channelResolutionsByChannel[n] = { ...serverByCh[n] }
	}

	const audioOnlyResolutions = (map.audioOnlyChannels || []).map((ch) => pickRes(ch))

	const channelMap = {
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

	let base
	if (ctx.state && typeof ctx.state.getState === 'function') {
		base = ctx.state.getState()
	} else {
		base = {
			variables: { ...(ctx.variables || {}) },
			channels: ctx.gatheredInfo?.channelIds || [],
			channelStatus: ctx.gatheredInfo?.channelStatusLines || {},
			media: (ctx.CHOICES_MEDIAFILES || []).map((c) => ({ id: c.id, label: c.label })),
			templates: (ctx.CHOICES_TEMPLATES || []).map((c) => ({ id: c.id, label: c.label })),
		}
	}
	if (base.media) {
		base.media = base.media.map((m) => {
			const cinf = m.cinf || (ctx.mediaDetails || {})[m.id] || ''
			const parsed = parseCinfMedia(cinf)
			const probed = (ctx._mediaProbeCache || {})[m.id] || {}
			return { ...m, ...parsed, ...probed }
		})
	}

	const casparConn = ctx._casparStatus || {
		connected: false,
		host: cfg.caspar?.host,
		port: cfg.caspar?.port,
	}

	return {
		...base,
		caspar: casparConn,
		channelMap,
		scene: {
			live: liveSceneState.getAll(),
			programLayerBankByChannel: ctx.programLayerBankByChannel || {},
		},
		playback: {
			matrix: playbackTracker.getMatrixForState(ctx),
		},
		localMediaEnabled: !!(cfg.local_media_path || '').trim(),
		configComparison: ctx._configComparison || null,
		ui: cfg.ui || {},
		osc:
			base.osc !== undefined
				? base.osc
				: ctx.oscState && typeof ctx.oscState.getSnapshot === 'function'
					? ctx.oscState.getSnapshot()
					: null,
	}
}

module.exports = { getState }

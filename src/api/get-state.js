/**
 * Full HTTP/WebSocket state snapshot (simplified vs companion — no config-generator video modes).
 */

'use strict'

const liveSceneState = require('../state/live-scene-state')
const playbackTracker = require('../state/playback-tracker')
const { parseCinfMedia } = require('../media/cinf-parse')
const { buildChannelMap } = require('../config/channel-map-from-ctx')

/**
 * @param {object} ctx — app context (state, config, gatheredInfo, …)
 */
function getState(ctx) {
	const cfg = ctx.config || {}
	const channelMap = buildChannelMap(ctx)

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

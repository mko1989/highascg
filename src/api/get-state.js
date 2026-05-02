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

	const timelineEngine = ctx.timelineEngine
	const timelines = timelineEngine && typeof timelineEngine.getAll === 'function' ? timelineEngine.getAll() : []
	const timelinePlayback =
		timelineEngine && typeof timelineEngine.getPlayback === 'function' ? timelineEngine.getPlayback() : null

	/**
	 * Live deck mirror (WS `scene_deck_sync` from web UI) + same preset arrays as the browser’s `sceneState`
	 * (`layerPresets` / `lookPresets` — named mix shortcuts and look bookmarks). Always includes arrays
	 * so Companion can rely on the shape. Optional: `sceneSnapshots` (full look JSON) when the browser
	 * is connected, `previewSceneId`, `looks` (id + name + mainScope).
	 */
	const rawDeck =
		ctx.sceneDeck && typeof ctx.sceneDeck === 'object' && Array.isArray(ctx.sceneDeck.looks) ? ctx.sceneDeck : { looks: [] }
	const sceneDeck = {
		...rawDeck,
		looks: Array.isArray(rawDeck.looks) ? rawDeck.looks : [],
		previewSceneId:
			rawDeck.previewSceneId != null && String(rawDeck.previewSceneId).trim()
				? String(rawDeck.previewSceneId).trim()
				: null,
		layerPresets: Array.isArray(rawDeck.layerPresets) ? rawDeck.layerPresets : [],
		lookPresets: Array.isArray(rawDeck.lookPresets) ? rawDeck.lookPresets : [],
	}

	return {
		...base,
		caspar: casparConn,
		/** Last DeckLink input PLAY summary after AMCP connect (WO-28); null until first routing setup. */
		decklinkInputsStatus: ctx._decklinkInputsStatus ?? null,
		channelMap,
		scene: {
			live: liveSceneState.getAll(),
			programLayerBankByChannel: ctx.programLayerBankByChannel || {},
			deck: sceneDeck,
		},
		timeline: {
			list: timelines,
			playback: timelinePlayback,
		},
		playback: {
			matrix: playbackTracker.getMatrixForState(ctx),
		},
		localMediaEnabled: !!(cfg.local_media_path || '').trim(),
		configComparison: ctx._configComparison || null,
		ui: cfg.ui || {},
		extraLiveSources: Array.isArray(cfg.extraLiveSources) ? cfg.extraLiveSources : [],
		osc:
			base.osc !== undefined
				? base.osc
				: ctx.oscState && typeof ctx.oscState.getSnapshot === 'function'
					? ctx.oscState.getSnapshot()
					: null,
	}
}

module.exports = { getState }

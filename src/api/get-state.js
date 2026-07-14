/**
 * Full HTTP/WebSocket state snapshot (simplified vs companion — no config-generator video modes).
 */

'use strict'

const liveSceneState = require('../state/live-scene-state')
const playbackTracker = require('../state/playback-tracker')
const { parseCinfMedia } = require('../media/cinf-parse')
const { buildChannelMap } = require('../config/channel-map-from-ctx')
const { normalizeScreenDestinations } = require('../config/screen-destinations')
const { enrichMediaListWithCinfAndProbe } = require('../utils/media-snapshot-cinf')
const { buildSceneDeckForApi, loadProjectScenes } = require('../engine/project-scenes')
const { enrichExtraLiveSources } = require('../config/extra-live-source-enrich')
const { getHostOperatorFullscreenSnapshot } = require('./host-operator-fullscreen')
const { getComposeBlocklistStats } = require('../preview/compose-preview-blocklist')
const {
	migrateExtraLiveSourcesList,
	collectHostLiveConfigWarnings,
} = require('../config/host-live-sources-migrate')

/**
 * @param {object} ctx — app context (state, config, gatheredInfo, …)
 * @param {{ slimCatalog?: boolean, fullCinfMedia?: boolean }} [opts] — when `slimCatalog`, omit media/templates bodies from WS bootstrap (PF-01). `fullCinfMedia` bypasses HIGHASCG_GETSTATE_CINF_MAX.
 */
function getState(ctx, opts = {}) {
	const slimCatalog = opts.slimCatalog === true
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
	if (slimCatalog) {
		const mediaCount = Array.isArray(base.media) ? base.media.length : 0
		const templateCount = Array.isArray(base.templates) ? base.templates.length : 0
		base = {
			...base,
			media: [],
			templates: [],
			mediaCount,
			templateCount,
			catalogDeferred: true,
		}
	} else if (base.media) {
		const capOverride = opts.fullCinfMedia === true ? 0 : undefined
		const { list, truncated, enrichedMax } = enrichMediaListWithCinfAndProbe(
			base.media,
			ctx,
			(m) => {
				const cinf = m.cinf || (ctx.mediaDetails || {})[m.id] || ''
				const parsed = cinf ? parseCinfMedia(cinf) : {}
				const probed = (ctx._mediaProbeCache || {})[m.id] || {}
				return { ...m, ...parsed, ...probed }
			},
			capOverride,
		)
		base = { ...base, media: list }
		if (truncated) {
			base.mediaCinfTruncated = true
			base.mediaCinfEnrichedMax = enrichedMax
		}
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

	/** Looks + snapshots from saved project; live `previewSceneId` from WS when UI is connected. */
	const sceneDeck = buildSceneDeckForApi(ctx)

	let globalBorders = null
	try {
		const scenes = loadProjectScenes()
		if (Array.isArray(scenes?.globalBorders)) globalBorders = scenes.globalBorders
	} catch (_) {
		// Ignore project-scene load failures and fall back to the current state snapshot.
	}

	const hostLiveMig = migrateExtraLiveSourcesList(Array.isArray(cfg.extraLiveSources) ? cfg.extraLiveSources : [], {
		config: cfg,
		...ctx,
	})

	return {
		...base,
		screenDestinations: normalizeScreenDestinations(cfg.screenDestinations),
		caspar: casparConn,
		ledTestPatternActive: ctx._ledTestPatternActive ?? false,
		/** Last DeckLink input PLAY summary after AMCP connect (WO-28); null until first routing setup. */
		decklinkInputsStatus: ctx._decklinkInputsStatus ?? null,
		liveAudioInputsStatus: ctx._liveAudioInputsStatus ?? null,
		v4l2InputsStatus: ctx._v4l2InputsStatus ?? null,
		virtualCameraStatus: require('./routes-virtual-camera').getStatusPayload(ctx),
		channelMap,
		scene: {
			live: liveSceneState.getAll(),
			programLayerBankByChannel: ctx.programLayerBankByChannel || {},
			deck: sceneDeck,
			...(globalBorders ? { globalBorders } : {}),
		},
		timeline: {
			list: timelines,
			playback: timelinePlayback,
		},
		playback: {
			matrix: playbackTracker.getMatrixForState(ctx),
		},
		/** Blocklisted compose-preview channels — bootstraps the client badge on WS connect/reconnect (WO-159 T159.2). */
		composePreview: { blocklist: getComposeBlocklistStats() },
		localMediaEnabled: !!(cfg.local_media_path || '').trim(),
		configComparison: ctx._configComparison || null,
		ui: cfg.ui || {},
		extraLiveSources: enrichExtraLiveSources(hostLiveMig.list, ctx),
		hostLiveMigrationWarnings: [...collectHostLiveConfigWarnings(cfg), ...hostLiveMig.warnings],
		...getHostOperatorFullscreenSnapshot(ctx),
		osc:
			base.osc !== undefined
				? base.osc
				: ctx.oscState && typeof ctx.oscState.getSnapshot === 'function'
					? ctx.oscState.getSnapshot()
					: null,
	}
}

/**
 * WS `state` broadcast: full snapshot, or slim bootstrap when env `HIGHASCG_WS_SLIM_BOOTSTRAP` is set (PF-01 / PF-04).
 * @param {{ _wsBroadcast?: Function, getState?: Function, getStateWsBootstrap?: Function, log?: Function }} ctx
 */
function broadcastWsStateSnapshot(ctx) {
	if (!ctx || typeof ctx._wsBroadcast !== 'function') return
	const slim =
		process.env.HIGHASCG_WS_SLIM_BOOTSTRAP === '1' ||
		String(process.env.HIGHASCG_WS_SLIM_BOOTSTRAP || '').toLowerCase() === 'true'
	try {
		if (slim && typeof ctx.getStateWsBootstrap === 'function') {
			ctx._wsBroadcast('state', ctx.getStateWsBootstrap())
		} else if (typeof ctx.getState === 'function') {
			ctx._wsBroadcast('state', ctx.getState())
		}
	} catch (e) {
		const m = e instanceof Error ? e.message : String(e)
		if (typeof ctx.log === 'function') ctx.log('warn', '[WS] state broadcast: ' + m)
	}
}

module.exports = { getState, broadcastWsStateSnapshot }

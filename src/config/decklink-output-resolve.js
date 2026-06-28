'use strict'

const { STANDARD_VIDEO_MODES, getModeDimensions } = require('./config-modes')
const { destinationsFromConfig } = require('./screen-destinations')
const { defaultVideoModeForProjectFps, default2160VideoModeForProjectFps, normalizeProjectFps } = require('./project-fps')
const { isDecklinkIoOut } = require('./decklink-io-direction')

const FPS_TOLERANCE = 0.02

/**
 * @param {number} a
 * @param {number} b
 */
function fpsNear(a, b) {
	return Math.abs(Number(a) - Number(b)) <= FPS_TOLERANCE
}

/**
 * Map feed timing to a Caspar standard video-mode id for DeckLink consumers.
 * @param {{ videoMode?: string, width?: number, height?: number, fps?: number }} feed
 * @returns {{ decklinkVideoMode: string|null, isCustom: boolean, mappedFromCustom: boolean }}
 */
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

/** Custom canvas height at or below 1080 lines → 1080p SDI; above → 2160p (project frame rate). */
const DECKLINK_AUTO_SDI_HEIGHT_1080 = 1080

/**
 * Pick a standard DeckLink SDI format for a wired feed.
 * Exact WxH@fps match wins; custom canvases bucket to 1080p or 2160p at project fps.
 * @param {{ videoMode?: string, width?: number, height?: number, fps?: number }} feed
 * @returns {{ decklinkVideoMode: string|null, source: 'exact'|'auto'|'none', mappedFromCustom: boolean, autoTier: '1080p'|'2160p'|null }}
 */
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

/**
 * @param {object} connector
 * @returns {string}
 */
function readConnectorDecklinkOutputVideoMode(connector) {
	return String(connector?.caspar?.decklinkOutputVideoMode || '').trim()
}

/**
 * SDI `<video-mode>`: operator override, exact standard match, or auto 1080p/2160p bucket for custom canvases.
 * @param {{ videoMode?: string, width?: number, height?: number, fps?: number }} feed
 * @param {string} [connectorOverride]
 * @returns {{ decklinkVideoMode: string|null, source: 'override'|'exact'|'auto'|'none', mappedFromCustom: boolean, autoTier: '1080p'|'2160p'|null }}
 */
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

/**
 * 1:1 passthrough subregion — channel pixels map to SDI without scaling.
 * Larger canvas overflows the SDI raster; smaller canvas leaves unused SDI area.
 * @param {{ width?: number, height?: number }} feed
 * @returns {{ srcX: number, srcY: number, destX: number, destY: number, width: number, height: number }|null}
 */
function buildDecklinkPassthroughSubregion(feed) {
	const width = Math.max(0, parseInt(String(feed?.width ?? 0), 10) || 0)
	const height = Math.max(0, parseInt(String(feed?.height ?? 0), 10) || 0)
	if (width <= 0 || height <= 0) return null
	return { srcX: 0, srcY: 0, destX: 0, destY: 0, width, height }
}

/**
 * Standard DeckLink `<video-mode>` for a tiled subregion.
 * Operator-selected output mode (e.g. 2160p5000) wins over slice WxH — Caspar scales subregions into that SDI format.
 * @param {{ width: number, height: number, fps?: number, modeHint?: string }} tile
 * @returns {string}
 */
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

/**
 * Parent `<video-mode>` for synced DeckLink `<ports>` — highest-resolution tile (same frame rate).
 * @param {{ videoMode?: string, width?: number, height?: number }[]} tiles
 * @returns {string}
 */
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

/**
 * @param {Record<string, unknown>} config
 * @param {number} screenN 1-based
 */
function feedFromScreenConfig(config, screenN) {
	const n = Math.max(1, parseInt(String(screenN), 10) || 1)
	const mode = String(config[`screen_${n}_mode`] || '1080p5000').trim() || '1080p5000'
	const dims = getModeDimensions(mode, config, n)
	return {
		sourceKind: 'screen',
		sourceLabel: `Program ${n}`,
		videoMode: dims.modeId,
		width: dims.width,
		height: dims.height,
		fps: dims.fps,
	}
}

/**
 * @param {Record<string, unknown>} config
 * @param {number} [mvN]
 */
function feedFromMultiviewConfig(config, mvN = 1) {
	const n = Math.max(1, parseInt(String(mvN), 10) || 1)
	const mode = String(config[`multiview_${n}_mode`] || config.multiview_mode || '1080p5000').trim() || '1080p5000'
	const dims = getModeDimensions(mode, config, 1)
	return {
		sourceKind: 'multiview',
		sourceLabel: n > 1 ? `Multiview ${n}` : 'Multiview',
		videoMode: dims.modeId,
		width: dims.width,
		height: dims.height,
		fps: dims.fps,
	}
}

/**
 * @param {Record<string, unknown>|null|undefined} dest
 */
function feedFromDestination(dest) {
	if (!dest || typeof dest !== 'object') return null
	const mode = String(dest.mode || 'pgm_prv')
	const videoMode = String(dest.videoMode || '1080p5000').trim() || '1080p5000'
	const width = Math.max(64, parseInt(String(dest.width ?? 1920), 10) || 1920)
	const height = Math.max(64, parseInt(String(dest.height ?? 1080), 10) || 1080)
	const fps = Math.max(1, parseFloat(String(dest.fps ?? 50)) || 50)
	const label = String(dest.label || dest.id || 'Destination')
	if (mode === 'multiview') {
		return {
			sourceKind: 'destination_multiview',
			sourceLabel: label,
			videoMode,
			width,
			height,
			fps,
		}
	}
	return {
		sourceKind: 'destination',
		sourceLabel: label,
		videoMode,
		width,
		height,
		fps,
	}
}

/**
 * Walk cable graph backward from a source connector id to a terminal feed id.
 * @param {Record<string, unknown>} config
 * @param {string} startSourceId
 */
function resolveTerminalSourceId(config, startSourceId) {
	const g = config?.deviceGraph
	if (!g || !Array.isArray(g.connectors)) return String(startSourceId || '').trim()
	const edges = Array.isArray(g.edges) ? g.edges : []
	const byId = new Map(g.connectors.map((c) => [String(c?.id || ''), c]))
	const seen = new Set()
	const queue = [String(startSourceId || '').trim()]

	while (queue.length) {
		const cur = queue.shift()
		if (!cur || seen.has(cur)) continue
		seen.add(cur)

		if (
			cur.startsWith('dst_in_') ||
			cur.startsWith('dst_ch') ||
			cur.startsWith('dst_mv')
		) {
			return cur
		}

		if (cur.startsWith('caspar_pgm_') || cur === 'caspar_mv_out') {
			const inEdges = edges.filter((e) => String(e?.sinkId || '') === cur)
			if (inEdges.length) {
				for (const ie of inEdges) queue.push(String(ie?.sourceId || ''))
				continue
			}
			return cur
		}

		const conn = byId.get(cur)
		if (conn?.kind === 'destination_in') {
			const did = String(conn.externalRef || '').trim()
			if (did) return `dst_in_${did}`
		}

		if (conn?.kind === 'pixel_map_out') {
			const nodeId = String(conn.deviceId || '')
			const nodeInputs = g.connectors.filter(
				(c) => String(c?.deviceId || '') === nodeId && c?.kind === 'pixel_map_in'
			)
			for (const ni of nodeInputs) {
				for (const ie of edges.filter((e) => String(e?.sinkId || '') === String(ni?.id || ''))) {
					queue.push(String(ie?.sourceId || ''))
				}
			}
			continue
		}

		for (const ie of edges.filter((e) => String(e?.sinkId || '') === cur)) {
			queue.push(String(ie?.sourceId || ''))
		}
	}

	return ''
}

/**
 * @param {Record<string, unknown>} config
 * @param {string} terminalId
 */
function feedFromTerminalSourceId(config, terminalId) {
	const destinations = destinationsFromConfig(config)
	const id = String(terminalId || '').trim()
	if (!id) return null

	if (id.startsWith('dst_in_')) {
		const destId = id.slice('dst_in_'.length)
		return feedFromDestination(destinations.find((d) => String(d?.id || '') === destId))
	}
	if (id.startsWith('dst_ch')) {
		const n = parseInt(id.slice('dst_ch'.length), 10)
		if (Number.isFinite(n) && n >= 1) {
			const dest = destinations.find((d) => (parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0) === n - 1)
			return feedFromDestination(dest) || feedFromScreenConfig(config, n)
		}
	}
	if (id.startsWith('dst_mv') || id === 'caspar_mv_out') {
		const mvDest = destinations.find((d) => String(d?.mode || '') === 'multiview')
		return feedFromDestination(mvDest) || feedFromMultiviewConfig(config)
	}
	if (id.startsWith('caspar_pgm_')) {
		const n = parseInt(id.slice('caspar_pgm_'.length), 10)
		if (Number.isFinite(n) && n >= 1) return feedFromScreenConfig(config, n)
	}
	return null
}

/**
 * @param {Record<string, unknown>} config
 * @param {object} connector
 */
function feedFromOutputBinding(config, connector) {
	const binding = connector?.caspar?.outputBinding
	if (!binding || typeof binding !== 'object') return null
	if (binding.type === 'multiview') return feedFromMultiviewConfig(config)
	if (binding.type === 'screen') {
		const n = Math.max(1, parseInt(String(binding.index ?? 1), 10) || 1)
		return feedFromScreenConfig(config, n)
	}
	return null
}

/**
 * @param {Record<string, unknown>} config
 * @param {object} connector
 */
function resolveUpstreamFeedForDecklinkConnector(config, connector) {
	const g = config?.deviceGraph
	const edges = Array.isArray(g?.edges) ? g.edges : []
	const incoming = edges.filter((e) => String(e?.sinkId || '') === String(connector?.id || ''))
	if (incoming.length) {
		const terminal = resolveTerminalSourceId(config, String(incoming[0]?.sourceId || ''))
		const feed = feedFromTerminalSourceId(config, terminal)
		if (feed) return { ...feed, cableResolved: true }
	}
	return { ...(feedFromOutputBinding(config, connector) || feedFromMultiviewConfig(config)), cableResolved: false }
}

/**
 * @param {Record<string, unknown>} config
 * @param {object} connector
 */
function resolveDecklinkOutputStatus(config, connector) {
	const feed = resolveUpstreamFeedForDecklinkConnector(config, connector)
	const override = readConnectorDecklinkOutputVideoMode(connector)
	const effective = resolveEffectiveDecklinkVideoMode(feed, override)
	const match = matchStandardDecklinkVideoMode(feed)
	const inherited = {
		sourceLabel: feed.sourceLabel || '',
		sourceKind: feed.sourceKind || '',
		videoMode: feed.videoMode || '',
		width: feed.width || 0,
		height: feed.height || 0,
		fps: feed.fps || 0,
		standardModeId: effective.decklinkVideoMode || match.decklinkVideoMode,
		mappedFromCustom: effective.mappedFromCustom,
		outputModeSource: effective.source,
		operatorOutputMode: override || '',
		cableResolved: !!feed.cableResolved,
	}

	if (!effective.decklinkVideoMode) {
		let reason = 'Cable a destination to this SDI port, then pick SDI format below if needed'
		if (!feed.cableResolved && !feed.sourceLabel) reason = 'No upstream cable — wire a destination feed to this SDI port'
		else if (match.isCustom) {
			const w = feed.width || 0
			const h = feed.height || 0
			reason =
				w > 0 && h > 0
					? `Custom ${w}×${h} needs SDI format — auto mapping failed (missing canvas size?)`
					: 'Set SDI output format below (upstream canvas size unknown)'
		}
		return {
			ok: false,
			reason,
			inherited,
			decklinkVideoMode: null,
		}
	}

	let reason = ''
	if (effective.source === 'override') reason = 'SDI format set on this port (1:1 passthrough)'
	else if (effective.source === 'auto') {
		const wh =
			inherited.width && inherited.height ? `${inherited.width}×${inherited.height}` : 'custom canvas'
		const tier = effective.autoTier === '2160p' ? '2160p' : '1080p'
		reason = `Auto ${effective.decklinkVideoMode}: ${wh} → ${tier} SDI at project frame rate (1:1 passthrough)`
	} else if (effective.mappedFromCustom) reason = 'Upstream WxH matches standard mode'

	return {
		ok: true,
		reason,
		inherited,
		decklinkVideoMode: effective.decklinkVideoMode,
	}
}

/**
 * @param {Record<string, unknown>} config
 */
function isDecklinkOutputConnector(c) {
	if (!c || typeof c !== 'object') return false
	if (c.kind === 'decklink_out') return true
	return c.kind === 'decklink_io' && isDecklinkIoOut(c)
}

/**
 * @param {Record<string, unknown>} config
 */
function listDecklinkOutputStatuses(config) {
	const g = config?.deviceGraph
	const connectors = Array.isArray(g?.connectors) ? g.connectors : []
	const out = []
	for (const c of connectors) {
		if (!isDecklinkOutputConnector(c)) continue
		const deviceIndex = parseInt(String(c.externalRef || '0'), 10) || 0
		const status = resolveDecklinkOutputStatus(config, c)
		out.push({
			connectorId: String(c.id || ''),
			deviceIndex,
			kind: String(c.kind || ''),
			...status,
		})
	}
	return out
}

/**
 * Resolve DeckLink video-mode for a Caspar screen or multiview output target.
 * @param {Record<string, unknown>} config
 * @param {'screen'|'multiview'} targetType
 * @param {number} [targetN] 1-based screen or multiview index
 */
function resolveDecklinkVideoModeForTarget(config, targetType, targetN = 1) {
	const g = config?.deviceGraph
	const connectors = Array.isArray(g?.connectors) ? g.connectors : []
	const edges = Array.isArray(g?.edges) ? g.edges : []
	const n = Math.max(1, parseInt(String(targetN), 10) || 1)
	const prefix = targetType === 'multiview' ? 'multiview_' : `screen_${n}_`
	const deviceNum =
		parseInt(String(config[`${prefix}decklink_device`] || (targetType === 'multiview' ? config.multiview_decklink_device : 0) || '0'), 10) || 0

	for (const c of connectors) {
		if (!isDecklinkOutputConnector(c)) continue
		if (parseInt(String(c.externalRef || '0'), 10) !== deviceNum) continue
		const incoming = edges.filter((e) => String(e?.sinkId || '') === String(c.id || ''))
		if (incoming.length) {
			const st = resolveDecklinkOutputStatus(config, c)
			if (st.decklinkVideoMode) return st.decklinkVideoMode
		}
		const binding = c.caspar?.outputBinding
		if (targetType === 'multiview' && binding?.type === 'multiview') {
			const st = resolveDecklinkOutputStatus(config, c)
			if (st.decklinkVideoMode) return st.decklinkVideoMode
		}
		if (targetType === 'screen' && binding?.type === 'screen' && (parseInt(String(binding.index ?? 1), 10) || 1) === n) {
			const st = resolveDecklinkOutputStatus(config, c)
			if (st.decklinkVideoMode) return st.decklinkVideoMode
		}
	}

	const flatOverride = String(config[`${prefix}decklink_output_video_mode`] || '').trim()
	if (flatOverride && STANDARD_VIDEO_MODES[flatOverride]) return flatOverride

	if (targetType === 'multiview') {
		const feed = feedFromMultiviewConfig(config, n)
		return resolveEffectiveDecklinkVideoMode(feed).decklinkVideoMode
	}
	const feed = feedFromScreenConfig(config, n)
	return resolveEffectiveDecklinkVideoMode(feed).decklinkVideoMode
}

/**
 * @param {Record<string, unknown>} config
 * @returns {string[]}
 */
function validateDecklinkOutputResolutions(config) {
	const warnings = []
	for (const st of listDecklinkOutputStatuses(config)) {
		const cid = st.connectorId || `device_${st.deviceIndex}`
		if (!st.ok) {
			warnings.push(`decklink_output_custom_resolution:${cid}: ${st.reason}`)
			continue
		}
		const mode = String(st.decklinkVideoMode || st.inherited?.standardModeId || '').toLowerCase()
		if (/^2160p/.test(mode) || (st.inherited?.height >= 2160 && st.inherited?.width >= 3840)) {
			warnings.push(
				`decklink_output_uhd_format:${cid}: ${mode || 'UHD'} on device ${st.deviceIndex} — verify Desktop Video connector mapping and Caspar DeckLink format for this UHD output.`,
			)
		}
	}
	return warnings
}

/**
 * Channel `<video-mode>` when a DeckLink consumer is present.
 * Caspar rejects DeckLink when channel format ≠ consumer format.
 * @param {{ channelModeId: string, isChannelCustom: boolean, decklinkVideoMode: string|null, hasScreenConsumer: boolean, decklinkReplaceScreen?: boolean }} opts
 * @returns {string}
 */
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
	resolveTerminalSourceId,
	resolveUpstreamFeedForDecklinkConnector,
	resolveDecklinkOutputStatus,
	listDecklinkOutputStatuses,
	resolveDecklinkVideoModeForTarget,
	validateDecklinkOutputResolutions,
	isDecklinkOutputConnector,
	feedFromScreenConfig,
	feedFromMultiviewConfig,
	channelVideoModeForDecklinkConsumer,
}

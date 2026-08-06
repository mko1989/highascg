'use strict'

const { STANDARD_VIDEO_MODES } = require('./config-modes')
const { isDecklinkIoOut } = require('./decklink-io-direction')
const {
	matchStandardDecklinkVideoMode,
	readConnectorDecklinkOutputVideoMode,
	resolveEffectiveDecklinkVideoMode,
} = require('./decklink-output-resolve-modes')
const {
	feedFromScreenConfig,
	feedFromMultiviewConfig,
	resolveUpstreamFeedForDecklinkConnector,
} = require('./decklink-output-resolve-feed')

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

function isDecklinkOutputConnector(c) {
	if (!c || typeof c !== 'object') return false
	if (c.kind === 'decklink_out') return true
	return c.kind === 'decklink_io' && isDecklinkIoOut(c)
}

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

module.exports = {
	resolveDecklinkOutputStatus,
	isDecklinkOutputConnector,
	listDecklinkOutputStatuses,
	resolveDecklinkVideoModeForTarget,
	validateDecklinkOutputResolutions,
}

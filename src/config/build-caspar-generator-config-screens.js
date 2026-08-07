'use strict'

const { isMainBusDestinationMode } = require('./routing-map')
const { STANDARD_VIDEO_MODES, normalizeVideoModeId } = require('./config-modes')
const { destinationsFromConfig } = require('./screen-destinations')
const {
	reachesGpuFromSource,
	createDestinationWiringContext,
	destinationSourceIds,
} = require('./device-graph-destination-wiring')
const {
	getDestinationList,
	parseCustomVideoModeString,
} = require('./build-caspar-generator-destination-utils')

/**
 * Owner spec (todos21.07.26): an NDI stream output "should not have a start stream but be treated
 * as an sdi out, it gets added as a screen consumer in the config and is on always without any
 * settings other than changing the id/label".
 *
 * So: for every enabled `type: 'ndi'` entry in streamOutputs that is CABLED from a main
 * destination in the device graph (edge dst_in_<destId> ↔ <outputId>), collect its name onto that
 * destination's screen as `screen_${n}_ndi_stream_names`. config-generator-consumer-attach.js
 * emits one `<ndi>` consumer per name, right next to the existing per-screen
 * `screen_${n}_ndi_enabled` block — same consumer, different source of truth. No runtime process
 * and no Start button: the consumer lives in casparcg.config and is on for as long as Caspar runs.
 * @param {Record<string, unknown>} merged flat generator config (mutated)
 * @param {Record<string, unknown>} appConfig
 */
function applyNdiStreamOutputsToScreens(merged, appConfig) {
	const outputs = Array.isArray(appConfig?.streamOutputs) ? appConfig.streamOutputs : []
	const ndiOutputs = outputs.filter(
		(o) => o && String(o.type || '').toLowerCase() === 'ndi' && o.enabled !== false,
	)
	if (!ndiOutputs.length) return
	const graph = appConfig?.deviceGraph
	const edges = Array.isArray(graph?.edges) ? graph.edges : []
	const dests = getDestinationList(appConfig)

	for (const out of ndiOutputs) {
		const outId = String(out.id || '').trim()
		if (!outId) continue
		// Cables are stored dst_in_<destId> → <outputId> today, but match both directions — the
		// graph editor has produced either depending on which end the operator grabbed first.
		const edge = edges.find(
			(e) =>
				(String(e?.sinkId || '') === outId && String(e?.sourceId || '').startsWith('dst_in_')) ||
				(String(e?.sourceId || '') === outId && String(e?.sinkId || '').startsWith('dst_in_')),
		)
		if (!edge) continue
		const destInId = String(edge.sinkId || '') === outId ? String(edge.sourceId || '') : String(edge.sinkId || '')
		const destId = destInId.slice('dst_in_'.length)
		const dest = dests.find((d) => String(d?.id || '') === destId)
		if (!dest || !isMainBusDestinationMode(dest.mode)) continue
		const n = Math.max(1, (parseInt(String(dest.mainScreenIndex ?? 0), 10) || 0) + 1)
		const key = `screen_${n}_ndi_stream_names`
		const list = Array.isArray(merged[key]) ? merged[key] : (merged[key] = [])
		const name = String(out.name || out.label || outId).trim() || outId
		if (!list.includes(name)) list.push(name)
	}
}

/**
 * Project destination panel state into Caspar generator screen settings.
 * Priority: destination `videoMode` when standard, otherwise destination `width/height/fps` as custom mode.
 * @param {Record<string, unknown>} merged
 * @param {Record<string, unknown>} appConfig
 */
function applyDestinationOverridesToScreens(merged, appConfig) {
	const rawList = destinationsFromConfig(appConfig || {})
	const list = getDestinationList(appConfig)
	if (!list.length) return
	// WO-274: must match routing-map's main-bus predicate exactly. This filter previously omitted
	// `operator_gui`, so an operator GUI destination parked on a high mainScreenIndex pushed
	// `merged.screen_count` past the real PGM/PRV count that resolveMainScreenCount had just computed.
	const routable = list.filter((d) => isMainBusDestinationMode(d?.mode))
	if (!routable.length) return
	const mainIdxs = routable.map((d) => Math.max(0, parseInt(String(d.mainScreenIndex ?? 0), 10) || 0))
	const dstCount = Math.max(...mainIdxs, 0) + 1
	merged.screen_count = Math.max(1, dstCount)

	const hasPanelOverrides = rawList.some(
		(d) => d && typeof d === 'object' && ('mode' in d || 'videoMode' in d || 'width' in d || 'height' in d || 'fps' in d)
	)
	if (!hasPanelOverrides) return
	for (let idx = 0; idx < merged.screen_count; idx++) {
		const perMain = routable.filter((d) => (parseInt(String(d.mainScreenIndex ?? 0), 10) || 0) === idx)
		if (!perMain.length) continue
		const picked = perMain.find((d) => d.videoMode && d.videoMode !== '1080p5000') || perMain.find((d) => String(d.mode || 'pgm_prv') === 'pgm_prv') || perMain[0]
		const modeRaw = String(picked.videoMode || '').trim()
		const width = Math.max(64, parseInt(String(picked.width ?? 0), 10) || 0)
		const height = Math.max(64, parseInt(String(picked.height ?? 0), 10) || 0)
		const fps = Math.max(1, parseFloat(String(picked.fps ?? 50)) || 50)
		const n = idx + 1
		// Normalize mode aliases (e.g. '1080p50' → '1080p5000') and check if standard
		const normalized = modeRaw ? normalizeVideoModeId(modeRaw) : ''
		if (normalized && STANDARD_VIDEO_MODES[normalized]) {
			merged[`screen_${n}_mode`] = normalized
			continue
		}
		const customFromMode = parseCustomVideoModeString(modeRaw)
		if (customFromMode) {
			merged[`screen_${n}_mode`] = 'custom'
			merged[`screen_${n}_custom_width`] = customFromMode.w
			merged[`screen_${n}_custom_height`] = customFromMode.h
			merged[`screen_${n}_custom_fps`] = customFromMode.fps
			continue
		}
		if (width > 0 && height > 0) {
			merged[`screen_${n}_mode`] = 'custom'
			merged[`screen_${n}_custom_width`] = width
			merged[`screen_${n}_custom_height`] = height
			merged[`screen_${n}_custom_fps`] = fps
		}
	}
}

/**
 * Project multiview destination panel videoMode into `multiview_mode` for generator + channel plan.
 * @param {Record<string, unknown>} merged
 * @param {Record<string, unknown>} appConfig
 */
function applyMultiviewDestinationOverrides(merged, appConfig) {
	const list = destinationsFromConfig(appConfig || {})
	const mvDest = list.find((d) => d && String(d.mode || '') === 'multiview')
	if (!mvDest) return

	const modeRaw = String(mvDest.videoMode || '').trim()
	const width = Math.max(64, parseInt(String(mvDest.width ?? 0), 10) || 0)
	const height = Math.max(64, parseInt(String(mvDest.height ?? 0), 10) || 0)
	const fps = Math.max(1, parseFloat(String(mvDest.fps ?? 50)) || 50)

	if (modeRaw && STANDARD_VIDEO_MODES[modeRaw]) {
		merged.multiview_mode = modeRaw
		return
	}
	const customFromMode = parseCustomVideoModeString(modeRaw)
	if (customFromMode) {
		merged.multiview_mode = 'custom'
		merged.multiview_custom_width = customFromMode.w
		merged.multiview_custom_height = customFromMode.h
		merged.multiview_custom_fps = customFromMode.fps
		return
	}
	if (width > 0 && height > 0) {
		merged.multiview_mode = 'custom'
		merged.multiview_custom_width = width
		merged.multiview_custom_height = height
		merged.multiview_custom_fps = fps
	}
}

function applyScreenConsumerOverridesFromCabling(merged, appConfig) {
	const destinations = destinationsFromConfig(appConfig || {})
	const ctx = createDestinationWiringContext(appConfig)
	if (!ctx.g.connectors?.length || !destinations.length) return

	for (const dest of destinations) {
		const mode = String(dest?.mode || 'pgm_prv')
		if (mode === 'multiview' || mode === 'stream') continue
		const idx = Math.max(0, parseInt(String(dest?.mainScreenIndex ?? 0), 10) || 0)
		const n = idx + 1
		const srcCandidates = destinationSourceIds(dest, idx, ctx)
		/* WO-364: only PGM-half cables count — a PRV-only GPU cable must not enable screen_N. */
		merged[`screen_${n}_screen_consumer`] = srcCandidates.some((src) => reachesGpuFromSource(src, ctx, { pgmOnly: true }))
	}
}

module.exports = {
	applyNdiStreamOutputsToScreens,
	applyDestinationOverridesToScreens,
	applyMultiviewDestinationOverrides,
	applyScreenConsumerOverridesFromCabling,
}

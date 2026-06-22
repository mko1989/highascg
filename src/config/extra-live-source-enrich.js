'use strict'

const { buildChannelMap } = require('./channel-map-from-ctx')
const { loadFullProject } = require('../engine/project-scenes')

/**
 * @param {string} value
 * @returns {{ channel: number, layer: number | null } | null}
 */
function parseRouteChannelLayer(value) {
	const m = String(value || '')
		.trim()
		.match(/^route:\/\/(\d+)(?:-(\d+))?$/i)
	if (!m) return null
	const channel = parseInt(m[1], 10)
	const layer = m[2] != null ? parseInt(m[2], 10) : null
	if (!Number.isFinite(channel) || channel < 1) return null
	if (layer != null && (!Number.isFinite(layer) || layer < 1)) return null
	return { channel, layer }
}

/**
 * @param {number} channelW
 * @param {number} channelH
 * @param {{ x?: number, y?: number, scaleX?: number, scaleY?: number }} fill
 * @returns {{ w: number, h: number } | null}
 */
function resolutionPixelsFromNormalizedFill(channelW, channelH, fill) {
	if (!fill || !(channelW > 0) || !(channelH > 0)) return null
	const sx = Number(fill.scaleX)
	const sy = Number(fill.scaleY)
	if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return null
	return {
		w: Math.max(1, Math.round(channelW * sx)),
		h: Math.max(1, Math.round(channelH * sy)),
	}
}

function formatResolution(w, h) {
	return `${Math.max(1, Math.round(w))}×${Math.max(1, Math.round(h))}`
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {number} layer
 * @returns {{ fill?: object, contentResolution?: { w: number, h: number } } | null}
 */
function findPublisherLayerFromProject(ctx, channel, layer) {
	let project = null
	try {
		project = loadFullProject()
	} catch {
		project = null
	}
	const scenes = project?.scenes?.scenes
	if (!Array.isArray(scenes)) return null
	for (const scene of scenes) {
		const layers = scene?.layers
		if (!Array.isArray(layers)) continue
		const row = layers.find((l) => Number(l?.layerNumber) === layer)
		if (!row) continue
		const src = row.source || {}
		let contentResolution = null
		const resStr = src.resolution || src.res
		if (typeof resStr === 'string') {
			const m = resStr.match(/(\d+)[×x](\d+)/i)
			if (m) contentResolution = { w: parseInt(m[1], 10) || 0, h: parseInt(m[2], 10) || 0 }
		}
		return {
			fill: row.fill && typeof row.fill === 'object' ? { ...row.fill } : undefined,
			contentResolution:
				contentResolution && contentResolution.w > 0 && contentResolution.h > 0 ? contentResolution : undefined,
		}
	}
	return null
}

/**
 * @param {object} ctx
 * @param {number} channel
 */
function pickChannelResolution(ctx, channel) {
	const cm = buildChannelMap(ctx)
	const n = parseInt(String(channel), 10)
	if (cm?.channelResolutionsByChannel?.[n]?.w > 0) {
		const r = cm.channelResolutionsByChannel[n]
		return { w: r.w, h: r.h, fps: r.fps }
	}
	const progIdx = (cm.programChannels || []).indexOf(n)
	if (progIdx >= 0 && cm.programResolutions?.[progIdx]?.w > 0) {
		const r = cm.programResolutions[progIdx]
		return { w: r.w, h: r.h, fps: r.fps }
	}
	const prvIdx = (cm.previewChannels || []).indexOf(n)
	if (prvIdx >= 0 && cm.previewResolutions?.[prvIdx]?.w > 0) {
		const r = cm.previewResolutions[prvIdx]
		return { w: r.w, h: r.h, fps: r.fps }
	}
	const input = (cm.inputChannels || []).find((e) => Number(e.channel) === n)
	if (input?.resolution?.w > 0) {
		return { w: input.resolution.w, h: input.resolution.h, fps: input.resolution.fps }
	}
	return { w: 1920, h: 1080, fps: 50 }
}

/**
 * Enrich persisted / API extra live source metadata (layer route resolution, PRINT targets).
 * @param {object} item
 * @param {object} ctx
 * @returns {object}
 */
function enrichExtraLiveSource(item, ctx) {
	if (!item || typeof item !== 'object') return item
	const out = { ...item }
	const parsed = parseRouteChannelLayer(out.value)
	if (!parsed) return out

	const chRes = pickChannelResolution(ctx, parsed.channel)
	const routeType = String(out.routeType || '').toLowerCase()

	if (routeType === 'layer' && parsed.layer != null) {
		let fill = out.fill && typeof out.fill === 'object' ? out.fill : out.sourceFill
		if (!fill) {
			const fromProject = findPublisherLayerFromProject(ctx, parsed.channel, parsed.layer)
			if (fromProject?.fill) fill = fromProject.fill
		}
		const dims = fill ? resolutionPixelsFromNormalizedFill(chRes.w, chRes.h, fill) : null
		if (dims) {
			out.fill = fill
			out.resolution = formatResolution(dims.w, dims.h)
		}
		out.thumbnailChannel = parsed.channel
		out.thumbnailLayer = parsed.layer
	} else if (routeType === 'decklink' || out.decklinkSlot != null) {
		const cm = buildChannelMap(ctx)
		const slot = Number(out.decklinkSlot) || parsed.layer || 1
		const entry = (cm.inputChannels || []).find((e) => e.kind === 'decklink' && Number(e.slot) === slot)
		if (entry?.resolution?.w > 0) {
			out.resolution = formatResolution(entry.resolution.w, entry.resolution.h)
			if (entry.resolution.fps != null) out.fps = String(entry.resolution.fps)
		}
		out.thumbnailChannel = Number(out.inputsChannel) || parsed.channel
		out.thumbnailLayer = Number(out.inputsLayer) || parsed.layer || slot
	} else {
		out.thumbnailChannel = parsed.channel
		if (!out.resolution) out.resolution = formatResolution(chRes.w, chRes.h)
	}

	if (chRes.fps != null && out.fps == null) out.fps = String(chRes.fps)
	return out
}

/**
 * @param {object[]} list
 * @param {object} ctx
 * @returns {object[]}
 */
function enrichExtraLiveSources(list, ctx) {
	if (!Array.isArray(list)) return []
	return list.map((item) => enrichExtraLiveSource(item, ctx))
}

/**
 * PRINT / thumbnail target for a live source tile.
 * @param {object} item
 * @returns {{ channel: number, layer?: number }}
 */
function resolveLiveSourcePrintTarget(item) {
	if (!item || typeof item !== 'object') return { channel: 1 }
	const thumbLayer = parseInt(String(item.thumbnailLayer ?? ''), 10)
	const thumbCh = parseInt(String(item.thumbnailChannel ?? ''), 10)
	if (Number.isFinite(thumbCh) && thumbCh >= 1) {
		return Number.isFinite(thumbLayer) && thumbLayer >= 1
			? { channel: thumbCh, layer: thumbLayer }
			: { channel: thumbCh }
	}
	const parsed = parseRouteChannelLayer(item.value)
	if (!parsed) return { channel: 1 }
	if (String(item.routeType || '').toLowerCase() === 'layer' && parsed.layer != null) {
		return { channel: parsed.channel, layer: parsed.layer }
	}
	return { channel: parsed.channel, layer: parsed.layer ?? undefined }
}

module.exports = {
	parseRouteChannelLayer,
	resolutionPixelsFromNormalizedFill,
	enrichExtraLiveSource,
	enrichExtraLiveSources,
	resolveLiveSourcePrintTarget,
}

/**
 * MIXER FILL math (shared: inspector + Companion selection sync).
 * Mirrors Node ui-selection.js calcMixerFill — keep in sync when changing modes.
 */

import { fillToPixelRect } from './fill-math.js'
import { api } from './api-client.js'

/**
 * Layer fills are authored in program compose pixels; PRV may differ (letterbox / pillarbox).
 * Map a pixel rect from program space into the AMCP target channel output (uniform scale, centered).
 * @param {{ x: number, y: number, w: number, h: number }} px
 */
export function mapProgramPixelRectToTargetOutput(px, progW, progH, outW, outH) {
	const pw = Math.max(1, progW)
	const ph = Math.max(1, progH)
	const ow = Math.max(1, outW)
	const oh = Math.max(1, outH)
	if (Math.abs(pw - ow) < 0.5 && Math.abs(ph - oh) < 0.5) {
		return { x: px.x, y: px.y, w: px.w, h: px.h }
	}
	const k = Math.min(ow / pw, oh / ph)
	const ox = (ow - pw * k) / 2
	const oy = (oh - ph * k) / 2
	return {
		x: px.x * k + ox,
		y: px.y * k + oy,
		w: px.w * k,
		h: px.h * k,
	}
}

/**
 * Compute MIXER FILL {x, y, xScale, yScale} for a layer.
 * CasparCG MIXER FILL semantics: xScale/yScale = 1 means source fills the entire channel.
 * So to show a 960px source on a 1920px channel at native 1:1 pixels, xScale = 960/1920 = 0.5.
 * @param {object} ls - { x, y, w, h, stretch }
 */
export function calcMixerFill(ls, res, contentRes) {
	const stretch = ls.stretch || 'none'
	const lx = ls.x ?? 0
	const ly = ls.y ?? 0
	const lw = ls.w ?? res.w
	const lh = ls.h ?? res.h
	const nx = lx / res.w
	const ny = ly / res.h

	if (stretch === 'stretch') {
		return { x: nx, y: ny, xScale: lw / res.w, yScale: lh / res.h }
	}

	const cw = contentRes?.w > 0 ? contentRes.w : null
	const ch = contentRes?.h > 0 ? contentRes.h : null
	const contentAR = cw && ch ? cw / ch : 16 / 9

	if (stretch === 'none') {
		if (cw && ch) {
			return { x: nx, y: ny, xScale: cw / res.w, yScale: ch / res.h }
		}
		return { x: nx, y: ny, xScale: lw / res.w, yScale: lh / res.h }
	}
	if (stretch === 'fit') {
		if (cw && ch) {
			const fitScale = Math.min(lw / cw, lh / ch)
			return { x: nx, y: ny, xScale: (cw * fitScale) / res.w, yScale: (ch * fitScale) / res.h }
		}
		const ar = contentAR
		const fitW = Math.min(lw, lh * ar)
		const fitH = fitW / ar
		return { x: nx, y: ny, xScale: fitW / res.w, yScale: fitH / res.h }
	}
	if (stretch === 'fill-h') {
		const outW = lw
		const outH = outW / contentAR
		return { x: nx, y: ny, xScale: outW / res.w, yScale: outH / res.h }
	}
	if (stretch === 'fill-v') {
		const outH = lh
		const outW = outH * contentAR
		return { x: nx, y: ny, xScale: outW / res.w, yScale: outH / res.h }
	}
	return { x: nx, y: ny, xScale: lw / res.w, yScale: lh / res.h }
}

export function parseResolutionString(s) {
	if (!s || typeof s !== 'string') return null
	const m = String(s).match(/(\d+)[×x](\d+)/i)
	return m ? { w: parseInt(m[1], 10) || 0, h: parseInt(m[2], 10) || 0 } : null
}

/** Strip trailing H.265/HEVC filename hints so CLS duplicates merge (must match server media-browser-dedupe). */
function stripEncodingTechSuffixFromBasename(base) {
	let s = String(base || '').trim()
	s = s.replace(/\s*\(h\.?265\)\s*$/i, '')
	s = s.replace(/\s*\[h\.?265\]\s*$/i, '')
	s = s.replace(/\s+h\.?265$/i, '')
	s = s.replace(/_h\.?265$/i, '')
	s = s.replace(/_hevc$/i, '')
	s = s.replace(/\s*\(hevc\)\s*$/i, '')
	s = s.replace(/\s+hevc$/i, '')
	return s.trim()
}

/** Lowercase, strip extension — Caspar AMCP often omits extension vs media list ids. */
export function normalizeMediaIdForMatch(id) {
	let base = String(id || '')
		.toLowerCase()
		.replace(/\\/g, '/')
		.replace(/^.*\//, '')
		.replace(/\.[^./]+$/, '')
		.trim()
	base = stripEncodingTechSuffixFromBasename(base)
	return base
}

/**
 * @param {{ id?: string }[]} media
 * @param {string} value - layer source.value (Caspar id or filename)
 * @returns {{ id?: string, resolution?: string } | null}
 */
export function findMediaRow(media, value) {
	if (!value || !Array.isArray(media)) return null
	const exact = media.find((x) => x.id === value)
	if (exact) return exact
	const nv = normalizeMediaIdForMatch(value)
	for (const x of media) {
		if (normalizeMediaIdForMatch(x.id) === nv) return x
	}
	return null
}

/** Default scene fill = full channel (Caspar stretch). */
export function isFullCanvasFill(f) {
	if (!f) return true
	const x = f.x ?? 0
	const y = f.y ?? 0
	const sx = f.scaleX ?? 1
	const sy = f.scaleY ?? 1
	const e = 1e-5
	return Math.abs(x) < e && Math.abs(y) < e && Math.abs(sx - 1) < e && Math.abs(sy - 1) < e
}

/**
 * Reject stored fills that are clearly broken (e.g. after switching to a different aspect source without
 * recomputing native) — negative anchors with huge scale, NaN, etc.
 */
export function isMixerFillReasonable(f) {
	if (!f) return true
	const x = f.x ?? 0
	const y = f.y ?? 0
	const sx = f.scaleX ?? 1
	const sy = f.scaleY ?? 1
	if (![x, y, sx, sy].every((n) => typeof n === 'number' && Number.isFinite(n))) return false
	if (sx <= 0 || sy <= 0) return false
	if (sx > 2 || sy > 2) return false
	if (x < -0.5 || y < -0.5 || x > 1.5 || y > 1.5) return false
	return true
}

/** Caspar FILL is left, top, width, height in 0–1. Full width/height with non-zero origin is inconsistent with letterbox — recompute native. */
export function isFullScaleWithNonZeroOrigin(f) {
	const e = 1e-5
	const x = f.x ?? 0
	const y = f.y ?? 0
	const sx = f.scaleX ?? 1
	const sy = f.scaleY ?? 1
	const fullScale = Math.abs(sx - 1) < e && Math.abs(sy - 1) < e
	const hasOrigin = Math.abs(x) > e || Math.abs(y) > e
	return fullScale && hasOrigin
}

/**
 * Resolve media pixel size for letterbox math: state, /api/media row, then ffprobe on disk.
 * @param {{ type?: string, value?: string, resolution?: string }} source
 * @param {() => Promise<object[]>} [fetchMediaList] - e.g. cached GET /api/media
 * @returns {Promise<{ w: number, h: number } | null>}
 */
export async function fetchMediaContentResolution(source, stateStore, screenIdx, fetchMediaList) {
	if (!source?.value) return null
	let contentRes = null
	if (source.resolution) contentRes = parseResolutionString(source.resolution)
	if (!contentRes?.w) contentRes = getContentResolution(source, stateStore, screenIdx)
	if (!contentRes?.w && typeof fetchMediaList === 'function') {
		try {
			const list = await fetchMediaList()
			const row = findMediaRow(Array.isArray(list) ? list : [], source.value)
			contentRes = parseResolutionString(row?.resolution) || null
		} catch {
			/* ignore */
		}
	}
	const t = String(source.type || '').toLowerCase()
	if (!contentRes?.w && (t === 'media' || t === 'file')) {
		try {
			const probe = await api.get(`/api/local-media/${encodeURIComponent(source.value)}/probe`)
			if (probe?.resolution) contentRes = parseResolutionString(probe.resolution)
		} catch {
			/* ignore — path not on disk or ffprobe missing */
		}
	}
	return contentRes?.w > 0 && contentRes?.h > 0 ? contentRes : null
}

/**
 * Map scene layer content fit UI to calcMixerFill stretch mode.
 * @param {{ contentFit?: string, fillNativeAspect?: boolean }} layer
 * @returns {'fit' | 'fill-h' | 'fill-v' | 'stretch'}
 */
export function mapContentFitToStretch(layer) {
	const cf = layer.contentFit
	if (cf === 'horizontal') return 'fill-h'
	if (cf === 'vertical') return 'fill-v'
	if (cf === 'stretch') return 'stretch'
	if (cf === 'fill-canvas') return 'fit'
	if (layer.fillNativeAspect === false) return 'stretch'
	return 'fit'
}

/**
 * MIXER FILL for scene preview / AMCP: layer rectangle + content fit (fit / fill-h / fill-v / stretch).
 * Normalized fill is relative to the **program** compose canvas; `targetOutputCanvas` is the channel
 * receiving the command (usually PRV — map into that pixel space when it differs from program).
 */
export async function resolveLayerFillForAmcp(layer, stateStore, screenIdx, targetOutputCanvas, fetchMediaList) {
	const raw = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
	const f = {
		x: raw.x ?? 0,
		y: raw.y ?? 0,
		scaleX: raw.scaleX ?? 1,
		scaleY: raw.scaleY ?? 1,
	}
	const src = layer.source
	if (!src?.value) return f
	const t = String(src.type || '').toLowerCase()
	if (t === 'timeline' || String(src.value || '').startsWith('route://')) return f

	const stretchMode = mapContentFitToStretch(layer)
	if (stretchMode === 'stretch') return f

	const contentRes = await fetchMediaContentResolution(src, stateStore, screenIdx, fetchMediaList)
	const state = stateStore?.getState?.() || {}
	const cm = state.channelMap || {}
	const s = screenIdx ?? 0
	const prog = cm.programResolutions?.[s]
	const progW = prog?.w > 0 ? prog.w : 1920
	const progH = prog?.h > 0 ? prog.h : 1080
	const outW = targetOutputCanvas?.width > 0 ? targetOutputCanvas.width : progW
	const outH = targetOutputCanvas?.height > 0 ? targetOutputCanvas.height : progH

	const px = fillToPixelRect(f, { width: progW, height: progH })
	const mapped = mapProgramPixelRectToTargetOutput(px, progW, progH, outW, outH)
	const ls = { x: mapped.x, y: mapped.y, w: mapped.w, h: mapped.h, stretch: stretchMode }
	const out = calcMixerFill(ls, { w: outW, h: outH }, contentRes)
	return { x: out.x, y: out.y, scaleX: out.xScale, scaleY: out.yScale }
}

/** @param {{ type?: string, value?: string }} source */
export function getContentResolution(source, stateStore, screenIdx = 0) {
	if (!source?.value) return null
	const state = stateStore?.getState?.() || {}
	const channelMap = state.channelMap || {}
	if (source.type === 'media' || source.type === 'file') {
		const media = state.media || []
		const m = findMediaRow(media, source.value)
		return parseResolutionString(m?.resolution) || null
	}
	if (source.type === 'route' || String(source.value || '').startsWith('route://')) {
		const match = String(source.value || '').match(/route:\/\/(\d+)(?:-(\d+))?/)
		if (match) {
			const ch = parseInt(match[1], 10)
			const inputsCh = channelMap.inputsCh
			if (inputsCh != null && ch === inputsCh) {
				const ir = channelMap.inputsResolution
				return ir ? { w: ir.w, h: ir.h } : null
			}
			const programChannels = channelMap.programChannels || []
			const previewChannels = channelMap.previewChannels || []
			const pci = programChannels.indexOf(ch)
			if (pci >= 0) {
				const pr = channelMap.programResolutions?.[pci] ?? channelMap.programResolutions?.[screenIdx]
				return pr ? { w: pr.w, h: pr.h } : null
			}
			const pvi = previewChannels.indexOf(ch)
			if (pvi >= 0) {
				const pr = channelMap.previewResolutions?.[pvi] ?? channelMap.programResolutions?.[screenIdx]
				return pr ? { w: pr.w, h: pr.h } : null
			}
			const pr = channelMap.programResolutions?.[screenIdx]
			return pr ? { w: pr.w, h: pr.h } : null
		}
	}
	const pr = channelMap.programResolutions?.[screenIdx]
	return pr ? { w: pr.w, h: pr.h } : null
}

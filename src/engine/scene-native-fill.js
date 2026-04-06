/**
 * Scene layer MIXER FILL — same “contain / original aspect” math as web nativeFill.
 * Channel pixel size from `getModeDimensions` / screen_*_mode (see config-modes).
 * @see companion-module-casparcg-server/src/scene-native-fill.js
 */

'use strict'

const { parseCinfMedia } = require('../media/cinf-parse')
const { getChannelMap } = require('../config/routing')
const { getModeDimensions } = require('../config/config-modes')

function parseResolutionString(s) {
	if (!s || typeof s !== 'string') return null
	const m = String(s).match(/(\d+)[×x](\d+)/i)
	return m ? { w: parseInt(m[1], 10) || 0, h: parseInt(m[2], 10) || 0 } : null
}

function normalizeMediaIdForMatch(id) {
	return String(id || '')
		.toLowerCase()
		.replace(/\\/g, '/')
		.replace(/^.*\//, '')
		.replace(/\.[^./]+$/, '')
		.trim()
}

function findMediaRow(media, value) {
	if (!value || !Array.isArray(media)) return null
	const exact = media.find((x) => x.id === value)
	if (exact) return exact
	const nv = normalizeMediaIdForMatch(value)
	for (const x of media) {
		if (normalizeMediaIdForMatch(x.id) === nv) return x
	}
	return null
}

function nativeFillNorm(contentW, contentH, channelW, channelH) {
	const w = channelW > 0 ? channelW : 1920
	const h = channelH > 0 ? channelH : 1080
	if (!(contentW > 0 && contentH > 0)) {
		return { x: 0, y: 0, scaleX: 1, scaleY: 1 }
	}
	const s = Math.min(w / contentW, h / contentH)
	const scaleX = (contentW * s) / w
	const scaleY = (contentH * s) / h
	const x = (1 - scaleX) / 2
	const y = (1 - scaleY) / 2
	return { x, y, scaleX, scaleY }
}

function getChannelResolutionForChannel(config, channel) {
	const map = getChannelMap(config || {})
	const n = parseInt(channel, 10)
	const cfg = config || {}
	for (let i = 0; i < map.screenCount; i++) {
		if (map.programCh(i + 1) === n || map.previewCh(i + 1) === n) {
			const modeKey = cfg[`screen_${i + 1}_mode`] || cfg.screen_mode || '1080p5000'
			const dims = getModeDimensions(modeKey, cfg, i + 1)
			return dims ? { w: dims.width, h: dims.height } : { w: 1920, h: 1080 }
		}
	}
	const modeKey = cfg.screen_mode || '1080p5000'
	const dims = getModeDimensions(modeKey, cfg, 1)
	return dims ? { w: dims.width, h: dims.height } : { w: 1920, h: 1080 }
}

function resolutionFromProbeEntry(p) {
	if (!p || typeof p !== 'object') return null
	if (p.resolution) {
		const r = parseResolutionString(String(p.resolution))
		if (r?.w > 0 && r?.h > 0) return r
	}
	const pw = parseInt(String(p.width ?? ''), 10)
	const ph = parseInt(String(p.height ?? ''), 10)
	if (pw > 0 && ph > 0) return { w: pw, h: ph }
	return null
}

function getMediaResolutionFromSelf(self, clipValue) {
	if (!clipValue || !self) return null
	const md = self.mediaDetails && self.mediaDetails[clipValue]
	if (md) {
		const parsed = parseCinfMedia(typeof md === 'string' ? md : String(md))
		if (parsed.resolution) {
			const r = parseResolutionString(parsed.resolution)
			if (r?.w > 0 && r?.h > 0) return r
		}
	}
	let list = []
	try {
		if (self.state && typeof self.state.getState === 'function') list = self.state.getState().media || []
	} catch (_) {}
	const row = findMediaRow(list, clipValue)
	if (row?.resolution) {
		const r = parseResolutionString(row.resolution)
		if (r?.w > 0 && r?.h > 0) return r
	}
	if (row?.cinf) {
		const parsed = parseCinfMedia(String(row.cinf))
		if (parsed.resolution) {
			const r = parseResolutionString(parsed.resolution)
			if (r?.w > 0 && r?.h > 0) return r
		}
	}
	const pr = resolutionFromProbeEntry((self._mediaProbeCache || {})[clipValue])
	if (pr) return pr
	for (const k of Object.keys(self._mediaProbeCache || {})) {
		if (normalizeMediaIdForMatch(k) !== normalizeMediaIdForMatch(clipValue)) continue
		const r2 = resolutionFromProbeEntry(self._mediaProbeCache[k])
		if (r2) return r2
	}
	for (const k of Object.keys(self.mediaDetails || {})) {
		if (normalizeMediaIdForMatch(k) !== normalizeMediaIdForMatch(clipValue)) continue
		const parsed = parseCinfMedia(String(self.mediaDetails[k]))
		if (parsed.resolution) {
			const r = parseResolutionString(parsed.resolution)
			if (r?.w > 0 && r?.h > 0) return r
		}
	}
	return null
}

function cinfResponseToStr(data) {
	if (data == null) return ''
	if (Array.isArray(data)) return data.join('\n')
	return String(data)
}

/**
 * @param {object} self
 * @param {string} clipValue
 * @returns {Promise<{ w: number, h: number } | null>}
 */
async function fetchCinfResolutionFromAmcp(self, clipValue) {
	if (!clipValue || !self?.amcp?.query?.cinf) return null
	try {
		const res = await self.amcp.query.cinf(clipValue)
		const str = cinfResponseToStr(res?.data)
		if (!str.trim()) return null
		const parsed = parseCinfMedia(str)
		if (parsed.resolution) {
			const r = parseResolutionString(parsed.resolution)
			if (r?.w > 0 && r?.h > 0) return r
		}
	} catch (_) {}
	return null
}

function clipPath(layer) {
	const v = layer.source && layer.source.value
	return v != null ? String(v) : ''
}

/** Same mapping as web/lib/mixer-fill.js mapContentFitToStretch */
function mapContentFitToStretch(layer) {
	const cf = layer.contentFit
	if (cf === 'horizontal') return 'fill-h'
	if (cf === 'vertical') return 'fill-v'
	if (cf === 'stretch') return 'stretch'
	if (cf === 'fill-canvas') return 'fit'
	if (layer.fillNativeAspect === false) return 'stretch'
	return 'fit'
}

/** Mirrors web calcMixerFill — keep in sync with mixer-fill.js */
function calcMixerFill(ls, res, contentRes) {
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

function resolveSceneLayerFill(layer, channelW, channelH, mediaRes) {
	const raw = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
	const srcType = layer.source && layer.source.type
	if (srcType === 'timeline') return raw
	if (layer.source && String(layer.source.value || '').startsWith('route://')) return raw

	const canProbe = !srcType || srcType === 'media' || srcType === 'file'
	if (!canProbe) return raw

	const stretchMode = mapContentFitToStretch(layer)
	if (stretchMode === 'stretch') return raw

	const px = {
		x: raw.x * channelW,
		y: raw.y * channelH,
		w: raw.scaleX * channelW,
		h: raw.scaleY * channelH,
	}
	const ls = { x: px.x, y: px.y, w: px.w, h: px.h, stretch: stretchMode }
	const res = { w: channelW, h: channelH }
	const out = calcMixerFill(ls, res, mediaRes)
	return { x: out.x, y: out.y, scaleX: out.xScale, scaleY: out.yScale }
}

async function getResolvedFillForSceneLayer(self, layer, channel) {
	const { w, h } = getChannelResolutionForChannel(self?.config, channel)
	const clip = clipPath(layer)
	let mediaRes = getMediaResolutionFromSelf(self, clip)
	if ((!mediaRes || !(mediaRes.w > 0 && mediaRes.h > 0)) && clip) {
		const fromAmcp = await fetchCinfResolutionFromAmcp(self, clip)
		if (fromAmcp) mediaRes = fromAmcp
	}
	return resolveSceneLayerFill(layer, w, h, mediaRes)
}

module.exports = {
	nativeFillNorm,
	getChannelResolutionForChannel,
	getMediaResolutionFromSelf,
	resolveSceneLayerFill,
	getResolvedFillForSceneLayer,
	parseResolutionString,
}

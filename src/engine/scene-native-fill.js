/**
 * Scene layer MIXER FILL — same “contain / original aspect” math as web nativeFill.
 * Channel pixel size: prefer live INFO CONFIG (`channelMap` from GET /state or `buildChannelMap(appCtx)`),
 * else `getModeDimensions` / screen_*_mode.
 * @see companion-module-casparcg-server/src/scene-native-fill.js
 */

'use strict'

const { parseCinfMedia } = require('../media/cinf-parse')
const { getChannelMap } = require('../config/routing')
const { getModeDimensions } = require('../config/config-modes')
const { buildChannelMap } = require('../config/channel-map-from-ctx')

/**
 * HTTP GET /state includes channelMap; engine StateManager.getState() does not.
 * Always derive live resolutions from config + Caspar INFO CONFIG when channelMap is absent.
 */
function getMergedChannelMap(self) {
	let st = null
	try {
		if (self?.state && typeof self.state.getState === 'function') st = self.state.getState()
	} catch (_) {}
	if (st?.channelMap) return st.channelMap
	if (self && typeof self === 'object' && self.config) {
		try {
			return buildChannelMap(self)
		} catch (_) {}
	}
	return null
}

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

/**
 * Pixel size of a Caspar channel for scene FILL math.
 * Prefer live INFO CONFIG via HTTP state (`channelMap`) so PGM/PRV match running outputs;
 * fall back to config screen_*_mode when state is missing.
 * @param {object} config
 * @param {string|number} channel
 * @param {object} [self] — app ctx (`config`, `gatheredInfo`) or `state.getState()` with channelMap
 */
function getChannelResolutionForChannel(config, channel, self) {
	const map = getChannelMap(config || {})
	const n = parseInt(channel, 10)
	const cfg = config || {}
	const cm = getMergedChannelMap(self)

	for (let i = 0; i < map.screenCount; i++) {
		const progCh = map.programCh(i + 1)
		const prvCh = map.previewCh(i + 1)
		if (progCh === n || prvCh === n) {
			if (cm) {
				const byCh = cm.channelResolutionsByChannel && cm.channelResolutionsByChannel[n]
				if (byCh && byCh.w > 0 && byCh.h > 0) {
					return { w: byCh.w, h: byCh.h }
				}
				if (progCh === n) {
					const pr = cm.programResolutions?.[i]
					if (pr?.w > 0 && pr?.h > 0) return { w: pr.w, h: pr.h }
				}
				if (prvCh === n) {
					const pr = cm.previewResolutions?.[i]
					if (pr?.w > 0 && pr?.h > 0) return { w: pr.w, h: pr.h }
				}
			}
			const modeKey = cfg[`screen_${i + 1}_mode`] || cfg.screen_mode || '1080p5000'
			const dims = getModeDimensions(modeKey, cfg, i + 1)
			return dims ? { w: dims.width, h: dims.height } : { w: 1920, h: 1080 }
		}
	}
	const modeKey = cfg.screen_mode || '1080p5000'
	const dims = getModeDimensions(modeKey, cfg, 1)
	return dims ? { w: dims.width, h: dims.height } : { w: 1920, h: 1080 }
}

function getScreenIndexForChannel(config, channel) {
	const map = getChannelMap(config || {})
	const n = parseInt(channel, 10)
	for (let i = 0; i < map.screenCount; i++) {
		const prvCh = map.previewCh(i + 1)
		if (map.programCh(i + 1) === n || (prvCh != null && prvCh === n)) return i
	}
	return 0
}

/**
 * Scene fill is normalized to the **program** compose canvas (`channelMap.programResolutions[screen]`),
 * not necessarily to the Caspar channel pixel size. Map authoring pixels → target channel (same as web
 * `mapProgramPixelRectToTargetOutput`).
 */
function mapProgramPixelRectToTargetOutput(px, progW, progH, outW, outH) {
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
 * @returns {{ w: number, h: number }}
 */
function getProgramAuthoringResolution(self, config, channel, incomingScene) {
	const cc = incomingScene && incomingScene.composeCanvas
	if (cc && cc.w > 0 && cc.h > 0) {
		return { w: cc.w, h: cc.h }
	}
	const screenIdx = getScreenIndexForChannel(config, channel)
	const cm = getMergedChannelMap(self)
	const pr = cm?.programResolutions?.[screenIdx]
	if (pr?.w > 0 && pr?.h > 0) return { w: pr.w, h: pr.h }
	const map = getChannelMap(config || {})
	const progCh = map.programCh(screenIdx + 1)
	return getChannelResolutionForChannel(config, progCh, self)
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
	if (String(clipValue).trim().toLowerCase().startsWith('route://')) return null
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
	if (cf === 'native') return 'none'
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
			const fitScale = Math.min(lw / cw, lh / ch)
			return { x: nx, y: ny, xScale: (cw * fitScale) / res.w, yScale: (ch * fitScale) / res.h }
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

/**
 * @param {number} authoringW - program compose width (layer fill is normalized to this)
 * @param {number} authoringH
 * @param {number} targetW - Caspar channel receiving MIXER (PGM or PRV)
 * @param {number} targetH
 */
function resolveSceneLayerFill(layer, authoringW, authoringH, targetW, targetH, mediaRes) {
	const raw = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
	const srcType = layer.source && layer.source.type
	if (srcType === 'timeline') return raw
	if (layer.source && String(layer.source.value || '').startsWith('route://')) return raw

	const canProbe = !srcType || srcType === 'media' || srcType === 'file'
	if (!canProbe) return raw

	const stretchMode = mapContentFitToStretch(layer)
	if (stretchMode === 'stretch') return raw

	const aw = authoringW > 0 ? authoringW : 1920
	const ah = authoringH > 0 ? authoringH : 1080
	const tw = targetW > 0 ? targetW : aw
	const th = targetH > 0 ? targetH : ah

	const px = {
		x: raw.x * aw,
		y: raw.y * ah,
		w: raw.scaleX * aw,
		h: raw.scaleY * ah,
	}
	const mapped = mapProgramPixelRectToTargetOutput(px, aw, ah, tw, th)
	const ls = { x: mapped.x, y: mapped.y, w: mapped.w, h: mapped.h, stretch: stretchMode }
	const out = calcMixerFill(ls, { w: tw, h: th }, mediaRes)
	return { x: out.x, y: out.y, scaleX: out.xScale, scaleY: out.yScale }
}

async function getResolvedFillForSceneLayer(self, layer, channel, incomingScene) {
	const { w: authW, h: authH } = getProgramAuthoringResolution(self, self?.config, channel, incomingScene)
	const { w: targetW, h: targetH } = getChannelResolutionForChannel(self?.config, channel, self)
	const clip = clipPath(layer)
	let mediaRes = getMediaResolutionFromSelf(self, clip)
	if ((!mediaRes || !(mediaRes.w > 0 && mediaRes.h > 0)) && clip) {
		const fromAmcp = await fetchCinfResolutionFromAmcp(self, clip)
		if (fromAmcp) mediaRes = fromAmcp
	}
	return resolveSceneLayerFill(layer, authW, authH, targetW, targetH, mediaRes)
}

module.exports = {
	nativeFillNorm,
	getChannelResolutionForChannel,
	getMediaResolutionFromSelf,
	resolveSceneLayerFill,
	getResolvedFillForSceneLayer,
	parseResolutionString,
}

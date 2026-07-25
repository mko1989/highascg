'use strict'

const { getChannelMap } = require('../config/routing')
const { LOOK_LAYER_MIN } = require('./look-layer-ranges')

/** Caspar host layers for HTML/CG overlays above the look stack (10–199). */
const TEMPLATE_CG_OVERLAY_LAYER_BASE = 700
const TEMPLATE_CG_OVERLAY_LAYER_MAX = 899

/**
 * @param {string} [cgName]
 */
function isLowerThirdCgName(cgName) {
	return String(cgName || '').trim().toLowerCase().startsWith('lower-thirds/')
}

/**
 * WO-322: shader templates (shader-store.js exports every shader to `template/shaders/<id>.html`,
 * Caspar path `shaders/<id>`). These composite on the LOOK band like media — the owner must be
 * able to stack look layers on top — so they are the one template-CG kind that does NOT go to the
 * 700+ overlay.
 * @param {string} [cgName]
 */
function isShaderCgName(cgName) {
	return String(cgName || '').trim().toLowerCase().startsWith('shaders/')
}

/**
 * Map a look's logical layer number to a dedicated high CG host layer (700+).
 * @param {number|string} logicalLayerNumber — scene layerNumber (e.g. 20, 30)
 * @param {string} [cgName] — when omitted, always maps look-range layers to overlay stack
 * @returns {number}
 */
function resolveTemplateCgHostLayer(logicalLayerNumber, cgName) {
	const n = parseInt(logicalLayerNumber, 10)
	if (!Number.isFinite(n)) return TEMPLATE_CG_OVERLAY_LAYER_BASE
	if (n >= TEMPLATE_CG_OVERLAY_LAYER_BASE && n <= TEMPLATE_CG_OVERLAY_LAYER_MAX) return n
	// WO-322: shaders stay on their look-band layer (composite like media); lower thirds and
	// every other template CG keep the 700+ overlay (above the bank A/B crossfade, WO-196
	// continuity relies on the fixed host).
	const useOverlay = !cgName || ((isLowerThirdCgName(cgName) || isSceneTemplateCgName(cgName)) && !isShaderCgName(cgName))
	if (!useOverlay) return n
	if (n >= LOOK_LAYER_MIN && n <= 199) {
		const logical = n >= 110 ? n - 100 : n
		const offset = Math.max(0, logical - LOOK_LAYER_MIN)
		return Math.min(TEMPLATE_CG_OVERLAY_LAYER_MAX, TEMPLATE_CG_OVERLAY_LAYER_BASE + offset)
	}
	return n
}

/**
 * @param {string} name
 */
function isSceneTemplateCgName(name) {
	const s = String(name || '').trim().toLowerCase()
	if (!s) return false
	if (isLowerThirdCgName(s)) return true
	return s.includes('/') || s.endsWith('.html') || /^[a-z0-9_-]+$/.test(s)
}

/**
 * @param {object} ctx
 * @returns {{ programChannels?: number[] }}
 */
function channelMapFromCtx(ctx) {
	if (ctx?.getState && typeof ctx.getState === 'function') {
		const st = ctx.getState()
		if (st?.channelMap?.programChannels?.length) return st.channelMap
	}
	const cfg = ctx?.config || {}
	return getChannelMap(cfg, ctx?.switcherOutputBusByChannel)
}

/**
 * Resolve Caspar program channel from explicit `channel` or `mainScreenIndex` / `mainIdx`.
 * @param {object} body
 * @param {object} [ctx]
 * @param {number} [fallbackChannel=1]
 */
function resolveCgRequestChannel(body, ctx, fallbackChannel = 1) {
	const b = body && typeof body === 'object' ? body : {}
	if (b.channel != null) {
		const ch = parseInt(b.channel, 10)
		if (Number.isFinite(ch) && ch > 0) return ch
	}
	const idxRaw = b.mainScreenIndex ?? b.mainIdx ?? b.screenIndex
	if (idxRaw != null) {
		const idx = parseInt(idxRaw, 10)
		if (Number.isFinite(idx) && idx >= 0) {
			const map = channelMapFromCtx(ctx)
			const programs = map.programChannels || []
			if (programs[idx] != null) {
				const ch = parseInt(programs[idx], 10)
				if (Number.isFinite(ch) && ch > 0) return ch
			}
		}
	}
	const fb = parseInt(fallbackChannel, 10)
	return Number.isFinite(fb) && fb > 0 ? fb : 1
}

/**
 * Normalize REST / WS CG body: program channel + overlay host layer.
 * @param {object} body
 * @param {object} [ctx]
 */
function normalizeCgRequest(body, ctx) {
	const b = body && typeof body === 'object' ? { ...body } : {}
	const channel = resolveCgRequestChannel(b, ctx)
	const cgName = b.template || b.cgName || ''
	if (b.layer != null) {
		b.layer = resolveTemplateCgHostLayer(b.layer, cgName)
	}
	if (b.logicalLayer != null && b.layer == null) {
		b.layer = resolveTemplateCgHostLayer(b.logicalLayer, cgName)
	}
	b.channel = channel
	return b
}

module.exports = {
	TEMPLATE_CG_OVERLAY_LAYER_BASE,
	TEMPLATE_CG_OVERLAY_LAYER_MAX,
	isLowerThirdCgName,
	isShaderCgName,
	isSceneTemplateCgName,
	resolveTemplateCgHostLayer,
	resolveCgRequestChannel,
	normalizeCgRequest,
	channelMapFromCtx,
}

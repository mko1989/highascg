/**
 * PIP overlay — CG HTML on a **separate** layer above PIP content.
 * Chrome uses a **larger** MIXER FILL than the video layer so frames/strips/shadows sit
 * in the margin **outside** the picture (same math as “matte + hole”).
 * @see 25_WO_PIP_OVERLAY_EFFECTS.md
 */

'use strict'

const { getChannelResolutionForChannel } = require('./scene-native-fill')

const PIP_OVERLAY_LAYER_OFFSET = 100

const TEMPLATE_MAP = {
	border: 'pip_border',
	shadow: 'pip_shadow',
	edge_strip: 'pip_edge_strip',
	glow: 'pip_glow',
}

function overlayLayer(contentLayer) {
	return contentLayer + PIP_OVERLAY_LAYER_OFFSET
}

function clamp01(v) {
	return Math.max(0, Math.min(1, v))
}

/**
 * Scene / API may store params under `params` **or** flat next to `type` — merge for AMCP + outset math.
 * @param {{ type?: string, params?: object, inner?: unknown } | null | undefined} overlay
 * @returns {Record<string, unknown>}
 */
function mergeOverlayParams(overlay) {
	const out = {}
	if (!overlay || typeof overlay !== 'object') return out
	const nested = overlay.params && typeof overlay.params === 'object' ? { ...overlay.params } : {}
	Object.assign(out, nested)
	const skip = new Set(['type', 'params', 'inner'])
	for (const k of Object.keys(overlay)) {
		if (skip.has(k)) continue
		const v = overlay[k]
		if (v !== undefined) out[k] = v
	}
	return out
}

/**
 * @param {{ x?: number, y?: number, scaleX?: number, scaleY?: number } | null | undefined} f
 */
function normalizeContentFill(f) {
	const z = { x: 0, y: 0, scaleX: 1, scaleY: 1, ...f }
	let x = Number(z.x)
	let y = Number(z.y)
	let sx = Number(z.scaleX)
	let sy = Number(z.scaleY)
	if (!Number.isFinite(x)) x = 0
	if (!Number.isFinite(y)) y = 0
	if (!Number.isFinite(sx) || sx <= 0) sx = 1
	if (!Number.isFinite(sy) || sy <= 0) sy = 1
	return { x, y, scaleX: sx, scaleY: sy }
}

/**
 * Pixel outset so overlay MIXER FILL is larger than the content PIP (chrome sits outside the video rect).
 * @param {{ type: string, params?: object }} overlay
 * @returns {number}
 */
function outsetPxForPipOverlay(overlay) {
	const p = mergeOverlayParams(overlay)
	switch (overlay?.type) {
		case 'border':
			return Math.max(0, Number(p.width) || 4)
		case 'edge_strip':
			/** Mat width in pixels — must match strip thickness (see templates fallback). */
			return Math.max(1, Number(p.thickness) || 3)
		case 'shadow': {
			const blur = Number(p.blur) || 0
			const ox = Math.abs(Number(p.offsetX) || 0)
			const oy = Math.abs(Number(p.offsetY) || 0)
			const sp = Math.max(0, Number(p.spread) || 0)
			return Math.max(12, blur + Math.max(ox, oy) + sp + 2)
		}
		case 'glow':
			return Math.max(6, Number(p.intensity) || 15)
		default:
			return 4
	}
}

/**
 * Expand normalized FILL rect evenly in pixel space (symmetric matting).
 * @param {{ x: number, y: number, scaleX: number, scaleY: number }} contentFill
 * @param {number} outsetPx
 * @param {number} chW
 * @param {number} chH
 * @returns {{ x: number, y: number, scaleX: number, scaleY: number }}
 */
function expandFillOutward(contentFill, outsetPx, chW, chH) {
	const w = Math.max(1, chW)
	const h = Math.max(1, chH)
	const ox = outsetPx / w
	const oy = outsetPx / h
	let x = contentFill.x - ox
	let y = contentFill.y - oy
	let sx = contentFill.scaleX + 2 * ox
	let sy = contentFill.scaleY + 2 * oy
	if (x < 0) {
		sx += x
		x = 0
	}
	if (y < 0) {
		sy += y
		y = 0
	}
	if (x + sx > 1) sx = Math.max(0, 1 - x)
	if (y + sy > 1) sy = Math.max(0, 1 - y)
	return { x, y, scaleX: sx, scaleY: sy }
}

/**
 * Content PIP rectangle in **overlay layer** normalized 0–1 coordinates (hole over video).
 * @param {{ x: number, y: number, scaleX: number, scaleY: number }} contentFill
 * @param {{ x: number, y: number, scaleX: number, scaleY: number }} overlayFill
 * @returns {{ l: number, t: number, w: number, h: number }}
 */
function innerRectInOverlayNorm(contentFill, overlayFill) {
	const sx2 = overlayFill.scaleX
	const sy2 = overlayFill.scaleY
	if (!(sx2 > 0) || !(sy2 > 0)) {
		return { l: 0, t: 0, w: 1, h: 1 }
	}
	return {
		l: clamp01((contentFill.x - overlayFill.x) / sx2),
		t: clamp01((contentFill.y - overlayFill.y) / sy2),
		w: clamp01(contentFill.scaleX / sx2),
		h: clamp01(contentFill.scaleY / sy2),
	}
}

/**
 * CG JSON payload: params + inner (hole) in overlay-local 0–1 space.
 */
function buildPipOverlayCgPayload(overlay, inner) {
	return JSON.stringify({ ...mergeOverlayParams(overlay), inner })
}

/**
 * Build AMCP commands to apply a PIP overlay on a scene layer.
 *
 * @param {object} overlay - { type, params }
 * @param {number} channel
 * @param {number} contentPhysicalLayer - Physical Caspar layer of the PIP content
 * @param {{ x: number, y: number, scaleX: number, scaleY: number }} contentFill - FILL of the **video** layer
 * @param {object} [appCtx] - module ctx with `config` and optional `state` (for channel resolution)
 * @returns {string[]}
 */
function buildPipOverlayAmcpLines(overlay, channel, contentPhysicalLayer, contentFill, appCtx) {
	if (!overlay?.type) return []
	const template = TEMPLATE_MAP[overlay.type]
	if (!template) return []

	const res = getChannelResolutionForChannel(appCtx?.config, channel, appCtx)
	const chW = res?.w > 0 ? res.w : 1920
	const chH = res?.h > 0 ? res.h : 1080

	const cf = normalizeContentFill(contentFill)
	const outset = outsetPxForPipOverlay(overlay)
	const overlayFill = expandFillOutward(cf, outset, chW, chH)
	const inner = innerRectInOverlayNorm(cf, overlayFill)
	const oLayer = overlayLayer(contentPhysicalLayer)
	const cl = `${channel}-${oLayer}`
	const data = buildPipOverlayCgPayload(overlay, inner)

	return [
		`CG ${cl} ADD 0 "${template}" 1 "${data.replace(/"/g, '\\"')}"`,
		`MIXER ${cl} FILL ${overlayFill.x} ${overlayFill.y} ${overlayFill.scaleX} ${overlayFill.scaleY} 0`,
		`MIXER ${cl} KEYER 0`,
		`MIXER ${cl} OPACITY 1`,
	]
}

/**
 * CG UPDATE with recomputed inner (call with same contentFill as video layer).
 * @param {number} channel
 * @param {number} contentPhysicalLayer
 * @param {{ type: string, params?: object }} overlay
 * @param {{ x: number, y: number, scaleX: number, scaleY: number }} contentFill
 * @param {object} [appCtx]
 * @returns {string[]}
 */
function buildPipOverlayUpdateLines(channel, contentPhysicalLayer, overlay, contentFill, appCtx) {
	const oLayer = overlayLayer(contentPhysicalLayer)
	const cl = `${channel}-${oLayer}`
	const res = getChannelResolutionForChannel(appCtx?.config, channel, appCtx)
	const chW = res?.w > 0 ? res.w : 1920
	const chH = res?.h > 0 ? res.h : 1080
	const cf = normalizeContentFill(contentFill)
	const outset = outsetPxForPipOverlay(overlay)
	const overlayFill = expandFillOutward(cf, outset, chW, chH)
	const inner = innerRectInOverlayNorm(cf, overlayFill)
	const data = buildPipOverlayCgPayload(overlay, inner)
	return [
		`CG ${cl} UPDATE 0 "${data.replace(/"/g, '\\"')}"`,
		`MIXER ${cl} FILL ${overlayFill.x} ${overlayFill.y} ${overlayFill.scaleX} ${overlayFill.scaleY} 0`,
	]
}

function buildPipOverlayRemoveLines(channel, contentPhysicalLayer) {
	const oLayer = overlayLayer(contentPhysicalLayer)
	const cl = `${channel}-${oLayer}`
	return [`CG ${cl} CLEAR`, `MIXER ${cl} CLEAR`]
}

const PIP_OVERLAY_TEMPLATE_FILES = Object.values(TEMPLATE_MAP).map((t) => t + '.html')

async function sendPipOverlayLinesSerial(amcp, lines) {
	for (const line of lines) {
		const t = String(line).trim()
		if (t) await amcp.raw(t)
	}
}

module.exports = {
	PIP_OVERLAY_LAYER_OFFSET,
	overlayLayer,
	mergeOverlayParams,
	normalizeContentFill,
	outsetPxForPipOverlay,
	expandFillOutward,
	innerRectInOverlayNorm,
	buildPipOverlayAmcpLines,
	buildPipOverlayUpdateLines,
	buildPipOverlayRemoveLines,
	sendPipOverlayLinesSerial,
	PIP_OVERLAY_TEMPLATE_FILES,
	TEMPLATE_MAP,
}

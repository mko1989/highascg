/**
 * PIP overlay utilities and helpers.
 *
 * Outside-border placement model (expanded MIXER FILL + inner content hole):
 * @see docs/reference/pip-overlay-outside-border.md
 */

'use strict'

const PIP_OVERLAY_LAYER_OFFSET = 100
const PIP_OVERLAY_MAX_STACK = 8
const PIP_OVERLAY_ALIGN_GAP = 1

const TEMPLATE_MAP = {
	border: 'pip_border',
	shadow: 'pip_shadow',
	edge_strip: 'pip_edge_strip',
	glow: 'pip_glow',
	router: 'pip_router',
}

function overlayLayerSlot(contentLayer, stackIndex = 0) {
	const i = Math.max(0, Math.min(PIP_OVERLAY_MAX_STACK - 1, stackIndex | 0))
	const base = Number(contentLayer)
	const n = Number.isFinite(base) ? base : 0
	return PIP_OVERLAY_LAYER_OFFSET + n * PIP_OVERLAY_MAX_STACK + i
}

function resolvePipOverlayCasparLayer(contentPhysicalLayer, stackIndex, nextContentLayer) {
	const i = Math.max(0, Math.min(PIP_OVERLAY_MAX_STACK - 1, stackIndex | 0))
	const p = Number(contentPhysicalLayer)
	if (!Number.isFinite(p) || p < 0) {
		return PIP_OVERLAY_LAYER_OFFSET + i
	}
	let nx = nextContentLayer
	if (nx == null) {
		nx = p >= 10 && p % 10 === 0 ? p + 10 : p + 1
	} else if (typeof nx === 'string' && nx.trim() === '') {
		nx = 10000
	} else {
		nx = Number(nx)
	}
	if (!Number.isFinite(nx) || nx <= p) {
		nx = 10000
	}
	if (p + PIP_OVERLAY_ALIGN_GAP + i < nx) {
		return p + PIP_OVERLAY_ALIGN_GAP + i
	}
	return PIP_OVERLAY_LAYER_OFFSET + p * PIP_OVERLAY_MAX_STACK + i
}

function overlayLayer(contentLayer) {
	return overlayLayerSlot(contentLayer, 0)
}

function pipOverlaysFromLayer(layer) {
	if (!layer || typeof layer !== 'object') return []
	if (Array.isArray(layer.pipOverlays) && layer.pipOverlays.length) {
		return layer.pipOverlays.filter((o) => o && typeof o === 'object' && o.type)
	}
	if (layer.pipOverlay && typeof layer.pipOverlay === 'object' && layer.pipOverlay.type) {
		return [layer.pipOverlay]
	}
	return []
}

function nextPipContentLayerInScene(layers, sceneLayerNum) {
	const pl = Number(sceneLayerNum)
	if (!Number.isFinite(pl)) return 10000
	const m = (layers || [])
		.map((l) => Number(l.layerNumber))
		.filter((n) => Number.isFinite(n) && n > pl)
	if (m.length === 0) return 10000
	return Math.min(...m)
}

function nextPipContentLayerInTake(takeJobs, pLayer) {
	const pl = Number(pLayer)
	if (!Number.isFinite(pl)) return 10000
	const m = (takeJobs || [])
		.map((j) => j.pLayer)
		.filter((n) => Number.isFinite(n) && n > pl)
	if (m.length === 0) return 10000
	return Math.min(...m)
}

function shouldStripPipSlotBeforeAdd(oR, takeJobs, currentSceneLayers) {
	if (!Array.isArray(takeJobs)) return true
	for (const job of takeJobs) {
		const pl = Number(job.pLayer)
		if (!Number.isFinite(pl)) continue
		const nxt = nextPipContentLayerInTake(takeJobs, pl)
		const sceneLn = Number(job.layer?.layerNumber)
		const cur =
			Number.isFinite(sceneLn) && Array.isArray(currentSceneLayers)
				? currentSceneLayers.find((l) => Number(l?.layerNumber) === sceneLn)
				: null
		const prevPips = pipOverlaysFromLayer(cur)
		const newPips = job.pipOverlays || []
		for (let i = 0; i < newPips.length; i++) {
			if (String(newPips[i]?.type || '') !== String(prevPips[i]?.type || '')) continue
			if (newPips[i] == null) continue
			const slot = resolvePipOverlayCasparLayer(pl, i, nxt)
			if (slot === oR) {
				return false
			}
		}
	}
	return true
}

function clamp01(v) {
	return Math.max(0, Math.min(1, v))
}

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

/** Defaults for CG JSON when scene/global state omits keys (matches web `pip-overlay-registry` defaults). */
const PIP_OVERLAY_PARAM_DEFAULTS = {
	border: { width: 4, color: '#e63946', radius: 0, opacity: 1, side: 'outside' },
	shadow: {
		blur: 20,
		offsetX: 5,
		offsetY: 5,
		color: 'rgba(0,0,0,0.6)',
		spread: 0,
		radius: 0,
		side: 'inside',
		segmentMode: 'full',
		segmentsPerEdge: 1,
		segmentEase: 0.5,
		opacity: 1,
	},
	edge_strip: {
		direction: 'cw',
		count: 1,
		thickness: 3,
		color: '#e63946',
		speed: 2,
		length: 28,
		glow: true,
		glowColor: '#ff6b6b',
		glowWidth: 5,
		roundedTips: false,
		side: 'outside',
		opacity: 1,
	},
	glow: {
		color: '#e63946',
		intensity: 15,
		width: 0,
		pulse: true,
		pulseSpeed: 2,
		minOpacity: 0.4,
		radius: 0,
		side: 'inside',
		segmentMode: 'full',
		segmentsPerEdge: 1,
		segmentEase: 0.5,
		opacity: 1,
	},
}

const PIP_OVERLAY_JSON_SKIP = new Set([
	'type',
	'params',
	'inner',
	'enabled',
	'fadeDuration',
	'mirrorBorderOnPrv',
	'borderPresets',
	'pgmAirSnapshot',
	'activePgmLayer',
	'artnetPatch',
	'artnetListenEnabled',
	'artnetChannelMap',
	'slices',
])

/**
 * Merge registry defaults + overlay params for HTML template UPDATE payloads.
 * Drops non-visual keys so Caspar JSON stays trim.
 * @param {object} overlay
 */
function mergePipOverlayParamsWithDefaults(overlay) {
	const t = String(overlay?.type || '').trim()
	const defs = PIP_OVERLAY_PARAM_DEFAULTS[t] || {}
	const merged = mergeOverlayParams(overlay)
	const out = { ...defs }
	for (const k of Object.keys(merged)) {
		if (PIP_OVERLAY_JSON_SKIP.has(k)) continue
		out[k] = merged[k]
	}
	return out
}

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

function outsetPxForPipOverlay(overlay) {
	const p = mergeOverlayParams(overlay)
	switch (overlay?.type) {
		case 'border':
			return Math.max(0, Number(p.width) || 4)
		case 'edge_strip': {
			const th = Math.max(1, Number(p.thickness) || 3)
			if (p.glow === false) return th
			const gw = Math.max(0, Number(p.glowWidth) || 0)
			return Math.max(th, Math.ceil(th / 2 + gw + 4))
		}
		case 'shadow': {
			const blur = Number(p.blur) || 0
			const ox = Math.abs(Number(p.offsetX) || 0)
			const oy = Math.abs(Number(p.offsetY) || 0)
			const sp = Math.max(0, Number(p.spread) || 0)
			return Math.max(12, blur + Math.max(ox, oy) + sp + 2)
		}
		case 'glow': {
			const blur = Number(p.intensity) || 15
			const spread = Number(p.width) || 0
			return Math.max(6, blur + spread + 4)
		}
		default:
			return 4
	}
}

function expandFillOutward(contentFill, outsetPx, chW, chH) {
	const w = Math.max(1, chW)
	const h = Math.max(1, chH)
	const ox = outsetPx / w
	const oy = outsetPx / h
	let x = contentFill.x - ox
	let y = contentFill.y - oy
	let sx = contentFill.scaleX + 2 * ox
	let sy = contentFill.scaleY + 2 * oy
	return { x, y, scaleX: sx, scaleY: sy }
}

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

function isOutsideSide(overlay) {
	const p = mergeOverlayParams(overlay)
	const side = String(p.side != null ? p.side : 'outside')
		.trim()
		.toLowerCase()
	return side !== 'inside'
}

function effectivePipOverlaySide(overlay) {
	return isOutsideSide(overlay) ? 'outside' : 'inside'
}

/**
 * Outside overlays stack outward from content: lower indices = further out (glow),
 * higher indices = closer to content (border). Each CG layer expands to fit the
 * full stack; this slot draws only in [ringInnerPx, ringOuterPx).
 */
function computeOutsideStackBands(overlays, stackIndex) {
	const list = Array.isArray(overlays) ? overlays : []
	let below = 0
	let my = 0
	let above = 0
	for (let i = 0; i < list.length; i++) {
		if (!list[i] || !isOutsideSide(list[i])) continue
		const px = outsetPxForPipOverlay(list[i])
		if (i < stackIndex) below += px
		else if (i === stackIndex) my = px
		else above += px
	}
	return {
		ringInnerPx: below,
		ringOuterPx: below + my,
		totalOutsetPx: below + my + above,
	}
}

function sumOutsideOutsetPx(overlays) {
	const list = Array.isArray(overlays) ? overlays : []
	let total = 0
	for (const o of list) {
		if (!o || !isOutsideSide(o)) continue
		total += outsetPxForPipOverlay(o)
	}
	return total
}

function buildPipOverlayCgPayload(overlay, placement) {
	const params = mergePipOverlayParamsWithDefaults(overlay)
	params.side = effectivePipOverlaySide(overlay)
	const inner = placement?.inner || placement
	const out = { ...params, inner }
	if (placement && placement.ringInnerPx != null) out.ringInnerPx = placement.ringInnerPx
	if (placement && placement.ringOuterPx != null) out.ringOuterPx = placement.ringOuterPx
	if (placement && placement.totalOutsetPx != null) out.totalOutsetPx = placement.totalOutsetPx
	return JSON.stringify(out)
}

/**
 * Channel-normalized FILL + template inner rect for one PIP overlay slot.
 * @param {object[]} [allOverlays] — full stack (required for correct outside banding)
 * @returns {{ inner: object, mixFill: object, oLayer: number, ringInnerPx?: number, ringOuterPx?: number, totalOutsetPx?: number }}
 */
function computePipOverlayPlacement(
	overlay,
	contentFill,
	chW,
	chH,
	contentPhysicalLayer,
	stackIndex = 0,
	nextContentLayer,
	allOverlays,
) {
	const cf = normalizeContentFill(contentFill)
	const stack = Array.isArray(allOverlays) && allOverlays.length ? allOverlays : [overlay]
	const oLayer = resolvePipOverlayCasparLayer(contentPhysicalLayer, stackIndex, nextContentLayer)
	const p = Number(contentPhysicalLayer)
	const idx = stackIndex | 0
	const aligned = Number.isFinite(p) && oLayer === p + PIP_OVERLAY_ALIGN_GAP + idx

	if (!isOutsideSide(overlay)) {
		return { inner: { l: 0, t: 0, w: 1, h: 1 }, mixFill: cf, oLayer }
	}

	const bands = computeOutsideStackBands(stack, stackIndex)
	const overlayFill = expandFillOutward(cf, bands.totalOutsetPx, chW, chH)
	return {
		inner: innerRectInOverlayNorm(cf, overlayFill),
		mixFill: overlayFill,
		oLayer,
		ringInnerPx: bands.ringInnerPx,
		ringOuterPx: bands.ringOuterPx,
		totalOutsetPx: bands.totalOutsetPx,
	}
}

/**
 * Combined placement when multiple overlays route through pip_router (max outside outset).
 */
function computePipRouterPlacement(overlays, contentFill, chW, chH, contentPhysicalLayer, nextContentLayer) {
	const cf = normalizeContentFill(contentFill)
	const stack = Array.isArray(overlays) ? overlays : []
	const oLayer = resolvePipOverlayCasparLayer(contentPhysicalLayer, 0, nextContentLayer)
	const totalOutset = sumOutsideOutsetPx(stack)
	const anyOutside = totalOutset > 0

	if (!anyOutside) {
		return {
			inner: { l: 0, t: 0, w: 1, h: 1 },
			mixFill: cf,
			oLayer,
		}
	}

	const overlayFill = expandFillOutward(cf, totalOutset, chW, chH)
	const effects = stack.map((o, i) => {
		const bands = computeOutsideStackBands(stack, i)
		const params = {
			...mergePipOverlayParamsWithDefaults(o),
			side: effectivePipOverlaySide(o),
			ringInnerPx: bands.ringInnerPx,
			ringOuterPx: bands.ringOuterPx,
		}
		return { type: o.type, params }
	})

	return {
		inner: innerRectInOverlayNorm(cf, overlayFill),
		mixFill: overlayFill,
		oLayer,
		totalOutsetPx: totalOutset,
		effects,
	}
}

module.exports = {
	PIP_OVERLAY_LAYER_OFFSET,
	PIP_OVERLAY_MAX_STACK,
	PIP_OVERLAY_ALIGN_GAP,
	TEMPLATE_MAP,
	mergePipOverlayParamsWithDefaults,
	overlayLayerSlot,
	resolvePipOverlayCasparLayer,
	overlayLayer,
	pipOverlaysFromLayer,
	nextPipContentLayerInScene,
	nextPipContentLayerInTake,
	shouldStripPipSlotBeforeAdd,
	clamp01,
	mergeOverlayParams,
	normalizeContentFill,
	outsetPxForPipOverlay,
	expandFillOutward,
	innerRectInOverlayNorm,
	buildPipOverlayCgPayload,
	computePipOverlayPlacement,
	computePipRouterPlacement,
	computeOutsideStackBands,
	sumOutsideOutsetPx,
	isOutsideSide,
	effectivePipOverlaySide,
}

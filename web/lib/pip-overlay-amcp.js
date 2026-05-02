/**
 * Browser-side PIP overlay AMCP lines — mirrors src/engine/pip-overlay.js for PRV preview push.
 * Keep template map and math in sync with the server module.
 */

import {
	PIP_OVERLAY_ALIGN_GAP,
	PIP_OVERLAY_LAYER_OFFSET,
	PIP_OVERLAY_MAX_STACK,
	overlayLayerSlot,
	resolvePipOverlayCasparLayer,
} from './pip-overlay-registry.js'

const TEMPLATE_MAP = {
	border: 'pip_border',
	shadow: 'pip_shadow',
	edge_strip: 'pip_edge_strip',
	glow: 'pip_glow',
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
		case 'edge_strip':
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

/** @param {{ x: number, y: number, scaleX: number, scaleY: number }} contentFill */
function innerRectPipLocalFromOutset(contentFill, bPx, chW, chH) {
	const w = Math.max(1, chW)
	const h = Math.max(1, chH)
	const b = Math.max(0, bPx)
	const rw = w * contentFill.scaleX
	const rh = h * contentFill.scaleY
	if (!(rw > 0) || !(rh > 0)) {
		return { l: 0, t: 0, w: 1, h: 1 }
	}
	const il = b / rw
	const it = b / rh
	if (!(il * 2 < 1) || !(it * 2 < 1) || !Number.isFinite(il) || !Number.isFinite(it)) {
		return { l: 0, t: 0, w: 1, h: 1 }
	}
	return { l: il, t: it, w: 1 - 2 * il, h: 1 - 2 * it }
}

function buildPipOverlayCgPayload(overlay, inner) {
	return JSON.stringify({ ...mergeOverlayParams(overlay), inner })
}

/** Match server `deferMixerAmcpLine` — PIP chrome must not apply before `MIXER <ch> COMMIT` with look video. */
function deferMixerAmcpLine(line) {
	const s = String(line).trim()
	if (!/^MIXER\s+\d+-\d+\s+/i.test(s)) return s
	if (/\bDEFER\b/i.test(s)) return s
	return `${s} DEFER`
}

/**
 * @param {{ w: number, h: number }} channelPx
 * @param {number|undefined} [nextContentLayer]
 */
function buildPipOverlayAmcpLines(overlay, channel, contentPhysicalLayer, contentFill, channelPx, stackIndex = 0, nextContentLayer) {
	if (!overlay?.type) return []
	const template = TEMPLATE_MAP[overlay.type]
	if (!template) return []

	const chW = channelPx?.w > 0 ? channelPx.w : 1920
	const chH = channelPx?.h > 0 ? channelPx.h : 1080

	const cf = normalizeContentFill(contentFill)
	const outset = outsetPxForPipOverlay(overlay)
	const oLayer = resolvePipOverlayCasparLayer(contentPhysicalLayer, stackIndex, nextContentLayer)
	const p = Number(contentPhysicalLayer)
	const idx = stackIndex | 0
	const aligned = Number.isFinite(p) && oLayer === p + PIP_OVERLAY_ALIGN_GAP + idx
	let inner
	let mixFill
	if (aligned) {
		inner = innerRectPipLocalFromOutset(cf, outset, chW, chH)
		mixFill = cf
	} else {
		const overlayFill = expandFillOutward(cf, outset, chW, chH)
		inner = innerRectInOverlayNorm(cf, overlayFill)
		mixFill = overlayFill
	}
	const cl = `${channel}-${oLayer}`
	const data = buildPipOverlayCgPayload(overlay, inner)
	/** @type {string[]} */
	const out = []
	if (aligned) {
		const leg = overlayLayerSlot(p, idx)
		if (Number.isFinite(leg) && leg !== oLayer) {
			const lcl = `${channel}-${leg}`
			out.push(`CG ${lcl} CLEAR`, `MIXER ${lcl} CLEAR`)
		}
	}
	out.push(
		`CG ${cl} ADD 0 "${template}" 1 "${data.replace(/"/g, '\\"')}"`,
		deferMixerAmcpLine(`MIXER ${cl} FILL ${mixFill.x} ${mixFill.y} ${mixFill.scaleX} ${mixFill.scaleY} 0`),
		deferMixerAmcpLine(`MIXER ${cl} KEYER 0`),
		deferMixerAmcpLine(`MIXER ${cl} OPACITY 1`)
	)
	return out
}

/**
 * @param {{ type: string, params?: object }[]} overlays
 * @param {{ w: number, h: number }} channelPx
 * @param {number|undefined} [nextContentLayer]
 * @returns {string[]}
 */
export function buildPipOverlayAmcpLinesAll(overlays, channel, contentPhysicalLayer, contentFill, channelPx, nextContentLayer) {
	const lines = []
	if (!Array.isArray(overlays)) return lines
	for (let i = 0; i < overlays.length && i < PIP_OVERLAY_MAX_STACK; i++) {
		const chunk = buildPipOverlayAmcpLines(overlays[i], channel, contentPhysicalLayer, contentFill, channelPx, i, nextContentLayer)
		lines.push(...chunk)
	}
	return lines
}

/**
 * @param {number|undefined} [nextContentLayer]
 * @returns {string[]}
 */
export function buildPipOverlayRemoveLines(channel, contentPhysicalLayer, nextContentLayer) {
	const ch = Number(channel)
	/** @type {Set<number>} */
	const toClear = new Set()
	for (let i = 0; i < PIP_OVERLAY_MAX_STACK; i++) {
		const oR = resolvePipOverlayCasparLayer(contentPhysicalLayer, i, nextContentLayer)
		if (Number.isFinite(oR)) toClear.add(oR)
	}
	const lines = []
	for (const ol of [...toClear].sort((a, b) => a - b)) {
		const cl = `${ch}-${ol}`
		lines.push(`CG ${cl} CLEAR`, `MIXER ${cl} CLEAR`)
	}
	return lines
}

/**
 * AMCP lines to clear PIP CG/MIXER for content layers in [minL, maxL].
 * Reuses the same slot resolution as live remove (aligned + legacy); dedupes repeated clears across L.
 * `next=10000` = treat as unbounded so aligned slots p…p+7 and legacy 100+8p… are all cleared.
 *
 * @param {number} channel
 * @param {number} minL
 * @param {number} maxL
 * @returns {string[]}
 */
export function pipOverlayClearAmcpLinesForContentRange(channel, minL, maxL) {
	const a = Number(minL)
	const b = Number(maxL)
	if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return []
	const unbounded = 10000
	/** @type {string[]} */
	const out = []
	const seen = new Set()
	for (let L = a; L <= b; L++) {
		for (const line of buildPipOverlayRemoveLines(channel, L, unbounded)) {
			const t = String(line).trim()
			if (!t || seen.has(t)) continue
			seen.add(t)
			out.push(t)
		}
	}
	return out
}

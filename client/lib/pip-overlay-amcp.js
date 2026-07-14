/**
 * Browser-side PIP overlay AMCP lines — mirrors src/engine/pip-overlay.js for PRV preview push.
 * Keep template map and math in sync with the server module.
 *
 * Outside-border model: @see docs/reference/pip-overlay-outside-border.md
 */

import {
	PIP_OVERLAY_MAX_STACK,
	resolvePipOverlayCasparLayer,
	PIP_OVERLAY_MAP,
} from './pip-overlay-registry.js'
import { sceneLayerRotationMixerLines, fillForSceneLayerRotationAnchor } from './scene-layer-rotation-amcp.js'

const TEMPLATE_MAP = {
	border: 'pip_border',
	shadow: 'pip_shadow',
	edge_strip: 'pip_edge_strip',
	glow: 'pip_glow',
	router: 'pip_router',
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

function mergePipOverlayParamsWithDefaults(overlay) {
	const t = String(overlay?.type || '').trim()
	const defs = PIP_OVERLAY_MAP.get(t)?.defaults || {}
	return { ...defs, ...mergeOverlayParams(overlay) }
}

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

function computePipOverlayPlacement(
	overlay,
	contentFill,
	chW,
	chH,
	contentPhysicalLayer,
	stackIndex,
	nextContentLayer,
	allOverlays,
) {
	const cf = normalizeContentFill(contentFill)
	const stack = Array.isArray(allOverlays) && allOverlays.length ? allOverlays : [overlay]
	const oLayer = resolvePipOverlayCasparLayer(contentPhysicalLayer, stackIndex, nextContentLayer)

	if (!isOutsideSide(overlay)) {
		const inner = { l: 0, t: 0, w: 1, h: 1 }
		return { inner, mixFill: cf, oLayer }
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

function buildPipOverlayCgPayload(overlay, placement) {
	const params = mergePipOverlayParamsWithDefaults(overlay)
	params.side = effectivePipOverlaySide(overlay)
	const inner = placement?.inner || placement
	const out = { ...params, inner }
	if (placement?.ringInnerPx != null) out.ringInnerPx = placement.ringInnerPx
	if (placement?.ringOuterPx != null) out.ringOuterPx = placement.ringOuterPx
	if (placement?.totalOutsetPx != null) out.totalOutsetPx = placement.totalOutsetPx
	return JSON.stringify(out)
}

/** Match server `deferMixerAmcpLine` — PIP chrome must not apply before `MIXER <ch> COMMIT` with look video. */
function deferMixerAmcpLine(line) {
	const s = String(line).trim()
	if (!/^MIXER\s+\d+-\d+\s+/i.test(s)) return s
	if (/\bDEFER\b/i.test(s)) return s
	return `${s} DEFER`
}

function pipOverlayMixerLines(cl, mixFill, contentRotation = 0, opts = {}) {
	const deferMixer = opts.deferMixer !== false
	const casparFill = fillForSceneLayerRotationAnchor(mixFill, contentRotation)
	const lines = [
		deferMixer
			? deferMixerAmcpLine(`MIXER ${cl} FILL ${casparFill.x} ${casparFill.y} ${casparFill.scaleX} ${casparFill.scaleY} 0`)
			: `MIXER ${cl} FILL ${casparFill.x} ${casparFill.y} ${casparFill.scaleX} ${casparFill.scaleY} 0`,
		deferMixer ? deferMixerAmcpLine(`MIXER ${cl} KEYER 0`) : `MIXER ${cl} KEYER 0`,
		deferMixer ? deferMixerAmcpLine(`MIXER ${cl} OPACITY 1`) : `MIXER ${cl} OPACITY 1`,
	]
	lines.push(
		...sceneLayerRotationMixerLines(cl, contentRotation, {
			deferRotation: deferMixer,
			rotationTail: deferMixer ? undefined : ' 0',
		}),
	)
	return lines
}

/**
 * @param {{ w: number, h: number }} channelPx
 * @param {number|undefined} [nextContentLayer]
 */
function buildPipOverlayAmcpLines(
	overlay,
	channel,
	contentPhysicalLayer,
	contentFill,
	channelPx,
	stackIndex = 0,
	nextContentLayer,
	contentRotation = 0,
	allOverlays,
) {
	if (!overlay?.type) return []
	const template = TEMPLATE_MAP[overlay.type]
	if (!template) return []

	const chW = channelPx?.w > 0 ? channelPx.w : 1920
	const chH = channelPx?.h > 0 ? channelPx.h : 1080
	const stack = Array.isArray(allOverlays) && allOverlays.length ? allOverlays : [overlay]

	const placement = computePipOverlayPlacement(
		overlay,
		contentFill,
		chW,
		chH,
		contentPhysicalLayer,
		stackIndex,
		nextContentLayer,
		stack,
	)
	const { mixFill, oLayer } = placement
	const cl = `${channel}-${oLayer}`
	const data = buildPipOverlayCgPayload(overlay, placement)
	/** @type {string[]} */
	const out = []
	out.push(
		`CG ${cl} ADD 0 "${template}" 1 "${data.replace(/"/g, '\\"')}"`,
		`CG ${cl} PLAY 0`,
		`CG ${cl} UPDATE 0 "${data.replace(/"/g, '\\"')}"`,
		...pipOverlayMixerLines(cl, mixFill, contentRotation),
	)
	return out
}

/**
 * @param {number} channel
 * @param {number} contentPhysicalLayer
 * @param {object} overlay
 * @param {object} contentFill
 * @param {object} channelPx
 * @param {number} [stackIndex]
 * @param {number} [nextContentLayer]
 * @returns {string[]}
 */
export function buildPipOverlayUpdateLines(
	channel,
	contentPhysicalLayer,
	overlay,
	contentFill,
	channelPx,
	stackIndex = 0,
	nextContentLayer,
	contentRotation = 0,
	allOverlays,
) {
	if (!overlay?.type) return []
	const oLayer = resolvePipOverlayCasparLayer(contentPhysicalLayer, stackIndex, nextContentLayer)
	const cl = `${channel}-${oLayer}`

	const chW = channelPx?.w > 0 ? channelPx.w : 1920
	const chH = channelPx?.h > 0 ? channelPx.h : 1080
	const stack = Array.isArray(allOverlays) && allOverlays.length ? allOverlays : [overlay]
	const placement = computePipOverlayPlacement(
		overlay,
		contentFill,
		chW,
		chH,
		contentPhysicalLayer,
		stackIndex,
		nextContentLayer,
		stack,
	)

	const data = buildPipOverlayCgPayload(overlay, placement)
	return [`CG ${cl} UPDATE 0 "${data.replace(/"/g, '\\"')}"`, ...pipOverlayMixerLines(cl, placement.mixFill, contentRotation)]
}

/**
 * @param {{ type: string, params?: object }[]} overlays
 * @param {{ w: number, h: number }} channelPx
 * @param {number|undefined} [nextContentLayer]
 * @param {{ type: string, params?: object }[]} [previousOverlays]
 * @param {Set<string>} [pipCgReadyKeys] — `${channel}-${overlayLayer}` keys that received ADD+PLAY; UPDATE only when present.
 * @returns {string[]}
 */
export function buildPipOverlayAmcpLinesAll(
	overlays,
	channel,
	contentPhysicalLayer,
	contentFill,
	channelPx,
	nextContentLayer,
	previousOverlays,
	pipCgReadyKeys,
	contentRotation = 0,
) {
	const lines = []
	if (!Array.isArray(overlays)) return lines
	const prev = Array.isArray(previousOverlays) ? previousOverlays : []
	const ch = Number(channel)

	for (let i = 0; i < overlays.length && i < PIP_OVERLAY_MAX_STACK; i++) {
		const cur = overlays[i]
		const old = prev[i]
		const oLayer = resolvePipOverlayCasparLayer(contentPhysicalLayer, i, nextContentLayer)
		const cgKey = Number.isFinite(ch) && Number.isFinite(oLayer) ? `${ch}-${oLayer}` : ''
		const cgReady = !!(cgKey && pipCgReadyKeys?.has(cgKey))
		// WO-213: UPDATE path sends full CG payload (colors/width/radius/etc + geometry) so config freshness is guaranteed.
		if (
			cur &&
			old &&
			cur.type === old.type &&
			effectivePipOverlaySide(cur) === effectivePipOverlaySide(old) &&
			!isOutsideSide(cur) &&
			cgReady
		) {
			const chunk = buildPipOverlayUpdateLines(
				channel,
				contentPhysicalLayer,
				cur,
				contentFill,
				channelPx,
				i,
				nextContentLayer,
				contentRotation,
				overlays,
			)
			lines.push(...chunk)
		} else if (cur) {
			if (isOutsideSide(cur) && cgKey) {
				const cl = `${ch}-${oLayer}`
				lines.push(`CG ${cl} CLEAR`, `MIXER ${cl} CLEAR`)
				if (pipCgReadyKeys) pipCgReadyKeys.delete(cgKey)
			}
			const chunk = buildPipOverlayAmcpLines(
				cur,
				channel,
				contentPhysicalLayer,
				contentFill,
				channelPx,
				i,
				nextContentLayer,
				contentRotation,
				overlays,
			)
			lines.push(...chunk)
			if (cgKey && pipCgReadyKeys) pipCgReadyKeys.add(cgKey)
		}
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
 * CLEAR only PIP/CG slots that actually change between previous and next overlay stacks.
 * Avoids blind sweeps of all {@link PIP_OVERLAY_MAX_STACK} slots (e.g. L260–L263 on L10) on every preview push.
 *
 * @param {number|undefined} nextContentLayer
 * @param {{ type: string, params?: object }[]|null|undefined} previousOverlays
 * @param {{ type: string, params?: object }[]|null|undefined} nextOverlays
 * @param {Set<string>} [pipCgReadyKeys]
 * @returns {string[]}
 */
export function buildPipOverlayRemoveStaleSlots(
	channel,
	contentPhysicalLayer,
	nextContentLayer,
	previousOverlays,
	nextOverlays,
	pipCgReadyKeys,
) {
	const ch = Number(channel)
	const prev = Array.isArray(previousOverlays) ? previousOverlays : []
	const next = Array.isArray(nextOverlays) ? nextOverlays : []
	const maxPrev = Math.min(prev.length, PIP_OVERLAY_MAX_STACK)
	const maxNext = Math.min(next.length, PIP_OVERLAY_MAX_STACK)
	/** @type {Set<number>} */
	const idxToClear = new Set()
	for (let i = maxNext; i < maxPrev; i++) idxToClear.add(i)
	for (let i = 0; i < Math.min(maxPrev, maxNext); i++) {
		if ((prev[i]?.type || '') !== (next[i]?.type || '')) idxToClear.add(i)
	}
	if (maxPrev > 0 && maxNext === 0) {
		for (let i = 0; i < maxPrev; i++) idxToClear.add(i)
	}
	const lines = []
	for (const i of [...idxToClear].sort((a, b) => a - b)) {
		const oR = resolvePipOverlayCasparLayer(contentPhysicalLayer, i, nextContentLayer)
		if (!Number.isFinite(oR)) continue
		const cl = `${ch}-${oR}`
		lines.push(`CG ${cl} CLEAR`, `MIXER ${cl} CLEAR`)
		if (pipCgReadyKeys) pipCgReadyKeys.delete(`${ch}-${oR}`)
	}
	return lines
}

/**
 * AMCP lines to clear PIP CG/MIXER for content layers in [minL, maxL].
 * Reuses the same slot resolution as live remove (WO-160 band 260–979); dedupes repeated clears across L.
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

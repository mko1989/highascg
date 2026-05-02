/**
 * PIP overlay — Caspar **CG** + MIXER. Two placement modes:
 * - **Aligned** (preferred): HTML on `L+1`, `L+2`, … when `L+1+stackIndex < nextContentLayer` (main **PLAY** stays on `L`;
 *   looks use `L` = 10, 20, 30… so 11–19 are the in-between band above base 10).
 *   MIXER FILL = video FILL when aligned; `inner` is PIP–local 0–1 (chrome inside the PIP box).
 * - **High-band legacy**: `100 + L*8 + i` when there is no room below the next look layer; expanded FILL
 *   and inner in that overlay’s 0–1 (chrome outside the video in channel space).
 * @see 25_WO_PIP_OVERLAY_EFFECTS.md
 */

'use strict'

const { getChannelResolutionForChannel } = require('./scene-native-fill')
const { sendAmcpLinesSequential } = require('../caspar/amcp-batch')
const { deferMixerAmcpLine } = require('../caspar/amcp-utils')

const PIP_OVERLAY_LAYER_OFFSET = 100
/** @see web/lib/pip-overlay-registry.js — keep in sync */
const PIP_OVERLAY_MAX_STACK = 8
/** Main clip on decade 10/20/…; first PIP/CG on p+1 so layers 11–19 (above 10) are free for HTML overlays. */
const PIP_OVERLAY_ALIGN_GAP = 1

const TEMPLATE_MAP = {
	border: 'pip_border',
	shadow: 'pip_shadow',
	edge_strip: 'pip_edge_strip',
	glow: 'pip_glow',
}

/** @deprecated use resolvePipOverlayCasparLayer — kept for callers that need legacy slot only */
function overlayLayerSlot(contentLayer, stackIndex = 0) {
	const i = Math.max(0, Math.min(PIP_OVERLAY_MAX_STACK - 1, stackIndex | 0))
	const base = Number(contentLayer)
	const n = Number.isFinite(base) ? base : 0
	return PIP_OVERLAY_LAYER_OFFSET + n * PIP_OVERLAY_MAX_STACK + i
}

/**
 * @param {number} contentPhysicalLayer
 * @param {number} stackIndex
 * @param {number|undefined} nextContentLayer - Smallest *other* look layer &gt; this PIP (exclusive end for aligned L+index).
 *   Omit/undefined: treated as `contentPhysicalLayer + 1` (at most one aligned slot without scene context).
 */
function resolvePipOverlayCasparLayer(contentPhysicalLayer, stackIndex, nextContentLayer) {
	const i = Math.max(0, Math.min(PIP_OVERLAY_MAX_STACK - 1, stackIndex | 0))
	const p = Number(contentPhysicalLayer)
	if (!Number.isFinite(p) || p < 0) {
		return PIP_OVERLAY_LAYER_OFFSET + i
	}
	// Invalid next (e.g. "" → 0, or ≤ p) was forcing legacy 100+8*p — CG sat above all low-numbered PIPs. Treat as "no bound".
	let nx = nextContentLayer
	if (nx == null) {
		// One main clip per decade (10,20,…); default upper bound = next base layer so 11..19 stay in-band.
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

/**
 * @param {object | null | undefined} layer
 * @returns {{ type: string, params?: object }[]}
 */
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

/**
 * Smallest **scene** layer number in the look above this strip (used for aligned PIP slot bounds).
 * @param {Array<{ layerNumber?: number }> | null | undefined} layers
 * @param {number|string} sceneLayerNum
 */
function nextPipContentLayerInScene(layers, sceneLayerNum) {
	const pl = Number(sceneLayerNum)
	if (!Number.isFinite(pl)) return 10000
	const m = (layers || [])
		.map((l) => Number(l.layerNumber))
		.filter((n) => Number.isFinite(n) && n > pl)
	if (m.length === 0) return 10000
	return Math.min(...m)
}

/**
 * @param {Array<{ pLayer: number }>} takeJobs
 * @param {number} pLayer
 * @returns {number}
 */
function nextPipContentLayerInTake(takeJobs, pLayer) {
	const pl = Number(pLayer)
	if (!Number.isFinite(pl)) return 10000
	const m = (takeJobs || [])
		.map((j) => j.pLayer)
		.filter((n) => Number.isFinite(n) && n > pl)
	if (m.length === 0) return 10000
	return Math.min(...m)
}

/**
 * @param {number} oR
 * @param {Array<{ pLayer: number, layer?: { layerNumber?: number }, pipOverlays?: object[] }>} takeJobs
 * @param {Array<{ layerNumber?: number }> | null | undefined} currentSceneLayers
 */
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
				// In-place CG UPDATE in add phase; no immediate strip (avoids flash)
				return false
			}
		}
	}
	return true
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
 * When CG shares the PIP’s MIXER FILL, template #root = PIP; inner is the “hole” in 0–1 of the PIP
 * (symmetric px border from content edges, same as pip_border’s resolveEffectiveInner fallback).
 * @param {{ x: number, y: number, scaleX: number, scaleY: number }} contentFill
 * @param {number} bPx
 * @param {number} chW
 * @param {number} chH
 * @returns {{ l: number, t: number, w: number, h: number }}
 */
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
 * @param {number} [stackIndex] - 0 = first overlay layer above PIP (below higher stack indices)
 * @param {number} [nextContentLayer] - min other look layer &gt; this PIP; see resolvePipOverlayCasparLayer
 * @returns {string[]}
 */
function buildPipOverlayAmcpLines(overlay, channel, contentPhysicalLayer, contentFill, appCtx, stackIndex = 0, nextContentLayer) {
	if (!overlay?.type) return []
	const template = TEMPLATE_MAP[overlay.type]
	if (!template) return []

	const res = getChannelResolutionForChannel(appCtx?.config, channel, appCtx)
	const chW = res?.w > 0 ? res.w : 1920
	const chH = res?.h > 0 ? res.h : 1080

	const cf = normalizeContentFill(contentFill)
	const outset = outsetPxForPipOverlay(overlay)
	const oLayer = resolvePipOverlayCasparLayer(contentPhysicalLayer, stackIndex, nextContentLayer)
	const p = Number(contentPhysicalLayer)
	const idx = stackIndex | 0
	// Must match resolve(): legacy uses 100+8*p+i; aligned uses p+1+idx (no CG on the same layer as the clip).
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
	// Aligned: drop old high-band HTML on the legacy slot (2 lines) so CG ADD targets the same layer as video.
	if (aligned) {
		const leg = overlayLayerSlot(p, idx)
		if (Number.isFinite(leg) && leg !== oLayer) {
			const lcl = `${channel}-${leg}`
			// Defer to channel COMMIT; avoid instant blank before PLAY + MIXER COMMIT
			out.push(deferMixerAmcpLine(`MIXER ${lcl} CLEAR`))
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
 * AMCP lines for every overlay in order (index 0 = bottom of stack).
 * @param {{ type: string, params?: object }[]} overlays
 * @param {number} [nextContentLayer]
 * @param {{ layerNumber?: number, pipOverlays?: object[] }|null|undefined} [prevSceneLayer] - same screen row on **air**; same template at same index uses CG UPDATE
 */
function buildPipOverlayAmcpLinesAll(overlays, channel, contentPhysicalLayer, contentFill, appCtx, nextContentLayer, prevSceneLayer) {
	const lines = []
	if (!Array.isArray(overlays)) return lines
	const prevPips = pipOverlaysFromLayer(prevSceneLayer)
	for (let i = 0; i < overlays.length && i < PIP_OVERLAY_MAX_STACK; i++) {
		if (
			overlays[i] &&
			prevPips[i] &&
			overlays[i].type &&
			String(overlays[i].type) === String(prevPips[i].type)
		) {
			const chunk = buildPipOverlayUpdateLines(
				channel,
				contentPhysicalLayer,
				overlays[i],
				contentFill,
				appCtx,
				i,
				nextContentLayer
			)
			lines.push(...chunk)
		} else {
			const chunk = buildPipOverlayAmcpLines(overlays[i], channel, contentPhysicalLayer, contentFill, appCtx, i, nextContentLayer)
			lines.push(...chunk)
		}
	}
	return lines
}

/**
 * CG UPDATE with recomputed inner (call with same contentFill as video layer).
 * @param {number} channel
 * @param {number} contentPhysicalLayer
 * @param {{ type: string, params?: object }} overlay
 * @param {{ x: number, y: number, scaleX: number, scaleY: number }} contentFill
 * @param {number} [stackIndex]
 * @param {object} [appCtx]
 * @param {number} [nextContentLayer]
 * @returns {string[]}
 */
function buildPipOverlayUpdateLines(channel, contentPhysicalLayer, overlay, contentFill, appCtx, stackIndex = 0, nextContentLayer) {
	const oLayer = resolvePipOverlayCasparLayer(contentPhysicalLayer, stackIndex, nextContentLayer)
	const cl = `${channel}-${oLayer}`
	const res = getChannelResolutionForChannel(appCtx?.config, channel, appCtx)
	const chW = res?.w > 0 ? res.w : 1920
	const chH = res?.h > 0 ? res.h : 1080
	const cf = normalizeContentFill(contentFill)
	const outset = outsetPxForPipOverlay(overlay)
	const p = Number(contentPhysicalLayer)
	const idxU = stackIndex | 0
	const alignedU = Number.isFinite(p) && oLayer === p + PIP_OVERLAY_ALIGN_GAP + idxU
	let inner
	let mixFill
	if (alignedU) {
		inner = innerRectPipLocalFromOutset(cf, outset, chW, chH)
		mixFill = cf
	} else {
		const overlayFill = expandFillOutward(cf, outset, chW, chH)
		inner = innerRectInOverlayNorm(cf, overlayFill)
		mixFill = overlayFill
	}
	const data = buildPipOverlayCgPayload(overlay, inner)
	return [
		`CG ${cl} UPDATE 0 "${data.replace(/"/g, '\\"')}"`,
		deferMixerAmcpLine(`MIXER ${cl} FILL ${mixFill.x} ${mixFill.y} ${mixFill.scaleX} ${mixFill.scaleY} 0`),
	]
}

/**
 * @param {number|undefined} [nextContentLayer] - Same as apply/take; controls which aligned layers were used
 */
function buildPipOverlayRemoveLines(channel, contentPhysicalLayer, nextContentLayer, maxStack = PIP_OVERLAY_MAX_STACK) {
	const ch = parseInt(channel, 10)
	const cap =
		maxStack == null || !Number.isFinite(Number(maxStack))
			? PIP_OVERLAY_MAX_STACK
			: Math.max(0, Math.min(PIP_OVERLAY_MAX_STACK, Math.floor(Number(maxStack))))
	if (cap === 0) return []
	/** @type {Set<number>} */
	const toClear = new Set()
	for (let i = 0; i < cap; i++) {
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
 * One deduped CG/MIXER clear set for PIP slots that the **previous** look actually used (avoids clearing empty stack slots).
 * @param {number} channel
 * @param {Array<{ pLayer: number, layer?: { layerNumber?: number } }>} takeJobs
 * @param {Array<{ layerNumber?: number }> | null | undefined} currentSceneLayers — previous look
 * @returns {string[]}
 */
function buildPipOverlayRemoveLinesForTakeJobSet(channel, takeJobs, currentSceneLayers) {
	const ch = parseInt(channel, 10)
	if (!Number.isFinite(ch) || !Array.isArray(takeJobs)) return []
	/** @type {Set<number>} */
	const toClear = new Set()
	for (const job of takeJobs) {
		const pl = Number(job.pLayer)
		if (!Number.isFinite(pl)) continue
		const sceneLn = Number(job.layer?.layerNumber)
		const prevLayer =
			Number.isFinite(sceneLn) && Array.isArray(currentSceneLayers)
				? currentSceneLayers.find((l) => Number(l?.layerNumber) === sceneLn)
				: null
		const prevN = pipOverlaysFromLayer(prevLayer).length
		if (prevN <= 0) continue
		const prevNext = nextPipContentLayerInScene(currentSceneLayers, sceneLn)
		for (let i = 0; i < prevN; i++) {
			const oR = resolvePipOverlayCasparLayer(pl, i, prevNext)
			if (Number.isFinite(oR)) toClear.add(oR)
		}
	}
	const lines = []
	for (const ol of [...toClear].sort((a, b) => a - b)) {
		if (!shouldStripPipSlotBeforeAdd(ol, takeJobs, currentSceneLayers)) continue
		// Defer to one MIXER <ch> COMMIT with LOADBG/PLAY and main layers — no instant CG strip
		lines.push(deferMixerAmcpLine(`MIXER ${ch}-${ol} CLEAR`))
	}
	return lines
}

/**
 * Fade PIP HTML on the same layer slots remove() would clear, in sync with outgoing content.
 * @param {string} opacityFadeParam - Same tail as content `MIXER … OPACITY` (e.g. `0 25` or `0 25 easeboth`)
 * @param {number} [nextContentLayer] - upper bound for aligned PIP band (see resolvePipOverlayCasparLayer)
 */
function buildPipOverlayOpacityFadeDeferLines(
	channel,
	contentPhysicalLayer,
	opacityFadeParam,
	nextContentLayer,
	maxStack = PIP_OVERLAY_MAX_STACK,
) {
	const lines = []
	const ch = parseInt(channel, 10)
	const tail = String(opacityFadeParam).trim()
	if (!tail) return lines
	const cap =
		maxStack == null || !Number.isFinite(Number(maxStack))
			? PIP_OVERLAY_MAX_STACK
			: Math.max(0, Math.min(PIP_OVERLAY_MAX_STACK, Math.floor(Number(maxStack))))
	if (cap === 0) return lines
	/** @type {Set<number>} */
	const toFade = new Set()
	for (let i = 0; i < cap; i++) {
		const oR = resolvePipOverlayCasparLayer(contentPhysicalLayer, i, nextContentLayer)
		if (Number.isFinite(oR)) toFade.add(oR)
	}
	for (const ol of [...toFade].sort((a, b) => a - b)) {
		lines.push(`MIXER ${ch}-${ol} OPACITY ${tail} DEFER`)
	}
	return lines
}

const PIP_OVERLAY_TEMPLATE_FILES = Object.values(TEMPLATE_MAP).map((t) => t + '.html')

/**
 * PIP overlay AMCP must stay in strict order with no arbitrary chunk boundaries.
 * `batchSendChunked` can split mid–overlay (e.g. CG in one BEGIN…COMMIT chunk, MIXER lines in the next);
 * MIXER-only chunks then get a pre-batch `MIXER <ch> COMMIT`, which commits channel mixer state before
 * overlay MIXER FILL runs — borders attach to the wrong place. Always send one line at a time.
 */
/** Drop duplicate command lines (common when PIP remove runs 8 stack slots + legacy, then repeated per take job). */
function dedupeAmcpLineOrderPreserving(lines) {
	const seen = new Set()
	const out = []
	for (const line of lines) {
		const t = String(line).trim()
		if (!t) continue
		if (seen.has(t)) continue
		seen.add(t)
		out.push(t)
	}
	return out
}

async function sendPipOverlayLinesSerial(amcp, lines) {
	const clean = dedupeAmcpLineOrderPreserving(lines)
	if (clean.length === 0) return
	await sendAmcpLinesSequential(clean, amcp)
}

module.exports = {
	PIP_OVERLAY_LAYER_OFFSET,
	PIP_OVERLAY_MAX_STACK,
	overlayLayer,
	overlayLayerSlot,
	resolvePipOverlayCasparLayer,
	pipOverlaysFromLayer,
	mergeOverlayParams,
	normalizeContentFill,
	outsetPxForPipOverlay,
	expandFillOutward,
	innerRectInOverlayNorm,
	innerRectPipLocalFromOutset,
	buildPipOverlayAmcpLines,
	buildPipOverlayAmcpLinesAll,
	buildPipOverlayUpdateLines,
	buildPipOverlayRemoveLines,
	buildPipOverlayRemoveLinesForTakeJobSet,
	buildPipOverlayOpacityFadeDeferLines,
	nextPipContentLayerInScene,
	nextPipContentLayerInTake,
	sendPipOverlayLinesSerial,
	PIP_OVERLAY_TEMPLATE_FILES,
	TEMPLATE_MAP,
}

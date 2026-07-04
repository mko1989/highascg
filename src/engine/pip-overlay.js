/**
 * PIP overlay — Caspar CG + MIXER.
 * This file contains the command builders for PIP overlays.
 * Utilities and Global Border logic have been split into separate files.
 */

'use strict'

const { getChannelResolutionForChannel } = require('./scene-native-fill')
const { sendAmcpLinesSequential, inferProgramChannelFromAmcpLines } = require('../caspar/amcp-batch')
const { deferMixerAmcpLine } = require('../caspar/amcp-utils')
const { sceneLayerRotationMixerLines, fillForSceneLayerRotationAnchor } = require('./scene-layer-rotation-amcp')

const utils = require('./pip-overlay-utils')
const globalBorder = require('./global-border')

const {
	PIP_OVERLAY_ALIGN_GAP,
	PIP_OVERLAY_MAX_STACK,
	TEMPLATE_MAP,
	resolvePipOverlayCasparLayer,
	pipOverlaysFromLayer,
	mergeOverlayParams,
	normalizeContentFill,
	outsetPxForPipOverlay,
	buildPipOverlayCgPayload,
	overlayLayerSlot,
	shouldStripPipSlotBeforeAdd,
	computePipOverlayPlacement,
	computePipRouterPlacement,
} = utils

/**
 * @param {{ deferMixer?: boolean }} [opts] — default immediate FILL (outside borders need expanded MIXER FILL on air).
 */
function pipOverlayMixerLines(cl, mixFill, contentRotation = 0, opts = {}) {
	const deferMixer = opts.deferMixer === true
	const mixTail = deferMixer ? ' DEFER' : ' 0'
	const casparFill = fillForSceneLayerRotationAnchor(mixFill, contentRotation)
	const lines = [
		`MIXER ${cl} FILL ${casparFill.x} ${casparFill.y} ${casparFill.scaleX} ${casparFill.scaleY}${mixTail}`,
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
 * Build AMCP commands to apply a PIP overlay on a scene layer.
 */
function buildPipOverlayAmcpLines(
	overlay,
	channel,
	contentPhysicalLayer,
	contentFill,
	appCtx,
	stackIndex = 0,
	nextContentLayer,
	contentRotation = 0,
	allOverlays,
) {
	if (!overlay?.type) return []
	const template = TEMPLATE_MAP[overlay.type]
	if (!template) return []

	const res = getChannelResolutionForChannel(appCtx?.config, channel, appCtx)
	const chW = res?.w > 0 ? res.w : 1920
	const chH = res?.h > 0 ? res.h : 1080
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
	const out = []
	const p = Number(contentPhysicalLayer)
	const idx = stackIndex | 0
	const aligned = Number.isFinite(p) && oLayer === p + PIP_OVERLAY_ALIGN_GAP + idx

	if (aligned) {
		const leg = overlayLayerSlot(p, idx)
		if (Number.isFinite(leg) && leg !== oLayer) {
			const lcl = `${channel}-${leg}`
			out.push(deferMixerAmcpLine(`MIXER ${lcl} CLEAR`))
		}
	}
	out.push(
		`CG ${cl} ADD 0 "${template}" 1 "${data.replace(/"/g, '\\"')}"`,
		`CG ${cl} PLAY 0`,
		`CG ${cl} UPDATE 0 "${data.replace(/"/g, '\\"')}"`,
		...pipOverlayMixerLines(cl, mixFill, contentRotation),
	)
	return out
}

/**
 * AMCP lines for every overlay in order (index 0 = bottom of stack).
 */
function buildPipOverlayAmcpLinesAll(
	overlays,
	channel,
	contentPhysicalLayer,
	contentFill,
	appCtx,
	nextContentLayer,
	prevSceneLayer,
	contentRotation = 0,
) {
	if (!Array.isArray(overlays) || overlays.length === 0) return []

	const lines = []
	const prevPips = pipOverlaysFromLayer(prevSceneLayer)
	for (let i = 0; i < overlays.length && i < PIP_OVERLAY_MAX_STACK; i++) {
		const cur = overlays[i]
		const canUpdateInPlace =
			cur &&
			prevPips[i] &&
			cur.type &&
			String(cur.type) === String(prevPips[i].type) &&
			utils.effectivePipOverlaySide(cur) === utils.effectivePipOverlaySide(prevPips[i]) &&
			!utils.isOutsideSide(cur)
		if (canUpdateInPlace) {
			const chunk = buildPipOverlayUpdateLines(
				channel,
				contentPhysicalLayer,
				cur,
				contentFill,
				appCtx,
				i,
				nextContentLayer,
				contentRotation,
				overlays,
			)
			lines.push(...chunk)
		} else if (cur) {
			const oLayer = resolvePipOverlayCasparLayer(contentPhysicalLayer, i, nextContentLayer)
			if (utils.isOutsideSide(cur) && Number.isFinite(oLayer)) {
				const cl = `${channel}-${oLayer}`
				lines.push(`CG ${cl} CLEAR`, `MIXER ${cl} CLEAR`)
			}
			const chunk = buildPipOverlayAmcpLines(
				cur,
				channel,
				contentPhysicalLayer,
				contentFill,
				appCtx,
				i,
				nextContentLayer,
				contentRotation,
				overlays,
			)
			lines.push(...chunk)
		}
	}
	return lines
}

/**
 * CG UPDATE with recomputed inner (call with same contentFill as video layer).
 */
function buildPipOverlayUpdateLines(
	channel,
	contentPhysicalLayer,
	overlay,
	contentFill,
	appCtx,
	stackIndex = 0,
	nextContentLayer,
	contentRotation = 0,
	allOverlays,
) {
	const oLayer = resolvePipOverlayCasparLayer(contentPhysicalLayer, stackIndex, nextContentLayer)
	const cl = `${channel}-${oLayer}`
	const res = getChannelResolutionForChannel(appCtx?.config, channel, appCtx)
	const chW = res?.w > 0 ? res.w : 1920
	const chH = res?.h > 0 ? res.h : 1080
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
 * Collapses all overlays for a layer into a single "router" command.
 */
function buildPipOverlayRouterAmcpLines(
	overlays,
	channel,
	contentPhysicalLayer,
	contentFill,
	appCtx,
	nextContentLayer,
	contentRotation = 0,
) {
	if (!Array.isArray(overlays) || overlays.length === 0) return []

	const res = getChannelResolutionForChannel(appCtx?.config, channel, appCtx)
	const chW = res?.w > 0 ? res.w : 1920
	const chH = res?.h > 0 ? res.h : 1080
	const { inner, mixFill, oLayer, effects } = computePipRouterPlacement(
		overlays,
		contentFill,
		chW,
		chH,
		contentPhysicalLayer,
		nextContentLayer,
	)

	const cl = `${channel}-${oLayer}`
	const data = JSON.stringify({
		inner,
		radius: overlays[0]?.params?.radius || overlays[0]?.radius || 0,
		effects: effects || overlays.map((o) => ({ type: o.type, params: mergeOverlayParams(o) })),
	})

	return [
		`CG ${cl} ADD 0 "pip_router" 1 "${data.replace(/"/g, '\\"')}"`,
		`CG ${cl} PLAY 0`,
		`CG ${cl} UPDATE 0 "${data.replace(/"/g, '\\"')}"`,
		...pipOverlayMixerLines(cl, mixFill, contentRotation),
	]
}

/**
 * Update the router command.
 */
function buildPipOverlayRouterUpdateLines(
	channel,
	contentPhysicalLayer,
	overlays,
	contentFill,
	appCtx,
	nextContentLayer,
	contentRotation = 0,
) {
	if (!Array.isArray(overlays) || overlays.length === 0) return []

	const oLayer = resolvePipOverlayCasparLayer(contentPhysicalLayer, 0, nextContentLayer)
	const res = getChannelResolutionForChannel(appCtx?.config, channel, appCtx)
	const chW = res?.w > 0 ? res.w : 1920
	const chH = res?.h > 0 ? res.h : 1080
	const { inner, mixFill, effects } = computePipRouterPlacement(
		overlays,
		contentFill,
		chW,
		chH,
		contentPhysicalLayer,
		nextContentLayer,
	)

	const cl = `${channel}-${oLayer}`
	const data = JSON.stringify({
		inner,
		radius: overlays[0]?.params?.radius || overlays[0]?.radius || 0,
		effects: effects || overlays.map((o) => ({ type: o.type, params: mergeOverlayParams(o) })),
	})

	return [`CG ${cl} UPDATE 0 "${data.replace(/"/g, '\\"')}"`, ...pipOverlayMixerLines(cl, mixFill, contentRotation)]
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
 * One deduped CG/MIXER clear set for PIP slots that the **previous** look actually used.
 */
function buildPipOverlayRemoveLinesForTakeJobSet(channel, takeJobs, currentSceneLayers) {
	const ch = parseInt(channel, 10)
	if (!Number.isFinite(ch) || !Array.isArray(takeJobs)) return []
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
		const prevNext = utils.nextPipContentLayerInScene(currentSceneLayers, sceneLn)
		for (let i = 0; i < prevN; i++) {
			const oR = resolvePipOverlayCasparLayer(pl, i, prevNext)
			if (Number.isFinite(oR)) toClear.add(oR)
		}
	}
	const lines = []
	for (const ol of [...toClear].sort((a, b) => a - b)) {
		if (!shouldStripPipSlotBeforeAdd(ol, takeJobs, currentSceneLayers)) continue
		lines.push(deferMixerAmcpLine(`MIXER ${ch}-${ol} CLEAR`))
	}
	return lines
}

/**
 * Fade PIP HTML on the same layer slots remove() would clear, in sync with outgoing content.
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
	const ch = inferProgramChannelFromAmcpLines(clean)
	if (
		ch != null &&
		clean.some((line) => /\bDEFER\b/i.test(line) && /^MIXER\s+\d+-\d+\s+/i.test(String(line).trim()))
	) {
		await amcp.mixerCommit(ch)
	}
}

module.exports = {
	...utils,
	...globalBorder,
	buildPipOverlayAmcpLines,
	buildPipOverlayAmcpLinesAll,
	buildPipOverlayUpdateLines,
	buildPipOverlayRouterAmcpLines,
	buildPipOverlayRouterUpdateLines,
	buildPipOverlayRemoveLines,
	buildPipOverlayRemoveLinesForTakeJobSet,
	buildPipOverlayOpacityFadeDeferLines,
	sendPipOverlayLinesSerial,
}

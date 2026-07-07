'use strict'

const { getChannelMap } = require('../config/routing')
const { param } = require('../caspar/amcp-utils')
const liveSceneState = require('../state/live-scene-state')
const {
	normalizeTransition,
	resolveChannelFramerateForMixerTween,
} = require('./scene-transition')
const {
	clearSceneProgramLookStackLayers,
	collectOccupiedLookLayersOnChannel,
} = require('./scene-exit-layers')
const { TIMELINE_LAYER_BASE } = require('./timeline-playback-helpers')

function transitionIsCut(globalT) {
	return globalT.duration <= 0 || String(globalT.type || '').toUpperCase() === 'CUT'
}

function waitMs(ms) {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

/**
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number} channel
 * @param {number[]} layerNums
 * @param {number} durationFrames
 * @param {string} [tween]
 */
async function fadePhysicalLayersOut(amcp, channel, layerNums, durationFrames, tween) {
	if (!amcp || !layerNums.length || durationFrames <= 0) return
	const lines = []
	for (const L of layerNums) {
		const cl = `${channel}-${L}`
		let p = `0 ${durationFrames}`
		if (tween) p += ` ${param(tween)}`
		lines.push(`MIXER ${cl} OPACITY ${p} DEFER`)
	}
	await amcp.batchSendChunked(lines, { skipMixerPreCommit: true })
	await amcp.mixerCommit(channel)
}

/**
 * Fade timeline layers in from 0→1 over durationFrames.
 * Sets initial opacity to 0 then schedules a deferred tween to 1.
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number} channel
 * @param {number[]} layerNums
 * @param {number} durationFrames
 * @param {string} [tween]
 */
async function fadePhysicalLayersIn(amcp, channel, layerNums, durationFrames, tween) {
	if (!amcp || !layerNums.length || durationFrames <= 0) return
	const lines = []
	for (const L of layerNums) {
		const cl = `${channel}-${L}`
		// Set initial opacity to 0 (instant)
		lines.push(`MIXER ${cl} OPACITY 0 0`)
	}
	for (const L of layerNums) {
		const cl = `${channel}-${L}`
		let p = `1 ${durationFrames}`
		if (tween) p += ` ${param(tween)}`
		lines.push(`MIXER ${cl} OPACITY ${p} DEFER`)
	}
	await amcp.batchSendChunked(lines, { skipMixerPreCommit: true })
	await amcp.mixerCommit(channel)
}

/**
 * Collect physical CasparCG layer numbers used by a timeline.
 * @param {object} tl timeline model
 * @returns {number[]}
 */
function collectTimelinePhysicalLayers(tl) {
	if (!tl?.layers?.length) return []
	return tl.layers.map((_, i) => TIMELINE_LAYER_BASE + i)
}

/**
 * @param {object} ctx
 * @param {import('./timeline-engine').TimelineEngine} eng
 * @param {string} tlId
 * @param {object} body
 */
async function runTimelineDirectTake(ctx, eng, tlId, body) {
	const map = getChannelMap(ctx?.config || {})
	const screenCount = map?.screenCount || 1
	const targetIdxs =
		body.screenIdx === null || body.screenIdx === 'all'
			? Array.from({ length: screenCount }, (_, i) => i)
			: [Math.max(0, parseInt(body.screenIdx, 10) || 0)]

	const tl = eng.get(tlId)
	if (!tl) throw new Error('Timeline not found')

	const pb = eng.getPlayback(tlId)
	const pos = pb?.position ?? 0
	const fps = Math.max(1, parseInt(String(body.framerate ?? tl.fps ?? 25), 10) || 25)
	const globalT = normalizeTransition(
		{
			type: body.transition || 'MIX',
			duration: body.duration != null ? Number(body.duration) : 0,
			tween: body.tween || 'linear',
		},
		false,
	)
	const forceCut = transitionIsCut(globalT)
	const amcp = ctx.amcp
	if (!amcp) throw new Error('Caspar not connected')

	const screenIdx =
		body.screenIdx === null || body.screenIdx === 'all'
			? null
			: Number.isFinite(Number(body.screenIdx))
				? Number(body.screenIdx)
				: 0

	eng.setSendTo({ preview: false, program: true, screenIdx }, tlId, { skipAmcpApply: true })
	eng.setLoop(tlId, !!pb?.loop)

	eng._prevKey = new Map()
	eng._lastKfValues.clear()
	eng._lastKfSegment.clear()

	// Timeline on PGM first (clip opacity keyframes); looks fade underneath on lower layers.
	await eng.playForTake(tlId, pos)

	const fadeWaits = []
	const tlPhysicalLayers = collectTimelinePhysicalLayers(tl)
	for (const sIdx of targetIdxs) {
		const programCh = map?.programCh?.(sIdx + 1) ?? 1
		const fr = Math.max(1, resolveChannelFramerateForMixerTween(ctx, programCh, fps))

		if (!forceCut) {
			// Fade in timeline layers
			if (tlPhysicalLayers.length) {
				await fadePhysicalLayersIn(amcp, programCh, tlPhysicalLayers, globalT.duration, globalT.tween)
			}
			// Fade out look layers
			const lookLayers = collectOccupiedLookLayersOnChannel(ctx, programCh)
			if (lookLayers.length) {
				await fadePhysicalLayersOut(amcp, programCh, lookLayers, globalT.duration, globalT.tween)
			}
			if (tlPhysicalLayers.length || lookLayers.length) {
				fadeWaits.push(waitMs((globalT.duration / fr) * 1000))
			}
		}
	}

	if (fadeWaits.length) await Promise.all(fadeWaits)

	for (const sIdx of targetIdxs) {
		const programCh = map?.programCh?.(sIdx + 1) ?? 1
		const previewCh = map?.previewCh?.(sIdx + 1) ?? 2
		await clearSceneProgramLookStackLayers(amcp, programCh, ctx)
		await clearSceneProgramLookStackLayers(amcp, previewCh, ctx)
		await amcp.mixerCommit(programCh).catch(() => {})
		await amcp.mixerCommit(previewCh).catch(() => {})
		liveSceneState.clearChannel(programCh)
	}

	liveSceneState.broadcastSceneLive(ctx)
	return { ok: true, transition: globalT, forceCut }
}

module.exports = {
	runTimelineDirectTake,
	fadePhysicalLayersOut,
	fadePhysicalLayersIn,
	transitionIsCut,
}

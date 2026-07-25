'use strict'

const { param } = require('../caspar/amcp-utils')
const {
	buildPipOverlayOpacityFadeDeferLines,
	nextPipContentLayerInScene,
	pipOverlaysFromLayer,
} = require('./pip-overlay')

/**
 * @param {object} amcp
 * @param {object} ctx
 * @returns {Promise<number|null>} updated fadeClockStart
 */
async function sendExitAndTimelineFadeLines(amcp, ctx) {
	const {
		self,
		channel,
		activeTimelineIdToFadeOut,
		fadeDur,
		forceCut,
		fadeTw,
		exitMedia,
		timelineFadeInPhys,
		shouldRunBankCrossfade,
		isMergeTransition,
		phys,
		activeBank,
		inactiveBank,
		currentSceneLayers,
		fadeWatcher,
		notifyProgramTransitionStarted,
		fadeClockStart,
	} = ctx

	const timelineFadeLines = []
	if (activeTimelineIdToFadeOut && fadeDur > 0 && !forceCut) {
		const tl = self.timelineEngine.timelines.get(activeTimelineIdToFadeOut)
		if (tl) {
			const { TIMELINE_LAYER_BASE } = require('./timeline-playback-helpers')
			let tail = `0 ${fadeDur}`
			if (fadeTw) tail += ` ${param(fadeTw)}`
			for (let li = 0; li < tl.layers.length; li++) {
				const cl = `${channel}-${TIMELINE_LAYER_BASE + li}`
				timelineFadeLines.push(`MIXER ${cl} OPACITY ${tail} DEFER`)
			}
		}
	}

	let newFadeClockStart = fadeClockStart

	if (
		(exitMedia.length > 0 || timelineFadeLines.length > 0 || (timelineFadeInPhys?.length || 0) > 0) &&
		fadeDur > 0 &&
		!shouldRunBankCrossfade &&
		!isMergeTransition
	) {
		const fadeLines = [...timelineFadeLines]
		// Incoming timeline layers were preset to 0 before PLAY (WO-152 B152.1) — fade them
		// in with the same batch/commit so they enter with the transition, not as a pop.
		for (const L of timelineFadeInPhys || []) {
			let p = `1 ${fadeDur}`
			if (fadeTw) p += ` ${param(fadeTw)}`
			fadeLines.push(`MIXER ${channel}-${L} OPACITY ${p}`)
		}
		for (const layer of exitMedia) {
			const pOut = phys(Number(layer.layerNumber), activeBank)
			if (fadeWatcher) fadeWatcher.cancel(channel, pOut)
			const cl = `${channel}-${pOut}`
			let p = `0 ${fadeDur}`
			if (fadeTw) p += ` ${param(fadeTw)}`
			fadeLines.push(`MIXER ${cl} OPACITY ${p}`)
			try {
				const nextL = nextPipContentLayerInScene(currentSceneLayers, layer.layerNumber)
				const pipN = pipOverlaysFromLayer(layer).length
				if (pipN > 0) {
					fadeLines.push(...buildPipOverlayOpacityFadeDeferLines(channel, pOut, p, nextL, pipN))
				}
			} catch (_) {}
		}
		try {
			await amcp.batchSendChunked(fadeLines, { skipMixerPreCommit: true })
			await amcp.mixerCommit(channel)
		} catch (_) {}
		newFadeClockStart = Date.now()
		notifyProgramTransitionStarted()
	} else if (exitMedia.length > 0) {
		for (const layer of exitMedia) {
			const ln = Number(layer.layerNumber)
			if (isMergeTransition && Number.isFinite(ln)) {
				if (fadeWatcher) {
					fadeWatcher.cancel(channel, phys(ln, activeBank))
					fadeWatcher.cancel(channel, phys(ln, inactiveBank))
				}
			} else {
				const pOut = phys(Number(layer.layerNumber), activeBank)
				if (fadeWatcher) fadeWatcher.cancel(channel, pOut)
			}
		}
	}

	return newFadeClockStart
}

module.exports = { sendExitAndTimelineFadeLines }

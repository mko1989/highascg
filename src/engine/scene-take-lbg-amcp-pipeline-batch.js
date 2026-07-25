'use strict'

const { chLayer } = require('../caspar/amcp-utils')
const { serializeClipCommandPlan } = require('../caspar/amcp-command-plan')
const { cropAdjustedFillForLayer } = require('./layer-crop')
const { logPlannedCommand } = require('./scene-take-lbg-merge')
const {
	buildPipOverlayAmcpLinesAll,
	buildPipOverlayRemoveLinesForTakeJobSet,
	nextPipContentLayerInTake,
	sendPipOverlayLinesSerial,
} = require('./pip-overlay')

/**
 * @param {object} amcp
 * @param {{ self: object, channel: number, takeJobs: object[], mergeMixerExtras: string[], borderLines: string[], twoPhaseBatch: boolean, currentSceneLayers: object[], currentMap: Map }} ctx
 */
async function sendTakeJobsLoadAndMixerBatch(amcp, ctx) {
	const { self, channel, takeJobs, mergeMixerExtras, borderLines, twoPhaseBatch, currentSceneLayers, currentMap } = ctx

	if (twoPhaseBatch) {
		// WO-259 T259.1 — Phase A: one BEGIN…COMMIT batch (chunked at the AMCP cap) carrying
		// border/PIP CG lines + per-layer MIXER CLEAR + LOADBG (transition params intact via the
		// same plan the legacy path serializes) + pre-PLAY opacity + deferred MIXER setup (incl.
		// immediate FILL/ANCHOR). The leading `MIXER <ch> COMMIT` stays OUTSIDE this batch and at
		// its existing position (right before the PLAY phase, inside sendStaggeredTakePlays) —
		// Caspar forbids `MIXER n COMMIT` inside BEGIN…COMMIT (amcp-batch.js validateBatchLine).
		const phaseALines = [...borderLines]
		for (const job of takeJobs) {
			if (!job.isMerge) {
				phaseALines.push(`MIXER ${chLayer(channel, job.pLayer)} CLEAR`)
			}
			if (job.loadPlan) {
				logPlannedCommand(self, 'load', job.layer.layerNumber, job.loadPlan)
				phaseALines.push(serializeClipCommandPlan(job.loadPlan))
			}
		}

		const prePlayOpacityLines = takeJobs
			.flatMap((j) => [j.prePlayOpacityZeroLine, j.prePlayOpacityFullLine])
			.filter(Boolean)
		phaseALines.push(...prePlayOpacityLines)

		const flatMixer = [...takeJobs.flatMap((j) => j.mixerLines), ...mergeMixerExtras]
		phaseALines.push(...flatMixer)

		let pipRemoveLines = []
		try {
			pipRemoveLines = buildPipOverlayRemoveLinesForTakeJobSet(channel, takeJobs, currentSceneLayers)
		} catch (_) {}
		phaseALines.push(...pipRemoveLines)

		const pipAddLines = []
		for (const job of takeJobs) {
			if (job.pipOverlays.length > 0) {
				try {
					// WO-158 T158.5: overlay placement hugs the visible (cropped) content;
					// the video layer's MIXER FILL stays uncropped (Caspar applies CROP itself).
					const lines = buildPipOverlayAmcpLinesAll(
						job.pipOverlays,
						channel,
						job.pLayer,
						cropAdjustedFillForLayer(job.f, job.layer),
						self,
						nextPipContentLayerInTake(takeJobs, job.pLayer),
						currentMap.get(job.layer.layerNumber) || null,
						job.layer?.rotation ?? 0,
					)
					if (lines.length > 0) pipAddLines.push(...lines)
				} catch (e) {
					self.log?.('warn', `PIP overlay layer ${job.pLayer}: ${e?.message || e}`)
				}
			}
		}
		phaseALines.push(...pipAddLines)

		if (phaseALines.length > 0) {
			await amcp.batchSendChunked(phaseALines, { skipMixerPreCommit: true, forceBatch: true })
		}
	} else {
		// Legacy sequential path (take_two_phase_batch: false, or no borderLines/takeJobs to fold) —
		// byte-identical to pre-WO-259 behavior.
		for (const job of takeJobs) {
			if (!job.isMerge) {
				await amcp.mixerClear(channel, job.pLayer).catch(() => {})
			}
			if (job.loadPlan) {
				logPlannedCommand(self, 'load', job.layer.layerNumber, job.loadPlan)
				await amcp.loadbg(job.loadPlan.channel, job.loadPlan.layer, job.loadPlan.clip, job.loadPlan.opts)
			}
		}

		const prePlayOpacityLines = takeJobs
			.flatMap((j) => [j.prePlayOpacityZeroLine, j.prePlayOpacityFullLine])
			.filter(Boolean)
		if (prePlayOpacityLines.length > 0) {
			await amcp.batchSendChunked(prePlayOpacityLines, { skipMixerPreCommit: true })
		}
		const flatMixer = [...takeJobs.flatMap((j) => j.mixerLines), ...mergeMixerExtras]
		if (flatMixer.length > 0) {
			await amcp.batchSendChunked(flatMixer, { skipMixerPreCommit: true })
		}

		let pipRemoveLines = []
		try {
			pipRemoveLines = buildPipOverlayRemoveLinesForTakeJobSet(channel, takeJobs, currentSceneLayers)
		} catch (_) {}
		if (pipRemoveLines.length > 0) {
			try {
				await sendPipOverlayLinesSerial(amcp, pipRemoveLines)
			} catch (_) {}
		}

		const pipAddLines = []
		for (const job of takeJobs) {
			if (job.pipOverlays.length > 0) {
				try {
					// WO-158 T158.5: overlay placement hugs the visible (cropped) content;
					// the video layer's MIXER FILL stays uncropped (Caspar applies CROP itself).
					const lines = buildPipOverlayAmcpLinesAll(
						job.pipOverlays,
						channel,
						job.pLayer,
						cropAdjustedFillForLayer(job.f, job.layer),
						self,
						nextPipContentLayerInTake(takeJobs, job.pLayer),
						currentMap.get(job.layer.layerNumber) || null,
						job.layer?.rotation ?? 0,
					)
					if (lines.length > 0) pipAddLines.push(...lines)
				} catch (e) {
					self.log?.('warn', `PIP overlay layer ${job.pLayer}: ${e?.message || e}`)
				}
			}
		}
		if (pipAddLines.length > 0) {
			try {
				await sendPipOverlayLinesSerial(amcp, pipAddLines)
			} catch (_) {}
		}
	}
}

module.exports = { sendTakeJobsLoadAndMixerBatch }

/**
 * Global border lines + LOADBG / MIXER / PLAY / PIP / crossfade / clip-end watcher for one PGM take.
 */

'use strict'

const playbackTracker = require('../state/playback-tracker')
const { param } = require('../caspar/amcp-utils')
const {
	buildPipOverlayAmcpLinesAll,
	buildPipOverlayRemoveLinesForTakeJobSet,
	nextPipContentLayerInTake,
	sendPipOverlayLinesSerial,
	buildGlobalBorderAmcpLines,
	buildGlobalBorderUpdateLines,
	buildGlobalBorderOpacityFadeLine,
} = require('./pip-overlay')
const { sendAmcpLinesSequential } = require('../caspar/amcp-batch')
const { serializeClipCommandPlan } = require('../caspar/amcp-command-plan')
const { logPlannedCommand } = require('./scene-take-lbg-merge')

/**
 * @param {object} amcp
 * @param {{ start: number|null }} fadeClockRef — mutated when a timed crossfade / merge play starts
 * @param {object} ctx
 */
async function runSceneTakeLbgAmcpPipeline(amcp, fadeClockRef, ctx) {
	const {
		self,
		channel,
		incomingGb,
		incomingGbEnabled,
		sameGbTemplateType,
		incomingGbLayer,
		gbWillFadeIn,
		takeJobs,
		mergeMixerExtras,
		currentSceneLayers,
		currentMap,
		shouldRunBankCrossfade,
		isMergeTransition,
		fadeDur,
		fadeTw,
		phys,
		activeBank,
		exitMedia,
		gbWillFadeOut,
		currentGbLayer,
		framerate,
		fadeWatcher,
		notifyProgramTransitionStarted,
	} = ctx

	// Global border (layer 998) lifecycle — must ride the same channel COMMIT/crossfade
	// as the bank swap so it doesn't pop on/off when looks transition. See WO-09.
	if (incomingGbEnabled) {
		try {
			let borderLines = []
			if (sameGbTemplateType) {
				// Same template → CG UPDATE so params (color/width/etc.) change without re-adding the CG instance.
				borderLines = buildGlobalBorderUpdateLines(channel, incomingGbLayer, incomingGb)
			} else {
				// Fresh add (or template type changed): load hidden when crossfading, full-opacity when cutting.
				borderLines = buildGlobalBorderAmcpLines(channel, incomingGbLayer, incomingGb, self, {
					initialOpacity: gbWillFadeIn ? 0 : 1,
				})
			}
			if (borderLines.length > 0) {
				if (typeof self.log === 'function') self.log('info', `[scene-take-lbg] Sending border lines: ${JSON.stringify(borderLines)}`)
				await sendPipOverlayLinesSerial(amcp, borderLines)
			}
		} catch (e) {
			self.log?.('warn', `Global border failed: ${e?.message || e}`)
		}
	}

	if (takeJobs.length > 0 || mergeMixerExtras.length > 0) {
		for (const job of takeJobs) {
			if (!job.isMerge) {
				await amcp.mixerClear(channel, job.pLayer).catch(() => {})
			}
			if (job.loadPlan) {
				logPlannedCommand(self, 'load', job.layer.layerNumber, job.loadPlan)
				await amcp.loadbg(job.loadPlan.channel, job.loadPlan.layer, job.loadPlan.clip, job.loadPlan.opts)
			}
		}

		const flatMixer = [...takeJobs.flatMap((j) => j.mixerLines), ...mergeMixerExtras]
		if (flatMixer.length > 0) {
			await amcp.batchSendChunked(flatMixer, { skipMixerPreCommit: true })
		}
		const prePlayOpacityLines = takeJobs.map((j) => j.prePlayOpacityZeroLine).filter(Boolean)
		if (prePlayOpacityLines.length > 0) {
			await amcp.batchSendChunked(prePlayOpacityLines, { skipMixerPreCommit: true })
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
					const lines = buildPipOverlayAmcpLinesAll(
						job.pipOverlays,
						channel,
						job.pLayer,
						job.f,
						self,
						nextPipContentLayerInTake(takeJobs, job.pLayer),
						currentMap.get(job.layer.layerNumber) || null
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


		let crossfadeLines = []
		if (shouldRunBankCrossfade) {
			const handledOut = new Set()
			for (const job of takeJobs) {
				const pOut = phys(Number(job.layer.layerNumber), activeBank)
				const pIn = job.pLayer
				handledOut.add(pOut)
				if (pIn === pOut) {
					// Defensive: incoming should be prepared on the inactive bank, but
					// never fade a layer against itself if state is corrupt.
					continue
				}
				// Deterministic dissolve: always ramp incoming up and paired outgoing down.
				if (!job.useLoadAuto && !job.hasLoadTransition) {
					const clIn = `${channel}-${pIn}`
					let pInTail = `${job.targetOpacity} ${fadeDur}`
					if (fadeTw) pInTail += ` ${param(fadeTw)}`
					crossfadeLines.push(`MIXER ${clIn} OPACITY ${pInTail}`)
				}

				const clOut = `${channel}-${pOut}`
				let pOutTail = `0 ${fadeDur}`
				if (fadeTw) pOutTail += ` ${param(fadeTw)}`
				crossfadeLines.push(`MIXER ${clOut} OPACITY ${pOutTail}`)
			}
			for (const layer of exitMedia) {
				const pOut = phys(Number(layer.layerNumber), activeBank)
				if (handledOut.has(pOut)) continue
				const clOut = `${channel}-${pOut}`
				let p = `0 ${fadeDur}`
				if (fadeTw) p += ` ${param(fadeTw)}`
				crossfadeLines.push(`MIXER ${clOut} OPACITY ${p}`)
			}
			// Tween the global border in sync with the bank crossfade so it never cuts in/out.
			if (gbWillFadeIn) {
				crossfadeLines.push(
					buildGlobalBorderOpacityFadeLine(channel, incomingGbLayer, 1, fadeDur, fadeTw ? param(fadeTw) : undefined)
				)
			} else if (gbWillFadeOut) {
				crossfadeLines.push(
					buildGlobalBorderOpacityFadeLine(channel, currentGbLayer, 0, fadeDur, fadeTw ? param(fadeTw) : undefined)
				)
			}
		}
		const needsIncomingFadePreroll =
			(shouldRunBankCrossfade && takeJobs.some((j) => j.incomingStartsHidden)) ||
			(isMergeTransition && takeJobs.some((j) => j.hasLoadTransition))
		const prebufferMs = needsIncomingFadePreroll ? 180 : 80
		await new Promise((r) => setTimeout(r, prebufferMs))

		const commitLine = `MIXER ${channel} COMMIT`

		let playLinesForCrossfade = []
		if (crossfadeLines.length > 0) {
			for (const job of takeJobs) {
				if (!job.playPlan) continue
				logPlannedCommand(self, 'play', job.layer.layerNumber, job.playPlan)
				playLinesForCrossfade.push(`PLAY ${job.playPlan.channel}-${job.playPlan.layer}`)
				if (job.incomingStartsHidden) {
					playLinesForCrossfade.push(`MIXER ${job.playPlan.channel}-${job.playPlan.layer} OPACITY 0 0`)
				}
			}
		}

		try {
			if (crossfadeLines.length > 0) {
				await sendAmcpLinesSequential(
					[commitLine, ...playLinesForCrossfade, ...crossfadeLines, commitLine],
					amcp,
				)
				fadeClockRef.start = Date.now()
				notifyProgramTransitionStarted()
			} else if (isMergeTransition && takeJobs.some((j) => j.playPlan)) {
				const mergePlayLines = []
				for (const job of takeJobs) {
					if (!job.playPlan) continue
					logPlannedCommand(self, 'play', job.layer.layerNumber, job.playPlan)
					mergePlayLines.push(`PLAY ${job.playPlan.channel}-${job.playPlan.layer}`)
				}
				if (mergePlayLines.length > 0) {
					await sendAmcpLinesSequential([commitLine, ...mergePlayLines], amcp)
					fadeClockRef.start = Date.now()
					notifyProgramTransitionStarted()
				} else {
					await amcp.mixerCommit(channel)
				}
			} else {
				const simplePlays = []
				for (const job of takeJobs) {
					if (!job.playPlan) continue
					logPlannedCommand(self, 'play', job.layer.layerNumber, job.playPlan)
					simplePlays.push(serializeClipCommandPlan(job.playPlan))
				}
				if (simplePlays.length > 0) {
					await sendAmcpLinesSequential([commitLine, ...simplePlays], amcp)
				} else {
					await amcp.mixerCommit(channel)
				}
			}
		} catch (_) {}

		try {
			for (const job of takeJobs) {
				if (!job.browserCgUrl) continue
				const cl = `${channel}-${job.pLayer}`
				const json = JSON.stringify({ url: job.browserCgUrl })
				const lines = [
					`CG ${cl} CLEAR`,
					`CG ${cl} ADD 0 highascg_browser_url 1 ${param(json)}`,
					`CG ${cl} PLAY 0`,
					`CG ${cl} UPDATE 0 ${param(json)}`,
				]
				await sendPipOverlayLinesSerial(amcp, lines)
			}
			if (takeJobs.some((j) => j.browserCgUrl)) {
				await amcp.mixerCommit(channel).catch(() => {})
			}
		} catch (e) {
			self.log?.('warn', `[scene-take-lbg] browser CG: ${e?.message || e}`)
		}

		if (isMergeTransition && mergeMixerExtras.length > 0 && takeJobs.length === 0) {
			fadeClockRef.start = Date.now()
			notifyProgramTransitionStarted()
		} else if (shouldRunBankCrossfade && crossfadeLines.length === 0) {
			fadeClockRef.start = Date.now()
			notifyProgramTransitionStarted()
		}

		for (const job of takeJobs) {
			try {
				playbackTracker.recordPlay(self, channel, job.pLayer, job.clip, { loop: !!job.layer.loop })
			} catch (_) {}

			const foe = job.layer.fadeOnEnd
			if (fadeWatcher && foe?.enabled && !job.layer.loop) {
				const fadeFr = foe.frames || 12
				let durationMs = playbackTracker.resolveClipDurationMs(self, job.clip)
				if (!durationMs || durationMs <= 0) {
					durationMs = await playbackTracker.resolveClipDurationMsWithDiskProbe(self, job.clip)
				}
				if (durationMs && durationMs > 0) {
					fadeWatcher.schedule(channel, job.pLayer, durationMs, fadeFr, framerate)
				} else {
					const oscDelay = playbackTracker.getOscClipEndFadeDelayMs(
						self,
						channel,
						job.pLayer,
						job.clip,
						fadeFr,
						framerate,
					)
					if (oscDelay != null && Number.isFinite(oscDelay)) {
						fadeWatcher.scheduleMidPlayback(channel, job.pLayer, oscDelay, fadeFr, framerate)
					} else {
						fadeWatcher.scheduleWithOscFallback(
							self,
							channel,
							job.pLayer,
							job.clip,
							fadeFr,
							framerate,
							() =>
								playbackTracker.getOscClipEndFadeDelayMs(
									self,
									channel,
									job.pLayer,
									job.clip,
									fadeFr,
									framerate,
								),
						)
					}
				}
			}
		}
	}

}

module.exports = { runSceneTakeLbgAmcpPipeline }

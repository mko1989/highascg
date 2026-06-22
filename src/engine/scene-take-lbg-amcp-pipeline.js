/**
 * Global border lines + LOADBG / MIXER / PLAY / PIP / crossfade / clip-end watcher for one PGM take.
 */

'use strict'

const playbackTracker = require('../state/playback-tracker')
const { isSceneTemplateLayer } = require('./scene-template-cg')
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
const { buildSceneTemplateCgAmcpLines } = require('./scene-template-cg')
const { logPlannedCommand } = require('./scene-take-lbg-merge')
const { clearStaleInactiveBankLookLayers } = require('./scene-exit-layers')
const { partitionTakeJobsPlayOrder } = require('./scene-route-deps')

const ROUTE_SOURCE_PLAY_DELAY_MS = 80

/**
 * @param {object[]} jobs
 * @param {*} self
 * @param {'load'|'play'} kind
 */
function serializeTakeJobPlans(jobs, self, kind) {
	const lines = []
	for (const job of jobs) {
		const plan = kind === 'load' ? job.loadPlan : job.playPlan
		if (!plan) continue
		logPlannedCommand(self, kind, job.layer.layerNumber, plan)
		if (kind === 'play') {
			lines.push(serializeClipCommandPlan(plan))
		}
	}
	return lines
}

/**
 * PLAY source layers before same-channel intra-look routes so route:// targets are on-air.
 * @param {object} amcp
 * @param {number} channel
 * @param {object[]} takeJobs
 * @param {*} self
 * @param {{ trailingCommit?: boolean }} [opts]
 */
async function sendPhasedTakePlays(amcp, channel, takeJobs, self, opts = {}) {
	const commitLine = `MIXER ${channel} COMMIT`
	const { sources, routes } = partitionTakeJobsPlayOrder(takeJobs, channel)
	const sourceLines = serializeTakeJobPlans(sources, self, 'play')
	const routeLines = serializeTakeJobPlans(routes, self, 'play')
	const tail = opts.trailingCommit !== false ? [commitLine] : []

	if (sourceLines.length && routeLines.length) {
		await sendAmcpLinesSequential([commitLine, ...sourceLines, commitLine], amcp)
		await new Promise((r) => setTimeout(r, ROUTE_SOURCE_PLAY_DELAY_MS))
		await sendAmcpLinesSequential([...routeLines, ...tail], amcp)
		return
	}
	const all = [...sourceLines, ...routeLines]
	if (all.length > 0) {
		await sendAmcpLinesSequential([commitLine, ...all, ...tail], amcp)
	} else {
		await amcp.mixerCommit(channel)
	}
}

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
		inactiveBank,
		exitMedia,
		gbWillFadeOut,
		currentGbLayer,
		framerate,
		fadeWatcher,
		notifyProgramTransitionStarted,
		incoming,
	} = ctx

	// Stale layers on the off-air bank are cleared immediately so they cannot resurface on the next swap.
	if (!isMergeTransition && incoming) {
		try {
			await clearStaleInactiveBankLookLayers(amcp, channel, inactiveBank, incoming, self)
		} catch (_) {}
	}

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
				// Only the top layer tweens during crossfade — bottom stays at full opacity (no 50% dip).
				if (!job.useLoadAuto && (shouldRunBankCrossfade || !job.hasLoadTransition)) {
					if (job.incomingIsAboveOutgoing) {
						const clIn = `${channel}-${pIn}`
						let pInTail = `${job.targetOpacity} ${fadeDur}`
						if (fadeTw) pInTail += ` ${param(fadeTw)}`
						crossfadeLines.push(`MIXER ${clIn} OPACITY ${pInTail}`)
					} else {
						const clOut = `${channel}-${pOut}`
						let pOutTail = `0 ${fadeDur}`
						if (fadeTw) pOutTail += ` ${param(fadeTw)}`
						crossfadeLines.push(`MIXER ${clOut} OPACITY ${pOutTail}`)
					}
				}
			}
			// Orphan exit layers on the active bank: cleared in teardown after fadeMs, not faded here.
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
			(isMergeTransition && fadeDur > 0 && takeJobs.some((j) => j.isMerge && j.loadPlan))
		const prebufferMs = needsIncomingFadePreroll ? 180 : 80
		await new Promise((r) => setTimeout(r, prebufferMs))

		const commitLine = `MIXER ${channel} COMMIT`

		const buildCrossfadePlayLines = (jobs) => {
			const lines = []
			for (const job of jobs) {
				if (!job.playPlan) continue
				logPlannedCommand(self, 'play', job.layer.layerNumber, job.playPlan)
				lines.push(`PLAY ${job.playPlan.channel}-${job.playPlan.layer}`)
				if (job.incomingStartsHidden) {
					lines.push(`MIXER ${job.playPlan.channel}-${job.playPlan.layer} OPACITY 0 0`)
				}
			}
			return lines
		}

		try {
			if (crossfadeLines.length > 0) {
				const { sources, routes } = partitionTakeJobsPlayOrder(takeJobs, channel)
				const srcPlays = buildCrossfadePlayLines(sources)
				const routePlays = buildCrossfadePlayLines(routes)
				if (srcPlays.length && routePlays.length) {
					await sendAmcpLinesSequential(
						[commitLine, ...srcPlays, ...crossfadeLines, commitLine],
						amcp,
					)
					await new Promise((r) => setTimeout(r, ROUTE_SOURCE_PLAY_DELAY_MS))
					await sendAmcpLinesSequential([...routePlays, commitLine], amcp)
				} else {
					await sendAmcpLinesSequential(
						[commitLine, ...srcPlays, ...routePlays, ...crossfadeLines, commitLine],
						amcp,
					)
				}
				fadeClockRef.start = Date.now()
				notifyProgramTransitionStarted()
			} else if (isMergeTransition && takeJobs.some((j) => j.playPlan)) {
				const { sources, routes } = partitionTakeJobsPlayOrder(takeJobs, channel)
				const animateSources = serializeTakeJobPlans(sources, self, 'play')
				const animateRoutes = serializeTakeJobPlans(routes, self, 'play')
				if (animateSources.length > 0 || animateRoutes.length > 0) {
					if (animateSources.length && animateRoutes.length) {
						await sendAmcpLinesSequential([commitLine, ...animateSources, commitLine], amcp)
						await new Promise((r) => setTimeout(r, ROUTE_SOURCE_PLAY_DELAY_MS))
						await sendAmcpLinesSequential([...animateRoutes, commitLine], amcp)
					} else {
						await sendAmcpLinesSequential([commitLine, ...animateSources, ...animateRoutes, commitLine], amcp)
					}
					fadeClockRef.start = Date.now()
					notifyProgramTransitionStarted()
				} else {
					await amcp.mixerCommit(channel)
				}
			} else {
				await sendPhasedTakePlays(amcp, channel, takeJobs, self)
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
			for (const job of takeJobs) {
				if (!job.templateCg) continue
				const lines = buildSceneTemplateCgAmcpLines(channel, job.pLayer, job.templateCg)
				if (lines.length > 0) {
					if (typeof self.log === 'function') {
						self.log(
							'info',
							`[scene-take-lbg] template CG layer ${job.layer.layerNumber} → ${job.templateCg.cgName}`,
						)
					}
					await sendPipOverlayLinesSerial(amcp, lines)
				}
			}
			if (takeJobs.some((j) => j.browserCgUrl || j.templateCg)) {
				await amcp.mixerCommit(channel).catch(() => {})
			}
		} catch (e) {
			self.log?.('warn', `[scene-take-lbg] browser/template CG: ${e?.message || e}`)
		}

		if (isMergeTransition && mergeMixerExtras.length > 0 && takeJobs.length === 0) {
			fadeClockRef.start = Date.now()
			notifyProgramTransitionStarted()
		} else if (shouldRunBankCrossfade && crossfadeLines.length === 0) {
			fadeClockRef.start = Date.now()
			notifyProgramTransitionStarted()
		}

		for (const job of takeJobs) {
			if (job.templateCg) continue
			try {
				playbackTracker.recordPlay(self, channel, job.pLayer, job.clip, { loop: !!job.layer.loop })
			} catch (_) {}

			const foe = job.layer.fadeOnEnd
			const clipIsTemplate = isSceneTemplateLayer(job.layer, job.clip, self)
			if (fadeWatcher && foe?.enabled && !job.layer.loop && !clipIsTemplate) {
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

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
const { buildSceneTemplateCgAmcpLines, buildClearTemplateCgOnOtherProgramChannelsLines } = require('./scene-template-cg')
const { serializeClipCommandPlan } = require('../caspar/amcp-command-plan')
const { logPlannedCommand } = require('./scene-take-lbg-merge')
const { clearStaleInactiveBankLookLayers } = require('./scene-exit-layers')
const { layerHasContent } = require('./scene-transition')
const {
	sendStaggeredTakePlays,
	isRouteClip,
	incomingCrossfadeOpacityLine,
	crossfadeSuffixLinesForStaggeredRoutes,
} = require('./scene-route-deps')

/**
 * PLAY source layers before same-channel intra-look routes so route:// targets are on-air.
 * @param {object} amcp
 * @param {number} channel
 * @param {object[]} takeJobs
 * @param {*} self
 * @param {{ trailingCommit?: boolean }} [opts]
 */
async function sendPhasedTakePlays(amcp, channel, takeJobs, self, opts = {}) {
	await sendStaggeredTakePlays(
		amcp,
		channel,
		takeJobs,
		(job) => {
			if (!job.playPlan) return []
			logPlannedCommand(self, 'play', job.layer.layerNumber, job.playPlan)
			return [serializeClipCommandPlan(job.playPlan)]
		},
		{
			leadingCommit: true,
			commitAfterSources: true,
			commitAfterRoutes: opts.trailingCommit !== false,
		},
	)
}

/**
 * @param {*} self
 * @param {object} job
 * @param {{ fadeDur: number, fadeTw?: string }} [fadeCtx]
 */
function playLinesForCrossfadeJob(self, job, fadeCtx) {
	if (!job.playPlan) return []
	logPlannedCommand(self, 'play', job.layer.layerNumber, job.playPlan)
	const cl = `${job.playPlan.channel}-${job.playPlan.layer}`
	const lines = [`PLAY ${cl}`]
	const routeLayer = isRouteClip(job.clip)
	if (job.incomingStartsHidden) {
		if (routeLayer && fadeCtx) {
			const fadeIn = incomingCrossfadeOpacityLine(
				job,
				job.playPlan.channel,
				fadeCtx.fadeDur,
				fadeCtx.fadeTw ? param(fadeCtx.fadeTw) : undefined,
			)
			if (fadeIn) lines.push(fadeIn)
		} else if (!routeLayer) {
			// Media sources: hold at 0 until suffix crossfade after source PLAY batch.
			lines.push(`MIXER ${cl} OPACITY 0 0`)
		}
	}
	return lines
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
		timelineFadeInPhys = [],
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


		let crossfadeLines = []
		if (shouldRunBankCrossfade) {
			const handledOut = new Set()
			const takeJobLogicalNums = new Set(
				takeJobs.map((j) => Number(j.layer.layerNumber)).filter(Number.isFinite),
			)
			for (const job of takeJobs) {
				const pOut = phys(Number(job.layer.layerNumber), activeBank)
				const pIn = job.pLayer
				handledOut.add(pOut)
				if (pIn === pOut) {
					// Defensive: incoming should be prepared on the inactive bank, but
					// never fade a layer against itself if state is corrupt.
					continue
				}
				const hasOutgoing = layerHasContent(currentMap.get(job.layer.layerNumber))
				// Only the top layer tweens during crossfade — bottom stays at full opacity (no 50% dip).
				if (!job.useLoadAuto && (shouldRunBankCrossfade || !job.hasLoadTransition)) {
					if (!hasOutgoing || job.incomingIsAboveOutgoing) {
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
			// Layers only in the leaving look: fade out on the active bank during the transition window.
			for (const layer of exitMedia || []) {
				const ln = Number(layer.layerNumber)
				if (!Number.isFinite(ln) || takeJobLogicalNums.has(ln)) continue
				const pOut = phys(ln, activeBank)
				if (handledOut.has(pOut)) continue
				handledOut.add(pOut)
				let pOutTail = `0 ${fadeDur}`
				if (fadeTw) pOutTail += ` ${param(fadeTw)}`
				crossfadeLines.push(`MIXER ${channel}-${pOut} OPACITY ${pOutTail}`)
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
			// Incoming timeline layers were preset to opacity 0 before PLAY (WO-152 B152.1) —
			// fade them in inside the same crossfade batch so they enter with the looks.
			for (const L of timelineFadeInPhys) {
				let tlTail = `1 ${fadeDur}`
				if (fadeTw) tlTail += ` ${param(fadeTw)}`
				crossfadeLines.push(`MIXER ${channel}-${L} OPACITY ${tlTail}`)
			}
		}
		const needsIncomingFadePreroll =
			(shouldRunBankCrossfade && takeJobs.some((j) => j.incomingStartsHidden)) ||
			(isMergeTransition && fadeDur > 0 && takeJobs.some((j) => j.isMerge && j.loadPlan))
		const prebufferMs = needsIncomingFadePreroll ? 180 : 80
		await new Promise((r) => setTimeout(r, prebufferMs))

		try {
			if (crossfadeLines.length > 0 && takeJobs.length === 0) {
				// Timeline-only / exit-only crossfade: sendStaggeredTakePlays drops suffix
				// lines when there are no source PLAY lines to ride on — send directly.
				await amcp.batchSendChunked(crossfadeLines, { skipMixerPreCommit: true })
				await amcp.mixerCommit(channel)
				fadeClockRef.start = Date.now()
				notifyProgramTransitionStarted()
			} else if (crossfadeLines.length > 0) {
				const crossfadeFadeCtx = { fadeDur, fadeTw }
				const suffixAfterSources = crossfadeSuffixLinesForStaggeredRoutes(crossfadeLines, takeJobs)
				await sendStaggeredTakePlays(
					amcp,
					channel,
					takeJobs,
					(job) => playLinesForCrossfadeJob(self, job, crossfadeFadeCtx),
					{
						leadingCommit: true,
						commitAfterSources: true,
						commitAfterRoutes: true,
						suffixAfterSources,
					},
				)
				fadeClockRef.start = Date.now()
				notifyProgramTransitionStarted()
			} else if (isMergeTransition && takeJobs.some((j) => j.playPlan)) {
				await sendStaggeredTakePlays(
					amcp,
					channel,
					takeJobs,
					(job) => {
						if (!job.playPlan) return []
						logPlannedCommand(self, 'play', job.layer.layerNumber, job.playPlan)
						return [serializeClipCommandPlan(job.playPlan)]
					},
					{
						leadingCommit: true,
						commitAfterSources: true,
						commitAfterRoutes: true,
					},
				)
				fadeClockRef.start = Date.now()
				notifyProgramTransitionStarted()
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
				const clearOther = buildClearTemplateCgOnOtherProgramChannelsLines(
					channel,
					job.layer.layerNumber,
					job.templateCg,
					self,
				)
				if (clearOther.length > 0) await sendPipOverlayLinesSerial(amcp, clearOther)
				const lines = buildSceneTemplateCgAmcpLines(channel, job.layer.layerNumber, job.templateCg)
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

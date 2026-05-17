/**
 * Standard program take: LOADBG … MIX … then PLAY per layer (Caspar FG/BG swap).
 * Replaces the former dual-bank mixer opacity crossfade (`scene-take.js`).
 *
 * Pipeline order (smooth look→look):
 * 1) Build takeJobs + exit list (no AMCP).
 * 2) Non-merge exit: batched MIXER OPACITY→0 (non-DEFER) when not using bank crossfade.
 * 3) `{TRANSITION} + Animate` (UI; legacy `+ MERGE`): **no bank B (+100)** — compare PGM vs incoming per logical layer;
 *    outgoing-only layers get `MIXER … OPACITY 0 <dur> <tween> DEFER`; incoming layers get LOADBG (with
 *    transition type + duration from default) + mixer prep (DEFER) on the **same** Caspar layer as the look;
 *    optional border fades ride `mergeMixerExtras`. Preroll, then `MIXER ch COMMIT` + `PLAY` lines in one sequential AMCP chain.
 * 4) Bank crossfade path (non-merge): paired opacity tweens on active vs inactive bank layers.
 * 5) Teardown after transition window; merge teardown clears both logical layer N and N+100 to drop legacy bank B.
 * LOADBG/PLAY stay `_send` (not inside BEGIN…COMMIT) so Caspar can resolve each layer reliably.
 */

'use strict'

const playbackTracker = require('../state/playback-tracker')
const { param, deferMixerAmcpLine, amcpVerboseTrace } = require('../caspar/amcp-utils')
const { diffCasparLayerPlan } = require('../caspar/amcp-layer-diff-plan')
const { describeClipCommandPlan } = require('../caspar/amcp-command-plan')
const { getResolvedFillForSceneLayer } = require('./scene-native-fill')
const { audioRouteToAudioFilter } = require('./audio-route')
const { mixerEffectNeutralLines } = require('./timeline-playback-helpers')
const {
	buildPipOverlayAmcpLinesAll,
	buildPipOverlayOpacityFadeDeferLines,
	buildPipOverlayRemoveLines,
	buildPipOverlayRemoveLinesForTakeJobSet,
	nextPipContentLayerInScene,
	nextPipContentLayerInTake,
	pipOverlaysFromLayer,
	sendPipOverlayLinesSerial,
	buildGlobalBorderAmcpLines,
	buildGlobalBorderUpdateLines,
	buildGlobalBorderOpacityFadeLine,
	buildGlobalBorderClearLines,
} = require('./pip-overlay')

function resolveGlobalBorderPhysicalLayer(gb) {
	return Number(gb?.activePgmLayer) === 996 ? 996 : 998
}

const { buildTakeJobs } = require('./scene-take-lbg-jobs')
const { PGM_BANK_B_OFFSET } = require('./scene-transition')
const { sendAmcpLinesSequential } = require('../caspar/amcp-batch')
const { serializeClipCommandPlan } = require('../caspar/amcp-command-plan')

/**
 * Merge transition: outgoing-only logical layers (still on PGM, not replaced by a takeJob on this beat)
 * fade to opacity 0 on the **same** Caspar layer index as the look (no bank B / +100).
 * @param {{ channel: number, exitMedia: object[], takeJobs: object[], fadeDur: number, fadeTw?: string, currentSceneLayers: object, fadeWatcher: object|null }} p
 * @returns {string[]}
 */
function buildMergeOutgoingOpacityDeferLines(p) {
	const { channel, exitMedia, takeJobs, fadeDur, fadeTw, currentSceneLayers, fadeWatcher } = p
	const lines = []
	const takeJobNums = new Set(takeJobs.map((j) => Number(j.layer.layerNumber)).filter(Number.isFinite))
	for (const layer of exitMedia) {
		const ln = Number(layer.layerNumber)
		if (!Number.isFinite(ln) || takeJobNums.has(ln)) continue
		if (fadeWatcher) {
			fadeWatcher.cancel(channel, ln)
			fadeWatcher.cancel(channel, ln + PGM_BANK_B_OFFSET)
		}
		const cl = `${channel}-${ln}`
		let tail = `0 ${fadeDur}`
		if (fadeTw) tail += ` ${param(fadeTw)}`
		lines.push(deferMixerAmcpLine(`MIXER ${cl} OPACITY ${tail}`))
		try {
			const nextL = nextPipContentLayerInScene(currentSceneLayers, layer.layerNumber)
			const pipN = pipOverlaysFromLayer(layer).length
			if (pipN > 0) {
				lines.push(...buildPipOverlayOpacityFadeDeferLines(channel, ln, tail, nextL, pipN))
			}
		} catch (_) {}
	}
	return lines
}

function logPlannedCommand(self, phase, sceneLayer, plan) {
	if (!amcpVerboseTrace() || typeof self?.log !== 'function' || !plan) return
	const d = describeClipCommandPlan(plan)
	self.log(
		'debug',
		`AMCP plan ${phase} sceneLayer=${sceneLayer} ch=${d.channel} layer=${d.layer} cmd=${d.commandName}` +
			(d.clip ? ` clip=${d.clip}` : '') +
			(d.transition ? ` transition=${d.transition} duration=${d.duration || 0} tween=${d.tween || 'linear'}` : '') +
			(d.seek != null ? ` seek=${d.seek}` : '') +
			(d.length != null ? ` length=${d.length}` : '')
	)
}

/**
 * @param {object} amcp
 * @param {{ self: object, channel: number, currentScene: object|null, incomingScene: object, framerate?: number, forceCut?: boolean, onProgramTransitionStarted?: Function }} opts
 */
async function runSceneTakeLbg(amcp, opts) {
	const {
		diffScenes,
		layerHasContent,
		normalizeTransition,
		physicalProgramLayer,
		normalizeProgramLayerBank,
		resolveChannelFramerateForMixerTween,
		persistProgramLayerBanks,
		isLayerAnimateTakeTransition,
	} = require('./scene-transition')

	const self = opts.self
	const channel = parseInt(opts.channel, 10)
	if (!channel || channel < 1) throw new Error('channel required')
	const incoming = opts.incomingScene
	if (!incoming || !Array.isArray(incoming.layers)) throw new Error('incomingScene.layers required')
	const layersWithContent = incoming.layers.filter(layerHasContent)
	if (layersWithContent.length === 0) {
		throw new Error('incomingScene has no layers with sources — cannot take an empty look')
	}

	const forceCut = !!opts.forceCut
	const globalT = normalizeTransition(incoming.defaultTransition, forceCut)
	const diff = diffScenes(opts.currentScene || null, incoming)

	const currentMap = new Map()
	for (const l of opts.currentScene?.layers || []) {
		if (layerHasContent(l)) currentMap.set(l.layerNumber, l)
	}

	const chKey = String(channel)
	if (!self.programLayerBankByChannel) self.programLayerBankByChannel = {}
	const activeBank = normalizeProgramLayerBank(self.programLayerBankByChannel[chKey])
	const inactiveBank = activeBank === 'a' ? 'b' : 'a'
	const phys = (sceneLn, bank) => physicalProgramLayer(sceneLn, bank)

	const fadeWatcher = self.clipEndFadeWatcher || null
	if (fadeWatcher) fadeWatcher.cancelChannel(channel)

	const framerate = resolveChannelFramerateForMixerTween(self, channel, opts.framerate)
	const incomingSorted = [...layersWithContent].sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))

	const exitCandidates = [...(diff.exit || [])]
	for (const updatedIncoming of diff.update || []) {
		const prev = currentMap.get(updatedIncoming.layerNumber)
		if (layerHasContent(prev)) exitCandidates.push(prev)
	}

	if (self.timelineEngine) {
		const pbNow = self.timelineEngine.getPlayback()
		if (pbNow?.timelineId) {
			const exitingTimeline = diff.exit.find((l) => layerHasContent(l) && l.source?.type === 'timeline' && l.source.value === pbNow.timelineId)
			if (exitingTimeline) {
				self.timelineEngine.stop(pbNow.timelineId)
			}
		}
	}

	const fadeDur = forceCut || globalT.duration <= 0 ? 0 : globalT.duration
	const fadeTw = globalT.tween
	const fadeMs = fadeDur > 0 ? (fadeDur / framerate) * 1000 : 0
	const isMergeTransition = isLayerAnimateTakeTransition(globalT.type)
	const shouldRunBankCrossfade = fadeDur > 0 && currentMap.size > 0 && !isMergeTransition
	let fadeClockStart = null
	let transitionStartedNotified = false
	function notifyProgramTransitionStarted() {
		if (transitionStartedNotified) return
		transitionStartedNotified = true
		if (typeof opts.onProgramTransitionStarted !== 'function') return
		try {
			const r = opts.onProgramTransitionStarted()
			if (r && typeof r.catch === 'function') {
				r.catch((e) => self.log?.('warn', `[scene-take-lbg] transition-start callback failed: ${e?.message || e}`))
			}
		} catch (e) {
			self.log?.('warn', `[scene-take-lbg] transition-start callback failed: ${e?.message || e}`)
		}
	}

	self.log?.(
		'info',
		`[scene-take-lbg] merge=${isMergeTransition} shouldRunBankCrossfade=${shouldRunBankCrossfade} fadeDur=${fadeDur} currentMapSize=${currentMap.size}`,
	)

	const { takeJobs, extraExitCandidates } = await buildTakeJobs({
		incomingSorted,
		currentMap,
		channel,
		incoming,
		self,
		phys,
		inactiveBank,
		shouldRunBankCrossfade,
		forceCut,
		globalT,
		framerate,
	})

	if (extraExitCandidates && extraExitCandidates.length > 0) {
		exitCandidates.push(...extraExitCandidates)
	}

	const seenExitLayerNums = new Set()
	const exitMedia = exitCandidates.filter((l) => {
		if (!layerHasContent(l) || String(l.source?.type || '') === 'timeline') return false
		const ln = Number(l.layerNumber)
		if (!Number.isFinite(ln)) return true
		if (seenExitLayerNums.has(ln)) return false
		seenExitLayerNums.add(ln)
		return true
	})

	const currentSceneLayers = opts.currentScene?.layers

	if (exitMedia.length > 0 && fadeDur > 0 && !shouldRunBankCrossfade && !isMergeTransition) {
		const fadeLines = []
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
		fadeClockStart = Date.now()
		notifyProgramTransitionStarted()
	} else if (exitMedia.length > 0) {
		for (const layer of exitMedia) {
			const ln = Number(layer.layerNumber)
			if (isMergeTransition && Number.isFinite(ln)) {
				if (fadeWatcher) {
					fadeWatcher.cancel(channel, ln)
					fadeWatcher.cancel(channel, ln + PGM_BANK_B_OFFSET)
				}
			} else {
				const pOut = phys(Number(layer.layerNumber), activeBank)
				if (fadeWatcher) fadeWatcher.cancel(channel, pOut)
			}
		}
	}

	// Global border (layer 998) lifecycle is computed before takeJobs so the teardown
	// block can also act when only the border changes (no media swap). See WO-09.
	const currentGb = opts.currentScene?.globalBorder
	const incomingGb = incoming.globalBorder
	const currentGbEnabled = !!(currentGb && currentGb.enabled)
	const incomingGbEnabled = !!(incomingGb && incomingGb.enabled)
	const sameGbTemplateType =
		currentGbEnabled &&
		incomingGbEnabled &&
		String(currentGb.type || '').toLowerCase() === String(incomingGb.type || '').toLowerCase()
	const gbCanFadeWithCrossfade = shouldRunBankCrossfade && fadeDur > 0 && !forceCut
	const gbFadeLinked = fadeDur > 0 && !forceCut && (shouldRunBankCrossfade || isMergeTransition)
	const gbWillFadeIn = incomingGbEnabled && !sameGbTemplateType && gbFadeLinked
	const gbWillFadeOut = currentGbEnabled && !incomingGbEnabled && gbFadeLinked

	const incomingGbLayer = resolveGlobalBorderPhysicalLayer(incomingGb)
	const currentGbLayer = resolveGlobalBorderPhysicalLayer(currentGb)

	const mergeMixerExtras =
		isMergeTransition && fadeDur > 0 && !forceCut
			? [
					...buildMergeOutgoingOpacityDeferLines({
						channel,
						exitMedia,
						takeJobs,
						fadeDur,
						fadeTw,
						currentSceneLayers,
						fadeWatcher,
					}),
					...(gbWillFadeIn
						? [
								deferMixerAmcpLine(
									buildGlobalBorderOpacityFadeLine(
										channel,
										incomingGbLayer,
										1,
										fadeDur,
										fadeTw ? param(fadeTw) : undefined,
									),
								),
						  ]
						: []),
					...(gbWillFadeOut
						? [
								deferMixerAmcpLine(
									buildGlobalBorderOpacityFadeLine(
										channel,
										currentGbLayer,
										0,
										fadeDur,
										fadeTw ? param(fadeTw) : undefined,
									),
								),
						  ]
						: []),
			  ]
			: []

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
				fadeClockStart = Date.now()
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
					fadeClockStart = Date.now()
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
			fadeClockStart = Date.now()
			notifyProgramTransitionStarted()
		} else if (shouldRunBankCrossfade && crossfadeLines.length === 0) {
			fadeClockStart = Date.now()
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

	// Border-only teardown path: when the new look removes the border and there's no exit
	// media to anchor the wait, still respect the crossfade clock before clearing the CG.
	const needsBorderOnlyTeardown = currentGbEnabled && !incomingGbEnabled && exitMedia.length === 0
	if (exitMedia.length > 0 || needsBorderOnlyTeardown) {
		let teardownWait = 0
		if (fadeClockStart != null && fadeDur > 0) {
			teardownWait = Math.max(0, fadeMs - (Date.now() - fadeClockStart))
		}
		if (teardownWait > 0) {
			await new Promise((r) => setTimeout(r, Math.ceil(teardownWait) + 5))
		}

		/** Logical layers receiving a take job on this beat still use Caspar layer N for the new clip — do not STOP/CLEAR N after MIX. */
		const takeJobLogicalNums = new Set(takeJobs.map((j) => Number(j.layer.layerNumber)).filter(Number.isFinite))

		const teardownLines = []
		for (const layer of exitMedia) {
			const ln = Number(layer.layerNumber)
			if (isMergeTransition && Number.isFinite(ln)) {
				if (takeJobLogicalNums.has(ln)) {
					// Same-layer swap: old media is gone after PLAY+MIX; clearing N would kill the new foreground.
					const ghost = ln + PGM_BANK_B_OFFSET
					const clg = `${channel}-${ghost}`
					teardownLines.push(`STOP ${clg}`, `MIXER ${clg} CLEAR`)
					try {
						playbackTracker.recordStop(self, channel, ghost)
					} catch (_) {}
					continue
				}
				for (const phys of [ln, ln + PGM_BANK_B_OFFSET]) {
					const cl = `${channel}-${phys}`
					teardownLines.push(`STOP ${cl}`, `MIXER ${cl} CLEAR`)
					try {
						const nextL = nextPipContentLayerInScene(currentSceneLayers, layer.layerNumber)
						const pipN = pipOverlaysFromLayer(layer).length
						if (pipN > 0 && phys === ln) {
							teardownLines.push(...buildPipOverlayRemoveLines(channel, phys, nextL, pipN))
						}
					} catch (_) {}
					try {
						playbackTracker.recordStop(self, channel, phys)
					} catch (_) {}
				}
			} else {
				const pOut = phys(Number(layer.layerNumber), activeBank)
				const cl = `${channel}-${pOut}`
				teardownLines.push(`STOP ${cl}`, `MIXER ${cl} CLEAR`)
				try {
					const nextL = nextPipContentLayerInScene(currentSceneLayers, layer.layerNumber)
					const pipN = pipOverlaysFromLayer(layer).length
					if (pipN > 0) {
						teardownLines.push(...buildPipOverlayRemoveLines(channel, pOut, nextL, pipN))
					}
				} catch (_) {}
				try {
					playbackTracker.recordStop(self, channel, pOut)
				} catch (_) {}
			}
		}

		// Border was on the previous look but not the new one — opacity tween (if any) is done,
		// so the CG and mixer slot are safe to free now.
		if (currentGbEnabled && !incomingGbEnabled) {
			teardownLines.push(...buildGlobalBorderClearLines(channel, 998))
			teardownLines.push(...buildGlobalBorderClearLines(channel, 996))
		}

		if (teardownLines.length > 0) {
			try {
				await sendPipOverlayLinesSerial(amcp, teardownLines)
			} catch (_) {}
		}
		try {
			await amcp.mixerCommit(channel)
		} catch (_) {}
	}

	if (takeJobs.length > 0 || mergeMixerExtras.length > 0) {
		self.programLayerBankByChannel[chKey] = isMergeTransition ? 'a' : inactiveBank
	}
	persistProgramLayerBanks(self)

	// Setup playlist automation for list-mode layers in this look
	if (takeJobs.length > 0) {
		setupLayerPlaylists(self, channel, incoming, takeJobs)
	}

	return {
		ok: true,
		takeMode: 'lbg',
		diff: {
			update: diff.update.length,
			enter: diff.enter.length,
			exit: diff.exit.length,
			unchanged: diff.unchanged.length,
		},
	}
}

function setupLayerPlaylists(self, channel, incoming, takeJobs) {
	// Register the global OSC playlist handler on self.oscState exactly once!
	if (self.oscState && !self._playlistOscBound) {
		self._playlistOscBound = true
		self.oscState.on('change', (snapshot) => {
			handlePlaylistOscUpdate(self, snapshot)
		})
	}

	for (const job of takeJobs) {
		const layer = job.layer
		if (layer.sourceMode === 'list' && Array.isArray(layer.playlist) && layer.playlist.length > 0) {
			const pKey = `${incoming.id}-${layer.layerNumber}`
			
			// Initialize the active index to 0 for auto advance
			self.playlistActiveIndices = self.playlistActiveIndices || {}
			
			if (layer.playlistAdvance === 'auto') {
				self.playlistActiveIndices[pKey] = 0
				
				// Clear any previous image timer for this layer
				clearPlaylistImageTimer(self, pKey)
				
				if (layer.playlist.length > 1) {
					const firstItem = layer.playlist[0]
					const isImg = firstItem.type === 'image' || /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(firstItem.value)
					
					if (isImg) {
						schedulePlaylistImageTimer(self, channel, job.pLayer, incoming, layer, 0)
					} else {
						// Video: preload the second item as LOADBG AUTO
						queueNextPlaylistItem(self, channel, job.pLayer, layer, 1)
					}
				}
			}
		}
	}
}

function handlePlaylistOscUpdate(self, snapshot) {
	try {
		const liveSceneState = require('../state/live-scene-state')
		const activeScenes = liveSceneState.getAll()

		for (const chKey in activeScenes) {
			const channel = parseInt(chKey, 10)
			const liveEntry = activeScenes[chKey]
			if (!liveEntry || !liveEntry.scene) continue
			const scene = liveEntry.scene
			const activeBank = require('./scene-transition').normalizeProgramLayerBank(self.programLayerBankByChannel?.[chKey])

			if (Array.isArray(scene.layers)) {
				for (const layer of scene.layers) {
					if (layer.sourceMode === 'list' && Array.isArray(layer.playlist) && layer.playlist.length > 0 && layer.playlistAdvance === 'auto') {
						// Find physical layer index
						const pLayer = require('./scene-transition').phys(Number(layer.layerNumber), activeBank)

						// Check current file in OSC snapshot
						const chOsc = snapshot.channels && snapshot.channels[chKey]
						const layerOsc = chOsc && chOsc.layers && chOsc.layers[pLayer]
						const playingFile = layerOsc && layerOsc.file && layerOsc.file.name

						if (playingFile) {
							const itemIdx = layer.playlist.findIndex(item => sameFileName(item.value, playingFile))
							if (itemIdx >= 0) {
								const pKey = `${scene.id}-${layer.layerNumber}`
								self.playlistActiveIndices = self.playlistActiveIndices || {}
								const lastIdx = self.playlistActiveIndices[pKey] ?? 0

								if (itemIdx !== lastIdx) {
									// Advanced to the next item!
									self.playlistActiveIndices[pKey] = itemIdx
									if (typeof self.log === 'function') {
										self.log('info', `[Playlist] Layer ${layer.layerNumber} advanced to item ${itemIdx}: ${playingFile}`)
									}

									// Clear current image timers
									clearPlaylistImageTimer(self, pKey)

									const currentItem = layer.playlist[itemIdx]
									const isImg = currentItem.type === 'image' || /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(currentItem.value)

									if (isImg) {
										schedulePlaylistImageTimer(self, channel, pLayer, scene, layer, itemIdx)
									} else {
										// Video: preload the next item (with loop wrapping)
										let nextIdx = itemIdx + 1
										if (layer.playlistLoop !== false) {
											nextIdx = nextIdx % layer.playlist.length
										} else if (nextIdx >= layer.playlist.length) {
											nextIdx = -1
										}

										if (nextIdx >= 0) {
											queueNextPlaylistItem(self, channel, pLayer, layer, nextIdx)
										}
									}
								}
							}
						}
					}
				}
			}
		}
	} catch (e) {
		self.log?.('warn', `[Playlist OSC] Error: ${e?.message || e}`)
	}
}

function queueNextPlaylistItem(self, channel, pLayer, layer, nextIdx) {
	const nextItem = layer.playlist[nextIdx]
	const transition = layer.playlistTransition || { type: 'MIX', duration: 12 }
	const loadOpts = {
		auto: true,
		loop: false
	}
	if (transition.type && String(transition.type).toUpperCase() !== 'CUT') {
		loadOpts.transition = transition.type
		loadOpts.duration = transition.duration
	}
	if (typeof self.log === 'function') {
		self.log('info', `[Playlist] Preloading next item ${nextIdx} (${nextItem.value}) on ${channel}-${pLayer} with AUTO`)
	}
	self.amcp.loadbg(channel, pLayer, nextItem.value, loadOpts).catch((err) => {
		if (typeof self.log === 'function') {
			self.log('warn', `[Playlist] Preload failed on ${channel}-${pLayer}: ${err?.message || err}`)
		}
	})
}

function schedulePlaylistImageTimer(self, channel, pLayer, scene, layer, itemIdx) {
	const pKey = `${scene.id}-${layer.layerNumber}`
	clearPlaylistImageTimer(self, pKey)

	const item = layer.playlist[itemIdx]
	const durationMs = (item.duration ?? 5) * 1000

	if (typeof self.log === 'function') {
		self.log('info', `[Playlist] Scheduling image timer for item ${itemIdx} (${item.value}) on ${channel}-${pLayer} for ${durationMs}ms`)
	}

	self.playlistImageTimers = self.playlistImageTimers || {}
	self.playlistImageTimers[pKey] = setTimeout(() => {
		delete self.playlistImageTimers[pKey]

		// Advance to next
		let nextIdx = itemIdx + 1
		if (layer.playlistLoop !== false) {
			nextIdx = nextIdx % layer.playlist.length
		} else if (nextIdx >= layer.playlist.length) {
			return // Done playing once
		}

		triggerPlaylistAdvance(self, channel, pLayer, scene, layer, nextIdx)
	}, durationMs)
}

function clearPlaylistImageTimer(self, pKey) {
	if (self.playlistImageTimers && self.playlistImageTimers[pKey]) {
		clearTimeout(self.playlistImageTimers[pKey])
		delete self.playlistImageTimers[pKey]
	}
}

function triggerPlaylistAdvance(self, channel, pLayer, scene, layer, nextIdx) {
	const nextItem = layer.playlist[nextIdx]
	const transition = layer.playlistTransition || { type: 'MIX', duration: 12 }

	const loadOpts = {
		loop: false
	}
	if (transition.type && String(transition.type).toUpperCase() !== 'CUT') {
		loadOpts.transition = transition.type
		loadOpts.duration = transition.duration
	}

	if (typeof self.log === 'function') {
		self.log('info', `[Playlist] Advancing from image to item ${nextIdx} (${nextItem.value}) on ${channel}-${pLayer}`)
	}

	void (async () => {
		try {
			await self.amcp.loadbg(channel, pLayer, nextItem.value, loadOpts)
			await self.amcp.play(channel, pLayer)

			// Update index state immediately so that it triggers correctly on next update
			const pKey = `${scene.id}-${layer.layerNumber}`
			self.playlistActiveIndices = self.playlistActiveIndices || {}
			self.playlistActiveIndices[pKey] = nextIdx

			// Setup next advancement
			const isImg = nextItem.type === 'image' || /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(nextItem.value)
			if (isImg) {
				schedulePlaylistImageTimer(self, channel, pLayer, scene, layer, nextIdx)
			} else {
				let nextNextIdx = nextIdx + 1
				if (layer.playlistLoop !== false) {
					nextNextIdx = nextNextIdx % layer.playlist.length
				} else if (nextNextIdx >= layer.playlist.length) {
					nextNextIdx = -1
				}
				if (nextNextIdx >= 0) {
					queueNextPlaylistItem(self, channel, pLayer, layer, nextNextIdx)
				}
			}
		} catch (err) {
			if (typeof self.log === 'function') {
				self.log('warn', `[Playlist] Advance trigger failed on ${channel}-${pLayer}: ${err?.message || err}`)
			}
		}
	})()
}

function sameFileName(a, b) {
	if (!a || !b) return false
	const clean = (s) => String(s).toLowerCase().replace(/\\/g, '/').replace(/\.[^/.]+$/, '')
	return clean(a) === clean(b)
}

module.exports = { runSceneTakeLbg }

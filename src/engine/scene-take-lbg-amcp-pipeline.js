/**
 * Global border lines + LOADBG / MIXER / PLAY / PIP / crossfade / clip-end watcher for one PGM take.
 */

'use strict'

const { param } = require('../caspar/amcp-utils')
const { isTakeTwoPhaseBatchEnabled } = require('../caspar/amcp-batch')
const {
	sendPipOverlayLinesSerial,
	buildGlobalBorderAmcpLines,
	buildGlobalBorderUpdateLines,
	buildGlobalBorderOpacityFadeLine,
} = require('./pip-overlay')
const {
	buildSceneTemplateCgAmcpLines,
	buildClearTemplateCgOnOtherProgramChannelsLines,
	buildSceneTemplateCgSpec,
	isSameTemplateSpec,
	buildSceneTemplateCgUpdateOnlyLines,
	getTrackedTemplateHosts,
	recordTemplateHostAdded,
	resolveTemplateCgHostLayer,
} = require('./scene-template-cg')
const { isShaderCgName } = require('./cg-routing')
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
const { sendTakeJobsLoadAndMixerBatch } = require('./scene-take-lbg-amcp-pipeline-batch')
const { scheduleFadeOnEndForTakeJobs } = require('./scene-take-lbg-amcp-pipeline-fade')

/**
 * PLAY source layers before same-channel intra-look routes so route:// targets are on-air.
 * @param {object} amcp
 * @param {number} channel
 * @param {object[]} takeJobs
 * @param {*} self
 * @param {{ trailingCommit?: boolean, twoPhaseBatch?: boolean }} [opts]
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
			twoPhaseBatch: opts.twoPhaseBatch === true,
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

	// WO-259: take-scoped two-phase BEGIN…COMMIT batching (default true). `false` restores the exact
	// pre-WO-259 sequential/staggered AMCP line sequence below, byte-for-byte, with zero other changes.
	const twoPhaseBatch = isTakeTwoPhaseBatchEnabled(amcp._context)

	// Global border (layer 998) lifecycle — must ride the same channel COMMIT/crossfade
	// as the bank swap so it doesn't pop on/off when looks transition. See WO-09.
	let borderLines = []
	if (incomingGbEnabled) {
		try {
			if (sameGbTemplateType) {
				// Same template → CG UPDATE so params (color/width/etc.) change without re-adding the CG instance.
				borderLines = buildGlobalBorderUpdateLines(channel, incomingGbLayer, incomingGb)
			} else {
				// Fresh add (or template type changed): load hidden when crossfading, full-opacity when cutting.
				borderLines = buildGlobalBorderAmcpLines(channel, incomingGbLayer, incomingGb, self, {
					initialOpacity: gbWillFadeIn ? 0 : 1,
				})
			}
		} catch (e) {
			self.log?.('warn', `Global border failed: ${e?.message || e}`)
			borderLines = []
		}
	}

	// Phase A only exists when there is a take/merge batch to fold border lines into (WO-259 fix design).
	// Border-only changes (no takeJobs/mergeMixerExtras) keep the immediate legacy send below.
	const hasPhaseA = twoPhaseBatch && (takeJobs.length > 0 || mergeMixerExtras.length > 0)

	if (!hasPhaseA && borderLines.length > 0) {
		try {
			if (typeof self.log === 'function') self.log('info', `[scene-take-lbg] Sending border lines: ${JSON.stringify(borderLines)}`)
			await sendPipOverlayLinesSerial(amcp, borderLines)
		} catch (e) {
			self.log?.('warn', `Global border send failed: ${e?.message || e}`)
		}
	}

	if (takeJobs.length > 0 || mergeMixerExtras.length > 0) {
		await sendTakeJobsLoadAndMixerBatch(amcp, {
			self,
			channel,
			takeJobs,
			mergeMixerExtras,
			borderLines,
			twoPhaseBatch: hasPhaseA,
			currentSceneLayers,
			currentMap,
		})

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
		/* Owner 27.07 ("all shaders doesnt mix well, even look to look"): a shader template's CEF
		 * page needs several hundred ms to compile WebGL and render its first frame — a 180ms
		 * preroll ramped a BLANK layer up and the shader popped in mid-fade. Give shader-bearing
		 * takes a real warm-up before the crossfade starts. */
		const hasShaderJob = takeJobs.some((j) => j.templateCg && isShaderCgName(j.templateCg.cgName))
		const shaderWarmupMs = Math.max(0, Math.min(3000, parseInt(process.env.HIGHASCG_SHADER_WARMUP_MS || '600', 10) || 600))
		const prebufferMs = hasShaderJob
			? Math.max(needsIncomingFadePreroll ? 180 : 80, shaderWarmupMs)
			: needsIncomingFadePreroll
				? 180
				: 80
		await new Promise((r) => setTimeout(r, prebufferMs))

		try {
			if (crossfadeLines.length > 0 && takeJobs.length === 0) {
				// Timeline-only / exit-only crossfade: sendStaggeredTakePlays drops suffix
				// lines when there are no source PLAY lines to ride on — send directly.
				await amcp.batchSendChunked(crossfadeLines, { skipMixerPreCommit: true })
				await amcp.mixerCommit(channel)
				fadeClockRef.start = Date.now()
				notifyProgramTransitionStarted()
			} else if (crossfadeLines.length > 0 && !takeJobs.some((j) => j.playPlan)) {
				// WO-322 follow-up: a look whose jobs are all CG-hosted (shader-only look — playPlan
				// is null on template jobs) hits the same suffix drop as above, but with Phase A
				// deferred lines pending: the incoming bank was pre-hidden at OPACITY 0 and the ramp
				// to target rode in the dropped suffix, so the shader stayed invisible on one bank
				// parity and the outgoing media hard-cut at teardown instead of mixing. Leading
				// COMMIT first (flushes the deferred pre-hide, exactly like the staggered path's
				// leadingCommit before its PLAY batch), then the crossfade ramps.
				await amcp.mixerCommit(channel)
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
						twoPhaseBatch,
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
						twoPhaseBatch,
					},
				)
				fadeClockRef.start = Date.now()
				notifyProgramTransitionStarted()
			} else {
				await sendPhasedTakePlays(amcp, channel, takeJobs, self, { twoPhaseBatch })
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

				// WO-322: a shader composites on the LOOK band like media — CG ADD on the job's
				// bank-mapped physical layer (job.pLayer, NOT logical n: a bank-B take must land on
				// n+100). No continuity/UPDATE-only path (shaders are stateless graphics, not
				// timers), no clear-on-other-channels (mirrored looks legitimately run the same
				// shader per channel, exactly like media), no cgFade (the job's own mixerLines
				// OPACITY in the crossfade batch owns the fade — a CG-level ramp would double it),
				// and no tracked-host record (buildSceneTemplateCgAmcpLines guards that to 700+).
				if (isShaderCgName(job.templateCg.cgName)) {
					const lines = buildSceneTemplateCgAmcpLines(channel, job.pLayer, job.templateCg, {})
					if (lines.length > 0) {
						self.log?.(
							'info',
							`[scene-take-lbg] shader layer ${job.layer.layerNumber} → ${job.templateCg.cgName} on look-band layer ${job.pLayer} (WO-322)`,
						)
						await sendPipOverlayLinesSerial(amcp, lines)
					}
					continue
				}

				// WO-196 T196.2: detect continuity — same template on same host layer preserves timer state.
				// Check if the current scene already has this template on the same layer.
				const currentLayer = currentMap.get(job.layer.layerNumber)
				const currentSpec = currentLayer
					? buildSceneTemplateCgSpec(currentLayer, currentLayer.source?.value, self)
					: null
				// WO-268: continuity also requires that THIS session actually ADDed the template on
				// that host layer (WO-207 tracked hosts, cleared on Caspar reconnect) — the client
				// scene map alone can claim continuity across a Caspar restart, and the resulting
				// UPDATE-only take 403s against the empty layer.
				const continuityHostLayer = resolveTemplateCgHostLayer(job.layer.layerNumber, job.templateCg.cgName)
				const isContinuous =
					isSameTemplateSpec(job.templateCg, currentSpec) &&
					getTrackedTemplateHosts(channel).has(continuityHostLayer)

				const clearOther = buildClearTemplateCgOnOtherProgramChannelsLines(
					channel,
					job.layer.layerNumber,
					job.templateCg,
					self,
				)
				if (clearOther.length > 0) await sendPipOverlayLinesSerial(amcp, clearOther)

				let lines = []
				if (isContinuous) {
					// Same timer on same layer: emit UPDATE only to preserve running state.
					lines = buildSceneTemplateCgUpdateOnlyLines(channel, job.layer.layerNumber, job.templateCg)
					if (typeof self.log === 'function') {
						self.log(
							'info',
							`[scene-take-lbg] template CG layer ${job.layer.layerNumber} → ${job.templateCg.cgName} (continuity UPDATE)`,
						)
					}
				} else {
					// Different template or no current layer: full CLEAR+ADD+PLAY+UPDATE. When the take is a
					// bank crossfade, fade the template in on its host layer so it MIXES with the media
					// instead of cutting (the CG host layer is outside the bank crossfade math).
					const cgFade = shouldRunBankCrossfade && fadeDur > 0 ? { fadeDurFrames: fadeDur, fadeTween: fadeTw } : {}
					lines = buildSceneTemplateCgAmcpLines(channel, job.layer.layerNumber, job.templateCg, cgFade)
					if (typeof self.log === 'function') {
						self.log(
							'info',
							`[scene-take-lbg] template CG layer ${job.layer.layerNumber} → ${job.templateCg.cgName}`,
						)
					}
				}

				if (lines.length > 0) {
					await sendPipOverlayLinesSerial(amcp, lines)
					// WO-268 (completing WO-207's intent — this call was documented but never
					// wired): remember that this session ADDed the template host, so continuity
					// UPDATEs and teardown can trust the record.
					if (!isContinuous) recordTemplateHostAdded(channel, continuityHostLayer)
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

		await scheduleFadeOnEndForTakeJobs(self, channel, takeJobs, fadeWatcher, framerate)
	}

}

module.exports = { runSceneTakeLbgAmcpPipeline }

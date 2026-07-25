/**
 * Standard program take: LOADBG … MIX … then PLAY per layer (Caspar FG/BG swap).
 * Replaces the former dual-bank mixer opacity crossfade (`scene-take.js`).
 *
 * Pipeline order (smooth look→look):
 * 1) Build takeJobs + exit list (no AMCP).
 * 2) Non-merge exit: batched MIXER OPACITY→0 (non-DEFER) when not using bank crossfade.
 * 3) `{TRANSITION} + Animate` (UI; legacy `+ MERGE`): same **on-air** physical layer (`phys(N, activeBank)`);
 *    LOADBG (no MIX) + animated `MIXER FILL <dur> <tween>` + `MIXER ch COMMIT` + `PLAY … MIX <dur> <tween>` + COMMIT;
 *    outgoing-only layers still get DEFER opacity fade via `mergeMixerExtras`. Bank pointer unchanged.
 * 4) Bank crossfade path (non-merge): direction-aware opacity — fade incoming in when it is on top (bank B),
 *    or fade outgoing out when incoming is underneath (bank A); only one side tweens (no 50% dip).
 * 5) Teardown after transition window; merge teardown clears both logical layer N and N+100 to drop legacy bank B.
 * WO-259: `take_two_phase_batch` (config, default true) folds per-layer MIXER CLEAR/LOADBG/pre-PLAY
 * opacity/deferred MIXER/border+PIP CG into one BEGIN…COMMIT (Phase A), and PLAYs + crossfade
 * OPACITY into a second BEGIN…COMMIT (Phase B) — see scene-take-lbg-amcp-pipeline.js and
 * scene-route-deps.js#sendStaggeredTakePlays. `MIXER <ch> COMMIT` always stays outside both batches.
 * Same-channel route:// PLAYs ride Phase B too, dependency-ordered after their source PLAYs, so a look
 * mixing media + routes lands on one frame (todos19.07.26 fix — batches execute in order, apply
 * atomically). Explicit `false` restores the historical one-command-at-a-time staggered sequence.
 */

'use strict'

const { buildTakeJobs } = require('./scene-take-lbg-jobs')
const { PGM_BANK_B_OFFSET } = require('./scene-transition')
const { resolveGlobalBorderPhysicalLayer, buildMergeMixerExtrasForTake } = require('./scene-take-lbg-merge')
const { runSceneTakeLbgTeardown } = require('./scene-take-lbg-teardown')
const { setupLayerPlaylists } = require('./scene-take-lbg-playlist')
const { runSceneTakeLbgAmcpPipeline } = require('./scene-take-lbg-amcp-pipeline')
const { sendExitAndTimelineFadeLines } = require('./scene-take-lbg-exit-fade')
const { collectOrphanLookLogicalLayers, collectOrphanLookPhysicalLayers, clearPhysicalLookLayers } = require('./scene-exit-layers')
const { remapIntraLookRoutesForTakeChannel, assertSceneHasNoSelfRoutes } = require('./scene-route-deps')

/**
 * @param {object} amcp
 * @param {{ self: object, channel: number, currentScene: object|null, incomingScene: object, framerate?: number, forceCut?: boolean, onProgramTransitionStarted?: Function, skipLayerVisualEquality?: boolean, banklessTake?: boolean }} opts
 */
async function runSceneTakeLbg(amcp, opts) {
	// WO-156: every take path (API take, preview stage, sync-push, replication) funnels through
	// here — reject direct self-routes (route://N onto channel N) before any AMCP is sent.
	assertSceneHasNoSelfRoutes(opts?.incomingScene, parseInt(opts?.channel, 10))
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
	const incomingRaw = opts.incomingScene
	if (!incomingRaw || !Array.isArray(incomingRaw.layers)) throw new Error('incomingScene.layers required')

	const forceCut = !!opts.forceCut
	const globalT = normalizeTransition(incomingRaw.defaultTransition, forceCut)
	const isMergeTransitionEarly = isLayerAnimateTakeTransition(globalT.type)

	const chKey = String(channel)
	if (!self.programLayerBankByChannel) self.programLayerBankByChannel = {}
	let activeBank = normalizeProgramLayerBank(self.programLayerBankByChannel[chKey])
	let inactiveBank = activeBank === 'a' ? 'b' : 'a'
	let routeRemapBank = isMergeTransitionEarly ? activeBank : inactiveBank

	// WO-209 T209.1: bankless take mode — stage incoming on same bank (logical layers).
	// PRV channels are bank-less by design; setting both to 'a' forces content at logical 10-99.
	const banklessTake = !!opts.banklessTake
	if (banklessTake) {
		activeBank = 'a'
		inactiveBank = 'a'
		routeRemapBank = 'a'
	}
	const incoming = remapIntraLookRoutesForTakeChannel(incomingRaw, channel, routeRemapBank)
	const layersWithContent = incoming.layers.filter(layerHasContent)
	if (layersWithContent.length === 0) {
		throw new Error('incomingScene has no layers with sources — cannot take an empty look')
	}

	const diff = diffScenes(opts.currentScene || null, incoming)

	const currentMap = new Map()
	for (const l of opts.currentScene?.layers || []) {
		if (layerHasContent(l)) currentMap.set(l.layerNumber, l)
	}

	const phys = (sceneLn, bank) => physicalProgramLayer(sceneLn, bank)

	const fadeWatcher = self.clipEndFadeWatcher || null
	if (fadeWatcher) fadeWatcher.cancelChannel(channel)

	const framerate = resolveChannelFramerateForMixerTween(self, channel, opts.framerate)
	const incomingSorted = [...layersWithContent].sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))

	// diff.update = same layer slot, new content — handled by LOADBG/PLAY; never STOP/CLEAR that slot in teardown.
	const exitCandidates = [...(diff.exit || [])]

	let activeTimelineIdToFadeOut = null
	if (self.timelineEngine) {
		const pbNow = self.timelineEngine.getPlayback()
		if (pbNow?.timelineId) {
			const isPlayingOnThisChannel = self.timelineEngine._channelsFor(pbNow.sendTo).includes(channel)
			const exitingTimeline = diff.exit.find(
				(l) => layerHasContent(l) && l.source?.type === 'timeline' && l.source.value === pbNow.timelineId
			)
			if (exitingTimeline || isPlayingOnThisChannel) {
				activeTimelineIdToFadeOut = pbNow.timelineId
			}
		}
	}

	const fadeDur = forceCut || globalT.duration <= 0 ? 0 : globalT.duration
	const fadeTw = globalT.tween
	const fadeMs = fadeDur > 0 ? (fadeDur / framerate) * 1000 : 0
	const isMergeTransition = isLayerAnimateTakeTransition(globalT.type)
	const shouldRunBankCrossfade = fadeDur > 0 && (currentMap.size > 0 || activeTimelineIdToFadeOut) && !isMergeTransition
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

	const { takeJobs, extraExitCandidates, timelineFadeInPhys, skippedVisuallyEqualLayers } = await buildTakeJobs({
		incomingSorted,
		currentMap,
		channel,
		incoming,
		self,
		amcp,
		phys,
		inactiveBank,
		activeBank,
		shouldRunBankCrossfade,
		forceCut,
		isMergeTransition,
		globalT,
		framerate,
		skipLayerVisualEquality: !!opts.skipLayerVisualEquality,
	})

	if (extraExitCandidates && extraExitCandidates.length > 0) {
		exitCandidates.push(...extraExitCandidates)
	}

	// PGM-only / empty live JSON: bank A/B may leave the other slot on-air (e.g. L110 then L10).
	// Clear stale physical layers before LOADBG when we are not doing a bank opacity crossfade.
	// WO-160b: pgm-only channels run the orphan sweep BEFORE every take regardless of shouldRunBankCrossfade
	// because their live JSON is less reliable (no staged PRV exchange).
	const shouldClearOrphans = (!shouldRunBankCrossfade && takeJobs.length > 0) || (opts.pgmOnly && takeJobs.length > 0)
	if (shouldClearOrphans) {
		const incomingPhys = takeJobs.map((j) => j.pLayer)
		const stalePhys = collectOrphanLookPhysicalLayers(self, channel, incomingPhys)
		if (stalePhys.length > 0) {
			try {
				await clearPhysicalLookLayers(amcp, channel, stalePhys, self)
			} catch (e) {
				self.log?.('warn', `[scene-take-lbg] stale look-layer clear failed: ${e?.message || e}`)
			}
		}
	}

	// Caspar may still have look layers when live JSON already matches incoming (diff.exit empty).
	for (const ln of collectOrphanLookLogicalLayers(self, channel, incoming, inactiveBank)) {
		const row =
			currentMap.get(ln) ||
			(opts.currentScene?.layers || []).find((l) => Number(l.layerNumber) === ln) ||
			{ layerNumber: ln }
		exitCandidates.push(row)
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

	fadeClockStart = await sendExitAndTimelineFadeLines(amcp, {
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
	})

	// Global border (layer 998) lifecycle is computed before takeJobs so the teardown
	// block can also act when only the border changes (no media swap). See WO-09.
	const { mergeScreenSlicesIntoBorder } = require('./global-border')
	const currentGb = opts.currentScene?.globalBorder
	const incomingGb = mergeScreenSlicesIntoBorder(
		incoming.globalBorder,
		Number.isFinite(opts.mainScreenIndex) ? opts.mainScreenIndex : -1,
	)
	const currentGbEnabled = !!(currentGb && currentGb.enabled)
	const incomingGbEnabled = !!(incomingGb && incomingGb.enabled)
	const sameGbTemplateType =
		currentGbEnabled &&
		incomingGbEnabled &&
		String(currentGb.type || '').toLowerCase() === String(incomingGb.type || '').toLowerCase()
	const gbFadeLinked = fadeDur > 0 && !forceCut && (shouldRunBankCrossfade || isMergeTransition)
	const gbWillFadeIn = incomingGbEnabled && !sameGbTemplateType && gbFadeLinked
	const gbWillFadeOut = currentGbEnabled && !incomingGbEnabled && gbFadeLinked

	const incomingGbLayer = resolveGlobalBorderPhysicalLayer(incomingGb)
	const currentGbLayer = resolveGlobalBorderPhysicalLayer(currentGb)

	const mergeMixerExtras = buildMergeMixerExtrasForTake({
		isMergeTransition,
		fadeDur,
		forceCut,
		channel,
		exitMedia,
		takeJobs,
		fadeTw,
		currentSceneLayers,
		fadeWatcher,
		gbWillFadeIn,
		gbWillFadeOut,
		incomingGbLayer,
		currentGbLayer,
		activeBank,
		phys,
	})

	if (activeTimelineIdToFadeOut && fadeDur > 0 && !forceCut) {
		const tl = self.timelineEngine.timelines.get(activeTimelineIdToFadeOut)
		if (tl) {
			const { TIMELINE_LAYER_BASE } = require('./timeline-playback-helpers')
			const { deferMixerAmcpLine, param } = require('../caspar/amcp-utils')
			let tail = `0 ${fadeDur}`
			if (fadeTw) tail += ` ${param(fadeTw)}`
			for (let li = 0; li < tl.layers.length; li++) {
				const cl = `${channel}-${TIMELINE_LAYER_BASE + li}`
				mergeMixerExtras.push(deferMixerAmcpLine(`MIXER ${cl} OPACITY ${tail}`))
			}
		}
	}

	const fadeClockRef = { start: fadeClockStart }
	await runSceneTakeLbgAmcpPipeline(amcp, fadeClockRef, {
		self,
		channel,
		incoming,
		incomingGb,
		incomingGbEnabled,
		sameGbTemplateType,
		incomingGbLayer,
		gbWillFadeIn,
		timelineFadeInPhys: shouldRunBankCrossfade ? timelineFadeInPhys : [],
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
	})
	fadeClockStart = fadeClockRef.start

	// WO-196 T196.1: build set of incoming template host layers to avoid clearing them on exit.
	// This enables continuity: if a template layer carries the same identity on the next look,
	// we keep it on air without a CG CLEAR.
	const { buildSceneTemplateCgSpec, resolveTemplateCgHostLayer } = require('./scene-template-cg')
	const { isShaderCgName } = require('./cg-routing')
	const incomingTemplateHostLayers = new Set()
	for (const layer of incoming.layers) {
		if (!layerHasContent(layer)) continue
		const spec = buildSceneTemplateCgSpec(layer, layer.source?.value, self)
		// WO-322: 700+ overlay hosts only — shaders live on the look band with no continuity
		// semantics; adding their logical layer here would wrongly shield an unrelated exiting
		// 700-band host (and shader exits are the physical teardown path anyway).
		if (spec && !isShaderCgName(spec.cgName)) {
			const hostLayer = resolveTemplateCgHostLayer(layer.layerNumber, spec.cgName)
			incomingTemplateHostLayers.add(hostLayer)
		}
	}

	// Border-only teardown path: when the new look removes the border and there's no exit
	// media to anchor the wait, still respect the crossfade clock before clearing the CG.
	const needsBorderOnlyTeardown = currentGbEnabled && !incomingGbEnabled && exitMedia.length === 0
	await runSceneTakeLbgTeardown({
		amcp,
		self,
		channel,
		exitMedia,
		needsBorderOnlyTeardown,
		fadeClockStart,
		fadeDur,
		fadeMs,
		takeJobs,
		isMergeTransition,
		currentSceneLayers,
		currentGbEnabled,
		incomingGbEnabled,
		activeBank,
		inactiveBank,
		phys,
		activeTimelineIdToFadeOut,
		incomingTemplateHostLayers,
	})

	if (activeTimelineIdToFadeOut) {
		self.timelineEngine.stop(activeTimelineIdToFadeOut)
	}

	// WO-218 T218.2: When the bank flips, move visually-equal skipped layers to the target bank
	// to avoid split-brain (producer on old bank, mixer state on new bank).
	// This MUST run BEFORE the pointer flip and BEFORE clearStaleInactiveBankLookLayers.
	const shouldFlipBank = !isMergeTransition && (takeJobs.length > 0 || mergeMixerExtras.length > 0) && !banklessTake
	if (shouldFlipBank && skippedVisuallyEqualLayers.length > 0) {
		const swapLines = []
		for (const skipped of skippedVisuallyEqualLayers) {
			const fromPhys = skipped.physicalLayerNow // old bank, currently active
			const toPhys = phys(skipped.layerNumber, inactiveBank) // new bank (inactive), target
			if (fromPhys !== toPhys) {
				// SWAP <ch>-<from> <ch>-<to> TRANSFORMS (TRANSFORMS preserves mixer state across the swap)
				const swapCmd = `SWAP ${channel}-${fromPhys} ${channel}-${toPhys} TRANSFORMS`
				swapLines.push(swapCmd)
			}
		}
		if (swapLines.length > 0) {
			try {
				await amcp.batchSend(swapLines)
			} catch (e) {
				self.log?.('warn', `[scene-take-lbg] WO-218 SWAP for skipped layers failed: ${e?.message || e}`)
			}
		}
	}

	// WO-209 T209.1: skip pointer flip when banklessTake (pointer must stay 'a' for logical layers).
	if (shouldFlipBank) {
		self.programLayerBankByChannel[chKey] = inactiveBank
	}
	persistProgramLayerBanks(self)

	// WO-218 T218.3: Clean up mixer state on the bank layers we just swapped FROM,
	// so no stale CROP/FILL remains on the vacated layer for the next take.
	if (shouldFlipBank && skippedVisuallyEqualLayers.length > 0) {
		const clearLines = []
		for (const skipped of skippedVisuallyEqualLayers) {
			const fromPhys = skipped.physicalLayerNow // old bank (now inactive after flip)
			const toPhys = phys(skipped.layerNumber, inactiveBank) // new bank (now active after flip)
			if (fromPhys !== toPhys) {
				// Clear mixer state on the old bank layer (now inactive)
				clearLines.push(`MIXER ${channel}-${fromPhys} CLEAR`)
			}
		}
		if (clearLines.length > 0) {
			try {
				await amcp.batchSendChunked(clearLines, { skipMixerPreCommit: true })
			} catch (e) {
				self.log?.('warn', `[scene-take-lbg] WO-218 MIXER CLEAR for vacated layers failed: ${e?.message || e}`)
			}
		}
	}

	if (isMergeTransition && incoming) {
		try {
			const { clearStaleInactiveBankLookLayers } = require('./scene-exit-layers')
			await clearStaleInactiveBankLookLayers(amcp, channel, inactiveBank, incoming, self)
		} catch (_) {}
	}

	// WO-209 T209.3: when banklessTake, sweep opposite bank for orphaned look layers (not in incoming).
	// This cleans up stale bank-B physical layers (110-199) that aren't targeted by this take.
	if (banklessTake && !isMergeTransition && takeJobs.length > 0) {
		try {
			const incomingPhys = takeJobs.map((j) => j.pLayer)
			const stalePhys = collectOrphanLookPhysicalLayers(self, channel, incomingPhys)
			// Filter to bank-B layers only (110-199)
			const staleBankB = stalePhys.filter((layer) => layer >= PGM_BANK_B_OFFSET && layer <= 199)
			if (staleBankB.length > 0) {
				await clearPhysicalLookLayers(amcp, channel, staleBankB, self)
			}
		} catch (e) {
			self.log?.('warn', `[scene-take-lbg] bankless-take opposite-bank sweep failed: ${e?.message || e}`)
		}
	}

	// WO-210 T210.5: apply timersVisibility map from the look (if present).
	// For each assigned timer on this channel whose timerId is in the map, emit MIXER OPACITY.
	try {
		const timersVisibilityMap = incoming?.timersVisibility || opts?.incomingScene?.timersVisibility
		if (timersVisibilityMap && typeof timersVisibilityMap === 'object') {
			const { linesForLookVisibility } = require('./screen-timers')
			const visibilityLines = linesForLookVisibility(channel, timersVisibilityMap)
			if (visibilityLines.length > 0) {
				await amcp.batchSendChunked(visibilityLines, { skipMixerPreCommit: true })
			}
		}
	} catch (e) {
		self.log?.('warn', `[scene-take-lbg] timersVisibility apply failed: ${e?.message || e}`)
	}

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

module.exports = { runSceneTakeLbg }

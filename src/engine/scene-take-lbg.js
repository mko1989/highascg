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
 * LOADBG/PLAY stay `_send` (not inside BEGIN…COMMIT) so Caspar can resolve each layer reliably.
 */

'use strict'

const { param } = require('../caspar/amcp-utils')
const {
	buildPipOverlayOpacityFadeDeferLines,
	nextPipContentLayerInScene,
	pipOverlaysFromLayer,
} = require('./pip-overlay')

const { buildTakeJobs } = require('./scene-take-lbg-jobs')
const { PGM_BANK_B_OFFSET } = require('./scene-transition')
const { resolveGlobalBorderPhysicalLayer, buildMergeMixerExtrasForTake } = require('./scene-take-lbg-merge')
const { runSceneTakeLbgTeardown } = require('./scene-take-lbg-teardown')
const { setupLayerPlaylists } = require('./scene-take-lbg-playlist')
const { runSceneTakeLbgAmcpPipeline } = require('./scene-take-lbg-amcp-pipeline')
const { collectOrphanLookLogicalLayers, collectOrphanLookPhysicalLayers, clearPhysicalLookLayers } = require('./scene-exit-layers')
const { remapIntraLookRoutesForTakeChannel } = require('./scene-route-deps')

/**
 * @param {object} amcp
 * @param {{ self: object, channel: number, currentScene: object|null, incomingScene: object, framerate?: number, forceCut?: boolean, onProgramTransitionStarted?: Function, skipLayerVisualEquality?: boolean }} opts
 */
async function runSceneTakeLbg(amcp, opts) {
	if (opts.pgmOnly) {
		return require('./scene-take-pgm-only').runSceneTakePgmOnly(amcp, opts)
	}
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
	const activeBank = normalizeProgramLayerBank(self.programLayerBankByChannel[chKey])
	const inactiveBank = activeBank === 'a' ? 'b' : 'a'
	const routeRemapBank = isMergeTransitionEarly ? activeBank : inactiveBank
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

	const { takeJobs, extraExitCandidates, timelineFadeInPhys } = await buildTakeJobs({
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
	if (!shouldRunBankCrossfade && takeJobs.length > 0) {
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

	const timelineFadeLines = []
	if (activeTimelineIdToFadeOut && fadeDur > 0 && !forceCut) {
		const tl = self.timelineEngine.timelines.get(activeTimelineIdToFadeOut)
		if (tl) {
			const { TIMELINE_LAYER_BASE } = require('./timeline-playback-helpers')
			const { param } = require('../caspar/amcp-utils')
			let tail = `0 ${fadeDur}`
			if (fadeTw) tail += ` ${param(fadeTw)}`
			for (let li = 0; li < tl.layers.length; li++) {
				const cl = `${channel}-${TIMELINE_LAYER_BASE + li}`
				timelineFadeLines.push(`MIXER ${cl} OPACITY ${tail} DEFER`)
			}
		}
	}

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
			if (fadeTw) p += ` ${require('../caspar/amcp-utils').param(fadeTw)}`
			fadeLines.push(`MIXER ${channel}-${L} OPACITY ${p}`)
		}
		for (const layer of exitMedia) {
			const pOut = phys(Number(layer.layerNumber), activeBank)
			if (fadeWatcher) fadeWatcher.cancel(channel, pOut)
			const cl = `${channel}-${pOut}`
			let p = `0 ${fadeDur}`
			if (fadeTw) p += ` ${require('../caspar/amcp-utils').param(fadeTw)}`
			fadeLines.push(`MIXER ${cl} OPACITY ${p}`)
			try {
				const nextL = require('./pip-overlay').nextPipContentLayerInScene(currentSceneLayers, layer.layerNumber)
				const pipN = require('./pip-overlay').pipOverlaysFromLayer(layer).length
				if (pipN > 0) {
					fadeLines.push(...require('./pip-overlay').buildPipOverlayOpacityFadeDeferLines(channel, pOut, p, nextL, pipN))
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
					fadeWatcher.cancel(channel, phys(ln, activeBank))
					fadeWatcher.cancel(channel, phys(ln, inactiveBank))
				}
			} else {
				const pOut = phys(Number(layer.layerNumber), activeBank)
				if (fadeWatcher) fadeWatcher.cancel(channel, pOut)
			}
		}
	}

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
	})

	if (activeTimelineIdToFadeOut) {
		self.timelineEngine.stop(activeTimelineIdToFadeOut)
	}

	if (!isMergeTransition && (takeJobs.length > 0 || mergeMixerExtras.length > 0)) {
		self.programLayerBankByChannel[chKey] = inactiveBank
	}
	persistProgramLayerBanks(self)

	if (isMergeTransition && incoming) {
		try {
			const { clearStaleInactiveBankLookLayers } = require('./scene-exit-layers')
			await clearStaleInactiveBankLookLayers(amcp, channel, inactiveBank, incoming, self)
		} catch (_) {}
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

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

/**
 * @param {object} amcp
 * @param {{ self: object, channel: number, currentScene: object|null, incomingScene: object, framerate?: number, forceCut?: boolean, onProgramTransitionStarted?: Function, skipLayerVisualEquality?: boolean }} opts
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
		skipLayerVisualEquality: !!opts.skipLayerVisualEquality,
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

	const fadeClockRef = { start: fadeClockStart }
	await runSceneTakeLbgAmcpPipeline(amcp, fadeClockRef, {
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
		phys,
	})

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

module.exports = { runSceneTakeLbg }

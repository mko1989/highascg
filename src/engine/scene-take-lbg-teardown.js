/**
 * Post-take teardown: STOP/CLEAR exited layers (+ PIP slots), dual global border clear, optional fade wait.
 */

'use strict'

const playbackTracker = require('../state/playback-tracker')
const { isPgmAudioTrackPhysicalLayerOnChannel } = require('./look-layer-ranges')
const {
	buildPipOverlayRemoveLines,
	buildGlobalBorderClearLines,
	sendPipOverlayLinesSerial,
	nextPipContentLayerInScene,
	pipOverlaysFromLayer,
} = require('./pip-overlay')
const {
	isSceneTemplateLayer,
	buildSceneTemplateCgClearLines,
	resolveTemplateCgHostLayer,
	getTrackedTemplateHosts,
	untrackTemplateHosts,
} = require('./scene-template-cg')
/**
 * @param {object} ctx
 * @param {object} ctx.amcp
 * @param {object} ctx.self
 * @param {number} ctx.channel
 * @param {object[]} ctx.exitMedia
 * @param {boolean} ctx.needsBorderOnlyTeardown
 * @param {number|null} ctx.fadeClockStart
 * @param {number} ctx.fadeDur
 * @param {number} ctx.fadeMs
 * @param {object[]} ctx.takeJobs
 * @param {boolean} ctx.isMergeTransition
 * @param {object[]|undefined} ctx.currentSceneLayers
 * @param {boolean} ctx.currentGbEnabled
 * @param {boolean} ctx.incomingGbEnabled
 * @param {'a'|'b'} ctx.activeBank
 * @param {'a'|'b'} ctx.inactiveBank
 * @param {(sceneLn: number, bank: 'a'|'b') => number} ctx.phys
 * @param {Set<number>} [ctx.incomingTemplateHostLayers]
 */
async function runSceneTakeLbgTeardown(ctx) {
	const {
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
		incomingTemplateHostLayers = new Set(),
	} = ctx

	if (exitMedia.length === 0 && !needsBorderOnlyTeardown && !ctx.activeTimelineIdToFadeOut) return

	let teardownWait = 0
	if (fadeClockStart != null && fadeDur > 0) {
		teardownWait = Math.max(0, fadeMs - (Date.now() - fadeClockStart))
	}

	// Fade EXITING template CG out over the (remaining) crossfade window so template->media
	// transitions MIX instead of cutting. The CG CLEAR built below (after the wait) completes the
	// removal once the template is invisible. Template CG lives on the fixed 700+ overlay host layer,
	// outside the bank crossfade, so it needs its own opacity ramp — the counterpart to the fade-IN in
	// scene-template-cg.js buildSceneTemplateCgAmcpLines. Only exiting, non-replaced templates fade.
	if (fadeDur > 0 && teardownWait > 0) {
		const fadeOutFrames = fadeMs > 0 ? Math.max(1, Math.round(fadeDur * (teardownWait / fadeMs))) : fadeDur
		const fadeOutLines = []
		for (const layer of exitMedia) {
			if (!isSceneTemplateLayer(layer, layer.source?.value, self)) continue
			const hostLayer = resolveTemplateCgHostLayer(layer.layerNumber, layer.source?.value)
			if (incomingTemplateHostLayers.has(hostLayer)) continue // replaced by the incoming look — not exiting
			fadeOutLines.push(`MIXER ${channel}-${hostLayer} OPACITY 0 ${fadeOutFrames}`)
		}
		if (fadeOutLines.length > 0) {
			try {
				await sendPipOverlayLinesSerial(amcp, fadeOutLines)
			} catch (e) {
				self?.log?.('warn', `[scene-take-lbg] template fade-out failed: ${e?.message || e}`)
			}
		}
	}

	if (teardownWait > 0) {
		await new Promise((r) => setTimeout(r, Math.ceil(teardownWait) + 5))
	}

	const takeJobLogicalNums = new Set(takeJobs.map((j) => Number(j.layer.layerNumber)).filter(Number.isFinite))

	const teardownLines = []
	for (const layer of exitMedia) {
		const ln = Number(layer.layerNumber)
		if (isMergeTransition && Number.isFinite(ln)) {
			if (takeJobLogicalNums.has(ln)) {
				const stale = phys(ln, inactiveBank)
				const onAir = phys(ln, activeBank)
				if (stale !== onAir) {
					const clg = `${channel}-${stale}`
					if (!isPgmAudioTrackPhysicalLayerOnChannel(self?.config, channel, stale)) {
						teardownLines.push(`STOP ${clg}`, `MIXER ${clg} CLEAR`)
						try {
							playbackTracker.recordStop(self, channel, stale)
						} catch (_) {}
					}
				}
				continue
			}
			for (const bank of ['a', 'b']) {
				const physLn = phys(ln, bank)
				if (isPgmAudioTrackPhysicalLayerOnChannel(self?.config, channel, physLn)) continue
				const cl = `${channel}-${physLn}`
				teardownLines.push(`STOP ${cl}`, `MIXER ${cl} CLEAR`)
				try {
					const nextL = nextPipContentLayerInScene(currentSceneLayers, layer.layerNumber)
					const pipN = pipOverlaysFromLayer(layer).length
					if (pipN > 0 && physLn === phys(ln, activeBank)) {
						teardownLines.push(...buildPipOverlayRemoveLines(channel, physLn, nextL, pipN))
					}
				} catch (_) {}
				try {
					playbackTracker.recordStop(self, channel, physLn)
				} catch (_) {}
			}
		} else {
			const pOut = phys(Number(layer.layerNumber), activeBank)
			if (isPgmAudioTrackPhysicalLayerOnChannel(self?.config, channel, pOut)) continue
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

	// WO-196 T196.1: emit CG CLEAR for exiting template layers not in the incoming look.
	// This prevents timers and other template CG from staying on air after a look transition.
	const hostsToUntrack = new Set()
	for (const layer of exitMedia) {
		if (!isSceneTemplateLayer(layer, layer.source?.value, self)) continue
		const hostLayer = resolveTemplateCgHostLayer(layer.layerNumber, layer.source?.value)
		if (incomingTemplateHostLayers.has(hostLayer)) continue
		// This layer is exiting and will not be replaced by the incoming look.
		const clearLines = buildSceneTemplateCgClearLines(channel, layer.layerNumber, layer.source?.value)
		if (clearLines.length > 0) {
			teardownLines.push(...clearLines)
			// Reset the host opacity after the clear: the fade-out above left it at 0, so a later
			// CUT-in template on this host would otherwise be invisible. Empty layer → harmless.
			teardownLines.push(`MIXER ${channel}-${hostLayer} OPACITY 1 0`)
			hostsToUntrack.add(hostLayer)
		}
	}

	// WO-207 T207.2: clear tracked hosts not re-declared by the incoming look (belt and braces with WO-196).
	// This handles orphans when the same layer number exists in both scenes with different template types.
	const trackedHosts = getTrackedTemplateHosts(channel)
	if (trackedHosts.size > 0) {
		for (const host of trackedHosts) {
			// Skip hosts that are declared in the incoming look
			if (incomingTemplateHostLayers.has(host)) continue
			// This tracked host is not in the incoming look — clear it and mark for untracking.
			const clearLines = buildSceneTemplateCgClearLines(channel, host, '')
			if (clearLines.length > 0) {
				teardownLines.push(...clearLines)
				teardownLines.push(`MIXER ${channel}-${host} OPACITY 1 0`) // reset opacity for future reuse of this host
				hostsToUntrack.add(host)
			}
		}
	}

	// Untrack all hosts we just cleared
	if (hostsToUntrack.size > 0) {
		untrackTemplateHosts(channel, hostsToUntrack)
	}

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

module.exports = { runSceneTakeLbgTeardown }

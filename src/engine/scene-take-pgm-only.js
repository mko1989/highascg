/**
 * LEGACY since WO-160b: pgm-only takes now run through the LBG bank pipeline instead of this engine.
 * This file is kept for backwards compatibility — verify via grep that no callers remain at runtime.
 * runSceneTakePgmOnly is no longer invoked; normalizeTransitionForPgmOnly, physicalLayer, pgmOnlyMixerAnimTail
 * may have other consumers — check before deletion.
 *
 * --- Original docstring ---
 * PGM-only program take — single stack (no A/B banks), CUT or +Animate only.
 * Outgoing layers are cleared in teardown after the transition window, not before LOADBG.
 */

'use strict'

const { sendAmcpLinesSequential } = require('../caspar/amcp-batch')
const playbackTracker = require('../state/playback-tracker')
const { param } = require('../caspar/amcp-utils')
const { getResolvedFillForSceneLayer } = require('./scene-native-fill')
const { audioRouteToAudioFilter, resolveConfigProgramLayoutForChannel } = require('./audio-route')
const { resolvePlaySeekFramesForSceneLayer } = require('./scene-play-seek')
const {
	buildPipOverlayAmcpLinesAll,
	buildPipOverlayRemoveLines,
	nextPipContentLayerInScene,
	pipOverlaysFromLayer,
	sendPipOverlayLinesSerial,
} = require('./pip-overlay')
const {
	clipPath,
	resolveSceneClipForAmcp,
	shouldApplyStraightAlphaKeyer,
	buildEffectAmcpLines,
	chLayerAmcp,
} = require('./scene-take-lbg-helpers')
const { sceneLayerRotationMixerLines, fillForSceneLayerRotationAnchor } = require('./scene-layer-rotation-amcp')
const { cropAdjustedFillForLayer } = require('./layer-crop')
const { buildSceneTemplateCgSpec, buildSceneTemplateCgAmcpLines, buildClearTemplateCgOnOtherProgramChannelsLines } = require('./scene-template-cg')
const { setupLayerPlaylists } = require('./scene-take-lbg-playlist')
const { isPgmAudioTrackPhysicalLayerOnChannel } = require('./look-layer-ranges')
const { remapIntraLookRoutesForTakeChannel, sendStaggeredTakePlays } = require('./scene-route-deps')
const {
	diffScenes,
	layerHasContent,
	normalizeTransition,
	isLayerAnimateTakeTransition,
	baseTypeStripAnimateSuffix,
	resolveChannelFramerateForMixerTween,
} = require('./scene-transition')

function normalizeTransitionForPgmOnly(t, forceCut) {
	const n = normalizeTransition(t, forceCut)
	if (forceCut || n.duration <= 0 || String(n.type || '').toUpperCase() === 'CUT') {
		return { type: 'CUT', duration: 0, tween: 'linear' }
	}
	if (isLayerAnimateTakeTransition(n.type)) return n
	// Legacy plain MIX/WIPE/… (still on many looks) → same-layer + Animate on PGM-only.
	const base = (baseTypeStripAnimateSuffix(n.type) || String(n.type || 'MIX').trim()).split(/\s+/)[0] || 'MIX'
	const baseUpper = base.toUpperCase()
	const animateBase = ['MIX', 'WIPE', 'SLIDE', 'PUSH'].includes(baseUpper) ? baseUpper : 'MIX'
	return { type: `${animateBase} + ANIMATE`, duration: n.duration, tween: n.tween }
}

function physicalLayer(sceneLayerNum) {
	const n = parseInt(sceneLayerNum, 10)
	return Number.isFinite(n) && n >= 1 ? n : 10
}

/** Caspar reference gap between MIXER COMMIT and PLAY on same-layer LOADBG MIX takes. */
const PGM_ONLY_PLAY_PREROLL_MS = 80

/** +Animate: duration (+ tween) + DEFER on tweenable mixer props; CUT: immediate tail `0`. */
function pgmOnlyMixerAnimTail(isAnimate, fadeDur, fadeTw) {
	if (isAnimate && fadeDur > 0) {
		return `${fadeDur}${fadeTw ? ` ${param(fadeTw)}` : ''} DEFER`
	}
	return '0'
}

function buildPgmOnlyMixerLines(job, channel, isAnimate, fadeDur, fadeTw) {
	const cl = chLayerAmcp(channel, job.pLayer)
	const vol = job.layer.muted ? 0 : job.layer.volume != null ? job.layer.volume : 1
	const targetOpacity = job.layer.muted ? 0 : job.layer.opacity != null ? job.layer.opacity : 1
	const keyer = shouldApplyStraightAlphaKeyer(job.clip, !!job.layer.straightAlpha) ? 1 : 0
	const animTail = pgmOnlyMixerAnimTail(isAnimate, fadeDur, fadeTw)
	const rot = job.layer.rotation ?? 0
	const casparFill = fillForSceneLayerRotationAnchor(job.f, rot)
	const lines = [`MIXER ${cl} FILL ${casparFill.x} ${casparFill.y} ${casparFill.scaleX} ${casparFill.scaleY} ${animTail}`]
	lines.push(...sceneLayerRotationMixerLines(cl, rot, { rotationTail: ` ${animTail}` }))
	if (isAnimate && fadeDur > 0) {
		lines.push(`MIXER ${cl} OPACITY ${targetOpacity} ${animTail}`)
	} else if (targetOpacity !== 1) {
		lines.push(`MIXER ${cl} OPACITY ${targetOpacity} 0`)
	}
	lines.push(`MIXER ${cl} KEYER ${keyer}`)
	if (vol !== 1) {
		const volTail = isAnimate && fadeDur > 0 ? animTail : ''
		lines.push(`MIXER ${cl} VOLUME ${vol}${volTail ? ` ${volTail}` : ''}`)
	}
	for (const fx of job.layer.effects || []) {
		const fxLines = buildEffectAmcpLines(fx.type, fx.params || {}, cl)
		if (fxLines) lines.push(...fxLines)
	}
	return lines
}

/**
 * @param {object} amcp
 * @param {object} opts — same surface as runSceneTakeLbg (+ pgmOnly implied by caller)
 */
async function runSceneTakePgmOnly(amcp, opts) {
	const self = opts.self
	const channel = parseInt(opts.channel, 10)
	if (!channel || channel < 1) throw new Error('channel required')
	const incoming = remapIntraLookRoutesForTakeChannel(opts.incomingScene, channel)
	if (!incoming?.layers?.length) throw new Error('incomingScene.layers required')

	const forceCut = !!opts.forceCut
	const globalT = normalizeTransitionForPgmOnly(incoming.defaultTransition, forceCut)
	const isAnimate = isLayerAnimateTakeTransition(globalT.type) && globalT.duration > 0
	const fadeDur = isAnimate ? globalT.duration : 0
	const fadeTw = globalT.tween
	const animateBase = isAnimate ? baseTypeStripAnimateSuffix(globalT.type) || 'MIX' : null
	const framerate = resolveChannelFramerateForMixerTween(self, channel, opts.framerate)
	const fadeMs = fadeDur > 0 ? (fadeDur / framerate) * 1000 : 0

	const chKey = String(channel)
	if (!self.programLayerBankByChannel) self.programLayerBankByChannel = {}
	self.programLayerBankByChannel[chKey] = 'a'

	const fadeWatcher = self.clipEndFadeWatcher || null
	if (fadeWatcher) fadeWatcher.cancelChannel(channel)

	const currentMap = new Map()
	for (const l of opts.currentScene?.layers || []) {
		if (layerHasContent(l)) currentMap.set(l.layerNumber, l)
	}
	const diff = diffScenes(opts.currentScene || null, incoming)
	const incomingSorted = incoming.layers.filter(layerHasContent).sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))
	const incomingLayerNums = new Set(incomingSorted.map((l) => Number(l.layerNumber)))

	const exitLayers = []
	const seenExit = new Set()
	for (const l of diff.exit || []) {
		const ln = Number(l.layerNumber)
		if (!Number.isFinite(ln) || seenExit.has(ln)) continue
		seenExit.add(ln)
		exitLayers.push(l)
	}
	for (const l of opts.currentScene?.layers || []) {
		if (!layerHasContent(l)) continue
		const ln = Number(l.layerNumber)
		if (!Number.isFinite(ln) || incomingLayerNums.has(ln) || seenExit.has(ln)) continue
		seenExit.add(ln)
		exitLayers.push(l)
	}

	self.log?.(
		'info',
		`[scene-take-pgm-only] ch=${channel} animate=${isAnimate} fadeDur=${fadeDur} exitLayers=${exitLayers.length} incomingLayers=${incomingSorted.length}`,
	)

	let activeTimelineIdToFadeOut = null
	if (self.timelineEngine) {
		const pbNow = self.timelineEngine.getPlayback()
		if (pbNow?.timelineId) {
			const isPlayingOnThisChannel = self.timelineEngine._channelsFor(pbNow.sendTo).includes(channel)
			const exitingTimeline = exitLayers.find(
				(l) => layerHasContent(l) && l.source?.type === 'timeline' && l.source.value === pbNow.timelineId
			)
			if (exitingTimeline || isPlayingOnThisChannel) {
				activeTimelineIdToFadeOut = pbNow.timelineId
			}
		}
	}

	const takeJobs = []
	/** Timeline physical layers preset to 0 by startSceneTimelineLayer — faded in via flatMixer (WO-152 B152.1). */
	const timelineFadeInPhys = []
	for (const layer of incomingSorted) {
		if (layer.source?.type === 'timeline') {
			const tlId = layer.source.value
			if (tlId && self.timelineEngine) {
				const screenIdx = require('./scene-transition').programChannelToScreenIdx(self.config, channel)
				const { startSceneTimelineLayer } = require('./timeline-take')
				const fadeIn = await startSceneTimelineLayer(self, amcp, channel, layer, {
					fadeDur: forceCut ? 0 : fadeDur,
					screenIdx,
					startAtCurrentPosition: false,
				})
				timelineFadeInPhys.push(...fadeIn)
			}
			continue
		}

		let clip = clipPath(layer)
		if (layer.source?.type === 'live_audio') {
			const slot = parseInt(String(layer.source.value || '1'), 10) || 1
			const { resolveLiveAudioRouteString, resolveLiveAudioPlayClip } = require('../config/live-audio-input')
			clip =
				resolveLiveAudioRouteString(self.config, slot) ||
				resolveLiveAudioPlayClip(self.config, slot) ||
				clip
		}
		if (!clip) continue
		clip = resolveSceneClipForAmcp(clip, self)

		const templateCg = buildSceneTemplateCgSpec(layer, clip, self)

		const pLayer = physicalLayer(layer.layerNumber)
		const f = await getResolvedFillForSceneLayer(self, layer, channel, incoming)
		const loadOpts = { loop: !!layer.loop }
		const af = audioRouteToAudioFilter(layer.audioRoute || '1+2', resolveConfigProgramLayoutForChannel(self.config, channel))
		if (af) loadOpts.audioFilter = af

		if (isAnimate && fadeDur > 0) {
			loadOpts.transition = animateBase
			loadOpts.duration = fadeDur
			loadOpts.tween = fadeTw
		}

		const seekFrames = resolvePlaySeekFramesForSceneLayer(layer, self, {
			channel,
			layerNumber: layer.layerNumber,
			physicalLayer: pLayer,
			fps: framerate,
			forceCut,
			phys: physicalLayer,
			activeBank: 'a',
			incoming,
		})
		if (seekFrames != null && seekFrames > 0) loadOpts.seek = seekFrames

		takeJobs.push({
			layer,
			pLayer,
			clip,
			f,
			loadOpts,
			templateCg,
			pipOverlays: pipOverlaysFromLayer(layer),
		})
	}

	if (takeJobs.length === 0 && exitLayers.length === 0 && !activeTimelineIdToFadeOut) {
		return { ok: true, takeMode: 'pgm-only', layersApplied: 0, takeJobs: 0, diff: diff }
	}

	const flatMixer = []
	for (const job of takeJobs) {
		if (!job.templateCg) {
			await amcp.loadbg(channel, job.pLayer, job.clip, job.loadOpts)
		}
		flatMixer.push(...buildPgmOnlyMixerLines(job, channel, isAnimate, fadeDur, fadeTw))
	}

	if (activeTimelineIdToFadeOut && fadeDur > 0 && !forceCut) {
		const tl = self.timelineEngine.timelines.get(activeTimelineIdToFadeOut)
		if (tl) {
			const { TIMELINE_LAYER_BASE } = require('./timeline-playback-helpers')
			const { param } = require('../caspar/amcp-utils')
			let tail = `0 ${fadeDur}`
			if (fadeTw) tail += ` ${param(fadeTw)}`
			for (let li = 0; li < tl.layers.length; li++) {
				const pOut = TIMELINE_LAYER_BASE + li
				// A layer can be both exiting (old timeline) and entering (new timeline) —
				// the incoming fade-in owns it then; don't schedule a competing fade-out.
				if (timelineFadeInPhys.includes(pOut)) continue
				const cl = `${channel}-${pOut}`
				flatMixer.push(`MIXER ${cl} OPACITY ${tail} DEFER`)
			}
		}
	}

	// Incoming timeline layers were preset to opacity 0 before PLAY (WO-152 B152.1) —
	// fade them in with the same deferred batch (fired by the take's leading COMMIT).
	if (timelineFadeInPhys.length > 0 && fadeDur > 0 && !forceCut) {
		const { param } = require('../caspar/amcp-utils')
		let tail = `1 ${fadeDur}`
		if (fadeTw) tail += ` ${param(fadeTw)}`
		for (const L of timelineFadeInPhys) {
			flatMixer.push(`MIXER ${channel}-${L} OPACITY ${tail} DEFER`)
		}
	}

	if (flatMixer.length > 0) {
		await amcp.batchSendChunked(flatMixer, { skipMixerPreCommit: true })
	}

	// Timeline-only look (no takeJobs): nothing below will COMMIT the channel, so the
	// deferred fade lines above (in + out) must be fired explicitly here.
	if (takeJobs.length === 0 && (timelineFadeInPhys.length > 0 || activeTimelineIdToFadeOut)) {
		await amcp.mixerCommit(channel).catch(() => {})
	}

	if (isAnimate && fadeDur > 0 && takeJobs.length > 0) {
		await new Promise((r) => setTimeout(r, PGM_ONLY_PLAY_PREROLL_MS))
	}

	if (takeJobs.length > 0) {
		await sendStaggeredTakePlays(
			amcp,
			channel,
			takeJobs,
			(job) => (job.templateCg ? [] : [`PLAY ${channel}-${job.pLayer}`]),
			{
				leadingCommit: true,
				commitAfterSources: isAnimate && fadeDur > 0,
				commitAfterRoutes: isAnimate && fadeDur > 0,
			},
		)
		if (typeof opts.onProgramTransitionStarted === 'function' && isAnimate && fadeDur > 0) {
			try {
				opts.onProgramTransitionStarted()
			} catch (_) {}
		}
	}

	for (const job of takeJobs) {
		if (job.templateCg) continue
		try {
			playbackTracker.recordPlay(self, channel, job.pLayer, job.clip, { loop: !!job.layer.loop })
		} catch (_) {}
	}

	for (const job of takeJobs) {
		if (!job.templateCg) continue
		try {
			const clearOther = buildClearTemplateCgOnOtherProgramChannelsLines(
				channel,
				job.layer.layerNumber,
				job.templateCg,
				self,
			)
			if (clearOther.length > 0) await sendPipOverlayLinesSerial(amcp, clearOther)
			const lines = buildSceneTemplateCgAmcpLines(channel, job.layer.layerNumber, job.templateCg)
			if (lines.length > 0) {
				self.log?.(
					'info',
					`[scene-take-pgm-only] template CG layer ${job.layer.layerNumber} → ${job.templateCg.cgName}`,
				)
				await sendPipOverlayLinesSerial(amcp, lines)
			}
		} catch (e) {
			self.log?.('warn', `[scene-take-pgm-only] template CG failed: ${e?.message || e}`)
		}
	}
	if (takeJobs.some((j) => j.templateCg)) {
		await amcp.mixerCommit(channel).catch(() => {})
	}

	for (const job of takeJobs) {
		if (!job.pipOverlays?.length) continue
		try {
			const prev = currentMap.get(job.layer.layerNumber)
			const nextP = nextPipContentLayerInScene(incomingSorted, job.layer.layerNumber)
			// WO-158 T158.5: overlay placement hugs the visible (cropped) content;
			// the video layer's MIXER FILL above stays uncropped (Caspar applies CROP itself).
			const lines = buildPipOverlayAmcpLinesAll(
				job.pipOverlays,
				channel,
				job.pLayer,
				cropAdjustedFillForLayer(job.f, job.layer),
				self,
				nextP,
				prev || null,
				job.layer?.rotation ?? 0,
			)
			if (lines.length) await sendPipOverlayLinesSerial(amcp, lines)
		} catch (e) {
			self.log?.('warn', `[scene-take-pgm-only] PIP add failed: ${e?.message || e}`)
		}
	}
	if (takeJobs.some((j) => j.pipOverlays?.length)) {
		await amcp.mixerCommit(channel).catch(() => {})
	}

	if (typeof opts.onProgramTransitionStarted === 'function' && !(isAnimate && fadeDur > 0)) {
		try {
			opts.onProgramTransitionStarted()
		} catch (_) {}
	}

	if (exitLayers.length > 0 || activeTimelineIdToFadeOut) {
		if (fadeMs > 0) {
			await new Promise((r) => setTimeout(r, Math.ceil(fadeMs) + 5))
		}
		
		if (exitLayers.length > 0) {
			const teardownLines = []
			for (const layer of exitLayers) {
				const ln = Number(layer.layerNumber)
				// Same physical slot is being re-taken — Caspar already swapped on PLAY; do not clear it.
				if (Number.isFinite(ln) && incomingLayerNums.has(ln)) continue
				const pOut = physicalLayer(layer.layerNumber)
				if (isPgmAudioTrackPhysicalLayerOnChannel(self?.config, channel, pOut)) continue
				const cl = chLayerAmcp(channel, pOut)
				teardownLines.push(`CG ${cl} CLEAR`, `STOP ${cl}`, `MIXER ${cl} CLEAR`)
				try {
					const nextP = nextPipContentLayerInScene(opts.currentScene?.layers, layer.layerNumber)
					const pipN = pipOverlaysFromLayer(layer).length
					if (pipN > 0) {
						teardownLines.push(...buildPipOverlayRemoveLines(channel, pOut, nextP, pipN))
					}
				} catch (_) {}
				try {
					playbackTracker.recordStop(self, channel, pOut)
				} catch (_) {}
			}
			if (teardownLines.length > 0) {
				try {
					await sendPipOverlayLinesSerial(amcp, teardownLines)
				} catch (_) {}
				await amcp.mixerCommit(channel).catch(() => {})
			}
		}
	}

	if (activeTimelineIdToFadeOut) {
		self.timelineEngine.stop(activeTimelineIdToFadeOut)
	}

	if (takeJobs.length > 0) {
		setupLayerPlaylists(self, channel, incoming, takeJobs.map((j) => ({ layer: j.layer, pLayer: j.pLayer, clip: j.clip })))
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
		self.log?.('warn', `[scene-take-pgm-only] timersVisibility apply failed: ${e?.message || e}`)
	}

	return {
		ok: true,
		takeMode: 'pgm-only',
		layersApplied: takeJobs.length,
		takeJobs: takeJobs.length,
		diff: {
			update: diff.update.length,
			enter: diff.enter.length,
			exit: diff.exit.length,
			unchanged: diff.unchanged.length,
		},
	}
}

module.exports = { runSceneTakePgmOnly, normalizeTransitionForPgmOnly, physicalLayer, pgmOnlyMixerAnimTail }

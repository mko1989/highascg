/**
 * Standard program take: LOADBG … MIX … then PLAY per layer (Caspar FG/BG swap).
 * Replaces the former dual-bank mixer opacity crossfade (`scene-take.js`).
 *
 * Pipeline order (smooth look→look):
 * 1) Build takeJobs + exit list (no AMCP).
 * 2) Exit layers: batched MIXER OPACITY→0 DEFER + channel COMMIT (starts outgoing fade). Chunks use
 *    `skipMixerPreCommit` so pre-batch channel COMMIT cannot flush a subset of DEFER lines.
 * 3) Incoming: LOADBG → batched MIXER … DEFER for all layers (fill/effects) → clear old PIP → new PIP (MIXER … DEFER) →
 *    PLAY → one channel COMMIT (atomic incoming look).
 * 4) Wait only remaining time until exit-fade window completes, then batched STOP/CLEAR/PIP + COMMIT.
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
} = require('./pip-overlay')

/**
 * Build raw AMCP mixer command lines for a single effect (WO-22).
 * Server-side version — mirrors web/lib/effect-registry.js effectToAmcpLines().
 * @param {string} type - Effect type key
 * @param {object} params - Effect params
 * @param {string} cl - "channel-layer" string (e.g. "1-10")
 * @returns {string[]|null}
 */
function buildEffectAmcpLines(type, params, cl) {
	const p = params || {}
	switch (type) {
		case 'blend_mode':
			return [`MIXER ${cl} BLEND ${String(p.mode || 'Normal').toUpperCase()}`]
		case 'brightness':
			return [`MIXER ${cl} BRIGHTNESS ${p.value ?? 1} 0`]
		case 'contrast':
			return [`MIXER ${cl} CONTRAST ${p.value ?? 1} 0`]
		case 'saturation':
			return [`MIXER ${cl} SATURATION ${p.value ?? 1} 0`]
		case 'levels':
			return [`MIXER ${cl} LEVELS ${p.minIn ?? 0} ${p.maxIn ?? 1} ${p.gamma ?? 1} ${p.minOut ?? 0} ${p.maxOut ?? 1} 0`]
		case 'chroma_key':
			return [`MIXER ${cl} CHROMA ${p.key || 'None'} ${p.threshold ?? 0.34} ${p.softness ?? 0.44} ${p.spill ?? 1} ${p.blur ?? 0}`]
		case 'crop':
			return [`MIXER ${cl} CROP ${p.left ?? 0} ${p.top ?? 0} ${p.right ?? 1} ${p.bottom ?? 1} 0`]
		case 'clip_mask':
			return [`MIXER ${cl} CLIP ${p.left ?? 0} ${p.top ?? 0} ${p.width ?? 1} ${p.height ?? 1} 0`]
		case 'perspective':
			return [`MIXER ${cl} PERSPECTIVE ${p.ulX ?? 0} ${p.ulY ?? 0} ${p.urX ?? 1} ${p.urY ?? 0} ${p.lrX ?? 1} ${p.lrY ?? 1} ${p.llX ?? 0} ${p.llY ?? 1} 0`]
		case 'grid':
			return [`MIXER ${cl} GRID ${p.resolution ?? 2} 0`]
		case 'keyer':
			return [`MIXER ${cl} KEYER ${p.enabled ? 1 : 0}`]
		case 'rotation':
			// Rotation is already handled by the base mixerLines (layer.rotation).
			// Only apply if this effect's degrees differs from 0 (i.e. used as an additive effect).
			return [`MIXER ${cl} ROTATION ${p.degrees ?? 0} 0`]
		case 'anchor':
			// Anchor is already handled by base mixerLines as ANCHOR 0 0; effect overrides it.
			return [`MIXER ${cl} ANCHOR ${p.x ?? 0} ${p.y ?? 0} 0`]
		default:
			return null
	}
}

function clipPath(layer) {
	const v = layer.source && layer.source.value
	return v != null ? String(v) : ''
}

function chLayerAmcp(channel, layer) {
	const c = parseInt(channel, 10)
	return `${c}-${parseInt(layer, 10)}`
}

function extFromPath(filename) {
	if (!filename || typeof filename !== 'string') return ''
	const base = filename.split(/[/\\]/).pop() || ''
	const i = base.lastIndexOf('.')
	return i < 0 ? '' : base.slice(i + 1).toLowerCase()
}

const STRAIGHT_ALPHA_STILL_EXT = new Set(['png', 'webp', 'tiff', 'tif', 'tga'])

function shouldApplyStraightAlphaKeyer(clip, straightAlpha) {
	if (!straightAlpha) return false
	const ext = extFromPath(clip)
	return STRAIGHT_ALPHA_STILL_EXT.has(ext)
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
 * @param {{ self: object, channel: number, currentScene: object|null, incomingScene: object, framerate?: number, forceCut?: boolean }} opts
 */
async function runSceneTakeLbg(amcp, opts) {
	const {
		diffScenes,
		layerHasContent,
		normalizeTransition,
		physicalProgramLayer,
		normalizeProgramLayerBank,
		layerVisuallyEqual,
		resolveChannelFramerateForMixerTween,
		persistProgramLayerBanks,
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

	// Outgoing media must include both:
	// - layers removed from incoming look (diff.exit)
	// - layers whose source changed (diff.update -> previous/current layer on active bank)
	// Otherwise old clips on the active bank survive and stack with the new look.
	const exitCandidates = [...(diff.exit || [])]
	for (const updatedIncoming of diff.update || []) {
		const prev = currentMap.get(updatedIncoming.layerNumber)
		if (layerHasContent(prev)) exitCandidates.push(prev)
	}

	// Stop timelines that are exiting (present in current look but not in incoming)
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
	// Consistent look-to-look behavior: if there is an existing look on this channel and transition duration > 0,
	// use bank crossfade path regardless of whether diff classified a source as "update".
	const shouldRunBankCrossfade = fadeDur > 0 && currentMap.size > 0
	/** When exit opacity fade starts (for teardown timing vs incoming load). */
	let fadeClockStart = /** @type {number | null} */ (null)

	/** @type {Array<{ layer: object, pLayer: number, clip: string, f: object, mixerLines: string[], targetOpacity: number, loadOpts: object, loadPlan: object|null, playPlan: object|null, pipOverlays: object[] }>} */
	const takeJobs = []

	for (const layer of incomingSorted) {
		if (layer.source && layer.source.type === 'timeline') {
			const tlId = layer.source.value
			if (tlId && self.timelineEngine) {
				const screenIdx = require('./scene-transition').programChannelToScreenIdx(self.config, channel)
				self.timelineEngine.setSendTo({ preview: true, program: true, screenIdx })
				self.timelineEngine.setLoop(tlId, !!layer.loop)
				self.timelineEngine.play(tlId, 0)
			}
			continue
		}
		const clip = clipPath(layer)
		if (!clip) continue

		const cur = currentMap.get(layer.layerNumber)
		if (layerVisuallyEqual(cur, layer)) continue
		if (layerHasContent(cur) && String(cur?.source?.type || '') !== 'timeline') {
			exitCandidates.push(cur)
		}

		const pLayer = phys(Number(layer.layerNumber), inactiveBank)
		const f = await getResolvedFillForSceneLayer(self, layer, channel, incoming)
		const cl = chLayerAmcp(channel, pLayer)
		const af = audioRouteToAudioFilter(layer.audioRoute || '1+2')

		const loadOpts = { loop: !!layer.loop }
		if (af) loadOpts.audioFilter = af
		if (layer.playSeekFrames != null && Number.isFinite(Number(layer.playSeekFrames))) {
			loadOpts.seek = Math.max(0, Math.floor(Number(layer.playSeekFrames)))
		}
		if (!shouldRunBankCrossfade && !forceCut && globalT.duration > 0 && globalT.type && String(globalT.type).toUpperCase() !== 'CUT') {
			loadOpts.transition = globalT.type
			loadOpts.duration = globalT.duration
			loadOpts.tween = globalT.tween
		}

		const keyer = shouldApplyStraightAlphaKeyer(clip, !!layer.straightAlpha) ? 1 : 0
		const vol = layer.muted ? 0 : layer.volume != null ? layer.volume : 1
		const mixerLines = []

		if (f.x !== 0 || f.y !== 0 || f.scaleX !== 1 || f.scaleY !== 1) {
			mixerLines.push(`MIXER ${cl} FILL ${f.x} ${f.y} ${f.scaleX} ${f.scaleY} 0`)
		}
		if (layer.rotation) {
			mixerLines.push(`MIXER ${cl} ROTATION ${layer.rotation} 0`)
		}
		if (layer.opacity != null && layer.opacity !== 1) {
			mixerLines.push(`MIXER ${cl} OPACITY ${layer.opacity} 0`)
		}
		const targetOpacity = layer.opacity != null ? Number(layer.opacity) : 1
		const pOutSame = phys(Number(layer.layerNumber), activeBank)
		// Caspar layer z-order: higher layer number is on top.
		// If incoming is below outgoing, incoming opacity tween is invisible; we must tween outgoing instead.
		const incomingStartsHidden = shouldRunBankCrossfade && !(pOutSame > pLayer)
		if (incomingStartsHidden) {
			mixerLines.push(`MIXER ${cl} OPACITY 0 0`)
		}
		if (keyer === 1) {
			mixerLines.push(`MIXER ${cl} KEYER 1`)
		}
		if (vol !== 1) {
			mixerLines.push(`MIXER ${cl} VOLUME ${vol}`)
		}

		if (Array.isArray(layer.effects)) {
			for (const fx of layer.effects) {
				const lines = buildEffectAmcpLines(fx.type, fx.params || {}, cl)
				if (lines) mixerLines.push(...lines)
			}
		}

		for (let i = 0; i < mixerLines.length; i++) {
			mixerLines[i] = deferMixerAmcpLine(mixerLines[i])
		}

		// Seek belongs on LOADBG only. PLAY without a clip only swaps FG/BG — Caspar 2.6 rejects PLAY … SEEK 0 in that form with “File not found” / 404 PLAY FAILED.
		const loadPlans = diffCasparLayerPlan(
			{ channel, layer: pLayer, nextUp: null, playing: false },
			{
				channel,
				layer: pLayer,
				nextUp: {
					clip,
					loop: !!loadOpts.loop,
					seek: loadOpts.seek,
					length: loadOpts.length,
					filter: loadOpts.filter,
					audioFilter: loadOpts.audioFilter,
					transition: loadOpts.transition
						? {
							type: loadOpts.transition,
							durationFrames: loadOpts.duration,
							tween: loadOpts.tween,
							direction: loadOpts.direction,
						}
						: null,
				},
				playing: false,
			},
			{ fps: framerate }
		)
		const playPlans = diffCasparLayerPlan(
			{ channel, layer: pLayer, nextUp: { clip }, playing: false },
			{ channel, layer: pLayer, nextUp: { clip }, playing: true },
			{ fps: framerate }
		)

		takeJobs.push({
			layer,
			pLayer,
			clip,
			f,
			mixerLines,
			targetOpacity,
			incomingStartsHidden,
			loadOpts,
			loadPlan: loadPlans.find((p) => p.commandName === 'LOADBG') || null,
			playPlan: playPlans.find((p) => p.commandName === 'PLAY') || null,
			pipOverlays: pipOverlaysFromLayer(layer),
		})
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

	// --- Exit fade first so outgoing layers start dimming while incoming LOADBG/PLAY runs (smooth crossfade). ---
	if (exitMedia.length > 0 && fadeDur > 0 && !shouldRunBankCrossfade) {
		const fadeLines = []
		for (const layer of exitMedia) {
			const pOut = phys(Number(layer.layerNumber), activeBank)
			if (fadeWatcher) fadeWatcher.cancel(channel, pOut)
			const cl = `${channel}-${pOut}`
			let p = `0 ${fadeDur}`
			if (fadeTw) p += ` ${param(fadeTw)}`
			fadeLines.push(`MIXER ${cl} OPACITY ${p} DEFER`)
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
	} else if (exitMedia.length > 0) {
		for (const layer of exitMedia) {
			const pOut = phys(Number(layer.layerNumber), activeBank)
			if (fadeWatcher) fadeWatcher.cancel(channel, pOut)
		}
	}

	// --- Incoming look: LOADBG → mixer → strip old PIP → new PIP (MIXER DEFER) → PLAY → commit (atomic). ---
	if (takeJobs.length > 0) {
		for (const job of takeJobs) {
			await amcp.mixerClear(channel, job.pLayer).catch(() => {})
			if (job.loadPlan) {
				logPlannedCommand(self, 'load', job.layer.layerNumber, job.loadPlan)
				await amcp.loadbg(job.loadPlan.channel, job.loadPlan.layer, job.loadPlan.clip, job.loadPlan.opts)
			}
		}

		const flatMixer = takeJobs.flatMap((j) => j.mixerLines)
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

		// Pre-buffer delay: when crossfade path animates incoming opacity from 0->1,
		// give decoder a bit more headroom to avoid mid-ramp "pop in" on some stills.
		const needsIncomingFadePreroll = shouldRunBankCrossfade && takeJobs.some((j) => j.incomingStartsHidden)
		const prebufferMs = needsIncomingFadePreroll ? 180 : 80
		await new Promise((r) => setTimeout(r, prebufferMs))

		for (const job of takeJobs) {
			if (job.playPlan) {
				logPlannedCommand(self, 'play', job.layer.layerNumber, job.playPlan)
				await amcp.play(job.playPlan.channel, job.playPlan.layer, job.playPlan.clip, job.playPlan.opts)
			}
		}

		// One channel commit — deferred video + PIP mixers apply with the PLAY swap (no early PIP geometry pop).
		try {
			await amcp.mixerCommit(channel)
		} catch (_) {}
		if (shouldRunBankCrossfade) {
			const crossfadeLines = []
			const handledOut = new Set()
			for (const job of takeJobs) {
				const pOut = phys(Number(job.layer.layerNumber), activeBank)
				const pIn = job.pLayer
				// Paired outgoing layer is handled by the in/out decision for this logical layer.
				handledOut.add(pOut)
				if (job.incomingStartsHidden) {
					// Incoming is on top: tween incoming up.
					const clIn = `${channel}-${pIn}`
					let p = `${job.targetOpacity} ${fadeDur}`
					if (fadeTw) p += ` ${param(fadeTw)}`
					crossfadeLines.push(`MIXER ${clIn} OPACITY ${p} DEFER`)
				} else if (pOut > pIn) {
					// Outgoing is on top: tween outgoing down to reveal incoming below.
					const clOut = `${channel}-${pOut}`
					let p = `0 ${fadeDur}`
					if (fadeTw) p += ` ${param(fadeTw)}`
					crossfadeLines.push(`MIXER ${clOut} OPACITY ${p} DEFER`)
				}
			}
			for (const layer of exitMedia) {
				const pOut = phys(Number(layer.layerNumber), activeBank)
				if (handledOut.has(pOut)) continue
				const clOut = `${channel}-${pOut}`
				let p = `0 ${fadeDur}`
				if (fadeTw) p += ` ${param(fadeTw)}`
				crossfadeLines.push(`MIXER ${clOut} OPACITY ${p} DEFER`)
			}
			if (crossfadeLines.length > 0) {
				try {
					await amcp.batchSendChunked(crossfadeLines, { skipMixerPreCommit: true })
					await amcp.mixerCommit(channel)
					fadeClockStart = Date.now()
				} catch (_) {}
			}
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

	// --- Teardown exiting layers after overlap: wait only remaining time from exit-fade start, then STOP/CLEAR/PIP. ---
	if (exitMedia.length > 0) {
		let teardownWait = 0
		if (fadeClockStart != null && fadeDur > 0) {
			teardownWait = Math.max(0, fadeMs - (Date.now() - fadeClockStart))
		}
		if (teardownWait > 0) {
			await new Promise((r) => setTimeout(r, Math.ceil(teardownWait) + 5))
		}

		const teardownLines = []
		for (const layer of exitMedia) {
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
		if (teardownLines.length > 0) {
			try {
				await sendPipOverlayLinesSerial(amcp, teardownLines)
			} catch (_) {}
		}
		try {
			await amcp.mixerCommit(channel)
		} catch (_) {}
	}

	self.programLayerBankByChannel[chKey] = inactiveBank
	persistProgramLayerBanks(self)

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

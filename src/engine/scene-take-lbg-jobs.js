'use strict'

const { getResolvedFillForSceneLayer } = require('./scene-native-fill')
const { audioRouteToAudioFilter, resolveConfigProgramLayoutForChannel, routeSourceChannelsToAudioFilter } = require('./audio-route')
const { deferMixerAmcpLine, param } = require('../caspar/amcp-utils')
const { buildClipCommandPlan } = require('../caspar/amcp-command-plan')
const { diffCasparLayerPlan } = require('../caspar/amcp-layer-diff-plan')
const { sceneLayerRotationMixerLines, fillForSceneLayerRotationAnchor } = require('./scene-layer-rotation-amcp')
const { pipOverlaysFromLayer } = require('./pip-overlay')
const { buildSceneTemplateCgSpec } = require('./scene-template-cg')
const {
	clipPath,
	resolveSceneClipForAmcp,
	chLayerAmcp,
	shouldApplyStraightAlphaKeyer,
	buildEffectAmcpLines,
} = require('./scene-take-lbg-helpers')

const {
	layerHasContent,
	isLayerAnimateTakeTransition,
	baseTypeStripAnimateSuffix,
} = require('./scene-transition')
const { resolvePlaySeekFramesForSceneLayer } = require('./scene-play-seek')

async function buildTakeJobs(opts) {
	const {
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
		isMergeTransition = false,
		globalT,
		framerate,
		skipLayerVisualEquality = false,
	} = opts

	const takeJobs = []
	const extraExitCandidates = []
	/** Timeline physical layers preset to 0 by startSceneTimelineLayer — the caller MUST fade them in (WO-152 B152.1). */
	const timelineFadeInPhys = []

	for (const layer of incomingSorted) {
		if (layer.source && layer.source.type === 'timeline') {
			const tlId = layer.source.value
			if (tlId && self.timelineEngine) {
				const screenIdx = require('./scene-transition').programChannelToScreenIdx(self.config, channel)
				// Merge transitions keep the plain-play path (no preset) — their fade batches never run.
				const fadeDur =
					forceCut || isMergeTransition || !(globalT?.duration > 0) ? 0 : globalT.duration
				const { startSceneTimelineLayer } = require('./timeline-take')
				const fadeIn = await startSceneTimelineLayer(self, amcp, channel, layer, {
					fadeDur,
					screenIdx,
					startAtCurrentPosition: false,
				})
				timelineFadeInPhys.push(...fadeIn)
			}
			continue
		}
		let clipRaw = clipPath(layer)
		if (layer.source && String(layer.source.type || '') === 'live_audio') {
			const slot = parseInt(String(layer.source.value || '1'), 10) || 1
			const { resolveLiveAudioRouteString, resolveLiveAudioPlayClip } = require('../config/live-audio-input')
			clipRaw =
				resolveLiveAudioRouteString(self.config, slot) ||
				resolveLiveAudioPlayClip(self.config, slot) ||
				clipRaw
		}
		/** Manual list only: advance index after we know this layer will get a take job (no-op takes must not consume a step). */
		let pendingManualPlaylistAdvance = null
		if (layer.sourceMode === 'list' && Array.isArray(layer.playlist) && layer.playlist.length > 0) {
			self.playlistActiveIndices = self.playlistActiveIndices || {}
			const pKey = `${incoming.id}-${layer.layerNumber}`
			if (layer.playlistAdvance === 'manual') {
				let idx = self.playlistActiveIndices[pKey] || 0
				if (idx < 0 || idx >= layer.playlist.length) idx = 0
				clipRaw = layer.playlist[idx].value
				pendingManualPlaylistAdvance = {
					pKey,
					idx,
					len: layer.playlist.length,
					loop: layer.playlistLoop !== false,
				}
			} else {
				// auto advance starts at index 0 on fresh take (unchanged vs old order)
				self.playlistActiveIndices[pKey] = 0
				clipRaw = layer.playlist[0].value
			}
		}
		let clip = clipRaw
		let browserCgUrl = null
		if (
			layer.source &&
			layer.source.type === 'browser' &&
			layer.source.browserAsCg === true &&
			/^https?:\/\//i.test(String(clipRaw || '').trim())
		) {
			browserCgUrl = String(clipRaw).trim()
			clip = '[HTML] black'
		}
		if (!clip) continue
		clip = resolveSceneClipForAmcp(clip, self)

		const templateCg = buildSceneTemplateCgSpec(layer, clip, self)

		const cur = currentMap.get(layer.layerNumber)
		const hasOutgoingOnAir = layerHasContent(cur)
		const diffs = skipLayerVisualEquality
			? { _: 'skipLayerVisualEquality' }
			: require('./scene-transition').layerVisuallyEqual(cur, layer, true)
		if (Object.keys(diffs).length === 0) {
			continue
		}
		if (pendingManualPlaylistAdvance) {
			const { pKey, idx, len, loop } = pendingManualPlaylistAdvance
			let nextIdx = idx + 1
			if (loop) {
				nextIdx = nextIdx % len
			} else {
				nextIdx = Math.min(nextIdx, len - 1)
			}
			self.playlistActiveIndices[pKey] = nextIdx
		}
		if (cur && typeof self.log === 'function') {
			self.log('info', `[buildTakeJobs] layer ${layer.layerNumber} changed. Diffs: ${JSON.stringify(Object.keys(diffs))}`)
			if (diffs.source) {
				self.log('info', `  Source: cur=${JSON.stringify(diffs.source.cur)}, inc=${JSON.stringify(diffs.source.inc)}`)
			}
			if (diffs.fill) {
				self.log('info', `  Fill: cur=${JSON.stringify(diffs.fill.cur)}, inc=${JSON.stringify(diffs.fill.inc)}`)
			}
		}
		if (layerHasContent(cur) && String(cur?.source?.type || '') !== 'timeline') {
			extraExitCandidates.push(cur)
		}

		const isMerge = isLayerAnimateTakeTransition(globalT.type)
		// Bank crossfade: inactive bank. +Animate: same physical layer as on-air (no A/B swap).
		const pLayer = isMerge
			? phys(Number(layer.layerNumber), activeBank)
			: phys(Number(layer.layerNumber), inactiveBank)
		const f = await getResolvedFillForSceneLayer(self, layer, channel, incoming)
		const cl = chLayerAmcp(channel, pLayer)
		let af
		if (String(clip || '').startsWith('route://')) {
			// Whole-channel routes (route://N) and layer routes (route://N-L) both carry the source channel.
			const routeMatch = String(clip).match(/^route:\/\/(\d+)(?:-\d+)?(?:\s|$)/)
			const sourceChannel = routeMatch ? Number(routeMatch[1]) : null
			const sourceLayout = sourceChannel != null ? resolveConfigProgramLayoutForChannel(self.config, sourceChannel) : null
			af = sourceLayout ? routeSourceChannelsToAudioFilter(layer.routeSourceAudio, sourceLayout) : null
		} else {
			af = audioRouteToAudioFilter(layer.audioRoute || '1+2', resolveConfigProgramLayoutForChannel(self.config, channel))
		}

		let isLoop = !!layer.loop
		if (layer.sourceMode === 'list' && Array.isArray(layer.playlist) && layer.playlist.length === 1) {
			const firstItem = layer.playlist[0]
			const isImg = firstItem.type === 'image' || /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(firstItem.value)
			if (!isImg && layer.playlistLoop !== false) {
				isLoop = true
			}
		}
		// Multi-item list: never use per-item LOOP token; list looping is handled by advance machinery via playlistLoop.
		if (layer.sourceMode === 'list' && Array.isArray(layer.playlist) && layer.playlist.length > 1) {
			isLoop = false
		}
		const loadOpts = { loop: isLoop }
		if (af) loadOpts.audioFilter = af
		const seekFrames = resolvePlaySeekFramesForSceneLayer(layer, self, {
			channel,
			layerNumber: layer.layerNumber,
			physicalLayer: pLayer,
			fps: framerate,
			forceCut,
			phys,
			activeBank,
			incoming,
		})
		if (seekFrames != null) loadOpts.seek = seekFrames
		const baseType = isMerge ? baseTypeStripAnimateSuffix(globalT.type) : globalT.type

		// Bank A/B crossfade uses paired MIXER OPACITY — not LOADBG MIX. +Animate: transition on PLAY only.
		if (
			!shouldRunBankCrossfade &&
			!isMerge &&
			!forceCut &&
			globalT.duration > 0 &&
			globalT.type &&
			String(globalT.type).toUpperCase() !== 'CUT'
		) {
			loadOpts.transition = baseType
			loadOpts.duration = globalT.duration
			loadOpts.tween = globalT.tween
		}
		const hasLoadTransition = !!loadOpts.transition && Number(loadOpts.duration) > 0 && String(loadOpts.transition).toUpperCase() !== 'CUT'

		const keyer = shouldApplyStraightAlphaKeyer(clip, !!layer.straightAlpha) ? 1 : 0
		const vol = layer.muted ? 0 : layer.volume != null ? layer.volume : 1
		const mixerLines = []
		let fillTail = '0'
		if (isMerge && globalT.duration > 0) {
			fillTail = String(globalT.duration)
			if (globalT.tween) fillTail += ` ${param(globalT.tween)}`
		}

		// Bank B (+100) stacks above bank A — only pre-hide when incoming is the top layer.
		const incomingIsAboveOutgoing =
			shouldRunBankCrossfade && inactiveBank === 'b' && activeBank === 'a'
		const isEnterOnly = !hasOutgoingOnAir
		// New layers (not in leaving look) always fade in; replace-below reveals through outgoing fade.
		const incomingStartsHidden =
			shouldRunBankCrossfade && (incomingIsAboveOutgoing || isEnterOnly)
		// Hide off-air top bank before FILL/PLAY so geometry changes are not visible on program.
		if (incomingStartsHidden) {
			mixerLines.push(`MIXER ${cl} OPACITY 0 0`)
		}

		// Always emit FILL: fill-canvas (and similar) often resolves to 0,0,1,1 — skipping looks like an
		// "identity" no-op but leaves the previous clip's MIXER FILL on the layer until something else overwrites it.
		const rot = layer.rotation ?? 0
		const casparFill = fillForSceneLayerRotationAnchor(f, rot)
		mixerLines.push(`MIXER ${cl} FILL ${casparFill.x} ${casparFill.y} ${casparFill.scaleX} ${casparFill.scaleY} ${fillTail}`)
		mixerLines.push(...sceneLayerRotationMixerLines(cl, rot))
		const targetOpacity = layer.opacity != null ? Number(layer.opacity) : 1
		if (!incomingStartsHidden && layer.opacity != null && layer.opacity !== 1) {
			mixerLines.push(`MIXER ${cl} OPACITY ${layer.opacity} 0`)
		}
		// Important: pre-hide for crossfade must be immediate (non-DEFER) before PLAY.
		// If we DEFER this together with "OPACITY 1 <dur>", Caspar may only honor the
		// final state at COMMIT and the fade appears as a hard cut.
		const prePlayOpacityZeroLine = incomingStartsHidden ? `MIXER ${cl} OPACITY 0 0` : null
		// Incoming below outgoing on a replaced slot: full opacity before PLAY (revealed when top fades out).
		const prePlayOpacityFullLine =
			shouldRunBankCrossfade && !incomingIsAboveOutgoing && hasOutgoingOnAir
				? `MIXER ${cl} OPACITY ${targetOpacity} 0`
				: null
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
			const line = String(mixerLines[i] || '')
			// Keep FILL + ANCHOR immediate so geometry/pivot apply before PLAY and are not gated by COMMIT.
			if (/^\s*MIXER\s+\d+-\d+\s+(FILL|ANCHOR)\b/i.test(line)) continue
			mixerLines[i] = deferMixerAmcpLine(line)
		}

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
					auto: !!loadOpts.auto,
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
		const useLoadAuto = false
		let playPlan = templateCg ? null : useLoadAuto ? null : playPlans.find((p) => p.commandName === 'PLAY') || null
		if (
			!templateCg &&
			isMerge &&
			globalT.duration > 0 &&
			baseType &&
			String(baseType).toUpperCase() !== 'CUT'
		) {
			playPlan = buildClipCommandPlan('PLAY', channel, pLayer, clip, {
				loop: !!loadOpts.loop,
				transition: baseType,
				duration: globalT.duration,
				tween: globalT.tween,
			})
		}

		takeJobs.push({
			layer,
			pLayer,
			clip,
			browserCgUrl,
			f,
			mixerLines,
			targetOpacity,
			incomingIsAboveOutgoing,
			isEnterOnly,
			hasOutgoingOnAir,
			incomingStartsHidden,
			prePlayOpacityZeroLine,
			prePlayOpacityFullLine,
			useLoadAuto,
			loadOpts,
			isMerge,
			hasLoadTransition,
			loadPlan: templateCg ? null : loadPlans.find((p) => p.commandName === 'LOADBG') || null,
			playPlan,
			templateCg,
			pipOverlays: pipOverlaysFromLayer(layer),
		})
	}

	return { takeJobs, extraExitCandidates, timelineFadeInPhys }
}

module.exports = { buildTakeJobs }

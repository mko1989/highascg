'use strict'

const { getResolvedFillForSceneLayer } = require('./scene-native-fill')
const { audioRouteToAudioFilter } = require('./audio-route')
const { deferMixerAmcpLine } = require('../caspar/amcp-utils')
const { diffCasparLayerPlan } = require('../caspar/amcp-layer-diff-plan')
const { pipOverlaysFromLayer } = require('./pip-overlay')
const {
	clipPath,
	chLayerAmcp,
	shouldApplyStraightAlphaKeyer,
	buildEffectAmcpLines,
} = require('./scene-take-lbg-helpers')

const {
	layerVisuallyEqual,
	layerHasContent,
	isLayerAnimateTakeTransition,
	baseTypeStripAnimateSuffix,
} = require('./scene-transition')

async function buildTakeJobs(opts) {
	const {
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
	} = opts

	const takeJobs = []
	const extraExitCandidates = []

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
		let clipRaw = clipPath(layer)
		if (layer.sourceMode === 'list' && Array.isArray(layer.playlist) && layer.playlist.length > 0) {
			self.playlistActiveIndices = self.playlistActiveIndices || {}
			const pKey = `${incoming.id}-${layer.layerNumber}`
			if (layer.playlistAdvance === 'manual') {
				let idx = self.playlistActiveIndices[pKey] || 0
				if (idx < 0 || idx >= layer.playlist.length) idx = 0
				clipRaw = layer.playlist[idx].value
				
				// Advance the index for the next Take trigger
				let nextIdx = idx + 1
				if (layer.playlistLoop !== false) {
					nextIdx = nextIdx % layer.playlist.length
				} else {
					nextIdx = Math.min(nextIdx, layer.playlist.length - 1)
				}
				self.playlistActiveIndices[pKey] = nextIdx
			} else {
				// auto advance starts at index 0 on fresh take
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

		const cur = currentMap.get(layer.layerNumber)
		const diffs = require('./scene-transition').layerVisuallyEqual(cur, layer, true)
		if (Object.keys(diffs).length === 0) {
			continue
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
		// Prepare incoming content on the inactive bank. Mixer state is layer-wide in
		// CasparCG, so preparing on the active PGM layer would move the foreground.
		const pLayer = isMerge ? Number(layer.layerNumber) : phys(Number(layer.layerNumber), inactiveBank)
		const f = await getResolvedFillForSceneLayer(self, layer, channel, incoming)
		const cl = chLayerAmcp(channel, pLayer)
		const af = audioRouteToAudioFilter(layer.audioRoute || '1+2')

		const loadOpts = { loop: !!layer.loop }
		if (af) loadOpts.audioFilter = af
		if (layer.playSeekFrames != null && Number.isFinite(Number(layer.playSeekFrames))) {
			loadOpts.seek = Math.max(0, Math.floor(Number(layer.playSeekFrames)))
		}
		const baseType = isMerge ? baseTypeStripAnimateSuffix(globalT.type) : globalT.type

		if (!forceCut && globalT.duration > 0 && globalT.type && String(globalT.type).toUpperCase() !== 'CUT') {
			loadOpts.transition = baseType
			loadOpts.duration = globalT.duration
			loadOpts.tween = globalT.tween
		}
		const hasLoadTransition = !!loadOpts.transition && Number(loadOpts.duration) > 0 && String(loadOpts.transition).toUpperCase() !== 'CUT'

		const keyer = shouldApplyStraightAlphaKeyer(clip, !!layer.straightAlpha) ? 1 : 0
		const vol = layer.muted ? 0 : layer.volume != null ? layer.volume : 1
		const mixerLines = []
		const fillTail = isMerge ? `${globalT.duration}` : '0'

		// Always emit FILL: fill-canvas (and similar) often resolves to 0,0,1,1 — skipping looks like an
		// "identity" no-op but leaves the previous clip's MIXER FILL on the layer until something else overwrites it.
		mixerLines.push(`MIXER ${cl} FILL ${f.x} ${f.y} ${f.scaleX} ${f.scaleY} ${fillTail}`)
		if (layer.rotation) {
			mixerLines.push(`MIXER ${cl} ROTATION ${layer.rotation} 0`)
		}
		const targetOpacity = layer.opacity != null ? Number(layer.opacity) : 1
		// For bank crossfades the incoming side must be controlled by mixer
		// opacity too; LOADBG AUTO can finish before the layer is visible.
		const incomingStartsHidden = shouldRunBankCrossfade && !hasLoadTransition
		if (isMerge) {
			mixerLines.push(`MIXER ${cl} OPACITY ${targetOpacity} ${globalT.duration}`)
		} else if (!incomingStartsHidden && layer.opacity != null && layer.opacity !== 1) {
			mixerLines.push(`MIXER ${cl} OPACITY ${layer.opacity} 0`)
		}
		// Important: pre-hide for crossfade must be immediate (non-DEFER) before PLAY.
		// If we DEFER this together with "OPACITY 1 <dur>", Caspar may only honor the
		// final state at COMMIT and the fade appears as a hard cut.
		const prePlayOpacityZeroLine = incomingStartsHidden ? `MIXER ${cl} OPACITY 0 0` : null
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
			// Keep FILL immediate so geometry is applied before PLAY and not gated by COMMIT.
			// This removes "... FILL ... DEFER" from take logs as requested.
			if (!isMerge && /^\s*MIXER\s+\d+-\d+\s+FILL\b/i.test(line)) continue
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

		takeJobs.push({
			layer,
			pLayer,
			clip,
			browserCgUrl,
			f,
			mixerLines,
			targetOpacity,
			incomingStartsHidden,
			prePlayOpacityZeroLine,
			useLoadAuto,
			loadOpts,
			isMerge,
			hasLoadTransition,
			loadPlan: (layer.source && layer.source.type === 'template') ? null : (loadPlans.find((p) => p.commandName === 'LOADBG') || null),
			playPlan: useLoadAuto ? null : (playPlans.find((p) => p.commandName === 'PLAY') || null),
			pipOverlays: pipOverlaysFromLayer(layer),
		})
	}

	return { takeJobs, extraExitCandidates }
}

module.exports = { buildTakeJobs }

/**
 * Standard program take: LOADBG … MIX … then PLAY per layer (Caspar FG/BG swap).
 * Replaces the former dual-bank mixer opacity crossfade (`scene-take.js`).
 */

'use strict'

const playbackTracker = require('../state/playback-tracker')
const { getResolvedFillForSceneLayer } = require('./scene-native-fill')
const { audioRouteToAudioFilter } = require('./audio-route')
const { mixerEffectNeutralLines } = require('./timeline-playback-helpers')
const { buildPipOverlayAmcpLines, buildPipOverlayRemoveLines, sendPipOverlayLinesSerial } = require('./pip-overlay')

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
	const phys = (sceneLn, bank) => physicalProgramLayer(sceneLn, bank)

	const fadeWatcher = self.clipEndFadeWatcher || null
	if (fadeWatcher) fadeWatcher.cancelChannel(channel)

	const framerate = resolveChannelFramerateForMixerTween(self, channel, opts.framerate)
	const incomingSorted = [...layersWithContent].sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))

	for (const layer of incomingSorted) {
		if (layer.source && layer.source.type === 'timeline') {
			throw new Error('Mixing timeline and media in one look is not supported — use timeline-only looks or media-only')
		}
		const clip = clipPath(layer)
		if (!clip) continue

		const cur = currentMap.get(layer.layerNumber)
		if (layerVisuallyEqual(cur, layer)) continue

		const pLayer = phys(Number(layer.layerNumber), activeBank)
		const f = await getResolvedFillForSceneLayer(self, layer, channel, incoming)
		const cl = chLayerAmcp(channel, pLayer)
		const af = audioRouteToAudioFilter(layer.audioRoute || '1+2')

		const loadOpts = { loop: !!layer.loop }
		if (af) loadOpts.audioFilter = af
		if (layer.playSeekFrames != null && Number.isFinite(Number(layer.playSeekFrames))) {
			loadOpts.seek = Math.max(0, Math.floor(Number(layer.playSeekFrames)))
		}
		if (!forceCut && globalT.duration > 0 && globalT.type && String(globalT.type).toUpperCase() !== 'CUT') {
			loadOpts.transition = globalT.type
			loadOpts.duration = globalT.duration
			loadOpts.tween = globalT.tween
		}

		await amcp.loadbg(channel, pLayer, clip, loadOpts)

		const keyer = shouldApplyStraightAlphaKeyer(clip, !!layer.straightAlpha) ? 1 : 0
		const vol = layer.muted ? 0 : layer.volume != null ? layer.volume : 1
		// Reset WO-22 mixer transforms that persist on the layer (crop, color, etc.); omitted effects must not linger.
		const mixerLines = [
			...mixerEffectNeutralLines(cl),
			`MIXER ${cl} ANCHOR 0 0`,
			`MIXER ${cl} FILL ${f.x} ${f.y} ${f.scaleX} ${f.scaleY} 0`,
			`MIXER ${cl} ROTATION ${layer.rotation ?? 0} 0`,
			`MIXER ${cl} OPACITY ${layer.opacity ?? 1} 0`,
			`MIXER ${cl} KEYER ${keyer}`,
			`MIXER ${cl} VOLUME ${vol}`,
		]

		// Append mixer effect commands from layer.effects[] (WO-22)
		if (Array.isArray(layer.effects)) {
			for (const fx of layer.effects) {
				const lines = buildEffectAmcpLines(fx.type, fx.params || {}, cl)
				if (lines) mixerLines.push(...lines)
			}
		}

		await amcp.batchSend(mixerLines)

		const playOpts = {}
		if (af) playOpts.audioFilter = af
		if (layer.playSeekFrames != null && Number.isFinite(Number(layer.playSeekFrames))) {
			playOpts.seek = Math.max(0, Math.floor(Number(layer.playSeekFrames)))
		}
		await amcp.play(channel, pLayer, undefined, playOpts)
		await amcp.mixerCommit(channel)

		// PIP overlay: apply HTML template on overlay layer (WO-25)
		if (layer.pipOverlay?.type) {
			try {
				const overlayLines = buildPipOverlayAmcpLines(layer.pipOverlay, channel, pLayer, f, self)
				if (overlayLines.length > 0) {
					await sendPipOverlayLinesSerial(amcp, overlayLines)
					await amcp.mixerCommit(channel)
				}
			} catch (e) {
				self.log?.('warn', `PIP overlay layer ${pLayer}: ${e?.message || e}`)
			}
		} else {
			// No overlay requested — clear any leftover from previous take
			try {
				const removeLines = buildPipOverlayRemoveLines(channel, pLayer)
				await sendPipOverlayLinesSerial(amcp, removeLines)
			} catch (_) {}
		}

		try {
			playbackTracker.recordPlay(self, channel, pLayer, clip, { loop: !!layer.loop })
		} catch (_) {}

		// WO-25: schedule fade-out before clip end (duration from CLS/CINF/cache, else ffprobe on media disk path)
		const foe = layer.fadeOnEnd
		if (fadeWatcher && foe?.enabled && !layer.loop) {
			let durationMs = playbackTracker.resolveClipDurationMs(self, clip)
			if (!durationMs || durationMs <= 0) {
				durationMs = await playbackTracker.resolveClipDurationMsWithDiskProbe(self, clip)
			}
			if (durationMs && durationMs > 0) {
				fadeWatcher.schedule(channel, pLayer, durationMs, foe.frames || 12, framerate)
			} else if (self.log) {
				self.log(
					'warn',
					`[ClipEndFade] no duration for "${String(clip).slice(0, 80)}" — fade-on-end skipped (CINF + cache + state media + disk probe all missed; check Caspar id vs library)`,
				)
			}
		}
	}

	for (const layer of diff.exit) {
		if (!layerHasContent(layer)) continue
		const t = String(layer.source?.type || '')
		if (t === 'timeline') continue
		const pOut = phys(Number(layer.layerNumber), activeBank)
		if (fadeWatcher) fadeWatcher.cancel(channel, pOut)
		try {
			await amcp.stop(channel, pOut)
			try {
				playbackTracker.recordStop(self, channel, pOut)
			} catch (_) {}
		} catch (_) {}
		try {
			await amcp.mixerClear(channel, pOut)
		} catch (_) {}
		// Clean up PIP overlay layer if it existed (WO-25)
		try {
			const removeLines = buildPipOverlayRemoveLines(channel, pOut)
			await sendPipOverlayLinesSerial(amcp, removeLines)
		} catch (_) {}
	}
	await amcp.mixerCommit(channel)

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

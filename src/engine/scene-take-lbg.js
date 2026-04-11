/**
 * Standard program take: LOADBG … MIX … then PLAY per layer (Caspar FG/BG swap).
 * Replaces the former dual-bank mixer opacity crossfade (`scene-take.js`).
 */

'use strict'

const playbackTracker = require('../state/playback-tracker')
const { getResolvedFillForSceneLayer } = require('./scene-native-fill')
const { audioRouteToAudioFilter } = require('./audio-route')

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
		const f = await getResolvedFillForSceneLayer(self, layer, channel)
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
		const mixerLines = [
			`MIXER ${cl} ANCHOR 0 0`,
			`MIXER ${cl} FILL ${f.x} ${f.y} ${f.scaleX} ${f.scaleY} 0`,
			`MIXER ${cl} ROTATION ${layer.rotation ?? 0} 0`,
			`MIXER ${cl} OPACITY ${layer.opacity ?? 1} 0`,
			`MIXER ${cl} KEYER ${keyer}`,
			`MIXER ${cl} VOLUME ${vol}`,
		]
		await amcp.batchSend(mixerLines, { force: true })

		const playOpts = {}
		if (af) playOpts.audioFilter = af
		if (layer.playSeekFrames != null && Number.isFinite(Number(layer.playSeekFrames))) {
			playOpts.seek = Math.max(0, Math.floor(Number(layer.playSeekFrames)))
		}
		await amcp.play(channel, pLayer, undefined, playOpts)
		await amcp.mixerCommit(channel)

		try {
			playbackTracker.recordPlay(self, channel, pLayer, clip, { loop: !!layer.loop })
		} catch (_) {}
	}

	for (const layer of diff.exit) {
		if (!layerHasContent(layer)) continue
		const t = String(layer.source?.type || '')
		if (t === 'timeline') continue
		const pOut = phys(Number(layer.layerNumber), activeBank)
		try {
			await amcp.stop(channel, pOut)
			try {
				playbackTracker.recordStop(self, channel, pOut)
			} catch (_) {}
		} catch (_) {}
		try {
			await amcp.mixerClear(channel, pOut)
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

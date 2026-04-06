/**
 * Program look take — AMCP batch load + bank crossfade (split from scene-transition for T6.1).
 * @see companion-module-casparcg-server/src/scene-transition.js runSceneTake
 */

'use strict'

const { MAX_BATCH_COMMANDS } = require('../caspar/amcp-batch')
const playbackTracker = require('../state/playback-tracker')
const { getResolvedFillForSceneLayer } = require('./scene-native-fill')
const { audioRouteToAudioFilter } = require('./audio-route')

function clipPath(layer) {
	const v = layer.source && layer.source.value
	return v != null ? String(v) : ''
}

function amcpParam(str) {
	if (str == null || str === '') return ''
	const s = String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
	return /\s/.test(s) ? `"${s}"` : s
}

function chLayerAmcp(channel, layer) {
	const c = parseInt(channel, 10)
	return `${c}-${parseInt(layer, 10)}`
}

function mixerOpacityLine(channel, layer, opacity, duration, tween) {
	const cl = chLayerAmcp(channel, layer)
	let p = String(opacity)
	if (duration != null && duration !== undefined) p += ` ${duration}`
	if (tween) p += ` ${amcpParam(tween)}`
	return `MIXER ${cl} OPACITY ${p}`
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
async function runSceneTake(amcp, opts) {
	const {
		diffScenes,
		layerHasContent,
		normalizeTransition,
		resolveChannelFramerateForMixerTween,
		physicalProgramLayer,
		normalizeProgramLayerBank,
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

	const framerate = Math.max(1, resolveChannelFramerateForMixerTween(self, channel, opts.framerate))
	const forceCut = !!opts.forceCut
	const globalT = normalizeTransition(incoming.defaultTransition, forceCut)
	const diff = diffScenes(opts.currentScene || null, incoming)

	const currentMap = new Map()
	for (const l of opts.currentScene?.layers || []) {
		if (layerHasContent(l)) {
			const ln = Number(l.layerNumber)
			if (Number.isFinite(ln)) currentMap.set(ln, l)
		}
	}
	const isFirstTake = currentMap.size === 0

	const chKey = String(channel)
	if (!self.programLayerBankByChannel) self.programLayerBankByChannel = {}
	const activeBank = normalizeProgramLayerBank(self.programLayerBankByChannel[chKey])
	const inactiveBank = activeBank === 'a' ? 'b' : 'a'
	const phys = (sceneLn, bank) => physicalProgramLayer(sceneLn, bank)

	const incomingSorted = [...layersWithContent].sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))

	/** Inverse of physicalProgramLayer for layers tracked on the active PGM bank (playback matrix keys). */
	function logicalFromPhysicalOnActiveBank(phys) {
		if (!Number.isFinite(phys)) return null
		if (activeBank === 'a') {
			if (phys >= 1 && phys <= 99) return phys
			return null
		}
		if (phys >= 110 && phys <= 199) return phys - 100
		return null
	}

	function logicalNumsFromPlaybackOnActiveBank() {
		const out = new Set()
		const prefix = `${channel}-`
		for (const key of Object.keys(self._playbackMatrix || {})) {
			if (!key.startsWith(prefix)) continue
			const phys = parseInt(key.slice(prefix.length), 10)
			const logical = logicalFromPhysicalOnActiveBank(phys)
			if (logical != null) out.add(logical)
		}
		return out
	}

	function fadeOutLogicalNums() {
		const s = new Set()
		for (const ln of currentMap.keys()) {
			if (Number.isFinite(ln)) s.add(ln)
		}
		for (const l of incomingSorted) {
			const ln = Number(l.layerNumber)
			if (Number.isFinite(ln)) s.add(ln)
		}
		// Layer rows removed from the look (present in previous JSON, absent in incoming) must still be cleared on Caspar.
		const incomingLayerNums = new Set(
			(incoming?.layers || []).map((l) => Number(l.layerNumber)).filter(Number.isFinite)
		)
		for (const l of opts.currentScene?.layers || []) {
			const ln = Number(l.layerNumber)
			if (!Number.isFinite(ln)) continue
			if (!incomingLayerNums.has(ln)) s.add(ln)
		}
		// Orphans: still playing on active bank but not in the new look (live JSON may have dropped the row).
		const incomingWithContentNums = new Set(
			incomingSorted.map((l) => Number(l.layerNumber)).filter(Number.isFinite)
		)
		for (const ln of logicalNumsFromPlaybackOnActiveBank()) {
			if (!incomingWithContentNums.has(ln)) s.add(ln)
		}
		return [...s].sort((a, b) => a - b)
	}

	const outNums = fadeOutLogicalNums()
	const playbackOnActive = logicalNumsFromPlaybackOnActiveBank()
	/** First take with empty live scene skips crossfade unless Caspar still has PGM layers on the active bank. */
	const shouldRunBankCrossfade =
		outNums.length > 0 && (!isFirstTake || playbackOnActive.size > 0)

	const layerBatches = []
	for (const layer of incomingSorted) {
		if (layer.source && layer.source.type === 'timeline') {
			throw new Error('Mixing timeline and media in one look is not supported — use timeline-only looks or media-only')
		}
		const clip = clipPath(layer)
		if (!clip) continue
		const pLayer = phys(Number(layer.layerNumber), inactiveBank)
		const f = await getResolvedFillForSceneLayer(self, layer, channel)
		const targetOp = layer.opacity ?? 1
		const opStart = isFirstTake ? targetOp : 0
		const keyer = shouldApplyStraightAlphaKeyer(clip, !!layer.straightAlpha) ? 1 : 0
		const cl = chLayerAmcp(channel, pLayer)
		
		const af = audioRouteToAudioFilter(layer.audioRoute || '1+2')
		const afConfig = af ? ` AF ${amcpParam(af)}` : ''

		const playLine = `PLAY ${cl} ${amcpParam(clip)}${layer.loop ? ' LOOP' : ''}${afConfig}`
		const vol = layer.muted ? 0 : layer.volume != null ? layer.volume : 1
		const buildLines = [
			`STOP ${cl}`,
			`MIXER ${cl} CLEAR`,
			playLine,
			`MIXER ${cl} ANCHOR 0 0`,
			`MIXER ${cl} FILL ${f.x} ${f.y} ${f.scaleX} ${f.scaleY} 0`,
			`MIXER ${cl} ROTATION ${layer.rotation ?? 0} 0`,
			`MIXER ${cl} OPACITY ${opStart} 0`,
			`MIXER ${cl} KEYER ${keyer}`,
			`MIXER ${cl} VOLUME ${vol}`,
		]
		layerBatches.push({ layer, pLayer, clip, buildLines })
	}

	const loadLineCount = layerBatches.reduce((n, b) => n + b.buildLines.length, 0)
	if (loadLineCount > 0) {
		if (loadLineCount <= MAX_BATCH_COMMANDS) {
			await amcp.batchSend(layerBatches.flatMap((b) => b.buildLines), { force: true })
		} else {
			for (const b of layerBatches) {
				await amcp.batchSend(b.buildLines, { force: true })
			}
		}
		for (const b of layerBatches) {
			if (self) {
				try {
					playbackTracker.recordPlay(self, channel, b.pLayer, b.clip, { loop: !!b.layer.loop })
				} catch (_) {}
			}
		}
	}

	await amcp.mixerCommit(channel)

	const fadeDur = forceCut || globalT.duration <= 0 ? 0 : globalT.duration
	const fadeTw = fadeDur > 0 ? globalT.tween : undefined

	if (shouldRunBankCrossfade) {
		const crossfadeLines = []
		for (const ln of outNums) {
			const pOut = phys(ln, activeBank)
			crossfadeLines.push(mixerOpacityLine(channel, pOut, 0, fadeDur, fadeTw))
		}
		for (const layer of incomingSorted) {
			const pIn = phys(Number(layer.layerNumber), inactiveBank)
			crossfadeLines.push(mixerOpacityLine(channel, pIn, layer.opacity ?? 1, fadeDur, fadeTw))
		}
		if (crossfadeLines.length > 0) {
			await amcp.batchSend(crossfadeLines, { force: true })
		}
		await amcp.mixerCommit(channel)

		if (fadeDur > 0) {
			const fadeMs = (fadeDur / framerate) * 1000
			await new Promise((resolve) => setTimeout(resolve, fadeMs + 5))
		}

		for (const ln of outNums) {
			const pOut = phys(ln, activeBank)
			try {
				await amcp.stop(channel, pOut)
				if (self) {
					try {
						playbackTracker.recordStop(self, channel, pOut)
					} catch (_) {}
				}
			} catch (_) {}
			try {
				await amcp.mixerClear(channel, pOut)
			} catch (_) {}
		}
		await amcp.mixerCommit(channel)
	}

	self.programLayerBankByChannel[chKey] = inactiveBank
	persistProgramLayerBanks(self)

	return {
		ok: true,
		diff: {
			update: diff.update.length,
			enter: diff.enter.length,
			exit: diff.exit.length,
			unchanged: diff.unchanged.length,
		},
	}
}

module.exports = { runSceneTake }

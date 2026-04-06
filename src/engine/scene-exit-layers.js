/**
 * Fade out exiting layers, then stop/clear (shared by scene take + timeline-only take).
 * @see companion-module-casparcg-server/src/scene-transition.js
 */

'use strict'

const { MAX_BATCH_COMMANDS } = require('../caspar/amcp-batch')
const { getChannelMap } = require('../config/routing')
const liveSceneState = require('../state/live-scene-state')
const { normalizeProgramLayerBank } = require('./program-layer-bank')
const playbackTracker = require('../state/playback-tracker')

/** Same as scene-transition physicalProgramLayer (avoid require cycle with scene-transition). */
const PGM_BANK_B_OFFSET = 100

function physicalProgramLayer(sceneLayerNum, bank) {
	const n = parseInt(sceneLayerNum, 10)
	if (!Number.isFinite(n)) return 10
	return bank === 'b' ? n + PGM_BANK_B_OFFSET : n
}

function layerHasContent(l) {
	return !!(l && l.source && l.source.value)
}

/** Caspar layers used by looks: bank A 1–99, bank B 110–199. Timeline uses 100+ (leave 100–109 alone). */
function isLookPhysicalLayer(L) {
	return (L >= 1 && L <= 99) || (L >= 110 && L <= 199)
}

/**
 * Scene layer rows that actually load into look stack slots (not timeline-only rows).
 * @param {object} layer
 * @returns {boolean}
 */
function sceneLayerOccupiesLookSlot(layer) {
	if (!layerHasContent(layer)) return false
	const t = String(layer.source?.type || '')
	if (t === 'timeline') return false
	return t === 'file' || t === 'template' || t === 'media'
}

/**
 * Look-stack layers that should be cleared: AMCP matrix + OSC + persisted live PGM look (no brute-force 1–199).
 * @param {{ _playbackMatrix?: object, config?: object, programLayerBankByChannel?: object }} self
 * @param {number} ch
 * @returns {number[]}
 */
function collectOccupiedLookLayersOnChannel(self, ch) {
	const set = new Set()
	const matrix = self?._playbackMatrix || {}
	const prefix = `${ch}-`
	for (const key of Object.keys(matrix)) {
		if (!key.startsWith(prefix)) continue
		const ln = parseInt(key.slice(prefix.length), 10)
		if (isLookPhysicalLayer(ln)) set.add(ln)
	}
	for (const ln of playbackTracker.getOccupiedLayerNumbersFromOsc(self, ch)) {
		if (isLookPhysicalLayer(ln)) set.add(ln)
	}
	const map = getChannelMap(self?.config || {})
	const programs = map.programChannels || []
	if (programs.includes(ch)) {
		const entry = liveSceneState.getChannel(ch)
		const scene = entry?.scene
		const bank = normalizeProgramLayerBank(self?.programLayerBankByChannel?.[String(ch)])
		for (const layer of scene?.layers || []) {
			if (!sceneLayerOccupiesLookSlot(layer)) continue
			const phys = physicalProgramLayer(layer.layerNumber, bank)
			if (isLookPhysicalLayer(phys)) set.add(phys)
		}
	}
	return [...set].sort((a, b) => a - b)
}

/**
 * Physical Caspar layers used by program looks: bank A 1–99, bank B 110–199 (see scene-transition PGM_BANK_B_OFFSET).
 * Timeline output uses 100+ (TIMELINE_LAYER_BASE); clearing occupied look layers removes looks without touching the 100–109 corridor.
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number|string} channel
 * @param {{ _playbackMatrix?: object, config?: object, programLayerBankByChannel?: object }} [self]
 */
async function clearSceneProgramLookStackLayers(amcp, channel, self) {
	const ch = parseInt(channel, 10)
	if (!Number.isFinite(ch) || ch < 1) return

	const layers = collectOccupiedLookLayersOnChannel(self || {}, ch)
	if (layers.length === 0) return

	const chunkSize = Math.floor(MAX_BATCH_COMMANDS / 2)
	for (let i = 0; i < layers.length; i += chunkSize) {
		const chunk = layers.slice(i, i + chunkSize)
		const lines = []
		for (const L of chunk) {
			const cl = `${ch}-${L}`
			lines.push(`STOP ${cl}`, `MIXER ${cl} CLEAR`)
		}
		if (lines.length === 0) continue
		try {
			await amcp.batchSend(lines, { force: true })
			if (self) {
				for (const L of chunk) {
					try {
						playbackTracker.recordStop(self, ch, L)
					} catch (_) {}
				}
			}
		} catch {
			for (const L of chunk) {
				try {
					await amcp.stop(ch, L)
				} catch (_) {}
				try {
					await amcp.mixerClear(ch, L)
				} catch (_) {}
				if (self) {
					try {
						playbackTracker.recordStop(self, ch, L)
					} catch (_) {}
				}
			}
		}
		await amcp.mixerCommit(ch)
	}
}

async function fadeExitLayerOpacities(amcp, channel, exitLayers, globalT, forceCut) {
	if (exitLayers.length === 0) return
	const dur = forceCut ? 0 : globalT.duration
	const tw = forceCut ? undefined : globalT.tween
	for (const layer of exitLayers) {
		await amcp.mixerOpacity(channel, layer.layerNumber, 0, dur, tw)
	}
}

async function runExitLayersStopAndClear(amcp, channel, exitLayers, framerate, globalT, forceCut, self) {
	const fadeMs = forceCut || globalT.duration <= 0 ? 0 : (globalT.duration / framerate) * 1000
	if (exitLayers.length === 0) return
	await new Promise((resolve) => {
		setTimeout(async () => {
			try {
				for (const layer of exitLayers) {
					try {
						await amcp.stop(channel, layer.layerNumber)
						if (self) {
							try {
								playbackTracker.recordStop(self, channel, layer.layerNumber)
							} catch (_) {}
						}
					} catch {}
					try {
						await amcp.mixerClear(channel, layer.layerNumber)
					} catch {}
				}
				await amcp.mixerCommit(channel)
			} catch {}
			resolve()
		}, fadeMs + 5)
	})
}

async function runExitLayers(amcp, channel, exitLayers, framerate, globalT, forceCut, self) {
	await fadeExitLayerOpacities(amcp, channel, exitLayers, globalT, forceCut)
	await runExitLayersStopAndClear(amcp, channel, exitLayers, framerate, globalT, forceCut, self)
}

module.exports = {
	fadeExitLayerOpacities,
	runExitLayersStopAndClear,
	runExitLayers,
	clearSceneProgramLookStackLayers,
	collectOccupiedLookLayersOnChannel,
}

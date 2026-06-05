/**
 * Fade out exiting layers, then stop/clear (shared by scene take + timeline-only take).
 * @see companion-module-casparcg-server/src/scene-transition.js
 */

'use strict'

const { resolveMaxBatchCommands } = require('../caspar/amcp-batch')
const { param } = require('../caspar/amcp-utils')
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

/** Caspar layers used by looks: bank A 1–99, bank B 110–199. Timeline uses 200+ (TIMELINE_LAYER_BASE). */
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
	const previews = (map.previewChannels || []).map((p) => Number(p)).filter((n) => Number.isFinite(n) && n > 0)
	const useLiveSceneLayers = programs.includes(ch) || previews.includes(ch)
	if (useLiveSceneLayers) {
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

function logicalLayerFromPhysicalLookLayer(phys) {
	const n = parseInt(phys, 10)
	if (!Number.isFinite(n) || !isLookPhysicalLayer(n)) return null
	return n >= 110 ? n - PGM_BANK_B_OFFSET : n
}

function physicalLookLayerBank(phys) {
	const n = parseInt(phys, 10)
	if (!Number.isFinite(n)) return null
	if (n >= 1 && n <= 99) return 'a'
	if (n >= 110 && n <= 199) return 'b'
	return null
}

/**
 * Logical look layers still on Caspar (matrix/OSC/live) but absent from the incoming look.
 * Covers stale PGM when live JSON already matches the new look before take runs.
 * @param {{ _playbackMatrix?: object, config?: object, programLayerBankByChannel?: object }} self
 * @param {number} ch
 * @param {object} incomingScene
 * @returns {number[]}
 */
function collectOrphanLookLogicalLayers(self, ch, incomingScene) {
	const incomingNums = new Set(
		(incomingScene?.layers || [])
			.filter(layerHasContent)
			.map((l) => Number(l.layerNumber))
			.filter(Number.isFinite),
	)
	const orphans = new Set()
	for (const phys of collectOccupiedLookLayersOnChannel(self, ch)) {
		const logical = logicalLayerFromPhysicalLookLayer(phys)
		if (logical != null && !incomingNums.has(logical)) orphans.add(logical)
	}
	return [...orphans].sort((a, b) => a - b)
}

/**
 * STOP/CLEAR specific look-stack physical layers (both banks).
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number} ch
 * @param {number[]} physicalLayers
 * @param {object} [self]
 */
async function clearPhysicalLookLayers(amcp, ch, physicalLayers, self) {
	const layers = (physicalLayers || []).filter((L) => isLookPhysicalLayer(L))
	if (layers.length === 0) return
	const lines = []
	for (const L of layers) {
		const cl = `${ch}-${L}`
		lines.push(`STOP ${cl}`, `MIXER ${cl} CLEAR`)
	}
	try {
		await amcp.batchSend(lines)
		if (self) {
			for (const L of layers) {
				try {
					playbackTracker.recordStop(self, ch, L)
				} catch (_) {}
			}
		}
	} catch {
		for (const L of layers) {
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

/**
 * Remove look-stack layers on the inactive bank that are not in the incoming look (not on air).
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number} ch
 * @param {'a'|'b'} inactiveBank
 * @param {object} incomingScene
 * @param {object} [self]
 */
async function clearStaleInactiveBankLookLayers(amcp, ch, inactiveBank, incomingScene, self) {
	const incomingNums = new Set(
		(incomingScene?.layers || [])
			.filter(layerHasContent)
			.map((l) => Number(l.layerNumber))
			.filter(Number.isFinite),
	)
	const stale = []
	for (const phys of collectOccupiedLookLayersOnChannel(self || {}, ch)) {
		if (physicalLookLayerBank(phys) !== inactiveBank) continue
		const logical = logicalLayerFromPhysicalLookLayer(phys)
		if (logical != null && !incomingNums.has(logical)) stale.push(phys)
	}
	await clearPhysicalLookLayers(amcp, ch, stale, self)
}

/**
 * Physical Caspar layers used by program looks: bank A 1–99, bank B 110–199 (see scene-transition PGM_BANK_B_OFFSET).
 * Timeline output uses TIMELINE_LAYER_BASE (200+); clearing occupied look layers removes looks without touching timeline slots.
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number|string} channel
 * @param {{ _playbackMatrix?: object, config?: object, programLayerBankByChannel?: object }} [self]
 */
async function clearSceneProgramLookStackLayers(amcp, channel, self) {
	const ch = parseInt(channel, 10)
	if (!Number.isFinite(ch) || ch < 1) return

	const layers = collectOccupiedLookLayersOnChannel(self || {}, ch)
	if (layers.length === 0) return

	const chunkSize = Math.floor(resolveMaxBatchCommands(amcp._context) / 2)
	for (let i = 0; i < layers.length; i += chunkSize) {
		const chunk = layers.slice(i, i + chunkSize)
		const lines = []
		for (const L of chunk) {
			const cl = `${ch}-${L}`
			lines.push(`STOP ${cl}`, `MIXER ${cl} CLEAR`)
		}
		if (lines.length === 0) continue
		try {
			await amcp.batchSend(lines)
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

/**
 * Fade all exiting layers together: DEFER opacity tweens, then one channel COMMIT (no per-layer stepping).
 * Uses physical Caspar layer from scene layer + current program bank.
 * @param {{ programLayerBankByChannel?: object } | null | undefined} self
 */
async function fadeExitLayerOpacities(amcp, channel, exitLayers, globalT, forceCut, self) {
	if (exitLayers.length === 0) return
	const dur = forceCut ? 0 : globalT.duration
	const tw = forceCut ? undefined : globalT.tween
	if (!dur || dur <= 0) return

	const ch = parseInt(channel, 10)
	const bank = normalizeProgramLayerBank(self?.programLayerBankByChannel?.[String(ch)])
	const lines = []
	for (const layer of exitLayers) {
		const pL = physicalProgramLayer(Number(layer.layerNumber), bank)
		const cl = `${ch}-${pL}`
		let p = '0'
		p += ` ${dur}`
		if (tw) p += ` ${param(tw)}`
		lines.push(`MIXER ${cl} OPACITY ${p} DEFER`)
	}
	await amcp.batchSendChunked(lines, { skipMixerPreCommit: true })
	await amcp.mixerCommit(channel)
}

async function runExitLayersStopAndClear(amcp, channel, exitLayers, framerate, globalT, forceCut, self) {
	const fadeMs = forceCut || globalT.duration <= 0 ? 0 : (globalT.duration / framerate) * 1000
	if (exitLayers.length === 0) return
	const ch = parseInt(channel, 10)
	const bank = normalizeProgramLayerBank(self?.programLayerBankByChannel?.[String(ch)])
	await new Promise((resolve) => {
		setTimeout(async () => {
			try {
				const lines = []
				for (const layer of exitLayers) {
					const pL = physicalProgramLayer(Number(layer.layerNumber), bank)
					const cl = `${ch}-${pL}`
					lines.push(`STOP ${cl}`, `MIXER ${cl} CLEAR`)
				}
				if (lines.length > 0) {
					await amcp.batchSendChunked(lines)
				}
				if (self) {
					for (const layer of exitLayers) {
						const pL = physicalProgramLayer(Number(layer.layerNumber), bank)
						try {
							playbackTracker.recordStop(self, channel, pL)
						} catch (_) {}
					}
				}
				await amcp.mixerCommit(channel)
			} catch {}
			resolve()
		}, fadeMs + 5)
	})
}

async function runExitLayers(amcp, channel, exitLayers, framerate, globalT, forceCut, self) {
	await fadeExitLayerOpacities(amcp, channel, exitLayers, globalT, forceCut, self)
	await runExitLayersStopAndClear(amcp, channel, exitLayers, framerate, globalT, forceCut, self)
}

module.exports = {
	fadeExitLayerOpacities,
	runExitLayersStopAndClear,
	runExitLayers,
	clearSceneProgramLookStackLayers,
	collectOccupiedLookLayersOnChannel,
	collectOrphanLookLogicalLayers,
	clearPhysicalLookLayers,
	clearStaleInactiveBankLookLayers,
	logicalLayerFromPhysicalLookLayer,
	physicalLookLayerBank,
}

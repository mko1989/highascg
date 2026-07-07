/**
 * Fade out exiting layers, then stop/clear (shared by scene take + timeline-only take).
 * @see companion-module-casparcg-server/src/scene-transition.js
 */

'use strict'

function _logDebug(self, msg) {
	if (typeof self?.log === 'function') {
		self.log('debug', `[Scene] ${msg}`)
	}
}

const { resolveMaxBatchCommands } = require('../caspar/amcp-batch')
const { param } = require('../caspar/amcp-utils')
const { getChannelMap } = require('../config/routing')
const {
	PGM_BANK_B_OFFSET,
	isLookPhysicalLayer,
	isPgmAudioTrackPhysicalLayerOnChannel,
} = require('./look-layer-ranges')
const liveSceneState = require('../state/live-scene-state')
const { normalizeProgramLayerBank } = require('./program-layer-bank')
const playbackTracker = require('../state/playback-tracker')
const { clearCasparChannel, isPreviewCasparChannel } = require('./caspar-channel-clear')

/** Same as scene-transition physicalProgramLayer (avoid require cycle with scene-transition). */
function physicalProgramLayer(sceneLayerNum, bank) {
	const n = parseInt(sceneLayerNum, 10)
	if (!Number.isFinite(n)) return 10
	return bank === 'b' ? n + PGM_BANK_B_OFFSET : n
}

function layerHasContent(l) {
	return !!(l && l.source && l.source.value)
}

function shouldSkipLookTeardownOnPhysicalLayer(self, ch, physicalLayer) {
	return isPgmAudioTrackPhysicalLayerOnChannel(self?.config, ch, physicalLayer)
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
	return t === 'file' || t === 'template' || t === 'media' || t === 'cg'
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

/**
 * @param {number} phys
 * @param {'a'|'b'|unknown} [bank] — when set, bank B maps 110→logical 10; bank A treats 110 as logical 110
 */
function logicalLayerFromPhysicalLookLayer(phys, bank) {
	const n = parseInt(phys, 10)
	if (!Number.isFinite(n) || !isLookPhysicalLayer(n)) return null
	const b = normalizeProgramLayerBank(bank ?? physicalLookLayerBank(n))
	if (b === 'b' && n >= PGM_BANK_B_OFFSET && n <= 199) return n - PGM_BANK_B_OFFSET
	return n
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
function collectOrphanLookLogicalLayers(self, ch, incomingScene, incomingBank = 'a') {
	const bank = normalizeProgramLayerBank(incomingBank)
	const incomingPhysical = new Set(
		(incomingScene?.layers || [])
			.filter(layerHasContent)
			.map((l) => physicalProgramLayer(l.layerNumber, bank))
			.filter(Number.isFinite),
	)
	const orphans = new Set()
	for (const phys of collectOccupiedLookLayersOnChannel(self, ch)) {
		if (incomingPhysical.has(phys)) continue
		const physBank = physicalLookLayerBank(phys)
		// Other bank slot (e.g. stale L110 when incoming uses L10) — clearPhysicalLookLayers handles it.
		if (physBank !== bank) continue
		const logical = logicalLayerFromPhysicalLookLayer(phys, physBank)
		if (logical != null) orphans.add(logical)
	}
	return [...orphans].sort((a, b) => a - b)
}

/**
 * Physical look-stack layers on Caspar not targeted by this take's LOADBG/PLAY jobs.
 * @param {{ _playbackMatrix?: object, config?: object, programLayerBankByChannel?: object }} self
 * @param {number} ch
 * @param {number[]} incomingPhysicalLayers
 * @returns {number[]}
 */
function collectOrphanLookPhysicalLayers(self, ch, incomingPhysicalLayers) {
	const incoming = new Set((incomingPhysicalLayers || []).filter((n) => Number.isFinite(n)))
	return collectOccupiedLookLayersOnChannel(self, ch).filter((phys) => {
		if (incoming.has(phys)) return false
		if (shouldSkipLookTeardownOnPhysicalLayer(self, ch, phys)) return false
		return true
	})
}

/**
 * STOP/CLEAR specific look-stack physical layers (both banks).
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number} ch
 * @param {number[]} physicalLayers
 * @param {object} [self]
 */
async function clearPhysicalLookLayers(amcp, ch, physicalLayers, self) {
	const layers = (physicalLayers || []).filter((L) => {
		if (!isLookPhysicalLayer(L)) return false
		if (shouldSkipLookTeardownOnPhysicalLayer(self, ch, L)) return false
		return true
	})
	if (layers.length === 0) return
	const lines = []
	for (const L of layers) {
		const cl = `${ch}-${L}`
		lines.push(`CG ${cl} CLEAR`, `STOP ${cl}`, `MIXER ${cl} CLEAR`)
	}
	try {
		await amcp.batchSend(lines)
		if (self) {
			for (const L of layers) {
				try {
					playbackTracker.recordStop(self, ch, L)
				} catch (err) {
					_logDebug(self, `recordStop ${ch}-${L} failed: ${err.message}`)
				}
			}
		}
	} catch (batchErr) {
		_logDebug(self, `batchSend clear failed (${ch}): ${batchErr.message}, falling back to individual stops`)
		for (const L of layers) {
			try {
				await amcp.stop(ch, L)
			} catch (stopErr) {
				_logDebug(self, `STOP ${ch}-${L} failed: ${stopErr.message}`)
			}
			try {
				await amcp.mixerClear(ch, L)
			} catch (clearErr) {
				_logDebug(self, `MIXER CLEAR ${ch}-${L} failed: ${clearErr.message}`)
			}
			if (self) {
				try {
					playbackTracker.recordStop(self, ch, L)
				} catch (recordErr) {
					_logDebug(self, `recordStop ${ch}-${L} failed: ${recordErr.message}`)
				}
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
		const logical = logicalLayerFromPhysicalLookLayer(phys, inactiveBank)
		if (logical != null && !incomingNums.has(logical)) stale.push(phys)
	}
	await clearPhysicalLookLayers(amcp, ch, stale, self)
}

/**
 * Physical Caspar layers used by program looks: bank A 10–99, bank B 110–199.
 * Layers 1–9 / 101–109 are always-on audio tracks — never cleared here.
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number|string} channel
 * @param {{ _playbackMatrix?: object, config?: object, programLayerBankByChannel?: object }} [self]
 */
async function clearSceneProgramLookStackLayers(amcp, channel, self) {
	const ch = parseInt(channel, 10)
	if (!Number.isFinite(ch) || ch < 1) return

	// Preview bus: one `CLEAR <channel>` wipes looks, timeline (200+), and CG — not layer-by-layer.
	if (isPreviewCasparChannel(self?.config, ch)) {
		await clearCasparChannel(amcp, ch, self)
		return
	}

	const layers = collectOccupiedLookLayersOnChannel(self || {}, ch).filter(
		(L) => !shouldSkipLookTeardownOnPhysicalLayer(self, ch, L),
	)
	
	// Add global border layers and any missing pip overlay slots to be safe.
	// Since taking the timeline completely takes over the screen, we must aggressively teardown the look stack.
	const layersToClear = new Set(layers)
	if (self) {
		try {
			const entry = liveSceneState.getChannel(ch)
			const sceneLayers = entry?.scene?.layers || []
			const bank = normalizeProgramLayerBank(self?.programLayerBankByChannel?.[String(ch)])
			const { pipOverlaysFromLayer, resolvePipOverlayCasparLayer } = require('./pip-overlay')
			for (const layer of sceneLayers) {
				const phys = physicalProgramLayer(layer.layerNumber, bank)
				const pipN = pipOverlaysFromLayer(layer).length
				for (let i = 0; i < pipN; i++) {
					const oR = resolvePipOverlayCasparLayer(phys, i)
					if (Number.isFinite(oR)) layersToClear.add(oR)
				}
			}
		} catch (_) {}
	}
	layersToClear.add(998)
	layersToClear.add(996)

	const layersArray = [...layersToClear].sort((a, b) => a - b)
	if (layersArray.length === 0) return

	const chunkSize = Math.floor(resolveMaxBatchCommands(amcp._context) / 3)
	for (let i = 0; i < layersArray.length; i += chunkSize) {
		const chunk = layersArray.slice(i, i + chunkSize)
		const lines = []
		for (const L of chunk) {
			const cl = `${ch}-${L}`
			lines.push(`CG ${cl} CLEAR`, `STOP ${cl}`, `MIXER ${cl} CLEAR`)
		}
		if (lines.length === 0) continue
		try {
			await amcp.batchSend(lines)
			if (self) {
				for (const L of chunk) {
					try {
						playbackTracker.recordStop(self, ch, L)
					} catch (recordErr) {
						_logDebug(self, `recordStop ${ch}-${L} failed: ${recordErr.message}`)
					}
				}
			}
		} catch (batchErr) {
			_logDebug(self, `batchSend clear failed (${ch}): ${batchErr.message}, falling back to individual stops`)
			for (const L of chunk) {
				try {
					await amcp.stop(ch, L)
				} catch (stopErr) {
					_logDebug(self, `STOP ${ch}-${L} failed: ${stopErr.message}`)
				}
				try {
					await amcp.mixerClear(ch, L)
				} catch (clearErr) {
					_logDebug(self, `MIXER CLEAR ${ch}-${L} failed: ${clearErr.message}`)
				}
				if (self) {
					try {
						playbackTracker.recordStop(self, ch, L)
					} catch (recordErr) {
						_logDebug(self, `recordStop ${ch}-${L} failed: ${recordErr.message}`)
					}
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
		if (shouldSkipLookTeardownOnPhysicalLayer(self, ch, pL)) continue
		const cl = `${ch}-${pL}`
		let p = '0'
		p += ` ${dur}`
		if (tw) p += ` ${param(tw)}`
		lines.push(`MIXER ${cl} OPACITY ${p} DEFER`)
	}
	if (lines.length === 0) return
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
					if (shouldSkipLookTeardownOnPhysicalLayer(self, ch, pL)) continue
					const cl = `${ch}-${pL}`
					lines.push(`STOP ${cl}`, `MIXER ${cl} CLEAR`)
				}
				if (lines.length > 0) {
					await amcp.batchSendChunked(lines)
				}
				if (self) {
					for (const layer of exitLayers) {
						const pL = physicalProgramLayer(Number(layer.layerNumber), bank)
						if (shouldSkipLookTeardownOnPhysicalLayer(self, ch, pL)) continue
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
	collectOrphanLookPhysicalLayers,
	clearPhysicalLookLayers,
	clearStaleInactiveBankLookLayers,
	logicalLayerFromPhysicalLookLayer,
	physicalLookLayerBank,
	isLookPhysicalLayer,
}

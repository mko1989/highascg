/**
 * List-mode playlist: OSC-driven advance, image timers, LOADBG AUTO preload.
 */

'use strict'

const { pathsMatch, normPath } = require('../state/live-scene-reconcile')
const { normalizeProgramLayerBank, physicalProgramLayer } = require('./scene-transition')

function setupLayerPlaylists(self, channel, incoming, takeJobs) {
	// Register the global OSC playlist handler on self.oscState exactly once!
	if (self.oscState && !self._playlistOscBound) {
		self._playlistOscBound = true
		self.oscState.on('change', (snapshot) => {
			handlePlaylistOscUpdate(self, snapshot)
		})
	}

	for (const job of takeJobs) {
		const layer = job.layer
		if (layer.sourceMode === 'list' && Array.isArray(layer.playlist) && layer.playlist.length > 0) {
			const pKey = `${incoming.id}-${layer.layerNumber}`
			
			// Initialize the active index to 0 for auto advance
			self.playlistActiveIndices = self.playlistActiveIndices || {}
			
			if (layer.playlistAdvance === 'auto') {
				self.playlistActiveIndices[pKey] = 0
				self.playlistOscPrevPlayingPath = self.playlistOscPrevPlayingPath || {}
				delete self.playlistOscPrevPlayingPath[pKey]

				// Clear any previous image timer for this layer
				clearPlaylistImageTimer(self, pKey)
				
				if (layer.playlist.length > 1) {
					const firstItem = layer.playlist[0]
					const isImg = firstItem.type === 'image' || /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(firstItem.value)
					
					if (isImg) {
						schedulePlaylistImageTimer(self, channel, job.pLayer, incoming, layer, 0)
					} else {
						// Video: preload the second item as LOADBG AUTO
						queueNextPlaylistItem(self, channel, job.pLayer, layer, 1)
					}
				}
			}
		}
	}
}

/**
 * Score how well a playlist entry path matches Caspar's foreground path (OSC / INFO).
 * Used so two different files with the same basename do not collapse to the same index.
 */
function scorePlaylistPathMatch(expected, playingFile) {
	const e = normPath(expected || '')
	const a = normPath(playingFile || '')
	if (!e || !a) return -1
	if (e === a) return 100000
	if (a.endsWith(e) || e.endsWith(a)) return 80000 + Math.min(e.length, a.length)
	if (pathsMatch(expected, playingFile)) return 1000 + Math.min(e.length, a.length)
	if (sameFileName(expected, playingFile)) return 100 + Math.min(e.length, a.length)
	return -1
}

/**
 * @param {object[]} playlist
 * @param {string} playingFile - path or name from Caspar OSC
 * @param {number} lastIdx - last known playlist index for this layer
 * @param {string | undefined} prevPlayingFile - foreground file from previous OSC sample for this layer
 */
function resolvePlaylistPlayingIndex(playlist, playingFile, lastIdx, prevPlayingFile) {
	if (!playingFile || !Array.isArray(playlist) || playlist.length === 0) return -1
	const scores = playlist.map((item) => scorePlaylistPathMatch(item?.value, playingFile))
	let best = -1
	for (const s of scores) {
		if (s > best) best = s
	}
	if (best < 0) return -1
	/** @type {number[]} */
	const cand = []
	for (let i = 0; i < scores.length; i++) {
		if (scores[i] === best) cand.push(i)
	}
	if (cand.length === 1) return cand[0]
	const li = Number(lastIdx) || 0
	const prevOk = prevPlayingFile != null && String(prevPlayingFile).trim().length > 0
	const changed = prevOk && normPath(prevPlayingFile) !== normPath(playingFile)
	if (changed) {
		const next = (li + 1) % playlist.length
		if (cand.includes(next)) return next
		if (cand.includes(li)) return li
		return cand[0]
	}
	if (cand.includes(li)) return li
	return cand[0]
}

function handlePlaylistOscUpdate(self, snapshot) {
	try {
		const liveSceneState = require('../state/live-scene-state')
		const activeScenes = liveSceneState.getAll()

		for (const chKey in activeScenes) {
			const channel = parseInt(chKey, 10)
			const liveEntry = activeScenes[chKey]
			if (!liveEntry || !liveEntry.scene) continue
			const scene = liveEntry.scene
			const activeBank = normalizeProgramLayerBank(self.programLayerBankByChannel?.[chKey])

			if (Array.isArray(scene.layers)) {
				for (const layer of scene.layers) {
					if (layer.sourceMode === 'list' && Array.isArray(layer.playlist) && layer.playlist.length > 0 && layer.playlistAdvance === 'auto') {
						// Find physical layer index
						const pLayer = physicalProgramLayer(Number(layer.layerNumber), activeBank)
						// Check current file in OSC snapshot
						const chOsc = snapshot.channels && snapshot.channels[chKey]
						const layerOsc = chOsc && chOsc.layers && chOsc.layers[pLayer]
						const playingFile = layerOsc && layerOsc.file && (layerOsc.file.name || layerOsc.file.path)

						if (playingFile) {
							const pKey = `${scene.id}-${layer.layerNumber}`
							self.playlistOscPrevPlayingPath = self.playlistOscPrevPlayingPath || {}
							const prevPlaying = self.playlistOscPrevPlayingPath[pKey]
							self.playlistActiveIndices = self.playlistActiveIndices || {}
							const lastIdx = self.playlistActiveIndices[pKey] ?? 0
							const itemIdx = resolvePlaylistPlayingIndex(layer.playlist, playingFile, lastIdx, prevPlaying)
							self.playlistOscPrevPlayingPath[pKey] = playingFile

							if (itemIdx >= 0) {
								if (itemIdx !== lastIdx) {
									// Advanced to the next item!
									self.playlistActiveIndices[pKey] = itemIdx
									if (typeof self.log === 'function') {
										self.log('info', `[Playlist] Layer ${layer.layerNumber} advanced to item ${itemIdx}: ${playingFile}`)
									}

									// Clear current image timers
									clearPlaylistImageTimer(self, pKey)

									const currentItem = layer.playlist[itemIdx]
									const isImg = currentItem.type === 'image' || /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(currentItem.value)

									if (isImg) {
										schedulePlaylistImageTimer(self, channel, pLayer, scene, layer, itemIdx)
									} else {
										// Video: preload the next item (with loop wrapping)
										let nextIdx = itemIdx + 1
										if (layer.playlistLoop !== false) {
											nextIdx = nextIdx % layer.playlist.length
										} else if (nextIdx >= layer.playlist.length) {
											nextIdx = -1
										}

										if (nextIdx >= 0) {
											queueNextPlaylistItem(self, channel, pLayer, layer, nextIdx)
										}
									}
								}
							}
						}
					}
				}
			}
		}
	} catch (e) {
		self.log?.('warn', `[Playlist OSC] Error: ${e?.message || e}`)
	}
}

function queueNextPlaylistItem(self, channel, pLayer, layer, nextIdx) {
	const nextItem = layer.playlist[nextIdx]
	const transition = layer.playlistTransition || { type: 'MIX', duration: 12 }
	const loadOpts = {
		auto: true,
		loop: false
	}
	if (transition.type && String(transition.type).toUpperCase() !== 'CUT') {
		loadOpts.transition = transition.type
		loadOpts.duration = transition.duration
	}
	if (typeof self.log === 'function') {
		self.log('info', `[Playlist] Preloading next item ${nextIdx} (${nextItem.value}) on ${channel}-${pLayer} with AUTO`)
	}
	self.amcp.loadbg(channel, pLayer, nextItem.value, loadOpts).catch((err) => {
		if (typeof self.log === 'function') {
			self.log('warn', `[Playlist] Preload failed on ${channel}-${pLayer}: ${err?.message || err}`)
		}
	})
}

function schedulePlaylistImageTimer(self, channel, pLayer, scene, layer, itemIdx) {
	const pKey = `${scene.id}-${layer.layerNumber}`
	clearPlaylistImageTimer(self, pKey)

	const item = layer.playlist[itemIdx]
	const durationMs = (item.duration ?? 5) * 1000

	if (typeof self.log === 'function') {
		self.log('info', `[Playlist] Scheduling image timer for item ${itemIdx} (${item.value}) on ${channel}-${pLayer} for ${durationMs}ms`)
	}

	self.playlistImageTimers = self.playlistImageTimers || {}
	self.playlistImageTimers[pKey] = setTimeout(() => {
		delete self.playlistImageTimers[pKey]

		// Advance to next
		let nextIdx = itemIdx + 1
		if (layer.playlistLoop !== false) {
			nextIdx = nextIdx % layer.playlist.length
		} else if (nextIdx >= layer.playlist.length) {
			return // Done playing once
		}

		triggerPlaylistAdvance(self, channel, pLayer, scene, layer, nextIdx)
	}, durationMs)
}

function clearPlaylistImageTimer(self, pKey) {
	if (self.playlistImageTimers && self.playlistImageTimers[pKey]) {
		clearTimeout(self.playlistImageTimers[pKey])
		delete self.playlistImageTimers[pKey]
	}
}

function triggerPlaylistAdvance(self, channel, pLayer, scene, layer, nextIdx) {
	const nextItem = layer.playlist[nextIdx]
	const transition = layer.playlistTransition || { type: 'MIX', duration: 12 }

	const loadOpts = {
		loop: false
	}
	if (transition.type && String(transition.type).toUpperCase() !== 'CUT') {
		loadOpts.transition = transition.type
		loadOpts.duration = transition.duration
	}

	if (typeof self.log === 'function') {
		self.log('info', `[Playlist] Advancing from image to item ${nextIdx} (${nextItem.value}) on ${channel}-${pLayer}`)
	}

	void (async () => {
		try {
			await self.amcp.loadbg(channel, pLayer, nextItem.value, loadOpts)
			await self.amcp.play(channel, pLayer)

			// Update index state immediately so that it triggers correctly on next update
			const pKey = `${scene.id}-${layer.layerNumber}`
			self.playlistActiveIndices = self.playlistActiveIndices || {}
			self.playlistActiveIndices[pKey] = nextIdx

			// Setup next advancement
			const isImg = nextItem.type === 'image' || /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(nextItem.value)
			if (isImg) {
				schedulePlaylistImageTimer(self, channel, pLayer, scene, layer, nextIdx)
			} else {
				let nextNextIdx = nextIdx + 1
				if (layer.playlistLoop !== false) {
					nextNextIdx = nextNextIdx % layer.playlist.length
				} else if (nextNextIdx >= layer.playlist.length) {
					nextNextIdx = -1
				}
				if (nextNextIdx >= 0) {
					queueNextPlaylistItem(self, channel, pLayer, layer, nextNextIdx)
				}
			}
		} catch (err) {
			if (typeof self.log === 'function') {
				self.log('warn', `[Playlist] Advance trigger failed on ${channel}-${pLayer}: ${err?.message || err}`)
			}
		}
	})()
}

function sameFileName(a, b) {
	if (!a || !b) return false
	const clean = (s) => {
		const parts = String(s).toLowerCase().replace(/\\/g, '/').split('/')
		const base = parts[parts.length - 1]
		return base.replace(/\.[^/.]+$/, '')
	}
	return clean(a) === clean(b)
}

module.exports = { setupLayerPlaylists }

/**
 * List-mode playlist: OSC-driven advance, image timers, LOADBG AUTO preload.
 */

'use strict'

const { resolvePlaylistPlayingIndex } = require('./playlist-path-match')
const { normalizeProgramLayerBank, physicalProgramLayer } = require('./scene-transition')
const { resolveSceneClipForAmcp } = require('./scene-take-lbg-helpers')
const { resolvePlaylistStartIndex } = require('./scene-take-playlist-start')
const { isFadeOutPlaylistItem, queuePlaylistFadeOut, scheduleFadeEndAdvance } = require('./playlist-fade-out')

/* Owner request 2026-07-26: templates/shaders/graphics in a playlist never advanced — advance was
 * OSC file/time-driven (media only) with a wall-clock timer for IMAGES only. "Timeless" now means
 * anything without a timed-media extension (images, CG templates, shaders, html graphics): those
 * advance by their item.duration timer (default 5s), exactly like images always did. */
const TIMED_MEDIA_EXT_RE = /\.(mp4|mov|mkv|avi|webm|mxf|m2ts?|ts|mpg|mpeg|m4v|mp3|wav|m4a|aac|flac|ogg)$/i
function isTimelessPlaylistItem(item) {
	if (!item) return false
	const t = String(item.type || '')
	if (t === 'image' || t === 'template' || t === 'shader' || t === 'graphic') return true
	const v = String(item.value || '')
	if (/\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(v)) return true
	return !TIMED_MEDIA_EXT_RE.test(v)
}

/* Per-item loop tick: a looped item plays with LOOP and HOLDS the playlist there — no timer, no
 * AUTO preload of the next item — until the operator advances (Next / Playlists panel). */
function isLoopedPlaylistItem(item) {
	return !!item && item.loop === true
}
/* WO-766 ↘: a timed clip that fades out at its end (a still has no end to fade at). */
const fadesOut = (item) => isFadeOutPlaylistItem(item) && !isTimelessPlaylistItem(item)

/* todos27.07.26 ROOT CAUSE of "preview played the old version": every piece of playlist runtime
 * state was keyed `${sceneId}-${layerNumber}` with NO channel — the same look live on PGM and
 * recalled on PRV shared one timer/index/prev-path slot, so the stale PRV entry's OSC pass stole
 * the hop timer and re-armed it with ITS (pre-edit) scene closure. Runtime state is now keyed by
 * channel too. (playlistStartIndices stays channel-less: it is set pre-playout, WO-347.) */
function playlistRuntimeKey(channel, sceneId, layerNumber) {
	return `${channel}:${sceneId}-${layerNumber}`
}

/* todos27.07.26 (owner): playlists RUN on program only. A preview recall shows the staged item
 * statically — no timers, no OSC-driven hops, no preloads on a PRV bus. */
function isPlaylistChannelEligible(self, channel) {
	try {
		const { isPreviewCasparChannel } = require('./caspar-channel-clear')
		return !isPreviewCasparChannel(self.config, channel)
	} catch {
		return true
	}
}

/* todos27.07.26 (owner): "the playlist continues even though its look was taken from the pgm" —
 * timers were only cleared when the SAME look restaged. Every take now wipes the channel's whole
 * playlist runtime state first, killing the outgoing look's timers. */
function clearChannelPlaylistState(self, channel) {
	const prefix = `${channel}:`
	for (const key of Object.keys(self.playlistImageTimers || {})) {
		if (key.startsWith(prefix)) clearPlaylistImageTimer(self, key)
	}
	for (const bag of [self.playlistActiveIndices, self.playlistOscPrevPlayingPath, self.playlistFadeEndArmed]) {
		if (!bag) continue
		for (const key of Object.keys(bag)) {
			if (key.startsWith(prefix)) delete bag[key]
		}
	}
}

function setupLayerPlaylists(self, channel, incoming, takeJobs) {
	clearChannelPlaylistState(self, channel)
	const runs = isPlaylistChannelEligible(self, channel)
	// Register the global OSC playlist handler on self.oscState exactly once!
	if (runs && self.oscState && !self._playlistOscBound) {
		self._playlistOscBound = true
		self.oscState.on('change', (snapshot) => {
			handlePlaylistOscUpdate(self, snapshot)
		})
	}

	for (const job of takeJobs) {
		const layer = job.layer
		if (layer.sourceMode === 'list' && Array.isArray(layer.playlist) && layer.playlist.length > 0) {
			const pKey = playlistRuntimeKey(channel, incoming.id, layer.layerNumber)
			
			self.playlistActiveIndices = self.playlistActiveIndices || {}
			/* WO-581: buildTakeJobs already staged the operator's start item (WO-347 set_start /
			 * WO-371 PRV step) — arm the chain from THAT item. Replaces the old 400 ms post-take
			 * hop, which put item 0 on air first with item 0's timer/preload already armed. */
			const startIdx = resolvePlaylistStartIndex(self, incoming.id, layer)
			/* WO-766: a ↘ start item fades at its end on PRV too — a fade is not an advance (WO-371 C). */
			if (fadesOut(layer.playlist[startIdx])) void queuePlaylistFadeOut(self, channel, job.pLayer, layer)
			if (!runs) continue
			self.playlistActiveIndices[pKey] = startIdx
			if (layer.playlistAdvance === 'auto') {
				self.playlistOscPrevPlayingPath = self.playlistOscPrevPlayingPath || {}
				delete self.playlistOscPrevPlayingPath[pKey]

				// Clear any previous image timer for this layer
				clearPlaylistImageTimer(self, pKey)
				
				if (layer.playlist.length > 1) {
					const firstItem = layer.playlist[startIdx]
					if (isLoopedPlaylistItem(firstItem)) {
						/* held on air — nothing to arm */
					} else if (isTimelessPlaylistItem(firstItem)) {
						schedulePlaylistImageTimer(self, channel, job.pLayer, incoming, layer, startIdx)
					} else if (fadesOut(firstItem)) {
						/* the fade holds the AUTO slot; the OSC pass moves on at the clip's end */
					} else {
						// Video: preload the following item as LOADBG AUTO
						let nextIdx = startIdx + 1
						if (layer.playlistLoop !== false) nextIdx %= layer.playlist.length
						if (nextIdx < layer.playlist.length) queueNextPlaylistItem(self, channel, job.pLayer, layer, nextIdx)
					}
				}
			}
		}
	}
}

function handlePlaylistOscUpdate(self, snapshot) {
	try {
		const liveSceneState = require('../state/live-scene-state')
		const activeScenes = liveSceneState.getAll()

		for (const chKey in activeScenes) {
			const channel = parseInt(chKey, 10)
			const liveEntry = activeScenes[chKey]
			if (!liveEntry || !liveEntry.scene) continue
			if (!isPlaylistChannelEligible(self, channel)) continue
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
						const playingFile =
							(layerOsc && layerOsc.file && (layerOsc.file.name || layerOsc.file.path)) ||
							/* CG/shader producers report template.path, never file.* */
							(layerOsc && layerOsc.template && String(layerOsc.template.path || '').replace(/\.html?$/i, '')) ||
							null
						/* OSC layer time lives on the file object (osc-state.js: f.elapsed / f.duration) */
						const elapsed = layerOsc?.file?.elapsed ?? undefined
						const duration = layerOsc?.file?.duration ?? undefined

						if (playingFile) {
							const pKey = playlistRuntimeKey(channel, scene.id, layer.layerNumber)
							self.playlistOscPrevPlayingPath = self.playlistOscPrevPlayingPath || {}
							const prevPlaying = self.playlistOscPrevPlayingPath[pKey]
							self.playlistActiveIndices = self.playlistActiveIndices || {}
							const lastIdx = self.playlistActiveIndices[pKey] ?? 0
							const itemIdx = resolvePlaylistPlayingIndex(layer.playlist, playingFile, lastIdx, prevPlaying)
							self.playlistOscPrevPlayingPath[pKey] = playingFile

							if (itemIdx >= 0) {
								const pTimerKey = playlistRuntimeKey(channel, scene.id, layer.layerNumber)
								if (
									isTimelessPlaylistItem(layer.playlist[itemIdx]) &&
									!isLoopedPlaylistItem(layer.playlist[itemIdx]) &&
									layer.playlist.length > 1 &&
									!(self.playlistImageTimers && self.playlistImageTimers[pTimerKey])
								) {
									// Timeless item on air with no timer armed (AUTO-promoted after a
									// video, or node restarted mid-playlist) — arm its duration timer.
									self.playlistActiveIndices[pKey] = itemIdx
									schedulePlaylistImageTimer(self, channel, pLayer, scene, layer, itemIdx)
								}
								if (itemIdx !== lastIdx) {
									// Advanced to the next item!
									self.playlistActiveIndices[pKey] = itemIdx
									if (typeof self.log === 'function') {
										self.log('info', `[Playlist] Layer ${layer.layerNumber} advanced to item ${itemIdx}: ${playingFile}`)
									}

									// Clear current image timers
									clearPlaylistImageTimer(self, pKey)

									const currentItem = layer.playlist[itemIdx]
									if (isLoopedPlaylistItem(currentItem)) {
										/* looped item: hold here until Next */
									} else if (isTimelessPlaylistItem(currentItem)) {
										schedulePlaylistImageTimer(self, channel, pLayer, scene, layer, itemIdx)
									} else if (fadesOut(currentItem)) {
										void queuePlaylistFadeOut(self, channel, pLayer, layer)
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

							/* WO-766: after a ↘ item faded out, move on by its remaining time (OSC keeps the old file fields). */
							if (itemIdx >= 0 && fadesOut(layer.playlist[itemIdx]) && layer.playlist.length > 1) {
								scheduleFadeEndAdvance(self, pKey, itemIdx, elapsed, duration, () => {
									const n = itemIdx + 1 < layer.playlist.length ? itemIdx + 1 : layer.playlistLoop !== false ? 0 : -1
									if (n >= 0) triggerPlaylistAdvance(self, channel, pLayer, scene, layer, n)
								})
							}
							// T211.5: Stall watchdog for imperfect media (video stream ends before container duration).
							// Track elapsed time progress; if near-end and frozen >2s, force-promote next item.
							if (layer.playlist.length > 1 && !isLoopedPlaylistItem(layer.playlist[itemIdx]) && !fadesOut(layer.playlist[itemIdx]) && typeof elapsed === 'number' && typeof duration === 'number' && duration > 0) {
								self.playlistElapsedTracking = self.playlistElapsedTracking || {}
								self.playlistWatchdogFiredFor = self.playlistWatchdogFiredFor || {}

								const trackKey = pKey
								const prevState = self.playlistElapsedTracking[trackKey] || {}
								const now = Date.now()
								const lastElapsedAt = prevState.lastElapsedAt ?? now
								const lastElapsed = prevState.lastElapsed ?? elapsed
								const msSinceProgress = now - lastElapsedAt

								// Re-arm watchdog when file changes
								if (prevState.lastFile !== playingFile) {
									self.playlistWatchdogFiredFor[trackKey] = false
									self.playlistElapsedTracking[trackKey] = {
										lastElapsed: elapsed,
										lastElapsedAt: now,
										lastFile: playingFile,
									}
								} else {
									// Same file: check for stall
									if (Math.abs(elapsed - lastElapsed) > 0.01) {
										// File is progressing
										self.playlistElapsedTracking[trackKey] = {
											lastElapsed: elapsed,
											lastElapsedAt: now,
											lastFile: playingFile,
										}
									} else {
										// Elapsed unchanged: check if we should fire watchdog
										const alreadyFired = !!self.playlistWatchdogFiredFor[trackKey]
										const shouldFire = shouldForceAdvance({
											elapsed,
											duration,
											lastElapsed,
											msSinceProgress,
											alreadyFired,
										})

										if (shouldFire) {
											self.playlistWatchdogFiredFor[trackKey] = true
											if (typeof self.log === 'function') {
												self.log('info', `[Playlist] stall watchdog force-advanced ch=${channel} layer=${layer.layerNumber} file=${playingFile}`)
											}
											// Force-promote: bare PLAY promotes the AUTO-preloaded bg to fg
											void (async () => {
												try {
													await self.amcp.play(channel, pLayer)
												} catch (err) {
													if (typeof self.log === 'function') {
														self.log('warn', `[Playlist] stall watchdog PLAY failed on ${channel}-${pLayer}: ${err?.message || err}`)
													}
												}
											})()
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
		loop: isLoopedPlaylistItem(nextItem)
	}
	if (transition.type && String(transition.type).toUpperCase() !== 'CUT') {
		loadOpts.transition = transition.type
		loadOpts.duration = transition.duration
	}
	if (typeof self.log === 'function') {
		self.log('info', `[Playlist] Preloading next item ${nextIdx} (${nextItem.value}) on ${channel}-${pLayer} with AUTO`)
	}
	const clip = resolveSceneClipForAmcp(nextItem.value, self)
	self.amcp.loadbg(channel, pLayer, clip, loadOpts).catch((err) => {
		if (typeof self.log === 'function') {
			self.log('warn', `[Playlist] Preload failed on ${channel}-${pLayer}: ${err?.message || err}`)
		}
	})
}

function schedulePlaylistImageTimer(self, channel, pLayer, scene, layer, itemIdx) {
	const pKey = playlistRuntimeKey(channel, scene.id, layer.layerNumber)
	clearPlaylistImageTimer(self, pKey)

	const item = layer.playlist[itemIdx]
	if (isLoopedPlaylistItem(item)) return
	const durationMs = (item.duration ?? 5) * 1000

	if (typeof self.log === 'function') {
		self.log('info', `[Playlist] Scheduling image timer for item ${itemIdx} (${item.value}) on ${channel}-${pLayer} for ${durationMs}ms`)
	}

	self.playlistImageTimers = self.playlistImageTimers || {}
	self.playlistImageTimers[pKey] = setTimeout(() => {
		delete self.playlistImageTimers[pKey]

		/* Defensive: the look may have left this channel between arm and fire — never hop a
		 * playlist whose scene is no longer live here (todos27 "playlist continues after take"). */
		try {
			const liveNow = require('../state/live-scene-state').getChannel(channel)
			if (!liveNow?.scene || String(liveNow.scene.id) !== String(scene.id)) return
		} catch {
			/* state unavailable — fire as before */
		}

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

/* WO-371 option C: stage ONE playlist item on a channel/layer with NO follow-up scheduling —
 * the preview ⏮/⏭ step path (item 27's "sits still" must stay true on PRV). PGM advancing is
 * triggerPlaylistAdvance below, which stages via this and then arms the timer/preload chain.
 * Resolves true when the item was staged, false on AMCP failure. */
function stagePlaylistItem(self, channel, pLayer, scene, layer, nextIdx) {
	const nextItem = layer.playlist[nextIdx]
	const transition = layer.playlistTransition || { type: 'MIX', duration: 12 }

	/* WO-766 (owner 25.10): Manual Next no longer loops every item (WO-224 T224.6) — only the item's own Loop does. */
	const loadOpts = { loop: isLoopedPlaylistItem(nextItem) }
	if (transition.type && String(transition.type).toUpperCase() !== 'CUT') {
		loadOpts.transition = transition.type
		loadOpts.duration = transition.duration
	}

	if (typeof self.log === 'function') {
		self.log('info', `[Playlist] Advancing from image to item ${nextIdx} (${nextItem.value}) on ${channel}-${pLayer}`)
	}

	return (async () => {
		try {
			/* Owner 2026-07-27 (two rounds): shader hops must MIX like any media (CG has no
			 * bg-transition path, so a non-CUT transition goes LOADBG/PLAY on the html file);
			 * only a CUT-configured playlist keeps the CG ADD host. The Shader Live editor
			 * compensates for the resulting plain html producer by re-hosting via CG ADD on the
			 * first 403'd UPDATE (one visible restart at edit time, mixing preserved on air). */
			const isShaderItem = /(^|\/)shaders\//i.test(String(nextItem.value || ''))
			if (isShaderItem && !loadOpts.transition) {
				await self.amcp.cgAdd(channel, pLayer, 0, String(nextItem.value).trim().toLowerCase(), 1, '{}')
			} else if (isShaderItem) {
				await self.amcp.loadbg(channel, pLayer, String(nextItem.value).trim().toLowerCase(), loadOpts)
				/* Owner 27.07: let the CEF shader render its first frame in the background before
				 * the MIX promotes it — playing immediately mixed to a blank page. */
				const warm = Math.max(0, Math.min(3000, parseInt(process.env.HIGHASCG_SHADER_WARMUP_MS || '600', 10) || 600))
				await new Promise((r) => setTimeout(r, warm))
				await self.amcp.play(channel, pLayer)
			} else {
				const clip = resolveSceneClipForAmcp(nextItem.value, self)
				await self.amcp.loadbg(channel, pLayer, clip, loadOpts)
				await self.amcp.play(channel, pLayer)
				if (fadesOut(nextItem)) await queuePlaylistFadeOut(self, channel, pLayer, layer)
			}

			// Update index state immediately so that it triggers correctly on next update
			const pKey = playlistRuntimeKey(channel, scene.id, layer.layerNumber)
			self.playlistActiveIndices = self.playlistActiveIndices || {}
			self.playlistActiveIndices[pKey] = nextIdx
			if (self.playlistFadeEndArmed) delete self.playlistFadeEndArmed[pKey]
			return true
		} catch (err) {
			if (typeof self.log === 'function') {
				self.log('warn', `[Playlist] Advance trigger failed on ${channel}-${pLayer}: ${err?.message || err}`)
			}
			return false
		}
	})()
}

function triggerPlaylistAdvance(self, channel, pLayer, scene, layer, nextIdx) {
	void stagePlaylistItem(self, channel, pLayer, scene, layer, nextIdx).then((staged) => {
		if (!staged) return
		// Setup next advancement
		const nextItem = layer.playlist[nextIdx]
		/* manual: the operator advances; a ↘ item's fade is already queued by stagePlaylistItem */
		if (isLoopedPlaylistItem(nextItem) || layer.playlistAdvance === 'manual' || fadesOut(nextItem)) return
		if (isTimelessPlaylistItem(nextItem)) {
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
	})
}

/**
 * Decide whether to force-advance due to stall watchdog (BUG 2 / T211.5).
 * Exported for unit testing.
 *
 * @param {{elapsed: number, duration: number, lastElapsed: number, msSinceProgress: number, alreadyFired: boolean}} state
 * @returns {boolean}
 */
function shouldForceAdvance(state) {
	const { elapsed, duration, lastElapsed, msSinceProgress, alreadyFired } = state
	if (!duration || duration <= 0) return false
	if (alreadyFired) return false
	if (msSinceProgress < 2000) return false
	// Near-end stall: elapsed frozen within 0.5s of duration
	const nearEnd = elapsed >= duration - 0.5
	return nearEnd
}

module.exports = {
	playlistRuntimeKey, resolvePlaylistPlayingIndex, isTimelessPlaylistItem,
	clearChannelPlaylistState, setupLayerPlaylists, fadesOut, shouldForceAdvance, handlePlaylistOscUpdate, triggerPlaylistAdvance, stagePlaylistItem }

'use strict'

const { getChannelMap } = require('../config/routing')
const {
	clipAudioRoute,
	playAfSuffix,
	timelineClipTransportStale,
	loopSeekIsSafe,
	TIMELINE_LAYER_BASE,
	timelineCasparLayer,
	normalizeTimelineSendTo,
} = require('./timeline-playback-helpers')
const { clipTransportMeta } = require('./timeline-playback-amcp-schedule')
const { opacitySegmentAtLocalMs, buildDeferredSegmentMixerLines } = require('./timeline-keyframe-mixer')

module.exports = {
	_logDebug(msg) {
		if (typeof this.self?.log === 'function') {
			this.self.log('debug', `[Timeline] ${msg}`)
		}
	},

	_validateClipStateForResume(prev, clip, meta) {
		if (!prev?.clipId || prev.clipId !== clip.id) return false
		if (prev.isRoute !== String(clip.source?.value || '').startsWith('route://')) return false
		if (prev.loopAlways !== !!clip.loopAlways) return false
		if (prev.frame !== meta.frame) return false
		return true
	},

	_canResumePlayback(id) {
		if (this._airTimelineId !== id) return false
		const cell = this._pbFor(id)
		if (cell.playing || this._prevKey.size === 0) return false
		const tl = this.timelines.get(id)
		if (!tl) return false
		const ms = cell.position ?? 0
		const channels = this._channels()
		for (let li = 0; li < tl.layers.length; li++) {
			const clip = this._clipAt(tl.layers[li], ms)
			if (!clip) continue
			for (const ch of channels) {
				const caspLayer = this._caspLayer(ch, li)
				const key = `${ch}-${caspLayer}`
				const prev = this._prevKey.get(key)
				const meta = clipTransportMeta(clip, ms, tl, this.self, {
					atEntry: false,
					channel: ch,
					physicalLayer: caspLayer,
				})
				if (!this._validateClipStateForResume(prev, clip, meta)) return false
			}
		}
		return true
	},

	_caspLayer(_ch, li) {
		return timelineCasparLayer(li, this.self?.log)
	},

	/** True when an explicit seek would change Caspar transport frame on any active layer. */
	_timelineSeekFrameChanged(id, ms) {
		const tl = this.timelines.get(id)
		if (!tl) return false
		const channels = this._channels()
		for (let li = 0; li < tl.layers.length; li++) {
			const clip = this._clipAt(tl.layers[li], ms)
			if (!clip) continue
			for (const ch of channels) {
				const caspLayer = this._caspLayer(ch, li)
				const key = `${ch}-${caspLayer}`
				const prev = this._prevKey.get(key)
				const meta = clipTransportMeta(clip, ms, tl, this.self, {
					atEntry: false,
					channel: ch,
					physicalLayer: caspLayer,
				})
				if (!prev?.clipId || prev.clipId !== clip.id) return true
				if (prev.frame !== meta.frame) return true
			}
		}
		return false
	},

	/**
	 * Full transport + mixer sync (scrub, play start, inspector edits). Not called from the UI tick.
	 * @param {string} id timeline id
	 * @param {number} ms position
	 * @param {boolean} force scrub / explicit seek — sends PLAY|LOAD|SEEK for active clips
	 */
	_applyAt(id, ms, force, opts) {
		this._syncAmcpLayers(id, ms, { force: !!force, take: !!opts?.take, takeFade: !!opts?.takeFade })
	},

	/**
	 * Called from {@link TimelineEngine#_tick} only — clip enter/exit and keyframed mixer segments.
	 * Does not PLAY/SEEK every tick (stretched clips loop via PLAY LOOP on transport start).
	 */
	_syncAmcpOnTimelineTick(id, ms) {
		this._syncAmcpLayers(id, ms, { force: false })
	},

	/**
	 * @param {string} id
	 * @param {number} ms
	 * @param {{ force?: boolean, take?: boolean }} opts — take: program take entry; lead
	 *   opacity keyframe segments are batched as DEFER tweens and the MIXER COMMIT is left
	 *   to the take orchestrator so clip fades fire frame-locked with the take crossfade (WO-139).
	 *   T173.4: per-tick keyframe segment changes are collected into per-channel batches.
	 */
	_syncAmcpLayers(id, ms, opts) {
		const tl = this.timelines.get(id)
		const self = this.self
		if (!tl || !self?.amcp) return
		const force = !!opts.force
		const take = !!opts.take
		/* WO-545: a take orchestrator's exit fade owns this timeline's opacity for the whole
		 * teardown wait, not just the entry apply that already passed `takeFade` — fold the hold
		 * in for every regular tick too (`_syncAmcpOnTimelineTick` never passes takeFade itself).
		 * `_applyKeyedMixerProp` (WO-528/WO-544) already suppresses both write paths under
		 * `takeFade`; this just widens WHEN that suppression applies for this one timeline. */
		const takeFade = !!opts.takeFade || this._opacityExitHoldId === id
		const channels = this._channels()
		const playing = this._airTimelineId === id && (this._pbFor(id).playing ?? false)
		const mixerDirty = new Set()
		const channelLines = new Map() // T173.4: collect MIXER lines per channel

		for (let li = 0; li < tl.layers.length; li++) {
			const layer = tl.layers[li]
			const clip = this._clipAt(layer, ms)

			for (const ch of channels) {
				const caspLayer = this._caspLayer(ch, li)
				const key = `${ch}-${caspLayer}`
				const prev = this._prevKey.get(key)

				if (clip) {
					const transportStale = timelineClipTransportStale(prev, clip)
					const atEntry = transportStale && !force
					const transportOpts = { atEntry, channel: ch, physicalLayer: caspLayer }
					const meta = clipTransportMeta(clip, ms, tl, self, transportOpts)
					/* Extending a clip past its media length mid-air flips implicitLoop (same for a
					 * clip.loop toggle), but none of the timelineClipTransportStale fields change —
					 * Caspar was started without LOOP and blanks at file end while the engine still
					 * thinks the clip is active (todos06.08). Re-send the transport when the loop
					 * requirement changes on a playing timeline. */
					const loopStale =
						playing &&
						!!prev &&
						!transportStale &&
						prev.clipId === clip.id &&
						((prev.implicitLoop ?? false) !== !!meta.implicitLoop ||
							(prev.loopClip ?? false) !== !!meta.loopClip)
					const needsFullTransport = transportStale || loopStale || (force && playing)
					/* WO-536: `!meta.loopAlways` used to be one of these conditions, so scrubbing a
					 * paused looping clip sent NOTHING — the picture never moved, `transportSent`
					 * stayed false, and the `_prevKey` write below kept the pre-scrub frame. That
					 * staleness then failed `_validateClipStateForResume`, so the next play() took
					 * the full-transport path and restarted the producer: the owner's black frame
					 * (todos14.08 line 6) and its wrong start position (line 12). A looping producer
					 * seeks exactly like any other — see `loopSeekIsSafe` for the source proof and
					 * for the one end-of-media window that must still be refused. */
					const needsScrubSeek =
						force &&
						prev?.clipId === clip.id &&
						!transportStale &&
						prev.frame !== meta.frame &&
						!meta.isRoute &&
						(!meta.loopAlways || loopSeekIsSafe(meta))
					const needsPausedSeek = needsScrubSeek && !playing
					const needsPlayingScrub = needsScrubSeek && playing
					let transportSent = false
					let hasDeferredLines = false // T173.2: track deferred tween

					if (meta.loopAlways) {
						if (needsFullTransport || (force && !playing && !prev)) {
							const result = this._sendClipTransport(ch, caspLayer, clip, meta, { playing, startTransport: true })
							transportSent = true
							if (result?.hasDeferredLines) {
								mixerDirty.add(ch)
								hasDeferredLines = true // T173.2
							}
						} else if (needsScrubSeek) {
							/* WO-536: this branch is exclusive — a looping clip never reached the
							 * scrub cases below, so a scrub sent nothing and `_prevKey.frame` went
							 * stale, which is what made `_canResumePlayback` decline and forced the
							 * STOP + PLAY restart on the next play (the black frame). Playing and
							 * paused are the same command here: a looping producer repositions like
							 * any other, and `loopSeekIsSafe` (already folded into needsScrubSeek)
							 * keeps us out of the end-of-media window. */
							self.amcp.call(ch, caspLayer, 'SEEK', String(meta.frame)).catch(_err => {
								this._logDebug(`SEEK ${ch}-${caspLayer} frame=${meta.frame} (LOOP scrub) failed: ${_err.message}`)
							})
							transportSent = true
						}
					} else if (needsFullTransport) {
						const result = this._sendClipTransport(ch, caspLayer, clip, meta, { playing, startTransport: true })
						transportSent = true
						if (result?.hasDeferredLines) {
							mixerDirty.add(ch)
							hasDeferredLines = true // T173.2
						}
					} else if (needsPausedSeek) {
						self.amcp.call(ch, caspLayer, 'SEEK', String(meta.frame)).catch(_err => {
							this._logDebug(`SEEK ${ch}-${caspLayer} frame=${meta.frame} failed: ${_err.message}`)
						})
						transportSent = true
					} else if (needsPlayingScrub) {
						const result = this._sendClipTransport(ch, caspLayer, clip, meta, { playing: true, startTransport: true })
						transportSent = true
						if (result?.hasDeferredLines) {
							mixerDirty.add(ch)
							hasDeferredLines = true // T173.2
						}
					}

					if (transportSent && (force || transportStale)) {
						// T173.2: protect opacity value and segment if we just applied a tween in _sendClipTransport
						const opacityKeyToPreserve = hasDeferredLines ? `${ch}-${caspLayer}-opacity` : null
						const opacitySegToPreserve = hasDeferredLines ? `${ch}-${caspLayer}-opacity-seg` : null
						for (const pk of this._lastKfValues.keys()) {
							if (pk.startsWith(`${ch}-${caspLayer}-`) && pk !== opacityKeyToPreserve) {
								this._lastKfValues.delete(pk)
							}
						}
						for (const pk of this._lastKfSegment.keys()) {
							if (pk.startsWith(`${ch}-${caspLayer}-`) && pk !== opacitySegToPreserve) {
								this._lastKfSegment.delete(pk)
							}
						}
					}

					if (transportSent || transportStale || !prev) {
						this._prevKey.set(key, {
							clipId: clip.id,
							src: String(clip.source?.value || ''),
							audioRoute: clipAudioRoute(clip),
							loopAlways: !!clip.loopAlways,
							isRoute: meta.isRoute,
							implicitLoop: !!meta.implicitLoop,
							loopClip: !!meta.loopClip,
							frame: transportSent ? meta.frame : (prev?.frame ?? meta.frame),
						})
					} else if (playing && !force && prev?.clipId === clip.id) {
						this._prevKey.set(key, { ...prev, frame: meta.frame })
					}

					// T173.4: collect lines per channel instead of sending immediately
					const lines = channelLines.get(ch) || []
					if (!channelLines.has(ch)) channelLines.set(ch, lines)

					if (
						this._applyClipMixer(ch, caspLayer, clip, ms - clip.startTime, {
							force,
							playing,
							fps: Math.max(1, tl.fps || 25),
							scheduleLeadTween: take,
							takeFade,
							collectLines: lines,
						})
					) {
						mixerDirty.add(ch)
					}
				} else if (prev?.clipId) {
					// T173.4: collect STOP line into per-channel array
					const lines = channelLines.get(ch) || []
					if (!channelLines.has(ch)) channelLines.set(ch, lines)
					lines.push(`STOP ${ch}-${caspLayer}`)
					mixerDirty.add(ch)

					this._prevKey.set(key, null)
					for (const pk of this._lastKfValues.keys()) {
						if (pk.startsWith(`${ch}-${caspLayer}-`)) this._lastKfValues.delete(pk)
					}
					for (const pk of this._lastKfSegment.keys()) {
						if (pk.startsWith(`${ch}-${caspLayer}-`)) this._lastKfSegment.delete(pk)
					}
				}
			}
		}

		// T173.4: send collected lines per channel as batch, then MIXER COMMIT
		if (!take) {
			for (const ch of mixerDirty) {
				const lines = channelLines.get(ch)
				if (lines && lines.length > 0) {
					self.amcp.batchSendChunked(lines, { skipMixerPreCommit: true }).catch(_err => {
						this._logDebug(`batch MIXER ${ch} failed: ${_err.message}`)
					})
				}
				self.amcp.mixerCommit(ch).catch(_err => {
					this._logDebug(`MIXER COMMIT ${ch} failed: ${_err.message}`)
				})
			}
		}
	},

	/**
	 * PLAY / LOADBG for one layer — only when clip starts or user scrubs (startTransport).
	 * STOP first so Caspar reapplies AF when route/clip changes. LOAD ignores AF on some builds — use LOADBG.
	 * T173: batched via batchSendChunked + optional opacity tween at clip start (T173.2).
	 * @param {boolean} opts.playing timeline transport playing
	 * @param {boolean} opts.startTransport new clip, play(), or seek/scrub
	 * @returns {{ hasDeferredLines: boolean }} indicates if DEFER tween lines were added (T173.2)
	 */
	_sendClipTransport(ch, caspLayer, clip, meta, opts) {
		const self = this.self
		if (!self?.amcp) return { hasDeferredLines: false }
		const { playing, startTransport } = opts

		if (meta.loopAlways) {
			if (!startTransport) return { hasDeferredLines: false }
			const layout = this._programLayoutForPlayback()
			const afSuffix = playAfSuffix(clip, layout)
			const cl = `${ch}-${caspLayer}`
			const cmd = `PLAY ${cl} ${meta.srcQ} LOOP${afSuffix}`
			self.amcp.stop(ch, caspLayer).catch(_err => {
				this._logDebug(`STOP ${ch}-${caspLayer} failed: ${_err.message}`)
			})
			self.amcp.raw(cmd).catch(_err => {
				this._logDebug(`PLAY ${cl} LOOP failed: ${_err.message}`)
			})
			/* WO-536: this PLAY carried no start position at all, so a looping clip always began at
			 * its IN point no matter where the timeline playhead was — owner: *"it doesnt start in
			 * correct place in regard to timelines playhead"*. It must be a SEPARATE `CALL … SEEK`:
			 * folding it into the PLAY as `LOOP SEEK n` would set the loop's IN point instead of the
			 * playhead (`ffmpeg_producer.cpp:302` aliases SEEK onto IN). `loopSeekIsSafe` carries the
			 * source proof and refuses the last ~2 frames, where the producer would hold rather than
			 * wrap. */
			if (meta.frame > 0 && loopSeekIsSafe(meta)) {
				self.amcp.call(ch, caspLayer, 'SEEK', String(meta.frame)).catch(_err => {
					this._logDebug(`SEEK ${ch}-${caspLayer} frame=${meta.frame} (LOOP) failed: ${_err.message}`)
				})
			}
			return { hasDeferredLines: false }
		}
		if (!startTransport) return { hasDeferredLines: false }

		const layout = this._programLayoutForPlayback()
		const afSuffix = playAfSuffix(clip, layout)
		const cl = `${ch}-${caspLayer}`

		// T173.1: collect transport + mixer init lines into one batch
		const lines = []

		// STOP first so Caspar reapplies AF when route/clip changes
		lines.push('STOP ' + cl)

		// T173.2: check if there's an opacity segment tween at clip-local 0
		// Determine if we'll use a tween or just init opacity
		const fps = 25 // default; could be taken from timeline context if needed
		const clipOpacityBase = clip.opacity != null ? clip.opacity : 1
		const opacitySeg = opacitySegmentAtLocalMs(clip, 0, fps, this._interpProp.bind(this), clipOpacityBase)
		const hasOpacityTween = opacitySeg && opacitySeg.startVal !== opacitySeg.endVal

		// Add opacity init if NO tween (else the tween start value will set it). Base is the clip's
		// static opacity (default 1); an opacity keyframe at/near clip-local 0 still overrides it.
		if (!hasOpacityTween) {
			let initialOpacity = clipOpacityBase
			const opacityKfs = (clip.keyframes || [])
				.filter((k) => k.property === 'opacity')
				.sort((a, b) => a.time - b.time)
			if (opacityKfs.length > 0) {
				const firstKf = opacityKfs[0]
				if (firstKf.time <= 2) {
					initialOpacity = Number.isFinite(firstKf.value) ? firstKf.value : 1
				}
			}
			if (initialOpacity < 1) {
				lines.push(`MIXER ${cl} OPACITY ${initialOpacity} 0`)
			}
		}

		// Add transport line (PLAY/LOAD/etc)
		if (meta.isRoute) {
			lines.push(`PLAY ${cl} ${meta.srcQ}${afSuffix}`)
		} else if (playing || meta.loopClip) {
			const loopStr = meta.loopClip || meta.implicitLoop ? ' LOOP' : ''
			lines.push(`PLAY ${cl} ${meta.srcQ}${loopStr} SEEK ${meta.frame}${afSuffix}`)
		} else if (afSuffix) {
			lines.push(`PLAY ${cl} ${meta.srcQ} SEEK ${meta.frame}${afSuffix}`)
		} else {
			lines.push(`LOAD ${cl} ${meta.srcQ} SEEK ${meta.frame}`)
		}

		// T173.2: append opacity segment tween if one starts at clip-local 0
		let hasDeferredLines = false
		if (hasOpacityTween) {
			const segLines = buildDeferredSegmentMixerLines(ch, caspLayer, 'OPACITY', opacitySeg.startVal, opacitySeg.endVal, opacitySeg.dur, opacitySeg.tween)
			lines.push(...segLines)
			// Mark segment as pre-applied so per-tick scheduler skips it.
			// Set _lastKfValues to start value so instant mixer check doesn't incorrectly trigger
			// in _applyClipMixer called right after (force=true at clip start).
			const kSeg = `${ch}-${caspLayer}-opacity-seg`
			const kVal = `${ch}-${caspLayer}-opacity`
			this._lastKfSegment.set(kSeg, opacitySeg.segIdx)
			this._lastKfValues.set(kVal, opacitySeg.startVal)
			hasDeferredLines = true
		}

		// If we need PAUSE after PLAY, add it to the batch
		if (afSuffix && !meta.isRoute && !(playing || meta.loopClip)) {
			lines.push(`PAUSE ${cl}`)
		}

		// Send all lines as one batch
		self.amcp.batchSendChunked(lines, { skipMixerPreCommit: true }).catch(_err => {
			this._logDebug(`batch transport ${cl} failed: ${_err.message}`)
		})

		return { hasDeferredLines }
	},

	_channelsFor(sendTo) {
		const st = normalizeTimelineSendTo(sendTo)
		const previewOn = st.preview
		const programOn = st.program
		/* Unrouted timeline (todos06.08): edits/scrub apply nowhere until Take or a look routes it. */
		if (!previewOn && !programOn) return []
		let map = null
		try {
			map = this.self?.config ? getChannelMap(this.self.config) : null
		} catch (_) {}
		const screenCount = map?.screenCount || 1
		const screenIdx = st.screenIdx != null ? st.screenIdx : null
		const ch = []
		const addScreen = (i) => {
			if (previewOn) {
				const prv = map?.previewCh ? map.previewCh(i + 1) : (i + 1) * 2
				if (prv != null) ch.push(prv)
			}
			if (programOn) ch.push(map?.programCh ? map.programCh(i + 1) : (i + 1) * 2 - 1)
		}
		if (screenIdx !== null) addScreen(screenIdx)
		else for (let i = 0; i < screenCount; i++) addScreen(i)
		if (ch.length === 0) {
			/* PRV requested but the screen has no PRV bus (pgm_only/pixelmap): route NOWHERE.
			 * The old fallback crossed to programCh(1) here, which is exactly how scrubbing a
			 * "preview-only" timeline painted over the live look on PGM-only rigs (todos06.08).
			 * Only an explicit program request may fall back to a program channel. */
			if (programOn) ch.push(map?.programCh?.(1) ?? 1)
			else {
				const prv1 = map?.previewCh?.(1)
				if (prv1 != null) ch.push(prv1)
			}
		}
		return ch
	},

	_channels() {
		return this._channelsFor(this._sendToFor(this._airTimelineId))
	},

	_timelineLayerIndex(caspLayer) {
		const li = caspLayer - TIMELINE_LAYER_BASE
		return li >= 0 ? li : -1
	},

}

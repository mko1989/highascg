'use strict'

const { getChannelMap } = require('../config/routing')
const { clipParamForPlay } = require('../caspar/amcp-utils')
const { resolveTimelineClipFrame } = require('./scene-play-seek')
const {
	buildEffectAmcpLinesPlayback,
	mixerEffectNeutralLines,
	clipAudioRoute,
	playAfSuffix,
	timelineClipTransportStale,
	TIMELINE_LAYER_BASE,
} = require('./timeline-playback-helpers')
const {
	mergedFillKeyframeTimes,
	keyframeSegmentIndex,
	msToMixerFrames,
	fillTweenForSegmentEnd,
	mapKeyframeTween,
	easingAtTime,
	shouldSendInstantKeyframeMixer,
} = require('./timeline-keyframe-mixer')

/**
 * @param {object} clip
 * @param {number} ms timeline position
 * @param {object} tl timeline model
 * @param {object} self app ctx
 */
function clipTransportMeta(clip, ms, tl, self, opts = {}) {
	const src = String(clip.source?.value || '')
	const transport = resolveTimelineClipFrame(clip, ms, tl, self, opts)
	return {
		src,
		srcQ: clipParamForPlay(src),
		isRoute: transport.isRoute,
		frame: transport.frame,
		implicitLoop: transport.implicitLoop,
		loopSpanFrames: transport.loopSpanFrames,
		inFrames: transport.inFrames,
		loopClip: !!(clip.loopAlways || clip.loop),
		loopAlways: !!clip.loopAlways,
	}
}

module.exports = {
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
				const key = `${ch}-${this._caspLayer(ch, li)}`
				const prev = this._prevKey.get(key)
				if (!prev?.clipId || prev.clipId !== clip.id) return false
			}
		}
		return true
	},

	_caspLayer(_ch, li) {
		return TIMELINE_LAYER_BASE + li
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
	_applyAt(id, ms, force) {
		this._syncAmcpLayers(id, ms, { force: !!force })
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
	 * @param {{ force?: boolean }} opts
	 */
	_syncAmcpLayers(id, ms, opts) {
		const tl = this.timelines.get(id)
		const self = this.self
		if (!tl || !self?.amcp) return
		const force = !!opts.force
		const channels = this._channels()
		const playing = this._airTimelineId === id && (this._pbFor(id).playing ?? false)
		const mixerDirty = new Set()

		for (let li = 0; li < tl.layers.length; li++) {
			const layer = tl.layers[li]
			const clip = this._clipAt(layer, ms)

			for (const ch of channels) {
				const caspLayer = this._caspLayer(ch, li)
				const key = `${ch}-${caspLayer}`
				const prev = this._prevKey.get(key)

				if (clip) {
					const transportStale = timelineClipTransportStale(prev, clip)
					// Clip-entry behaviour (startBehaviour → inPoint) only when playback tick enters a clip.
					// Forced seek/scrub/play-from-position always resolve frame from timeline ms.
					const atEntry = transportStale && !force
					const transportOpts = { atEntry, channel: ch, physicalLayer: caspLayer }
					const meta = clipTransportMeta(clip, ms, tl, self, transportOpts)
					// Full STOP+PLAY on clip/route change, first load, or play()/seek while transport running.
					const needsFullTransport = transportStale || (force && playing)
					const needsScrubSeek =
						force &&
						prev?.clipId === clip.id &&
						!transportStale &&
						prev.frame !== meta.frame &&
						!meta.isRoute &&
						!meta.loopAlways
					const needsPausedSeek = needsScrubSeek && !playing
					// Playing scrub: STOP+PLAY once at the new frame — never CALL SEEK (decoder stutter).
					const needsPlayingScrub = needsScrubSeek && playing
					let transportSent = false

					if (meta.loopAlways) {
						if (needsFullTransport || (force && !playing && !prev)) {
							this._sendClipTransport(ch, caspLayer, clip, meta, { playing, startTransport: true })
							transportSent = true
						}
					} else if (needsFullTransport) {
						this._sendClipTransport(ch, caspLayer, clip, meta, { playing, startTransport: true })
						transportSent = true
					} else if (needsPausedSeek) {
						self.amcp.call(ch, caspLayer, 'SEEK', String(meta.frame)).catch(() => {})
						transportSent = true
					} else if (needsPlayingScrub) {
						this._sendClipTransport(ch, caspLayer, clip, meta, { playing: true, startTransport: true })
						transportSent = true
					}

					if (transportSent && (force || transportStale)) {
						for (const pk of this._lastKfValues.keys()) {
							if (pk.startsWith(`${ch}-${caspLayer}-`)) this._lastKfValues.delete(pk)
						}
						for (const pk of this._lastKfSegment.keys()) {
							if (pk.startsWith(`${ch}-${caspLayer}-`)) this._lastKfSegment.delete(pk)
						}
					}

					if (transportSent || transportStale || !prev) {
						this._prevKey.set(key, {
							clipId: clip.id,
							audioRoute: clipAudioRoute(clip),
							frame: transportSent ? meta.frame : (prev?.frame ?? meta.frame),
						})
					} else if (playing && !force && prev?.clipId === clip.id) {
						// Track expected file frame during 1× play without CALL SEEK every tick.
						this._prevKey.set(key, { ...prev, frame: meta.frame })
					}

					if (
						this._applyClipMixer(ch, caspLayer, clip, ms - clip.startTime, {
							force,
							playing,
							fps: Math.max(1, tl.fps || 25),
						})
					) {
						mixerDirty.add(ch)
					}
				} else if (prev?.clipId) {
					self.amcp.stop(ch, caspLayer).catch(() => {})
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

		for (const ch of mixerDirty) {
			self.amcp.mixerCommit(ch).catch(() => {})
		}
	},

	/**
	 * Program master layout from server config (matches Device View → Audio).
	 */
	_programLayoutForPlayback() {
		const { resolveConfigProgramLayout } = require('./audio-route')
		const screenIdx = this._sendToFor(this._airTimelineId)?.screenIdx
		const mainIndex =
			screenIdx === null || screenIdx === 'all' || screenIdx === undefined
				? 0
				: Math.max(0, parseInt(String(screenIdx), 10) || 0)
		return resolveConfigProgramLayout(this.self?.config, mainIndex)
	},

	/**
	 * PLAY / LOADBG for one layer — only when clip starts or user scrubs (startTransport).
	 * STOP first so Caspar reapplies AF when route/clip changes. LOAD ignores AF on some builds — use LOADBG.
	 * @param {boolean} opts.playing timeline transport playing
	 * @param {boolean} opts.startTransport new clip, play(), or seek/scrub
	 */
	_sendClipTransport(ch, caspLayer, clip, meta, opts) {
		const self = this.self
		if (!self?.amcp) return
		const { playing, startTransport } = opts

		if (meta.loopAlways) {
			if (!startTransport) return
			const layout = this._programLayoutForPlayback()
			const afSuffix = playAfSuffix(clip, layout)
			const cl = `${ch}-${caspLayer}`
			const cmd = `PLAY ${cl} ${meta.srcQ} LOOP${afSuffix}`
			self.amcp
				.stop(ch, caspLayer)
				.catch(() => {})
				.then(() => self.amcp.raw(cmd).catch(() => {}))
			return
		}
		if (!startTransport) return

		const layout = this._programLayoutForPlayback()
		const afSuffix = playAfSuffix(clip, layout)
		const cl = `${ch}-${caspLayer}`

		const runTransport = () => {
			if (meta.isRoute) {
				self.amcp.raw(`PLAY ${cl} ${meta.srcQ}${afSuffix}`).catch(() => {})
			} else if (playing || meta.loopClip) {
				const loopStr = meta.loopClip || meta.implicitLoop ? ' LOOP' : ''
				self.amcp
					.raw(`PLAY ${cl} ${meta.srcQ}${loopStr} SEEK ${meta.frame}${afSuffix}`)
					.catch(() => {})
			} else if (afSuffix) {
				// LOAD ignores AF on many Caspar builds; PLAY applies pan then pause for scrub still.
				self.amcp
					.raw(`PLAY ${cl} ${meta.srcQ} SEEK ${meta.frame}${afSuffix}`)
					.catch(() => {})
					.then(() => {
						if (!playing) self.amcp.pause(ch, caspLayer).catch(() => {})
					})
			} else {
				self.amcp.raw(`LOAD ${cl} ${meta.srcQ} SEEK ${meta.frame}`).catch(() => {})
			}
		}

		self.amcp
			.stop(ch, caspLayer)
			.catch(() => {})
			.then(() => runTransport())
	},

	_clearLayerMixerSchedule(ch, layer) {
		const prefix = `${ch}-${layer}-`
		for (const pk of this._lastKfValues.keys()) {
			if (pk.startsWith(prefix)) this._lastKfValues.delete(pk)
		}
		for (const pk of this._lastKfSegment.keys()) {
			if (pk.startsWith(prefix)) this._lastKfSegment.delete(pk)
		}
	},

	/**
	 * One MIXER command per keyframe segment during playback (duration = end−start in frames).
	 * Scrub/force/pause: instant mixer (duration 0) at interpolated value.
	 * @param {{ force?: boolean, playing?: boolean, fps?: number }} opts
	 * @returns {boolean} True if any mixer command was sent (caller should COMMIT that channel on Caspar 2.5+).
	 */
	_applyClipMixer(ch, layer, clip, localMs, opts = {}) {
		const self = this.self
		if (!self?.amcp) return false
		const force = !!opts.force
		const playing = !!opts.playing && !force
		const fps = Math.max(1, opts.fps || 25)
		const { w, h } = this._programResolutionForPlayback()
		const base = this._clipFillBaseNormalized(clip, w, h)

		let sent = false

		const fillAt = (t) => {
			const ms = Math.max(0, t)
			return {
				fx: this._interpProp(clip, 'fill_x', ms, base.fill_x),
				fy: this._interpProp(clip, 'fill_y', ms, base.fill_y),
				sx: this._interpProp(clip, 'scale_x', ms, base.scale_x),
				sy: this._interpProp(clip, 'scale_y', ms, base.scale_y),
			}
		}
		const fillKey = (v) => `${v.fx},${v.fy},${v.sx},${v.sy}`

		const fillTimes = mergedFillKeyframeTimes(clip)
		const fillSegIdx = keyframeSegmentIndex(fillTimes, localMs)
		const kFillSeg = `${ch}-${layer}-fill-seg`
		const kFill = `${ch}-${layer}-fill`
		const prevFillSeg = this._lastKfSegment.get(kFillSeg)
		const inAnimatedSpan =
			playing && fillTimes.length >= 2 && fillSegIdx >= 0 && fillSegIdx < fillTimes.length - 1
		const segChanged = inAnimatedSpan && prevFillSeg !== fillSegIdx

		if (segChanged) {
			const t0 = fillTimes[fillSegIdx]
			const t1 = fillTimes[fillSegIdx + 1]
			const start = fillAt(localMs > t0 + 2 ? localMs : t0)
			const end = fillAt(t1)
			const spanMs = Math.max(1, t1 - t0)
			const dur = msToMixerFrames(spanMs, fps)
			const tween = mapKeyframeTween(fillTweenForSegmentEnd(clip, t1))
			self.amcp.mixerFill(ch, layer, start.fx, start.fy, start.sx, start.sy, 0).catch(() => {})
			self.amcp.mixerFill(ch, layer, end.fx, end.fy, end.sx, end.sy, dur, tween).catch(() => {})
			this._lastKfSegment.set(kFillSeg, fillSegIdx)
			this._lastKfValues.set(kFill, fillKey(end))
			sent = true
			if (typeof self.log === 'function') {
				self.log(
					'debug',
					`[Timeline] MIXER ${ch}-${layer} FILL seg ${t0}→${t1} ms dur=${dur} ${tween}`
				)
			}
		}

		const cur = fillAt(localMs)
		const curStr = fillKey(cur)
		if (
			!segChanged &&
			shouldSendInstantKeyframeMixer({
				playing,
				force,
				inTweenSpan: inAnimatedSpan,
				valueChanged: this._lastKfValues.get(kFill) !== curStr,
			})
		) {
			this._lastKfValues.set(kFill, curStr)
			if (playing && inAnimatedSpan) this._lastKfSegment.set(kFillSeg, fillSegIdx)
			else if (!playing) this._lastKfSegment.delete(kFillSeg)
			self.amcp.mixerFill(ch, layer, cur.fx, cur.fy, cur.sx, cur.sy, 0).catch(() => {})
			sent = true
			if (typeof self.log === 'function') {
				self.log('debug', `[Timeline] MIXER ${ch}-${layer} FILL ${cur.fx} ${cur.fy} ${cur.sx} ${cur.sy} 0`)
			}
		}

		sent =
			this._applyKeyedMixerProp(ch, layer, clip, 'opacity', localMs, 1, playing, force, fps) || sent
		const volDef = clip.volume != null ? clip.volume : 1
		const volVal = clip.muted ? 0 : this._interpProp(clip, 'volume', localMs, volDef)
		sent =
			this._applyKeyedMixerProp(ch, layer, clip, 'volume', localMs, volVal, playing, force, fps, {
				isVolume: true,
			}) || sent

		const kFx = `${ch}-${layer}-fx`
		const fxKey =
			Array.isArray(clip.effects) && clip.effects.length > 0
				? clip.effects.map((f) => `${f.type}:${JSON.stringify(f.params || {})}`).join('|')
				: ''
		if (this._lastKfValues.get(kFx) !== fxKey) {
			this._lastKfValues.set(kFx, fxKey)
			const cl = `${ch}-${layer}`
			const lines = [...mixerEffectNeutralLines(cl)]
			if (Array.isArray(clip.effects)) {
				for (const fx of clip.effects) {
					const fxLines = buildEffectAmcpLinesPlayback(fx.type, fx.params || {}, cl)
					if (fxLines) lines.push(...fxLines)
				}
			}
			if (lines.length > 0) {
				self.amcp.batchSendChunked(lines).catch(() => {})
				sent = true
			}
		}
		return sent
	},

	/**
	 * Opacity/volume keyframes: one tweened MIXER per segment while playing.
	 * @param {{ isVolume?: boolean }} extra
	 */
	_applyKeyedMixerProp(ch, layer, clip, prop, localMs, holdValue, playing, force, fps, extra = {}) {
		const self = this.self
		const kfs = (clip.keyframes || [])
			.filter((k) => k.property === prop)
			.sort((a, b) => a.time - b.time)
		const times = kfs.map((k) => k.time)
		const segIdx = keyframeSegmentIndex(times, localMs)
		const kSeg = `${ch}-${layer}-${prop}-seg`
		const prevSeg = this._lastKfSegment.get(kSeg)
		const inSpan = playing && times.length >= 2 && segIdx >= 0 && segIdx < times.length - 1

		const segChanged = inSpan && prevSeg !== segIdx

		if (segChanged) {
			const t0 = times[segIdx]
			const t1 = times[segIdx + 1]
			const startVal = this._interpProp(clip, prop, localMs > t0 + 2 ? localMs : t0, holdValue)
			const endVal = this._interpProp(clip, prop, t1, holdValue)
			const dur = msToMixerFrames(Math.max(1, t1 - t0), fps)
			const tween = mapKeyframeTween(easingAtTime(clip, prop, t1))
			if (extra.isVolume) {
				self.amcp.mixerVolume(ch, layer, startVal, 0).catch(() => {})
				self.amcp.mixerVolume(ch, layer, endVal, dur, tween).catch(() => {})
			} else {
				self.amcp.mixerOpacity(ch, layer, startVal, 0).catch(() => {})
				self.amcp.mixerOpacity(ch, layer, endVal, dur, tween).catch(() => {})
			}
			this._lastKfSegment.set(kSeg, segIdx)
			this._lastKfValues.set(`${ch}-${layer}-${prop}`, endVal)
			return true
		}

		const val = kfs.length ? this._interpProp(clip, prop, localMs, holdValue) : holdValue
		const kVal = `${ch}-${layer}-${prop}`
		const last = this._lastKfValues.get(kVal)
		const valueChanged = last === undefined || Math.abs(val - last) >= 1e-5
		if (
			!segChanged &&
			shouldSendInstantKeyframeMixer({
				playing,
				force,
				inTweenSpan: inSpan,
				valueChanged,
			})
		) {
			this._lastKfValues.set(kVal, val)
			if (playing && inSpan) this._lastKfSegment.set(kSeg, segIdx)
			else if (!playing) this._lastKfSegment.delete(kSeg)
			if (extra.isVolume) {
				self.amcp.mixerVolume(ch, layer, val, 0).catch(() => {})
			} else {
				self.amcp.mixerOpacity(ch, layer, val, 0).catch(() => {})
			}
			return true
		}
		return false
	},

	_channelsFor(sendTo) {
		const st = sendTo || {}
		const previewOn = st.preview !== false
		const programOn = st.program !== false
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
			const fallback = programOn ? (map?.programCh?.(1) ?? 1) : (map?.previewCh?.(1) ?? map?.programCh?.(1) ?? 1)
			ch.push(fallback)
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

	_pauseAll() {
		const self = this.self
		if (!self?.amcp) return
		const airId = this._airTimelineId
		const tl = airId ? this.timelines.get(airId) : null
		if (!tl) return
		const ms = this._nowMs(airId)
		for (const key of this._prevKey.keys()) {
			const [ch, caspLayer] = key.split('-').map(Number)
			if (isNaN(ch) || isNaN(caspLayer)) continue
			const li = this._timelineLayerIndex(caspLayer)
			if (li >= 0 && li < tl.layers.length) {
				const clip = this._clipAt(tl.layers[li], ms)
				if (clip?.loopAlways) continue
			}
			self.amcp.pause(ch, caspLayer).catch(() => {})
		}
	},

	_resumeAll() {
		const self = this.self
		if (!self?.amcp) return
		const airId = this._airTimelineId
		const tl = airId ? this.timelines.get(airId) : null
		if (!tl) return
		const ms = this._nowMs(airId)
		for (const key of this._prevKey.keys()) {
			const [ch, caspLayer] = key.split('-').map(Number)
			if (isNaN(ch) || isNaN(caspLayer)) continue
			const li = this._timelineLayerIndex(caspLayer)
			if (li >= 0 && li < tl.layers.length) {
				const clip = this._clipAt(tl.layers[li], ms)
				if (clip?.loopAlways) continue
			}
			self.amcp.resume(ch, caspLayer).catch(() => {})
		}
	},

	_stopAll(tl, channelsOverride) {
		const self = this.self
		if (!self?.amcp) return
		const channels = channelsOverride ?? this._channels()
		for (let li = 0; li < tl.layers.length; li++) {
			for (const ch of channels) {
				self.amcp.stop(ch, this._caspLayer(ch, li)).catch(() => {})
			}
		}
		this._lastKfValues.clear()
		this._lastKfSegment.clear()
	},
}

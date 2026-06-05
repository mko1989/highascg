'use strict'

const { getChannelMap } = require('../config/routing')
const { clipParamForPlay } = require('../caspar/amcp-utils')
const { resolveTimelineClipFrame } = require('./scene-play-seek')
const {
	buildEffectAmcpLinesPlayback,
	mixerEffectNeutralLines,
	playAfSuffix,
	TIMELINE_LAYER_BASE,
	TIMELINE_AMCP_DRIFT_MS,
} = require('./timeline-playback-helpers')
const {
	mergedFillKeyframeTimes,
	keyframeSegmentIndex,
	msToMixerFrames,
	fillTweenForSegmentEnd,
	mapKeyframeTween,
	easingAtTime,
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
		loopClip: !!(clip.loopAlways || clip.loop),
		loopAlways: !!clip.loopAlways,
	}
}

module.exports = {
	_caspLayer(_ch, li) {
		return TIMELINE_LAYER_BASE + li
	},

	/**
	 * Full transport + mixer sync (scrub, play start, inspector edits). Not called from the UI tick.
	 * @param {string} id timeline id
	 * @param {number} ms position
	 * @param {boolean} force scrub / explicit seek — sends PLAY|LOAD|SEEK for active clips
	 */
	_applyAt(id, ms, force) {
		this._syncAmcpLayers(id, ms, { force: !!force, allowDriftSeek: false })
	},

	/**
	 * Called from {@link TimelineEngine#_tick} only — clip enter/exit, throttled drift SEEK for stretched clips,
	 * and keyframed mixer once per keyframe segment (tween duration = ms to end keyframe). Does not PLAY/SEEK every tick.
	 */
	_syncAmcpOnTimelineTick(id, ms) {
		this._syncAmcpLayers(id, ms, { force: false, allowDriftSeek: true })
	},

	/**
	 * @param {string} id
	 * @param {number} ms
	 * @param {{ force?: boolean, allowDriftSeek?: boolean }} opts
	 */
	_syncAmcpLayers(id, ms, opts) {
		const tl = this.timelines.get(id)
		const self = this.self
		if (!tl || !self?.amcp) return
		const force = !!opts.force
		const allowDriftSeek = !!opts.allowDriftSeek
		const channels = this._channels()
		const playing = this._pb?.playing ?? false
		const mixerDirty = new Set()

		for (let li = 0; li < tl.layers.length; li++) {
			const layer = tl.layers[li]
			const clip = this._clipAt(layer, ms)

			for (const ch of channels) {
				const caspLayer = this._caspLayer(ch, li)
				const key = `${ch}-${caspLayer}`
				const prev = this._prevKey.get(key)

				if (clip) {
					const newClip = !prev || prev.clipId !== clip.id
					const atEntry = newClip || force
					const transportOpts = { atEntry, channel: ch, physicalLayer: caspLayer }
					const meta = clipTransportMeta(clip, ms, tl, self, transportOpts)
					const driftMeta = atEntry ? meta : clipTransportMeta(clip, ms, tl, self, { atEntry: false, channel: ch, physicalLayer: caspLayer })
					let transportSent = false

					if (meta.loopAlways) {
						if (newClip || force) {
							this._sendClipTransport(ch, caspLayer, clip, meta, { playing, startTransport: true })
							transportSent = true
						}
					} else if (newClip || force) {
						this._sendClipTransport(ch, caspLayer, clip, meta, { playing, startTransport: true })
						transportSent = true
					} else if (
						allowDriftSeek &&
						playing &&
						driftMeta.implicitLoop &&
						!driftMeta.isRoute &&
						prev?.clipId === clip.id
					) {
						const now = Date.now()
						const driftDue = !prev.lastDriftAt || now - prev.lastDriftAt >= TIMELINE_AMCP_DRIFT_MS
						if (driftDue && prev.frame !== driftMeta.frame) {
							self.amcp.call(ch, caspLayer, 'SEEK', String(driftMeta.frame)).catch(() => {})
							transportSent = true
							this._prevKey.set(key, {
								clipId: clip.id,
								frame: driftMeta.frame,
								lastDriftAt: now,
							})
						}
					}

					if (transportSent && (force || newClip)) {
						for (const pk of this._lastKfValues.keys()) {
							if (pk.startsWith(`${ch}-${caspLayer}-`)) this._lastKfValues.delete(pk)
						}
						for (const pk of this._lastKfSegment.keys()) {
							if (pk.startsWith(`${ch}-${caspLayer}-`)) this._lastKfSegment.delete(pk)
						}
					}

					if (transportSent || newClip || !prev) {
						this._prevKey.set(key, {
							clipId: clip.id,
							frame: transportSent && !atEntry ? driftMeta.frame : meta.frame,
							lastDriftAt:
								transportSent && driftMeta.implicitLoop
									? Date.now()
									: prev?.lastDriftAt,
						})
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
	 * PLAY / LOAD for one layer — only when clip starts or user scrubs (startTransport).
	 * @param {boolean} opts.playing timeline transport playing
	 * @param {boolean} opts.startTransport new clip, play(), or seek/scrub
	 */
	_sendClipTransport(ch, caspLayer, clip, meta, opts) {
		const self = this.self
		if (!self?.amcp) return
		const { playing, startTransport } = opts

		if (meta.loopAlways) {
			if (!startTransport) return
			self.amcp.raw(`PLAY ${ch}-${caspLayer} ${meta.srcQ} LOOP${playAfSuffix(clip)}`).catch(() => {})
			return
		}
		if (!startTransport) return

		if (meta.isRoute) {
			self.amcp.raw(`PLAY ${ch}-${caspLayer} ${meta.srcQ}${playAfSuffix(clip)}`).catch(() => {})
		} else if (playing || meta.loopClip) {
			const loopStr = meta.loopClip ? ' LOOP' : ''
			self.amcp
				.raw(`PLAY ${ch}-${caspLayer} ${meta.srcQ}${loopStr} SEEK ${meta.frame}${playAfSuffix(clip)}`)
				.catch(() => {})
		} else {
			self.amcp
				.raw(`LOAD ${ch}-${caspLayer} ${meta.srcQ} SEEK ${meta.frame}${playAfSuffix(clip)}`)
				.catch(() => {})
		}
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
		if (!segChanged && (force || this._lastKfValues.get(kFill) !== curStr)) {
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
		if (!segChanged && (force || last === undefined || Math.abs(val - last) >= 1e-5)) {
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
		return this._channelsFor(this._pb?.sendTo)
	},

	_timelineLayerIndex(caspLayer) {
		const li = caspLayer - TIMELINE_LAYER_BASE
		return li >= 0 ? li : -1
	},

	_pauseAll() {
		const self = this.self
		if (!self?.amcp) return
		const tl = this.timelines.get(this._pb?.timelineId)
		if (!tl) return
		const ms = this._nowMs()
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
		const tl = this.timelines.get(this._pb?.timelineId)
		if (!tl) return
		const ms = this._nowMs()
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

	_stopAll(tl) {
		const self = this.self
		if (!self?.amcp) return
		const channels = this._channels()
		for (let li = 0; li < tl.layers.length; li++) {
			for (const ch of channels) {
				self.amcp.stop(ch, this._caspLayer(ch, li)).catch(() => {})
			}
		}
		this._lastKfValues.clear()
		this._lastKfSegment.clear()
	},
}

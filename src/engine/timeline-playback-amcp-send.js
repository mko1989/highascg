'use strict'

const { getChannelMap } = require('../config/routing')
const {
	clipAudioRoute,
	playAfSuffix,
	timelineClipTransportStale,
	TIMELINE_LAYER_BASE,
} = require('./timeline-playback-helpers')
const { clipTransportMeta } = require('./timeline-playback-amcp-schedule')

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
					const atEntry = transportStale && !force
					const transportOpts = { atEntry, channel: ch, physicalLayer: caspLayer }
					const meta = clipTransportMeta(clip, ms, tl, self, transportOpts)
					const needsFullTransport = transportStale || (force && playing)
					const needsScrubSeek =
						force &&
						prev?.clipId === clip.id &&
						!transportStale &&
						prev.frame !== meta.frame &&
						!meta.isRoute &&
						!meta.loopAlways
					const needsPausedSeek = needsScrubSeek && !playing
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

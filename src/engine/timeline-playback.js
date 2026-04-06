/**
 * Timeline playback — ticker, AMCP apply, channel routing (mixin for TimelineEngine).
 * @see companion-module-casparcg-server/src/timeline-engine.js
 */
'use strict'

const { getChannelMap } = require('../config/routing')
const { audioRouteToAudioFilter } = require('./audio-route')
const { clipParamForPlay, param } = require('../caspar/amcp-utils')
const { getProgramResolutionForScreen } = require('../utils/program-resolution')

/** @param {object} clip */
function playAfSuffix(clip) {
	const af = audioRouteToAudioFilter(clip.audioRoute || '1+2')
	return af ? ` AF ${param(af)}` : ''
}

/** @param {string|undefined} s */
function parseResolutionAspect(s) {
	if (!s || typeof s !== 'string') return null
	const m = String(s).match(/(\d+)[×x](\d+)/i)
	if (!m) return null
	const w = parseInt(m[1], 10)
	const h = parseInt(m[2], 10)
	if (!(w > 0 && h > 0)) return null
	return w / h
}

/** Caspar layers for timeline (per stack index). Keep separate from scene/looks (typically 1–20) and black CG (9). */
const TIMELINE_LAYER_BASE = 100

const TICK_MS = 40
/** WS `timeline.tick` throttle — client extrapolates between ticks; ~150–180ms reduces jitter over high-latency links. */
const TIMELINE_TICK_BROADCAST_MS = 165

/** @param {new (self: object) => object} TimelineEngineClass */
function applyPlaybackMixin(TimelineEngineClass) {
	Object.assign(TimelineEngineClass.prototype, {
		addKeyframeAtNow(timelineId, layerIdx, property, value) {
			const tl = this.timelines.get(timelineId || this._pb?.timelineId)
			if (!tl) return null
			const ms = this._nowMs()
			const layer = tl.layers[layerIdx]
			if (!layer) return null
			const clip = this._clipAt(layer, ms)
			if (!clip) return null
			const localMs = Math.round(ms - clip.startTime)
			const kf = { time: Math.max(0, localMs), property, value, easing: 'linear' }
			clip.keyframes = (clip.keyframes || []).filter(
				(k) => !(k.property === kf.property && Math.abs(k.time - kf.time) < 0.5)
			)
			clip.keyframes.push(kf)
			clip.keyframes.sort((a, b) => a.time - b.time)
			this._emitChange()
			return kf
		},

		getPositionMs() {
			return this._nowMs()
		},

		adjustClipFillDelta(timelineId, layerIdx, axis, delta, aspectLocked) {
			const tl = this.timelines.get(timelineId || this._pb?.timelineId)
			if (!tl) return null
			const layer = tl.layers[layerIdx]
			if (!layer) return null
			const ms = this._nowMs()
			const clip = this._clipAt(layer, ms)
			if (!clip) return null
			const localMs = Math.round(ms - clip.startTime)
			const screenIdx = this._pb?.sendTo?.screenIdx ?? 0
			const { w, h } = getProgramResolutionForScreen(this.self, screenIdx)
			const base = this._clipFillBaseNormalized(clip, w, h)
			let rect = clip.fillPx
			if (!rect || rect.w < 1 || rect.h < 1) {
				rect = {
					x: base.fill_x * w,
					y: base.fill_y * h,
					w: base.scale_x * w,
					h: base.scale_y * h,
				}
			}
			let nx = rect.x
			let ny = rect.y
			let nw = rect.w
			let nh = rect.h
			const contentAr = parseResolutionAspect(clip?.source?.resolution)
			const medAr =
				contentAr != null
					? contentAr
					: nw > 0 && nh > 0
						? nw / nh
						: 16 / 9
			if (axis === 'pos_x') nx += delta
			else if (axis === 'pos_y') ny += delta
			else if (axis === 'size_w') {
				nw = Math.max(1, nw + delta)
				if (aspectLocked) nh = Math.max(1, Math.round(nw / medAr))
			} else if (axis === 'size_h') {
				nh = Math.max(1, nh + delta)
				if (aspectLocked) nw = Math.max(1, Math.round(nh * medAr))
			}
			clip.fillPx = { x: nx, y: ny, w: nw, h: nh }
			const FILL_PROPS = ['fill_x', 'fill_y', 'scale_x', 'scale_y']
			clip.keyframes = (clip.keyframes || []).filter(
				(k) => !(FILL_PROPS.includes(k.property) && Math.abs(k.time - localMs) < 0.5)
			)
			this._emitChange()
			if (this._pb?.timelineId === tl.id) this._applyAt(tl.id, ms, true)
			return {
				fill_x: nx / w,
				fill_y: ny / h,
				scale_x: nw / w,
				scale_y: nh / h,
			}
		},

		captureKeyframeAtNow(timelineId, layerIdx, param) {
			const tl = this.timelines.get(timelineId || this._pb?.timelineId)
			if (!tl) return false
			const layer = tl.layers[layerIdx]
			if (!layer) return false
			const ms = this._nowMs()
			const clip = this._clipAt(layer, ms)
			if (!clip) return false
			const t = Math.max(0, Math.round(ms - clip.startTime))

			const addKf = (prop, val) => {
				clip.keyframes = (clip.keyframes || []).filter((k) => !(k.property === prop && Math.abs(k.time - t) < 0.5))
				clip.keyframes.push({ time: t, property: prop, value: val, easing: 'linear' })
			}

			switch (param) {
				case 'opacity':
					addKf('opacity', this._interpProp(clip, 'opacity', t, 1))
					break
				case 'volume':
					addKf('volume', this._interpProp(clip, 'volume', t, clip.volume != null ? clip.volume : 1))
					break
				case 'fill_x':
					addKf('fill_x', this._interpProp(clip, 'fill_x', t, 0))
					break
				case 'fill_y':
					addKf('fill_y', this._interpProp(clip, 'fill_y', t, 0))
					break
				case 'scale_x':
					addKf('scale_x', this._interpProp(clip, 'scale_x', t, 1))
					break
				case 'scale_y':
					addKf('scale_y', this._interpProp(clip, 'scale_y', t, 1))
					break
				case 'position':
					addKf('fill_x', this._interpProp(clip, 'fill_x', t, 0))
					addKf('fill_y', this._interpProp(clip, 'fill_y', t, 0))
					break
				case 'scale':
					addKf('scale_x', this._interpProp(clip, 'scale_x', t, 1))
					addKf('scale_y', this._interpProp(clip, 'scale_y', t, 1))
					break
				default:
					return false
			}

			clip.keyframes.sort((a, b) => a.time - b.time || String(a.property).localeCompare(String(b.property)))
			this._emitChange()
			if (this._pb?.timelineId === tl.id) this._applyAt(tl.id, ms, true)
			return true
		},

		_resolveJumpTarget(flag, tl) {
			if (typeof flag.jumpTimeMs === 'number' && Number.isFinite(flag.jumpTimeMs)) {
				return Math.max(0, Math.min(flag.jumpTimeMs, tl.duration))
			}
			if (flag.jumpFlagId) {
				const ref = (tl.flags || []).find((f) => f.id === flag.jumpFlagId)
				if (ref && ref.id !== flag.id) return Math.max(0, Math.min(ref.timeMs, tl.duration))
			}
			return null
		},

		/**
		 * When the playhead crosses a flag time (prevMs < flag.timeMs <= ms), run the action.
		 * @returns {boolean} True if playback state changed such that this _tick should stop (pause / play restart).
		 */
		_processTimelineFlags(tlId, prevMs, ms) {
			const tl = this.timelines.get(tlId)
			if (!tl?.flags?.length) return false
			const flags = [...tl.flags].sort(
				(a, b) => a.timeMs - b.timeMs || String(a.id).localeCompare(String(b.id))
			)
			for (const f of flags) {
				if (prevMs < f.timeMs && ms >= f.timeMs) {
					const t = f.type || 'pause'
					if (t === 'pause') {
						this.pause(tlId)
						return true
					}
					if (t === 'play') {
						this.play(tlId, f.timeMs)
						return true
					}
					if (t === 'jump') {
						const target = this._resolveJumpTarget(f, tl)
						if (target != null) this.seek(tlId, target)
					}
					return false
				}
			}
			return false
		},

		play(id, fromMs) {
			const tl = this.timelines.get(id)
			if (!tl) return
			const pos = fromMs != null ? fromMs : this._pb?.timelineId === id ? this._pb.position : 0
			if (this._ticker) clearInterval(this._ticker)
			const wasPaused = this._pb?.timelineId === id && !this._pb?.playing && this._prevKey.size > 0
			if (wasPaused) {
				this._resumeAll()
			} else {
				this._prevKey = new Map()
				this._lastKfValues.clear()
			}
			this._lastTickPositionMs = undefined
			this._pb = {
				timelineId: id,
				position: pos,
				playing: true,
				loop: this._pb?.loop ?? false,
				sendTo: this._pb?.sendTo || { preview: true, program: true, screenIdx: 0 },
				_t0: Date.now(),
				_p0: pos,
			}
			if (!wasPaused) this._applyAt(id, pos, true)
			this._ticker = setInterval(() => this._tick(), TICK_MS)
			this._emitPb()
		},

		pause(id) {
			if (!this._pb || this._pb.timelineId !== id) return
			if (this._ticker) {
				clearInterval(this._ticker)
				this._ticker = null
			}
			this._lastTickPositionMs = undefined
			const now = this._nowMs()
			this._pb = { ...this._pb, position: now, _p0: now, _t0: Date.now(), playing: false }
			this._pauseAll()
			this._emitPb()
		},

		stop(id, opts) {
			if (!this._pb) return
			if (this._ticker) {
				clearInterval(this._ticker)
				this._ticker = null
			}
			this._lastTickPositionMs = undefined
			const saved = this._pb
			this._pb = { ...saved, position: 0, playing: false, _p0: 0, _t0: Date.now() }
			const tl = this.timelines.get(saved.timelineId)
			if (tl && !opts?.skipAmcp) this._stopAll(tl)
			this._prevKey = new Map()
			this._lastKfValues.clear()
			this._emitPb()
		},

		seek(id, ms) {
			const tl = this.timelines.get(id)
			if (!tl) return
			const pos = Math.max(0, Math.min(ms, tl.duration))
			if (!this._pb || this._pb.timelineId !== id) {
				this._pb = {
					timelineId: id,
					position: pos,
					playing: false,
					loop: false,
					// Keep last sendTo when switching timelines; else match UI (PRV + PGM).
					sendTo: this._pb?.sendTo || { preview: true, program: true, screenIdx: 0 },
					_t0: Date.now(),
					_p0: pos,
				}
			} else {
				this._pb = { ...this._pb, position: pos, _p0: pos, _t0: Date.now() }
				if (this._pb.playing) this._lastTickPositionMs = pos
			}
			this._applyAt(id, pos, true)
			this._emitPb()
		},

		setSendTo(sendTo) {
			const oldCh = this._pb ? this._channelsFor(this._pb.sendTo) : []
			if (!this._pb) this._pb = { position: 0, playing: false, loop: false, sendTo, _t0: Date.now(), _p0: 0 }
			else this._pb = { ...this._pb, sendTo }
			const newCh = this._channelsFor(sendTo)
			const removed = oldCh.filter((c) => !newCh.includes(c))
			if (removed.length > 0) {
				const tl = this.timelines.get(this._pb?.timelineId)
				const self = this.self
				if (tl && self?.amcp) {
					for (const ch of removed) {
						for (let li = 0; li < tl.layers.length; li++) {
							const caspLayer = this._caspLayer(ch, li)
							self.amcp.stop(ch, caspLayer).catch(() => {})
							this._prevKey.delete(`${ch}-${caspLayer}`)
							for (const pk of this._lastKfValues.keys()) {
								if (pk.startsWith(`${ch}-${caspLayer}-`)) this._lastKfValues.delete(pk)
							}
						}
					}
				}
			}
			this._emitPb()
		},

		setLoop(id, loop) {
			if (this._pb?.timelineId === id) this._pb = { ...this._pb, loop }
		},

		getPlayback() {
			if (!this._pb) return null
			const { _t0, _p0, ...rest } = this._pb
			return { ...rest, position: this._nowMs() }
		},

		_tick() {
			const pb = this._pb
			if (!pb?.playing) return
			const tl = this.timelines.get(pb.timelineId)
			if (!tl) return
			let ms = this._nowMs()
			const prevMs = this._lastTickPositionMs != null ? this._lastTickPositionMs : pb._p0
			if (this._processTimelineFlags(pb.timelineId, prevMs, ms)) return
			ms = this._nowMs()
			if (ms >= tl.duration) {
				if (pb.loop) {
					this.play(pb.timelineId, 0)
					return
				}
				this.stop(pb.timelineId)
				return
			}
			this._pb.position = ms
			this._applyAt(pb.timelineId, ms, false)
			this.emit('tick', { timelineId: pb.timelineId, position: ms })
			const ctx = this.self
			if (ctx && typeof ctx._wsBroadcast === 'function') {
				const t = Date.now()
				if (!this._lastTimelineTickSent || t - this._lastTimelineTickSent >= TIMELINE_TICK_BROADCAST_MS) {
					this._lastTimelineTickSent = t
					ctx._wsBroadcast('timeline.tick', { timelineId: pb.timelineId, position: ms })
				}
			}
			this._lastTickPositionMs = ms
		},

		_nowMs() {
			if (!this._pb?.playing) return this._pb?.position ?? 0
			return this._pb._p0 + (Date.now() - this._pb._t0)
		},

		_caspLayer(_ch, li) {
			return TIMELINE_LAYER_BASE + li
		},

		_applyAt(id, ms, force) {
			const tl = this.timelines.get(id)
			const self = this.self
			if (!tl || !self?.amcp) return
			const channels = this._channels()
			/** Channels that received at least one mixer command this frame — COMMIT only those (Caspar 2.5+). */
			const mixerDirty = new Set()

			for (let li = 0; li < tl.layers.length; li++) {
				const layer = tl.layers[li]
				const clip = this._clipAt(layer, ms)

				for (const ch of channels) {
					const caspLayer = this._caspLayer(ch, li)
					const key = `${ch}-${caspLayer}`
					const prev = this._prevKey.get(key)

					if (clip) {
						const src = String(clip.source?.value || '')
						const isRoute = src.startsWith('route://')
						const srcQ = clipParamForPlay(src)
						const newClip = !prev || prev.clipId !== clip.id
						const playing = this._pb?.playing ?? false
						const loopClip = clip.loopAlways || clip.loop
						const frame = !isRoute
							? Math.floor(((ms - clip.startTime) * tl.fps) / 1000) + (clip.inPoint || 0)
							: 0
						if (clip.loopAlways) {
							if (newClip) {
								self.amcp
									.raw(`PLAY ${ch}-${caspLayer} ${srcQ} LOOP${playAfSuffix(clip)}`)
									.catch(() => {})
							}
						} else if (force || newClip) {
							if (isRoute) {
								self.amcp.raw(`PLAY ${ch}-${caspLayer} ${srcQ}${playAfSuffix(clip)}`).catch(() => {})
							} else if (playing || loopClip) {
								const loopStr = loopClip ? ' LOOP' : ''
								self.amcp
									.raw(`PLAY ${ch}-${caspLayer} ${srcQ}${loopStr} SEEK ${frame}${playAfSuffix(clip)}`)
									.catch(() => {})
							} else {
								self.amcp
									.raw(`LOAD ${ch}-${caspLayer} ${srcQ} SEEK ${frame}${playAfSuffix(clip)}`)
									.catch(() => {})
							}
						} else if (force && !isRoute && prev?.clipId === clip.id) {
							self.amcp.call(ch, caspLayer, 'SEEK', String(frame)).catch(() => {})
						}
						if (force || newClip) {
							for (const pk of this._lastKfValues.keys()) {
								if (pk.startsWith(`${ch}-${caspLayer}-`)) this._lastKfValues.delete(pk)
							}
						}
						if (this._applyClipMixer(ch, caspLayer, clip, ms - clip.startTime)) {
							mixerDirty.add(ch)
						}
						this._prevKey.set(key, { clipId: clip.id })
					} else if (prev?.clipId) {
						self.amcp.stop(ch, caspLayer).catch(() => {})
						this._prevKey.set(key, null)
						for (const pk of this._lastKfValues.keys()) {
							if (pk.startsWith(`${ch}-${caspLayer}-`)) this._lastKfValues.delete(pk)
						}
					}
				}
			}
			for (const ch of channels) {
				if (mixerDirty.has(ch)) {
					self.amcp.mixerCommit(ch).catch(() => {})
				}
			}
		},

		/**
		 * @returns {boolean} True if any mixer command was sent (caller should COMMIT that channel on Caspar 2.5+).
		 */
		_applyClipMixer(ch, layer, clip, localMs) {
			const self = this.self
			if (!self?.amcp) return false
			const { w, h } = this._programResolutionForPlayback()
			const base = this._clipFillBaseNormalized(clip, w, h)
			const fx = this._interpProp(clip, 'fill_x', localMs, base.fill_x)
			const fy = this._interpProp(clip, 'fill_y', localMs, base.fill_y)
			const sx = this._interpProp(clip, 'scale_x', localMs, base.scale_x)
			const sy = this._interpProp(clip, 'scale_y', localMs, base.scale_y)
			const op = this._interpProp(clip, 'opacity', localMs, 1)
			const volRaw = this._interpProp(clip, 'volume', localMs, clip.volume != null ? clip.volume : 1)
			const vol = clip.muted ? 0 : volRaw

			let sent = false
			const kFill = `${ch}-${layer}-fill`
			const fillStr = `${fx},${fy},${sx},${sy}`
			if (this._lastKfValues.get(kFill) !== fillStr) {
				this._lastKfValues.set(kFill, fillStr)
				/** Same as scene-take: FILL x y xScale yScale duration — duration 0 = immediate (Caspar 2.5+). */
				self.amcp.mixerFill(ch, layer, fx, fy, sx, sy, 0).catch(() => {})
				sent = true
				if (typeof self.log === 'function') {
					self.log('debug', `[Timeline] MIXER ${ch}-${layer} FILL ${fx} ${fy} ${sx} ${sy} 0`)
				}
			}
			const kOp = `${ch}-${layer}-opacity`
			const lastOp = this._lastKfValues.get(kOp)
			if (lastOp === undefined || Math.abs(op - lastOp) >= 1e-5) {
				this._lastKfValues.set(kOp, op)
				self.amcp.mixerOpacity(ch, layer, op).catch(() => {})
				sent = true
			}
			const kVol = `${ch}-${layer}-volume`
			const lastVol = this._lastKfValues.get(kVol)
			if (lastVol === undefined || Math.abs(vol - lastVol) >= 1e-5) {
				this._lastKfValues.set(kVol, vol)
				self.amcp.mixerVolume(ch, layer, vol).catch(() => {})
				sent = true
			}
			return sent
		},

		_channelsFor(sendTo) {
			const st = sendTo || {}
			// Undefined preview/program must mean “on” (same as UI defaults). Only explicit `false` turns a bus off.
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
				if (previewOn) ch.push(map?.previewCh ? map.previewCh(i + 1) : (i + 1) * 2)
				if (programOn) ch.push(map?.programCh ? map.programCh(i + 1) : (i + 1) * 2 - 1)
			}
			if (screenIdx !== null) addScreen(screenIdx)
			else for (let i = 0; i < screenCount; i++) addScreen(i)
			if (ch.length === 0) ch.push(programOn ? map?.programCh?.(1) ?? 1 : map?.previewCh?.(1) ?? 2)
			return ch
		},

		_channels() {
			return this._channelsFor(this._pb?.sendTo)
		},

		_pauseAll() {
			const self = this.self
			if (!self?.amcp) return
			for (const key of this._prevKey.keys()) {
				const [ch, caspLayer] = key.split('-').map(Number)
				if (!isNaN(ch) && !isNaN(caspLayer)) self.amcp.pause(ch, caspLayer).catch(() => {})
			}
		},

		_resumeAll() {
			const self = this.self
			if (!self?.amcp) return
			for (const key of this._prevKey.keys()) {
				const [ch, caspLayer] = key.split('-').map(Number)
				if (!isNaN(ch) && !isNaN(caspLayer)) self.amcp.resume(ch, caspLayer).catch(() => {})
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
		},

		_emitPb() {
			this.emit('playback', this.getPlayback())
		},
	})
}

module.exports = { applyPlaybackMixin, TICK_MS, TIMELINE_TICK_BROADCAST_MS }

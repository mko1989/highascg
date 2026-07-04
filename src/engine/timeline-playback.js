/**
 * Timeline playback — ticker, AMCP apply, channel routing (mixin for TimelineEngine).
 * @see companion-module-casparcg-server/src/timeline-engine.js
 */
'use strict'

const { getProgramResolutionForScreen } = require('../utils/program-resolution')
const {
	parseResolutionAspect,
	TICK_MS,
	TIMELINE_TICK_BROADCAST_MS,
	normalizeTimelineSendTo,
} = require('./timeline-playback-helpers')
const timelinePlaybackAmcp = require('./timeline-playback-amcp')

function createPlaybackCell(position = 0) {
	const t = Date.now()
	return { position, playing: false, loop: false, _t0: t, _p0: position }
}

function cellNowMs(cell) {
	if (!cell?.playing) return cell?.position ?? 0
	return cell._p0 + (Date.now() - cell._t0)
}

function setCellPosition(cell, pos) {
	cell.position = pos
	cell._p0 = pos
	cell._t0 = Date.now()
}

/** @param {new (self: object) => object} TimelineEngineClass */
function applyPlaybackMixin(TimelineEngineClass) {
	Object.assign(TimelineEngineClass.prototype, {
		...timelinePlaybackAmcp,

		_pbFor(id) {
			let cell = this._playbackById.get(id)
			if (!cell) {
				cell = createPlaybackCell(0)
				this._playbackById.set(id, cell)
			}
			return cell
		},

		_sendToFor(id) {
			const tl = id ? this.timelines.get(id) : null
			if (tl?.sendTo && typeof tl.sendTo === 'object') return normalizeTimelineSendTo(tl.sendTo)
			return { preview: true, program: false, screenIdx: 0 }
		},
		addKeyframeAtNow(timelineId, layerIdx, property, value) {
			const tl = this.timelines.get(timelineId || this._airTimelineId)
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
			const tl = this.timelines.get(timelineId || this._airTimelineId)
			if (!tl) return null
			const layer = tl.layers[layerIdx]
			if (!layer) return null
			const ms = this._nowMs()
			const clip = this._clipAt(layer, ms)
			if (!clip) return null
			const localMs = Math.round(ms - clip.startTime)
			const screenIdx = this._sendToFor(timelineId || this._airTimelineId)?.screenIdx ?? 0
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
			if (this._airTimelineId === tl.id) this._applyAt(tl.id, ms, true)
			return {
				fill_x: nx / w,
				fill_y: ny / h,
				scale_x: nw / w,
				scale_y: nh / h,
			}
		},

		captureKeyframeAtNow(timelineId, layerIdx, param) {
			const tl = this.timelines.get(timelineId || this._airTimelineId)
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
			if (this._airTimelineId === tl.id) this._applyAt(tl.id, ms, true)
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
					// Companion button press — fire-and-forget HTTP POST (WO-24)
					if (t === 'companion_press') {
						const comp = this.self?.config?.companion || {}
						const host = comp.host || '127.0.0.1'
						const port = comp.port || 8000
						const page = f.companionPage ?? 1
						const row = f.companionRow ?? 0
						const col = f.companionColumn ?? 0
						const url = `http://${host}:${port}/api/location/${page}/${row}/${col}/press`
						fetch(url, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: '{}',
						}).catch((err) => {
							if (typeof this.self?.log === 'function') {
								this.self.log('warn', `[Timeline] Companion press failed: ${err.message}`)
							} else {
								console.warn('[Timeline] Companion press failed:', err.message)
							}
						})
					}
					return false
				}
			}
			return false
		},

		play(id, fromMs) {
			const tl = this.timelines.get(id)
			if (!tl) {
				const msg = `[Timeline] play(${id}): timeline not on server`
				if (typeof this.self?.log === 'function') this.self.log('warn', msg)
				else console.warn(msg)
				return
			}
			const cell = this._pbFor(id)
			const prevAir = this._airTimelineId
			const wasPausedResume = prevAir === id && this._canResumePlayback(id)

			if (this._ticker) clearInterval(this._ticker)

			if (prevAir && prevAir !== id) {
				const prevCell = this._pbFor(prevAir)
				if (prevCell.playing) {
					setCellPosition(prevCell, cellNowMs(prevCell))
					prevCell.playing = false
					this._emitPb(prevAir)
				}
				const prevTl = this.timelines.get(prevAir)
				if (prevTl && this.self?.amcp) {
					const prevCh = this._channelsFor(this._sendToFor(prevAir))
					this._stopAll(prevTl, prevCh)
				}
				this._prevKey = new Map()
				this._lastKfValues.clear()
				this._lastKfSegment.clear()
			}

			const pos = wasPausedResume
				? (cell.position ?? 0)
				: fromMs != null
					? fromMs
					: cell.position ?? 0

			this._airTimelineId = id
			setCellPosition(cell, pos)
			cell.playing = true

			if (wasPausedResume) {
				this._resumeAll()
			} else {
				if (prevAir === id) {
					this._prevKey = new Map()
					this._lastKfValues.clear()
					this._lastKfSegment.clear()
				}
				this._applyAt(id, pos, true)
			}

			this._lastTickPositionMs = undefined
			this._ticker = setInterval(() => this._tick(), TICK_MS)
			this._emitPb(id)
		},

		pause(id) {
			const cell = this._pbFor(id)
			if (!cell.playing && this._airTimelineId !== id) return
			if (this._airTimelineId === id) {
				if (this._ticker) {
					clearInterval(this._ticker)
					this._ticker = null
				}
				this._lastTickPositionMs = undefined
				const now = cellNowMs(cell)
				setCellPosition(cell, now)
				cell.playing = false
				this._pauseAll()
			} else {
				setCellPosition(cell, cellNowMs(cell))
				cell.playing = false
			}
			this._emitPb(id)
		},

		stop(id, opts) {
			if (!id) return
			const cell = this._pbFor(id)
			if (this._airTimelineId === id) {
				if (this._ticker) {
					clearInterval(this._ticker)
					this._ticker = null
				}
				this._lastTickPositionMs = undefined
				const tl = this.timelines.get(id)
				if (tl && !opts?.skipAmcp) this._stopAll(tl)
				this._prevKey = new Map()
				this._lastKfValues.clear()
				this._lastKfSegment.clear()
				this._airTimelineId = null
			}
			setCellPosition(cell, 0)
			cell.playing = false
			this._emitPb(id)
		},

		seek(id, ms) {
			const tl = this.timelines.get(id)
			if (!tl) return
			const cell = this._pbFor(id)
			const pos = Math.max(0, Math.min(ms, tl.duration))

			if (this._airTimelineId !== id) {
				const prevAir = this._airTimelineId
				if (prevAir && prevAir !== id) {
					const prevCell = this._pbFor(prevAir)
					if (prevCell.playing) {
						setCellPosition(prevCell, cellNowMs(prevCell))
						prevCell.playing = false
						this._emitPb(prevAir)
					}
					const prevTl = this.timelines.get(prevAir)
					if (prevTl && this.self?.amcp) {
						this._stopAll(prevTl, this._channelsFor(this._sendToFor(prevAir)))
					}
				}
				if (this._ticker) {
					clearInterval(this._ticker)
					this._ticker = null
				}
				this._airTimelineId = id
				this._prevKey = new Map()
				this._lastKfValues.clear()
				this._lastKfSegment.clear()
				setCellPosition(cell, pos)
				cell.playing = false
				this._applyAt(id, pos, true)
				this._emitPb(id)
				return
			}

			const samePausedPos = !cell.playing && Math.abs((cell.position ?? 0) - pos) < 1
			setCellPosition(cell, pos)
			if (cell.playing) this._lastTickPositionMs = pos
			if (samePausedPos) {
				this._emitPb(id)
				return
			}
			// While playing, Caspar runs at 1× — ignore redundant seeks at the same transport frame.
			if (cell.playing && !this._timelineSeekFrameChanged(id, pos)) {
				this._emitPb(id)
				return
			}
			this._applyAt(id, pos, true)
			this._emitPb(id)
		},

		setSendTo(sendTo, timelineId) {
			const tid = timelineId ?? this._airTimelineId
			if (!tid) return
			const tl = this.timelines.get(tid)
			const oldSt = this._sendToFor(tid)
			const oldCh = this._channelsFor(oldSt)
			if (tl) tl.sendTo = normalizeTimelineSendTo({ ...oldSt, ...sendTo })
			const newSt = this._sendToFor(tid)
			const newCh = this._channelsFor(newSt)
			const routingChanged =
				oldSt.preview !== newSt.preview ||
				oldSt.program !== newSt.program ||
				oldSt.screenIdx !== newSt.screenIdx ||
				oldCh.length !== newCh.length ||
				oldCh.some((c, i) => c !== newCh[i])
			if (this._airTimelineId === tid) {
				const removed = oldCh.filter((c) => !newCh.includes(c))
				if (removed.length > 0 && tl && this.self?.amcp) {
					const self = this.self
					for (const ch of removed) {
						for (let li = 0; li < tl.layers.length; li++) {
							const caspLayer = this._caspLayer(ch, li)
							self.amcp.stop(ch, caspLayer).catch(() => {})
							this._prevKey.delete(`${ch}-${caspLayer}`)
							for (const pk of this._lastKfValues.keys()) {
								if (pk.startsWith(`${ch}-${caspLayer}-`)) this._lastKfValues.delete(pk)
							}
							for (const pk of this._lastKfSegment.keys()) {
								if (pk.startsWith(`${ch}-${caspLayer}-`)) this._lastKfSegment.delete(pk)
							}
						}
					}
				}
				if (routingChanged && tl) {
					const cell = this._pbFor(tid)
					const pos = cell.playing ? cellNowMs(cell) : (cell.position ?? 0)
					this._applyAt(tid, pos, true)
				}
			}
			this._emitPb(tid)
		},

		setLoop(id, loop) {
			this._pbFor(id).loop = !!loop
			this._emitPb(id)
		},

		getPlayback(id) {
			const tid = id ?? this._airTimelineId
			if (!tid) return null
			const cell = this._pbFor(tid)
			const { _t0, _p0, ...rest } = cell
			return {
				...rest,
				timelineId: tid,
				sendTo: this._sendToFor(tid),
				position: cellNowMs(cell),
			}
		},

		_tick() {
			const airId = this._airTimelineId
			if (!airId) return
			const cell = this._pbFor(airId)
			if (!cell.playing) return
			const tl = this.timelines.get(airId)
			if (!tl) return
			let ms = cellNowMs(cell)
			const prevMs = this._lastTickPositionMs != null ? this._lastTickPositionMs : cell._p0
			if (this._processTimelineFlags(airId, prevMs, ms)) return
			ms = cellNowMs(cell)
			if (ms >= tl.duration) {
				if (cell.loop) {
					this.play(airId, 0)
					return
				}
				this.stop(airId)
				return
			}
			cell.position = ms
			// UI tick updates playhead only; AMCP transport runs on clip/state changes (not every 40ms).
			this._syncAmcpOnTimelineTick(airId, ms)
			this.emit('tick', { timelineId: airId, position: ms })
			const ctx = this.self
			if (ctx && typeof ctx._wsBroadcast === 'function') {
				const t = Date.now()
				if (!this._lastTimelineTickSent || t - this._lastTimelineTickSent >= TIMELINE_TICK_BROADCAST_MS) {
					this._lastTimelineTickSent = t
					ctx._wsBroadcast('timeline.tick', { timelineId: airId, position: ms })
				}
			}
			this._lastTickPositionMs = ms
		},

		_nowMs(id) {
			const tid = id ?? this._airTimelineId
			if (!tid) return 0
			return cellNowMs(this._pbFor(tid))
		},

		_emitPb(id) {
			const tid = id ?? this._airTimelineId
			if (!tid) return
			this.emit('playback', this.getPlayback(tid))
		},
	})
}

module.exports = { applyPlaybackMixin, TICK_MS, TIMELINE_TICK_BROADCAST_MS }

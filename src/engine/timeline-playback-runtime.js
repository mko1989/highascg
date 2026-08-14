'use strict'

const { TICK_MS, TIMELINE_TICK_BROADCAST_MS } = require('./timeline-playback-helpers')
const { normalizeTimelineSendTo } = require('./timeline-playback-helpers')

function cellNowMs(cell) {
	if (!cell?.playing) return cell?.position ?? 0
	return cell._p0 + (Date.now() - cell._t0)
}

function setCellPosition(cell, pos) {
	cell.position = pos
	cell._p0 = pos
	cell._t0 = Date.now()
}

module.exports = {
	/**
	 * @param {string} id
	 * @param {number} [fromMs]
	 * @param {{ takeFade?: boolean }} [opts] takeFade (WO-528): the CALLER presets these layers to
	 *   opacity 0 and will fade them in itself — used by `startSceneTimelineLayer` when a timeline
	 *   runs as a layer inside a look. Suppresses the engine's own instant OPACITY, which would
	 *   otherwise land the layer at full between the preset and the fade.
	 */
	play(id, fromMs, opts) {
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
			this._applyAt(id, pos, true, { takeFade: opts?.takeFade === true })
		}

		this._lastTickPositionMs = undefined
		this._ticker = setInterval(() => this._tick(), TICK_MS)
		this._emitPb(id)
	},

	/**
	 * Program take: always full transport + awaited mixer (clip fade-in keyframes). Never resume shortcut.
	 * @param {string} id
	 * @param {number} [fromMs]
	 * @param {{ takeFade?: boolean }} [opts] takeFade: the take orchestrator will fade these layers
	 *   in itself (MIX), so the per-clip instant OPACITY must be suppressed — see WO-528.
	 */
	async playForTake(id, fromMs, opts) {
		const tl = this.timelines.get(id)
		if (!tl) {
			const msg = `[Timeline] playForTake(${id}): timeline not on server`
			if (typeof this.self?.log === 'function') this.self.log('warn', msg)
			else console.warn(msg)
			return
		}
		const cell = this._pbFor(id)
		const prevAir = this._airTimelineId

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
		}

		const pos = fromMs != null ? fromMs : (cell.position ?? 0)
		this._airTimelineId = id
		setCellPosition(cell, pos)
		cell.playing = true

		// take: clip lead-opacity segments are batched as DEFER tweens and NOT committed here —
		// the take orchestrator (runTimelineDirectTake) issues one MIXER COMMIT per channel so
		// clip fade-ins fire frame-locked with the look crossfade (WO-139).
		this._applyAt(id, pos, true, { take: true, takeFade: opts?.takeFade === true })

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
			// A timeline leaving PGM must not stay flagged program:true. Take sets program:true and it
			// is persisted (project autosave); if it survives the stop, re-activating the Timeline tab
			// re-adopts that stale flag and re-routes the timeline back onto PGM — punching through
			// whatever replaced it (e.g. a look). Reset to preview-only on leaving air; the only thing
			// that puts a timeline back on PGM is an explicit Take. The reset rides the _emitPb below,
			// so clients clear their sticky copy via the playback broadcast (onPlayback).
			if (tl && tl.sendTo && tl.sendTo.program) {
				tl.sendTo = { preview: true, program: false, screenIdx: tl.sendTo.screenIdx ?? 0 }
			}
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
		if (cell.playing && !this._timelineSeekFrameChanged(id, pos)) {
			this._emitPb(id)
			return
		}
		this._applyAt(id, pos, true)
		this._emitPb(id)
	},

	setSendTo(sendTo, timelineId, opts) {
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
			const self = this.self
			if (routingChanged) {
				if (tl && self?.amcp) {
					for (let li = 0; li < tl.layers.length; li++) {
						for (const ch of oldCh) {
							const caspLayer = this._caspLayer(ch, li)
							self.amcp.stop(ch, caspLayer).catch((_err) => {
								if (typeof this.self?.log === 'function') {
									this.self.log('debug', `[Timeline] STOP ${ch}-${caspLayer} failed: ${_err.message}`)
								}
							})
						}
					}
				}
				this._prevKey = new Map()
				this._lastKfValues.clear()
				this._lastKfSegment.clear()
			}
			if (routingChanged && tl && !opts?.skipAmcpApply) {
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
}

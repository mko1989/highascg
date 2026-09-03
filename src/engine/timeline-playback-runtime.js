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
	 * @param {{ takeFade?: boolean, restart?: boolean }} [opts] takeFade (WO-528): the CALLER presets
	 *   these layers to opacity 0 and will fade them in itself — used by `startSceneTimelineLayer`
	 *   when a timeline runs as a layer inside a look. Suppresses the engine's own instant OPACITY,
	 *   which would otherwise land the layer at full between the preset and the fade.
	 *
	 *   restart (WO-537): the caller is demanding `fromMs`, not offering it. Without this the
	 *   paused-resume shortcut wins and `fromMs` is DISCARDED — deliberate for an operator pressing
	 *   Play (WO: "resume must ignore stale client fromMs"), wrong for a take, which must start
	 *   where it says. `playForTake` never resumes at all; this is the same guarantee for the look
	 *   path, which cannot use `playForTake` because its CUT branch has no orchestrator commit to
	 *   receive the DEFER lead tweens `take: true` would produce (the WO-519 fail-dark class).
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
		const wasPausedResume = prevAir === id && opts?.restart !== true && this._canResumePlayback(id)

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

	/**
	 * WO-545: mark `id` as having its opacity externally owned by a take orchestrator's own exit
	 * fade — `_syncAmcpLayers` folds this into `takeFade` for every regular tick while it's set, so
	 * the timeline's own per-tick opacity writes (steady-state or keyframe-segment) stop fighting
	 * the take's DEFERred fade-out for the whole teardown wait window instead of just its first
	 * apply. Pass `null` to release. `stop()` also clears it automatically so a hold can never
	 * outlive the timeline it was set for.
	 * @param {string|null} id
	 */
	setOpacityExitHold(id) {
		this._opacityExitHoldId = id || null
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
		if (this._opacityExitHoldId === id) this._opacityExitHoldId = null
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
				/* WO-555: a channel that is wanted by BOTH the old and the new routing (e.g. preview
				 * staying on while only program is added/removed) must never be stopped — it was
				 * unconditionally included in the old wholesale STOP-everything-then-reapply below,
				 * which is only harmless for a caller that also re-applies (the `!opts?.skipAmcpApply`
				 * branch a few lines down) to immediately re-establish it. `startSceneTimelineLayer`
				 * (timeline-take.js) always passes `skipAmcpApply: true`, so a routing change that only
				 * drops preview (or only drops program) left the channel that was SUPPOSED to keep
				 * playing freshly STOPped with nothing to restart it — a preview-scoped action (e.g.
				 * "preview a look whose own timeline is already live on program") stopping PROGRAM's
				 * physical layers as a side effect: "clicking a playing timeline look to send it to prv
				 * changes pgm to another random look" (todos02.09.26). Only channels being REMOVED
				 * (present in the old set, absent from the new one) get stopped. */
				const removedCh = oldCh.filter((c) => !newCh.includes(c))
				if (tl && self?.amcp && removedCh.length) {
					for (let li = 0; li < tl.layers.length; li++) {
						for (const ch of removedCh) {
							const caspLayer = this._caspLayer(ch, li)
							self.amcp.stop(ch, caspLayer).catch((_err) => {
								if (typeof this.self?.log === 'function') {
									this.self.log('debug', `[Timeline] STOP ${ch}-${caspLayer} failed: ${_err.message}`)
								}
							})
						}
					}
				}
				/* WO-558: the three transport/mixer caches below are keyed `${ch}-${caspLayer}[...]` —
				 * NOT per-channel maps — so wiping them entirely on ANY routing change (as this used
				 * to do) also drops the valid, still-accurate cached state for a channel that was
				 * NOT removed (e.g. program, when only preview's claim is being released). The next
				 * regular tick (`_tick()`, an unrelated ~40ms `setInterval`, not this call) then finds
				 * no `prev` entry for THAT channel's layers either, reads it as "transport never
				 * started", and force-restarts it — STOP+PLAY plus a full mixer reset — on a channel
				 * nothing was ever supposed to touch. Measured on the wire: previewing a plain,
				 * timeline-free look while a timeline played on program produced a full STOP/PLAY/MIXER
				 * block on program's own timeline layers ~20ms after the (correctly `skipAmcpApply`d)
				 * preview-release call — not from that call's own reapply, from the NEXT tick reading
				 * the now-empty cache (todos03.09.26: "sending looks on preview has effect on pgm
				 * channel"). Only drop cache entries for channels actually being REMOVED; a channel
				 * present in both `oldCh` and `newCh` keeps its cache, so the next tick still sees it
				 * as unchanged and leaves it alone. */
				if (removedCh.length) {
					for (const key of [...this._prevKey.keys()]) {
						if (removedCh.includes(Number(key.split('-')[0]))) this._prevKey.delete(key)
					}
					for (const key of [...this._lastKfValues.keys()]) {
						if (removedCh.includes(Number(key.split('-')[0]))) this._lastKfValues.delete(key)
					}
					for (const key of [...this._lastKfSegment.keys()]) {
						if (removedCh.includes(Number(key.split('-')[0]))) this._lastKfSegment.delete(key)
					}
				}
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

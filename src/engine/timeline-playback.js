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
const timelinePlaybackAmcpSend = require('./timeline-playback-amcp-send')
const timelinePlaybackAmcpSchedule = require('./timeline-playback-amcp-schedule')
const timelinePlaybackRuntime = require('./timeline-playback-runtime')

function createPlaybackCell(position = 0) {
	const t = Date.now()
	return { position, playing: false, loop: false, _t0: t, _p0: position }
}

function setCellPosition(cell, pos) {
	cell.position = pos
	cell._p0 = pos
	cell._t0 = Date.now()
}

/** @param {new (self: object) => object} TimelineEngineClass */
function applyPlaybackMixin(TimelineEngineClass) {
	Object.assign(TimelineEngineClass.prototype, {
		...timelinePlaybackAmcpSchedule,
		...timelinePlaybackAmcpSend,
		...timelinePlaybackRuntime,

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

		_fireCompanionPress(flag) {
			const page = flag.companionPage ?? 1
			const row = flag.companionRow ?? 0
			const col = flag.companionColumn ?? 0

			/* Try Satellite first (primary). WO-535: `pressButton` RETURNS whether the line went out —
			 * it exits silently when the socket is not connected, and the old code set `satelliteOk`
			 * unconditionally because only a synchronous throw could reach the catch. The press was
			 * then dropped with no fallback and no log, while the settings modal's Test press (pure
			 * HTTP, routes-companion-preview.js:179) kept working. That asymmetry IS the owner's
			 * report. The catch stays for a require/construct failure. */
			let satelliteOk = false
			try {
				const { getSatellitePreviewClient } = require('../companion/satellite-preview-client')
				satelliteOk = getSatellitePreviewClient().pressButton(page, row, col) === true
			} catch (_err) {
				/* require/construct failure only — `satelliteOk` is already false. */
			}

			// Fall back to HTTP API if satellite failed
			if (!satelliteOk) {
				// WO-535: one resolver, so the fallback cannot drift from the port the status probe
				// and the Test press use.
				const { resolveCompanionConfig } = require('../companion/companion-config')
				const { host, port } = resolveCompanionConfig(this.self?.config)
				const url = `http://${host}:${port}/api/location/${page}/${row}/${col}/press`

				fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: '{}',
				}).catch((err) => {
					if (typeof this.self?.log === 'function') {
						this.self.log('warn', `[Timeline] Companion press HTTP fallback failed: ${err.message}`)
					} else {
						console.warn('[Timeline] Companion press HTTP fallback failed:', err.message)
					}
				})
			}
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
					if (t === 'companion_press') {
						// Dispatch off-tick to prevent blocking playback sync; guard against stale execution
						const capturedId = tlId
						setImmediate(() => {
							if (this._airTimelineId === capturedId) this._fireCompanionPress(f)
						})
					}
					return false
				}
			}
			return false
		},

	})
}

module.exports = { applyPlaybackMixin, TICK_MS, TIMELINE_TICK_BROADCAST_MS }

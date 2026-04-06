/**
 * Timeline engine — data model, CRUD, interpolation helpers.
 * Playback and AMCP scheduling: timeline-playback.js (mixin)
 * @see companion-module-casparcg-server/src/timeline-engine.js
 */
'use strict'

const { EventEmitter } = require('events')
const { applyPlaybackMixin } = require('./timeline-playback')
const { getProgramResolutionForScreen } = require('../utils/program-resolution')

function uid() {
	return 'tl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

class TimelineEngine extends EventEmitter {
	constructor(self) {
		super()
		this.self = self
		this.timelines = new Map()
		this._pb = null
		this._ticker = null
		this._prevKey = new Map()
		this._lastKfValues = new Map()
	}

	create(opts) {
		const id = opts?.id || uid()
		const tl = {
			id,
			name: opts?.name || 'Timeline',
			duration: opts?.duration || 30000,
			fps: opts?.fps || 25,
			flags: Array.isArray(opts?.flags) ? opts.flags : [],
			layers: opts?.layers || [
				{ id: uid(), name: 'Layer 1', clips: [] },
				{ id: uid(), name: 'Layer 2', clips: [] },
				{ id: uid(), name: 'Layer 3', clips: [] },
			],
		}
		this.timelines.set(id, tl)
		this._emitChange()
		return tl
	}

	get(id) {
		return this.timelines.get(id) || null
	}

	getAll() {
		return [...this.timelines.values()]
	}

	update(id, tl) {
		if (!this.timelines.has(id)) return null
		this.timelines.set(id, { ...tl, id })
		this._emitChange()
		return this.timelines.get(id)
	}

	delete(id) {
		if (this._pb?.timelineId === id) this.stop(id)
		this.timelines.delete(id)
		this._emitChange()
	}

	/** Program canvas size for current playback sendTo (screen index). */
	_programResolutionForPlayback() {
		const screenIdx = this._pb?.sendTo?.screenIdx ?? 0
		return getProgramResolutionForScreen(this.self, screenIdx)
	}

	/**
	 * Mixer FILL components (normalized 0–1 style) from clip.fillPx, or full frame.
	 * @param {{ fillPx?: { x: number, y: number, w: number, h: number } }} clip
	 */
	_clipFillBaseNormalized(clip, w, h) {
		const fp = clip.fillPx
		if (!fp || typeof fp.x !== 'number' || typeof fp.w !== 'number' || fp.w < 1 || fp.h < 1) {
			return { fill_x: 0, fill_y: 0, scale_x: 1, scale_y: 1 }
		}
		return {
			fill_x: fp.x / w,
			fill_y: fp.y / h,
			scale_x: fp.w / w,
			scale_y: fp.h / h,
		}
	}

	/** Interpolated keyframe value at local time (ms inside clip), or default. Fill props default from clip.fillPx (pixels). */
	_interpProp(clip, prop, localMs, defVal) {
		let d = defVal
		if (prop === 'fill_x' || prop === 'fill_y' || prop === 'scale_x' || prop === 'scale_y') {
			const { w, h } = this._programResolutionForPlayback()
			const b = this._clipFillBaseNormalized(clip, w, h)
			if (prop === 'fill_x') d = b.fill_x
			else if (prop === 'fill_y') d = b.fill_y
			else if (prop === 'scale_x') d = b.scale_x
			else if (prop === 'scale_y') d = b.scale_y
		}
		const kfs = (clip.keyframes || []).filter((k) => k.property === prop).sort((a, b) => a.time - b.time)
		if (!kfs.length) return d
		const v = this._lerp(kfs, localMs)
		return v != null ? v : d
	}

	_lerp(kfs, t) {
		if (!kfs.length) return null
		if (t <= kfs[0].time) return kfs[0].value
		const last = kfs[kfs.length - 1]
		if (t >= last.time) return last.value
		for (let i = 0; i < kfs.length - 1; i++) {
			const a = kfs[i],
				b = kfs[i + 1]
			if (t >= a.time && t <= b.time) {
				return a.value + ((b.value - a.value) * (t - a.time)) / (b.time - a.time)
			}
		}
		return null
	}

	_clipAt(layer, ms) {
		for (const c of layer.clips || []) {
			if (ms >= c.startTime && ms < c.startTime + c.duration) return c
		}
		return null
	}

	_emitChange() {
		this.emit('change', this.getAll())
	}
}

applyPlaybackMixin(TimelineEngine)

module.exports = { TimelineEngine }

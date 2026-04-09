/**
 * Client-side timeline state manager — CRUD + localStorage persistence.
 * Source of truth for timeline structure on the client.
 * @see main_plan.md Prompt 16
 */

import { ensureLayerHeights, DEFAULT_LAYER_H } from './timeline-track-heights.js'

const STORAGE_KEY = 'casparcg_timelines_v1'

function uid() {
	return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

function defaultClip(source, startTime, duration) {
	return {
		id: uid(),
		source: source || null,
		startTime: startTime || 0,
		duration: duration || 5000,
		inPoint: 0,
		outPoint: null,
		keyframes: [],
		audioRoute: '1+2',
		muted: false,
		volume: 1,
		/** When true (default), changing W or H keeps media aspect when known — same as look editor. */
		aspectLocked: true,
		/** @type {'fill-canvas' | 'horizontal' | 'vertical' | 'stretch'} */
		contentFit: 'horizontal',
	}
}

function defaultLayer(name) {
	return { id: uid(), name: name || 'Layer', clips: [] }
}

function flagUid() {
	return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function defaultTimeline(opts) {
	return {
		id: opts?.id || uid(),
		name: opts?.name || 'Timeline',
		duration: opts?.duration || 30000,
		fps: opts?.fps || 25,
		flags: Array.isArray(opts?.flags) ? opts.flags : [],
		layers: opts?.layers || [
			defaultLayer('Layer 1'),
			defaultLayer('Layer 2'),
			defaultLayer('Layer 3'),
		],
	}
}

class TimelineStateManager {
	constructor() {
		this.timelines = []
		this.activeId = null
		this._listeners = new Map()
		this._load()
		if (this.timelines.length === 0) {
			const tl = defaultTimeline()
			ensureLayerHeights(tl)
			this.timelines.push(tl)
			this.activeId = tl.id
		}
	}

	// ── Timeline CRUD ─────────────────────────────────────────────────────────

	createTimeline(opts) {
		const tl = defaultTimeline(opts)
		ensureLayerHeights(tl)
		this.timelines.push(tl)
		this.activeId = tl.id
		this._save()
		return tl
	}

	updateTimeline(id, changes) {
		const tl = this.getTimeline(id)
		if (!tl) return null
		Object.assign(tl, changes)
		this._save()
		return tl
	}

	deleteTimeline(id) {
		const i = this.timelines.findIndex((t) => t.id === id)
		if (i < 0) return
		this.timelines.splice(i, 1)
		if (this.activeId === id) this.activeId = this.timelines[0]?.id || null
		if (this.timelines.length === 0) {
			const tl = defaultTimeline()
			ensureLayerHeights(tl)
			this.timelines.push(tl)
			this.activeId = tl.id
		}
		this._save()
	}

	getTimeline(id) {
		return this.timelines.find((t) => t.id === id) || null
	}

	getActive() {
		return (this.activeId && this.getTimeline(this.activeId)) || this.timelines[0] || null
	}

	/** All timelines (for Sources panel, dashboard). */
	getAll() {
		return [...this.timelines]
	}

	setActive(id) {
		this.activeId = id
		this._save()
	}

	// ── Timeline flags (playhead markers: pause / play / jump) ────────────────

	addFlag(timelineId, opts) {
		const tl = this.getTimeline(timelineId)
		if (!tl) return null
		if (!Array.isArray(tl.flags)) tl.flags = []
		const flag = {
			id: flagUid(),
			timeMs: Math.max(0, opts?.timeMs ?? 0),
			/** @type {'pause'|'play'|'jump'} */
			type: opts?.type && ['pause', 'play', 'jump'].includes(opts.type) ? opts.type : 'pause',
			jumpTimeMs: opts?.jumpTimeMs,
			jumpFlagId: opts?.jumpFlagId || undefined,
			label: typeof opts?.label === 'string' ? opts.label : '',
		}
		tl.flags.push(flag)
		tl.flags.sort((a, b) => a.timeMs - b.timeMs)
		this._save()
		return flag
	}

	updateFlag(timelineId, flagId, changes) {
		const tl = this.getTimeline(timelineId)
		if (!tl?.flags?.length) return null
		const f = tl.flags.find((x) => x.id === flagId)
		if (!f) return null
		Object.assign(f, changes)
		if (f.type && !['pause', 'play', 'jump'].includes(f.type)) f.type = 'pause'
		tl.flags.sort((a, b) => a.timeMs - b.timeMs)
		this._save()
		return f
	}

	removeFlag(timelineId, flagId) {
		const tl = this.getTimeline(timelineId)
		if (!tl?.flags?.length) return
		tl.flags = tl.flags.filter((x) => x.id !== flagId)
		this._save()
	}

	// ── Layer ops ─────────────────────────────────────────────────────────────

	addLayer(id, name) {
		const tl = this.getTimeline(id)
		if (!tl) return null
		const layer = defaultLayer(name || `Layer ${tl.layers.length + 1}`)
		tl.layers.push(layer)
		ensureLayerHeights(tl)
		this._save()
		return layer
	}

	insertLayer(id, afterIdx, name) {
		const tl = this.getTimeline(id)
		if (!tl) return null
		const layer = defaultLayer(name || `Layer ${afterIdx + 2}`)
		ensureLayerHeights(tl)
		tl.layers.splice(afterIdx + 1, 0, layer)
		tl.layerHeights.splice(afterIdx + 1, 0, DEFAULT_LAYER_H)
		ensureLayerHeights(tl)
		this._save()
		return layer
	}

	removeLayer(id, layerIdx) {
		const tl = this.getTimeline(id)
		if (!tl || layerIdx < 0 || layerIdx >= tl.layers.length) return
		tl.layers.splice(layerIdx, 1)
		if (Array.isArray(tl.layerHeights) && tl.layerHeights.length > layerIdx) tl.layerHeights.splice(layerIdx, 1)
		ensureLayerHeights(tl)
		this._save()
	}

	updateLayer(id, layerIdx, changes) {
		const tl = this.getTimeline(id)
		if (!tl || !tl.layers[layerIdx]) return null
		Object.assign(tl.layers[layerIdx], changes)
		this._save()
		return tl.layers[layerIdx]
	}

	// ── Clip ops ──────────────────────────────────────────────────────────────

	addClip(id, layerIdx, source, startTime, duration) {
		const tl = this.getTimeline(id)
		if (!tl || !tl.layers[layerIdx]) return null
		const clip = defaultClip(source, startTime, duration)
		tl.layers[layerIdx].clips.push(clip)
		this._save()
		return clip
	}

	updateClip(id, layerIdx, clipId, changes) {
		const clip = this._findClip(id, layerIdx, clipId)
		if (!clip) return null
		Object.assign(clip, changes)
		this._save()
		return clip
	}

	/**
	 * Deep-clone a clip object, assign a new id, set startTime, append to layer.
	 * @param {object} clip — plain clip object (e.g. from JSON clone)
	 */
	insertClipClone(timelineId, layerIdx, clip, startTime) {
		const tl = this.getTimeline(timelineId)
		if (!tl?.layers[layerIdx] || !clip) return null
		const c = JSON.parse(JSON.stringify(clip))
		c.id = uid()
		c.startTime = Math.max(0, startTime)
		tl.layers[layerIdx].clips.push(c)
		this._save()
		return c
	}

	/** Clone flag fields with a new id and time (jumpFlagId cleared — re-link in UI if needed). */
	duplicateFlag(timelineId, flag, timeMs) {
		const tl = this.getTimeline(timelineId)
		if (!tl || !flag) return null
		if (!Array.isArray(tl.flags)) tl.flags = []
		const f = {
			...JSON.parse(JSON.stringify(flag)),
			id: flagUid(),
			timeMs: Math.max(0, timeMs),
			jumpFlagId: undefined,
		}
		tl.flags.push(f)
		tl.flags.sort((a, b) => a.timeMs - b.timeMs)
		this._save()
		return f
	}

	removeClip(id, layerIdx, clipId) {
		const tl = this.getTimeline(id)
		if (!tl?.layers[layerIdx]) return
		const layer = tl.layers[layerIdx]
		const i = layer.clips.findIndex((c) => c.id === clipId)
		if (i >= 0) layer.clips.splice(i, 1)
		this._save()
	}

	// ── Keyframe ops ──────────────────────────────────────────────────────────

	/**
	 * Add a keyframe to a clip. Keeps keyframes sorted by time.
	 * If a keyframe with same time+property exists, it is replaced.
	 */
	addKeyframe(id, layerIdx, clipId, kf) {
		const clip = this._findClip(id, layerIdx, clipId)
		if (!clip) return null
		clip.keyframes = (clip.keyframes || []).filter(
			(k) => !(k.property === kf.property && k.time === kf.time)
		)
		clip.keyframes.push(kf)
		clip.keyframes.sort((a, b) => a.time - b.time)
		this._save()
		return kf
	}

	/** Remove a single keyframe by property + time. */
	removeKeyframe(id, layerIdx, clipId, property, time) {
		const clip = this._findClip(id, layerIdx, clipId)
		if (!clip) return
		clip.keyframes = (clip.keyframes || []).filter(
			(k) => !(k.property === property && Math.abs(k.time - time) < 0.5)
		)
		this._save()
	}

	/** Remove all keyframes with a given property from a clip. */
	clearKeyframesByProperty(id, layerIdx, clipId, property) {
		const clip = this._findClip(id, layerIdx, clipId)
		if (!clip) return
		clip.keyframes = (clip.keyframes || []).filter((k) => k.property !== property)
		this._save()
	}

	/** Add position keyframe (x,y) at given time — stores both fill_x and fill_y. */
	addPositionKeyframe(id, layerIdx, clipId, time, x, y) {
		const t = Math.max(0, time)
		this.addKeyframe(id, layerIdx, clipId, { time: t, property: 'fill_x', value: x ?? 0, easing: 'linear' })
		this.addKeyframe(id, layerIdx, clipId, { time: t, property: 'fill_y', value: y ?? 0, easing: 'linear' })
	}

	/** Add scale keyframe (locked: both x and y same value) at given time. */
	addScaleKeyframe(id, layerIdx, clipId, time, s) {
		const v = Math.max(0, Math.min(4, s ?? 1))
		const t = Math.max(0, time)
		this.addKeyframe(id, layerIdx, clipId, { time: t, property: 'scale_x', value: v, easing: 'linear' })
		this.addKeyframe(id, layerIdx, clipId, { time: t, property: 'scale_y', value: v, easing: 'linear' })
	}

	/** Remove position keyframes at given time (removes both fill_x and fill_y). */
	removePositionKeyframe(id, layerIdx, clipId, time) {
		this.removeKeyframe(id, layerIdx, clipId, 'fill_x', time)
		this.removeKeyframe(id, layerIdx, clipId, 'fill_y', time)
	}

	/** Remove scale keyframes at given time (removes both scale_x and scale_y). */
	removeScaleKeyframe(id, layerIdx, clipId, time) {
		this.removeKeyframe(id, layerIdx, clipId, 'scale_x', time)
		this.removeKeyframe(id, layerIdx, clipId, 'scale_y', time)
	}

	/** Remove opacity keyframes in given time range [fromMs, toMs]. */
	clearKeyframeRange(id, layerIdx, clipId, property, fromMs, toMs) {
		const clip = this._findClip(id, layerIdx, clipId)
		if (!clip) return
		clip.keyframes = (clip.keyframes || []).filter(
			(k) => !(k.property === property && k.time >= fromMs && k.time <= toMs)
		)
		this._save()
	}

	/** Move keyframe at index to new time (for drag). Clamps to 0..clip.duration. */
	updateKeyframeTime(id, layerIdx, clipId, keyframeIdx, newTime) {
		const clip = this._findClip(id, layerIdx, clipId)
		if (!clip?.keyframes?.[keyframeIdx]) return null
		const kf = clip.keyframes[keyframeIdx]
		const clamped = Math.max(0, Math.min(newTime, clip.duration || 999999))
		if (clamped === kf.time) return kf
		clip.keyframes.splice(keyframeIdx, 1)
		clip.keyframes.push({ ...kf, time: clamped })
		clip.keyframes.sort((a, b) => a.time - b.time)
		this._save()
		return clip.keyframes.find((k) => k.property === kf.property && k.time === clamped)
	}

	// ── Persistence ───────────────────────────────────────────────────────────

	_save() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ timelines: this.timelines, activeId: this.activeId }))
		} catch {}
		this._emit('change')
	}

	/** Export data for project save. */
	getExportData() {
		return { timelines: this.timelines, activeId: this.activeId }
	}

	/** Load from project data (replaces current state, persists to localStorage). */
	loadFromData(data) {
		if (!data || !Array.isArray(data.timelines)) return
		this.timelines = data.timelines.length ? data.timelines : [defaultTimeline()]
		for (const tl of this.timelines) {
			if (!Array.isArray(tl.flags)) tl.flags = []
			ensureLayerHeights(tl)
		}
		this.activeId = data.activeId || this.timelines[0]?.id || null
		this._save()
	}

	_load() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY)
			if (raw) {
				const data = JSON.parse(raw)
				if (Array.isArray(data.timelines) && data.timelines.length) {
					this.timelines = data.timelines
					this.activeId = data.activeId || data.timelines[0]?.id || null
					for (const tl of this.timelines) {
						if (!Array.isArray(tl.flags)) tl.flags = []
						ensureLayerHeights(tl)
					}
				}
			}
		} catch {}
	}

	on(key, fn) {
		if (!this._listeners.has(key)) this._listeners.set(key, [])
		this._listeners.get(key).push(fn)
		return () => {
			const fns = this._listeners.get(key)
			if (fns) { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1) }
		}
	}

	_emit(key) {
		const fns = this._listeners.get(key)
		if (fns) fns.forEach((fn) => fn())
	}

	_findClip(id, layerIdx, clipId) {
		const tl = this.getTimeline(id)
		if (!tl?.layers[layerIdx]) return null
		return tl.layers[layerIdx].clips.find((c) => c.id === clipId) || null
	}
}

export const timelineState = new TimelineStateManager()
export { defaultClip, defaultLayer, defaultTimeline, flagUid, uid }
export default TimelineStateManager

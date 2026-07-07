/**
 * Client-side timeline state manager — CRUD + localStorage persistence.
 * Source of truth for timeline structure on the client.
 * @see main_plan.md Prompt 16
 */

import { ensureLayerHeights, DEFAULT_LAYER_H } from './timeline-track-heights.js'
import {
	STORAGE_KEY,
	DEFAULT_SEND_TO,
	normalizeSendTo,
	ensureTimelineSendTo,
	defaultClip,
	defaultLayer,
	defaultTimeline,
	flagUid,
	uid,
	isValidFlagType,
	normalizeLoadedTimelines,
	findClipOnTimeline,
} from './timeline-state-model.js'
import { timelineClipMethods } from './timeline-state-clips.js'
import { timelineKeyframeMethods } from './timeline-state-keyframes.js'

/** Next unused default name (Layer 1, Layer 2, ...) even after renames or gaps. */
export function nextLayerDisplayName(tl) {
	const layers = Array.isArray(tl?.layers) ? tl.layers : []
	let maxNum = 0
	for (const l of layers) {
		const m = String(l?.name || '').match(/^Layer\s+(\d+)$/i)
		if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10))
	}
	return `Layer ${Math.max(maxNum, layers.length) + 1}`
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

	// -- Timeline CRUD ----------------------------------------------------------

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

	/** Persisted PRV/PGM routing for a timeline. */
	getSendTo(id) {
		const tl = this.getTimeline(id)
		return normalizeSendTo(tl?.sendTo)
	}

	/** Update persisted PRV/PGM routing; triggers project autosave via `change`. */
	setSendTo(id, sendTo) {
		const tl = this.getTimeline(id)
		if (!tl) return null
		tl.sendTo = normalizeSendTo({ ...tl.sendTo, ...sendTo })
		this._save()
		return tl.sendTo
	}

	// -- Timeline flags (playhead markers: pause / play / jump / companion_press) --

	addFlag(timelineId, opts) {
		const tl = this.getTimeline(timelineId)
		if (!tl) return null
		if (!Array.isArray(tl.flags)) tl.flags = []
		const flag = {
			id: flagUid(),
			timeMs: Math.max(0, opts?.timeMs ?? 0),
			type: opts?.type && isValidFlagType(opts.type) ? opts.type : 'pause',
			jumpTimeMs: opts?.jumpTimeMs,
			jumpFlagId: opts?.jumpFlagId || undefined,
			label: typeof opts?.label === 'string' ? opts.label : '',
		}
		tl.flags.push(flag)
		tl.flags.sort((a, b) => a.timeMs - b.timeMs)
		this.expandDurationToContent(timelineId)
		this._save()
		return flag
	}

	updateFlag(timelineId, flagId, changes) {
		const tl = this.getTimeline(timelineId)
		if (!tl?.flags?.length) return null
		const f = tl.flags.find((x) => x.id === flagId)
		if (!f) return null
		Object.assign(f, changes)
		if (f.type && !isValidFlagType(f.type)) f.type = 'pause'
		tl.flags.sort((a, b) => a.timeMs - b.timeMs)
		this.expandDurationToContent(timelineId)
		this._save()
		return f
	}

	removeFlag(timelineId, flagId) {
		const tl = this.getTimeline(timelineId)
		if (!tl?.flags?.length) return
		tl.flags = tl.flags.filter((x) => x.id !== flagId)
		this._save()
	}

	// -- Layer ops --------------------------------------------------------------

	reorderLayer(id, fromIdx, toIdx) {
		const tl = this.getTimeline(id)
		if (!tl || fromIdx < 0 || fromIdx >= tl.layers.length || toIdx < 0 || toIdx >= tl.layers.length) return false
		if (fromIdx === toIdx) return true

		const layer = tl.layers.splice(fromIdx, 1)[0]
		tl.layers.splice(toIdx, 0, layer)

		if (Array.isArray(tl.layerHeights)) {
			const h = tl.layerHeights.splice(fromIdx, 1)[0]
			tl.layerHeights.splice(toIdx, 0, h)
		}

		this._save()
		return true
	}

	addLayer(id, name) {
		const tl = this.getTimeline(id)
		if (!tl) return null
		const layer = defaultLayer(name || nextLayerDisplayName(tl))
		tl.layers.push(layer)
		ensureLayerHeights(tl)
		this._save()
		return layer
	}

	insertLayer(id, afterIdx, name) {
		const tl = this.getTimeline(id)
		if (!tl) return null
		const layer = defaultLayer(name || nextLayerDisplayName(tl))
		ensureLayerHeights(tl)
		tl.layers.splice(afterIdx + 1, 0, layer)
		tl.layerHeights.splice(afterIdx + 1, 0, DEFAULT_LAYER_H)
		ensureLayerHeights(tl)
		this._save()
		return layer
	}

	/** Insert below `layerIdx`, or append when index is out of range. */
	insertLayerBelow(id, layerIdx) {
		const tl = this.getTimeline(id)
		if (!tl) return null
		const name = nextLayerDisplayName(tl)
		if (layerIdx == null || layerIdx < 0 || layerIdx >= tl.layers.length) {
			return this.addLayer(id, name)
		}
		return this.insertLayer(id, layerIdx, name)
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

	// -- Persistence ------------------------------------------------------------

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
	loadFromData(data, opts = {}) {
		if (!data || !Array.isArray(data.timelines)) return
		this.timelines = data.timelines.length ? data.timelines : [defaultTimeline()]
		normalizeLoadedTimelines(this.timelines)
		this.activeId = data.activeId || this.timelines[0]?.id || null
		if (opts.silent) {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify({ timelines: this.timelines, activeId: this.activeId }))
			} catch {}
		} else {
			this._save()
		}
	}

	_load() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY)
			if (raw) {
				const data = JSON.parse(raw)
				if (Array.isArray(data.timelines) && data.timelines.length) {
					this.timelines = data.timelines
					this.activeId = data.activeId || data.timelines[0]?.id || null
					normalizeLoadedTimelines(this.timelines)
				}
			}
		} catch {}
	}

	on(key, fn) {
		if (!this._listeners.has(key)) this._listeners.set(key, [])
		this._listeners.get(key).push(fn)
		return () => {
			const fns = this._listeners.get(key)
			if (fns) {
				const i = fns.indexOf(fn)
				if (i >= 0) fns.splice(i, 1)
			}
		}
	}

	_emit(key) {
		const fns = this._listeners.get(key)
		if (fns) fns.forEach((fn) => fn())
	}

	_findClip(id, layerIdx, clipId) {
		const tl = this.getTimeline(id)
		if (!tl) return null
		return findClipOnTimeline(tl, layerIdx, clipId)
	}
}

Object.assign(TimelineStateManager.prototype, timelineClipMethods)
Object.assign(TimelineStateManager.prototype, timelineKeyframeMethods)

export const timelineState = new TimelineStateManager()
export { DEFAULT_SEND_TO, normalizeSendTo, defaultClip, defaultLayer, defaultTimeline, flagUid, uid }
export default TimelineStateManager

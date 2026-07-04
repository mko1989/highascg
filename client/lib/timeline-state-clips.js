/**
 * Timeline clip and flag mutation helpers (mixed into TimelineStateManager).
 */

import {
	CONTENT_END_PADDING_MS,
	computeContentEndMs,
	defaultClip,
	flagUid,
	uid,
} from './timeline-state-model.js'

export const timelineClipMethods = {
	moveClipToLayer(id, clipId, fromLayerIdx, toLayerIdx) {
		const tl = this.getTimeline(id)
		if (!tl || !tl.layers[fromLayerIdx] || !tl.layers[toLayerIdx]) return null
		const fromLayer = tl.layers[fromLayerIdx]
		const clipIdx = fromLayer.clips.findIndex((c) => c.id === clipId)
		if (clipIdx < 0) return null
		const clip = fromLayer.clips.splice(clipIdx, 1)[0]
		tl.layers[toLayerIdx].clips.push(clip)
		this._save()
		return clip
	},

	addClip(id, layerIdx, source, startTime, duration) {
		const tl = this.getTimeline(id)
		if (!tl || !tl.layers[layerIdx]) return null
		const clip = defaultClip(source, startTime, duration)
		tl.layers[layerIdx].clips.push(clip)
		this.expandDurationToContent(id)
		this._save()
		return clip
	},

	updateClip(id, layerIdx, clipId, changes) {
		const clip = this._findClip(id, layerIdx, clipId)
		if (!clip) return null
		Object.assign(clip, changes)
		this.expandDurationToContent(id)
		this._save()
		return clip
	},

	replaceClipSource(id, layerIdx, clipId, source, durationMs) {
		const clip = this._findClip(id, layerIdx, clipId)
		if (!clip) return null
		const duration = Math.max(1, Number(durationMs) || 5000)
		clip.source = source || null
		clip.duration = duration
		clip.inPoint = 0
		clip.outPoint = null
		for (const kf of clip.keyframes || []) {
			if (kf.time > duration) kf.time = duration
		}
		this.expandDurationToContent(id)
		this._save()
		return clip
	},

	findClipAtTime(id, layerIdx, timeMs) {
		const tl = this.getTimeline(id)
		if (!tl) return null
		const layer = tl.layers?.[layerIdx]
		if (!layer?.clips?.length) return null
		const t = Number(timeMs) || 0
		return (
			layer.clips.find((c) => t >= c.startTime && t < c.startTime + (c.duration || 0)) || null
		)
	},

	insertClipClone(timelineId, layerIdx, clip, startTime) {
		const tl = this.getTimeline(timelineId)
		if (!tl?.layers[layerIdx] || !clip) return null
		const c = JSON.parse(JSON.stringify(clip))
		c.id = uid()
		c.startTime = Math.max(0, startTime)
		tl.layers[layerIdx].clips.push(c)
		this.expandDurationToContent(timelineId)
		this._save()
		return c
	},

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
		this.expandDurationToContent(timelineId)
		this._save()
		return f
	},

	removeClip(id, layerIdx, clipId) {
		const tl = this.getTimeline(id)
		if (!tl?.layers[layerIdx]) return
		const layer = tl.layers[layerIdx]
		const i = layer.clips.findIndex((c) => c.id === clipId)
		if (i >= 0) layer.clips.splice(i, 1)
		this._save()
	},

	expandDurationToContent(timelineId) {
		const tl = this.getTimeline(timelineId)
		if (!tl) return false
		const contentEnd = computeContentEndMs(tl)
		const target = Math.ceil(contentEnd + CONTENT_END_PADDING_MS)
		if (target > tl.duration) {
			tl.duration = target
			return true
		}
		return false
	},
}

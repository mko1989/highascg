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
		/* WO-523: remember the media's own length, so a later edge-drag can be told apart from a clip
		 * that simply matches its media. Without this there is no way, after the fact, to know whether
		 * a duration was chosen by the operator or inherited from the file. */
		clip.naturalDuration = clip.duration
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

	/**
	 * Swap the media under an existing clip, keeping the clip the operator built.
	 *
	 * WO-523 — owner: *"when copying a clip in timelines to another layer then dropping a different
	 * media on to it, i want it to preserve all the settings … also when the clip was 'extended'
	 * (dragged by the clips edge to make take up more space in the timeline) it should preserve that
	 * too."*
	 *
	 * A clip whose length the operator set by dragging its edge keeps that length; a clip that was
	 * simply as long as its media adopts the new media's length. `naturalDuration` is what makes the
	 * two distinguishable.
	 *
	 * @param {number} durationMs natural length of the INCOMING media
	 */
	replaceClipSource(id, layerIdx, clipId, source, durationMs) {
		const clip = this._findClip(id, layerIdx, clipId)
		if (!clip) return null
		const incoming = Math.max(1, Number(durationMs) || 5000)
		const prevNatural = Number(clip.naturalDuration)
		const prevDuration = Math.max(1, Number(clip.duration) || 0)
		/* Unknown `naturalDuration` means a clip created before this was tracked. Preserve its length:
		 * the owner's stated want is to keep an extension, and silently shrinking a clip they had
		 * stretched is the worse error. */
		const wasResizedByOperator = !Number.isFinite(prevNatural) || prevNatural <= 0 || prevDuration !== prevNatural
		const duration = wasResizedByOperator ? prevDuration : incoming
		clip.source = source || null
		clip.duration = duration
		clip.naturalDuration = incoming
		/* Trim points index into the OUTGOING media and mean nothing for the new file — reset, as
		 * before. The transform (`fillPx`) is deliberately untouched: that is the "preserve all the
		 * settings" half, and the aspect refit is applied by the caller (WO-520). */
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

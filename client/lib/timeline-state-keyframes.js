/**
 * Timeline keyframe mutation helpers (mixed into TimelineStateManager).
 */

export const timelineKeyframeMethods = {
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
	},

	removeKeyframe(id, layerIdx, clipId, property, time) {
		const clip = this._findClip(id, layerIdx, clipId)
		if (!clip) return
		clip.keyframes = (clip.keyframes || []).filter(
			(k) => !(k.property === property && Math.abs(k.time - time) < 0.5)
		)
		this._save()
	},

	clearKeyframesByProperty(id, layerIdx, clipId, property) {
		const clip = this._findClip(id, layerIdx, clipId)
		if (!clip) return
		clip.keyframes = (clip.keyframes || []).filter((k) => k.property !== property)
		this._save()
	},

	addPositionKeyframe(id, layerIdx, clipId, time, x, y) {
		const t = Math.max(0, time)
		this.addKeyframe(id, layerIdx, clipId, { time: t, property: 'fill_x', value: x ?? 0, easing: 'linear' })
		this.addKeyframe(id, layerIdx, clipId, { time: t, property: 'fill_y', value: y ?? 0, easing: 'linear' })
	},

	addScaleKeyframe(id, layerIdx, clipId, time, s) {
		const v = Math.max(0, Math.min(4, s ?? 1))
		const t = Math.max(0, time)
		this.addKeyframe(id, layerIdx, clipId, { time: t, property: 'scale_x', value: v, easing: 'linear' })
		this.addKeyframe(id, layerIdx, clipId, { time: t, property: 'scale_y', value: v, easing: 'linear' })
	},

	removePositionKeyframe(id, layerIdx, clipId, time) {
		this.removeKeyframe(id, layerIdx, clipId, 'fill_x', time)
		this.removeKeyframe(id, layerIdx, clipId, 'fill_y', time)
	},

	removeScaleKeyframe(id, layerIdx, clipId, time) {
		this.removeKeyframe(id, layerIdx, clipId, 'scale_x', time)
		this.removeKeyframe(id, layerIdx, clipId, 'scale_y', time)
	},

	clearKeyframeRange(id, layerIdx, clipId, property, fromMs, toMs) {
		const clip = this._findClip(id, layerIdx, clipId)
		if (!clip) return
		clip.keyframes = (clip.keyframes || []).filter(
			(k) => !(k.property === property && k.time >= fromMs && k.time <= toMs)
		)
		this._save()
	},

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
	},
}

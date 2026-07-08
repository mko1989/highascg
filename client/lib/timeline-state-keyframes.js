/**
 * Timeline keyframe mutation helpers (mixed into TimelineStateManager).
 */

/**
 * Clamp a dragged keyframe's local time to its clip and same-property neighbours.
 * v1 drag semantics (WO-152 B152.2): a keyframe cannot cross an adjacent keyframe
 * of the SAME property — it clamps `minGapMs` short of it (no swap/reorder).
 * Keyframes of other properties are not barriers.
 * @param {Array<{time: number, property: string}>} keyframes sorted or not
 * @param {number} keyframeIdx index of the dragged keyframe
 * @param {number} newTime requested local time (ms)
 * @param {number} duration clip duration (ms)
 */
export function clampKeyframeDragTime(keyframes, keyframeIdx, newTime, duration, minGapMs = 1) {
	const kf = keyframes?.[keyframeIdx]
	const hiBound = Math.max(0, duration ?? Number.MAX_SAFE_INTEGER)
	if (!kf) return Math.max(0, Math.min(newTime, hiBound))
	let lo = 0
	let hi = hiBound
	for (let i = 0; i < keyframes.length; i++) {
		if (i === keyframeIdx) continue
		const k = keyframes[i]
		if (k.property !== kf.property) continue
		if (k.time <= kf.time) lo = Math.max(lo, k.time + minGapMs)
		else hi = Math.min(hi, k.time - minGapMs)
	}
	if (hi < lo) return kf.time
	return Math.max(lo, Math.min(newTime, hi))
}

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

	/**
	 * Move a keyframe in time. Clamps to the clip and to adjacent same-property
	 * keyframes (no crossing — WO-152 B152.2). Mutates the keyframe IN PLACE so
	 * callers holding a reference (canvas drag state) stay valid across re-sorts.
	 */
	updateKeyframeTime(id, layerIdx, clipId, keyframeIdx, newTime) {
		const clip = this._findClip(id, layerIdx, clipId)
		const kf = clip?.keyframes?.[keyframeIdx]
		if (!kf) return null
		const clamped = clampKeyframeDragTime(clip.keyframes, keyframeIdx, newTime, clip.duration || 999999)
		if (clamped === kf.time) return kf
		kf.time = clamped
		clip.keyframes.sort((a, b) => a.time - b.time)
		this._save()
		return kf
	},
}

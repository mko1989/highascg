/**
 * Timeline canvas snap helpers for clip move/resize + keyframe drag (WO-152 B152.2).
 * Pure logic only (no DOM imports) — covered by tools/smoke/smoke-timeline-keyframe-dnd.test.js.
 */

export function snapValue(val, candidates, threshold) {
	let bestDiff = threshold
	let bestCandidate = val
	for (const c of candidates) {
		const diff = Math.abs(val - c)
		if (diff < bestDiff) {
			bestDiff = diff
			bestCandidate = c
		}
	}
	return bestCandidate
}

/** @param {object} tl
 * @param {() => object|null} getPlayback
 * @param {{ layerIdx?: number, clipId?: string }} [exclude]
 */
export function collectTimelineSnapCandidates(tl, getPlayback, exclude = {}) {
	const candidates = [0, tl.duration]
	const pb = getPlayback()
	const nowPointer = pb && pb.position != null ? Number(pb.position) : null
	if (nowPointer != null) candidates.push(nowPointer)
	for (const f of tl.flags || []) candidates.push(f.timeMs)
	for (let lIdx = 0; lIdx < tl.layers.length; lIdx++) {
		const layer = tl.layers[lIdx]
		for (const c of layer.clips || []) {
			if (lIdx === exclude.layerIdx && c.id === exclude.clipId) continue
			candidates.push(c.startTime, c.startTime + c.duration)
		}
	}
	return { candidates, nowPointer }
}

export function resolveSnappedStart(rawStart, dur, candidates, thresholdMs, nowPointer) {
	let snapStart = snapValue(rawStart, candidates, thresholdMs)
	let snapEnd = snapValue(rawStart + dur, candidates, thresholdMs) - dur

	let newStart = rawStart
	if (Math.abs(snapStart - rawStart) <= Math.abs(snapEnd - rawStart)) {
		if (Math.abs(snapStart - rawStart) < thresholdMs) newStart = snapStart
	} else if (Math.abs(snapEnd - rawStart) < thresholdMs) {
		newStart = snapEnd
	}

	if (nowPointer != null) {
		const nowThresholdMs = thresholdMs * (14 / 8)
		const distStart = Math.abs(rawStart - nowPointer)
		const distEnd = Math.abs(rawStart + dur - nowPointer)
		if (distStart < nowThresholdMs || distEnd < nowThresholdMs) {
			newStart = distStart <= distEnd ? nowPointer : nowPointer - dur
		}
	}

	return Math.max(0, newStart)
}

export function resolveSnappedEdge(rawEdge, candidates, thresholdMs, nowPointer) {
	let edge = snapValue(rawEdge, candidates, thresholdMs)
	let resolved = Math.abs(edge - rawEdge) < thresholdMs ? edge : rawEdge
	if (nowPointer != null) {
		const nowThresholdMs = thresholdMs * (14 / 8)
		if (Math.abs(rawEdge - nowPointer) < nowThresholdMs) resolved = nowPointer
	}
	return resolved
}

// -- Keyframe drag: snap candidates + marker geometry (shared draw/hit-test) --

/**
 * Snap candidates for dragging a keyframe, in absolute timeline ms.
 * Includes playhead, flags, every clip edge (own clip too — clamp targets) and
 * every other keyframe on the timeline. The dragged keyframe is excluded by
 * object identity so it never snaps to itself.
 * @param {object} tl
 * @param {() => object|null} getPlayback
 * @param {{ excludeKf?: object }} [opts]
 */
export function collectKeyframeSnapCandidates(tl, getPlayback, opts = {}) {
	const candidates = [0, tl.duration]
	const pb = getPlayback()
	const nowPointer = pb && pb.position != null ? Number(pb.position) : null
	if (nowPointer != null) candidates.push(nowPointer)
	for (const f of tl.flags || []) candidates.push(f.timeMs)
	for (const layer of tl.layers) {
		for (const c of layer.clips || []) {
			candidates.push(c.startTime, c.startTime + c.duration)
			for (const kf of c.keyframes || []) {
				if (kf === opts.excludeKf) continue
				candidates.push(c.startTime + kf.time)
			}
		}
	}
	return { candidates, nowPointer }
}

/** Vertical padding of the keyframe lane inside a clip row (matches clip drawing). */
export const KF_ROW_PAD = 7

/** Half-size of the keyframe diamond hit zone, in canvas px. */
export const KF_HIT_RADIUS_PX = 8

/** Properties whose 0..1 value maps to marker height inside the clip row. */
export function isNormalizedKeyframeProperty(prop) {
	return prop === 'opacity' || prop === 'volume'
}

/**
 * Marker centre Y offset from the top of the clip row.
 * Value-aware for opacity/volume (drawn at value height); bottom lane otherwise.
 */
export function keyframeMarkerOffsetY(kf, rowH) {
	const innerH = Math.max(0, rowH - KF_ROW_PAD * 2)
	if (isNormalizedKeyframeProperty(kf.property)) {
		const val = Math.max(0, Math.min(1, kf.value || 0))
		return rowH - KF_ROW_PAD - val * innerH
	}
	return rowH - KF_ROW_PAD
}

/**
 * Nearest keyframe index within the hit radius of canvas point (cx, cy), else null.
 * Pure: `xAt` maps timeline ms to canvas x; row geometry is passed in.
 * @param {object} clip
 * @param {number} rowY clip row top (canvas px)
 * @param {number} rowH clip row height (canvas px)
 */
export function hitTestKeyframeIndex(clip, rowY, rowH, cx, cy, xAt, radiusPx = KF_HIT_RADIUS_PX) {
	const kfs = clip?.keyframes
	if (!kfs?.length || rowH < 8) return null
	let best = null
	let bestDist = Infinity
	for (let i = 0; i < kfs.length; i++) {
		const dx = cx - xAt(clip.startTime + kfs[i].time)
		const dy = cy - (rowY + keyframeMarkerOffsetY(kfs[i], rowH))
		if (Math.abs(dx) > radiusPx || Math.abs(dy) > radiusPx) continue
		const d = dx * dx + dy * dy
		if (d < bestDist) {
			bestDist = d
			best = i
		}
	}
	return best
}

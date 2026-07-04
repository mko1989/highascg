/**
 * Timeline canvas snap helpers for clip move/resize.
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

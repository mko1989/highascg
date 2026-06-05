'use strict'

/** Properties that map to a single MIXER FILL command. */
const FILL_KF_PROPS = ['fill_x', 'fill_y', 'scale_x', 'scale_y']

/**
 * Sorted unique keyframe times (ms, clip-local) for fill/scale props.
 * @param {{ keyframes?: Array<{ property: string, time: number }> }} clip
 * @returns {number[]}
 */
function mergedFillKeyframeTimes(clip) {
	const times = new Set()
	for (const k of clip.keyframes || []) {
		if (FILL_KF_PROPS.includes(k.property)) times.add(k.time)
	}
	return [...times].sort((a, b) => a - b)
}

/**
 * Index of the segment [times[i], times[i+1]) containing localMs.
 * @returns {number} segment start index, -2 before first, times.length-1 at/after last knot
 */
function keyframeSegmentIndex(times, localMs) {
	if (!times.length) return -1
	if (localMs < times[0]) return -2
	for (let i = 0; i < times.length - 1; i++) {
		if (localMs >= times[i] && localMs < times[i + 1]) return i
	}
	return times.length - 1
}

/**
 * Caspar mixer duration is in frames (25fps timeline default).
 * @param {number} ms
 * @param {number} fps
 */
function msToMixerFrames(ms, fps) {
	const f = Math.max(1, Math.round((Math.max(0, ms) * Math.max(1, fps)) / 1000))
	return f
}

/**
 * Easing for segment ending at endMs (from keyframe at that time, else linear).
 * @param {{ keyframes?: Array<{ property: string, time: number, easing?: string }> }} clip
 * @param {string} prop
 * @param {number} endMs
 */
function easingAtTime(clip, prop, endMs) {
	const k = (clip.keyframes || []).find((x) => x.property === prop && Math.abs(x.time - endMs) < 0.5)
	const e = k?.easing
	return e && String(e).trim() ? String(e).trim() : 'linear'
}

/**
 * @param {{ keyframes?: Array<{ property: string, time: number, easing?: string }> }} clip
 * @param {number} endMs
 */
function fillTweenForSegmentEnd(clip, endMs) {
	return easingAtTime(clip, 'fill_x', endMs) || easingAtTime(clip, 'scale_x', endMs) || 'linear'
}

/** Map UI easing (ease-in, ease-in-out) to Caspar mixer tween names. */
function mapKeyframeTween(tw) {
	const t = String(tw || 'linear')
		.toLowerCase()
		.replace(/-/g, '_')
	const map = {
		linear: 'linear',
		easein: 'easein',
		ease_out: 'easeout',
		easeout: 'easeout',
		easeinout: 'easeboth',
		ease_in_out: 'easeboth',
		easeboth: 'easeboth',
	}
	return map[t] || 'linear'
}

module.exports = {
	FILL_KF_PROPS,
	mergedFillKeyframeTimes,
	keyframeSegmentIndex,
	msToMixerFrames,
	easingAtTime,
	fillTweenForSegmentEnd,
	mapKeyframeTween,
}

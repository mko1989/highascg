'use strict'

const { param } = require('../caspar/amcp-utils')

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

/**
 * Instant MIXER (duration 0) is for scrub/pause and static holds — not while Caspar tweens a segment.
 * @param {{ playing?: boolean, force?: boolean, inTweenSpan?: boolean, valueChanged?: boolean }} opts
 * @returns {boolean}
 */
function shouldSendInstantKeyframeMixer(opts) {
	if (!opts?.valueChanged) return false
	if (opts.force) return true
	if (!opts.playing) return true
	return !opts.inTweenSpan
}

/**
 * AMCP lines for an opacity/volume segment tween (instant start + DEFER end).
 * @param {number} ch
 * @param {number} layer
 * @param {number} startVal
 * @param {number} endVal
 * @param {number} dur frames
 * @param {string} [tween]
 * @returns {string[]}
 */
function buildDeferredSegmentMixerLines(ch, layer, keyword, startVal, endVal, dur, tween) {
	const cl = `${ch}-${layer}`
	const lines = [`MIXER ${cl} ${keyword} ${startVal} 0`]
	let p = `${endVal} ${dur}`
	if (tween) p += ` ${param(tween)}`
	lines.push(`MIXER ${cl} ${keyword} ${p} DEFER`)
	return lines
}

/**
 * Active opacity segment at clip-local ms (for priming before PLAY on take).
 * @param {{ keyframes?: Array<{ property: string, time: number, easing?: string }> }} clip
 * @param {number} localMs
 * @param {number} fps
 * @param {(clip: object, prop: string, t: number, def: number) => number} interp
 * @param {number} [holdValue]
 * @returns {{ startVal: number, endVal: number, dur: number, tween: string, segIdx: number } | null}
 */
function opacitySegmentAtLocalMs(clip, localMs, fps, interp, holdValue = 1) {
	const kfs = (clip.keyframes || [])
		.filter((k) => k.property === 'opacity')
		.sort((a, b) => a.time - b.time)
	const times = kfs.map((k) => k.time)
	const segIdx = keyframeSegmentIndex(times, localMs)
	const inAnimatedSegment = times.length >= 2 && segIdx >= 0 && segIdx < times.length - 1
	const atSegmentStart = inAnimatedSegment && localMs <= times[segIdx] + 2
	if (!atSegmentStart) return null
	const t0 = times[segIdx]
	const t1 = times[segIdx + 1]
	const startVal = interp(clip, 'opacity', localMs > t0 + 2 ? localMs : t0, holdValue)
	const endVal = interp(clip, 'opacity', t1, holdValue)
	const dur = msToMixerFrames(Math.max(1, t1 - t0), fps)
	const tween = mapKeyframeTween(easingAtTime(clip, 'opacity', t1))
	return { startVal, endVal, dur, tween, segIdx }
}

module.exports = {
	FILL_KF_PROPS,
	mergedFillKeyframeTimes,
	keyframeSegmentIndex,
	msToMixerFrames,
	easingAtTime,
	fillTweenForSegmentEnd,
	mapKeyframeTween,
	shouldSendInstantKeyframeMixer,
	buildDeferredSegmentMixerLines,
	opacitySegmentAtLocalMs,
}

/**
 * Timeline JSON shape, defaults, and normalization helpers.
 */

import { ensureLayerHeights } from './timeline-track-heights.js'
import { applyTimelineClipDefaults } from './editor-defaults.js'
import { isPreviewBusAvailable } from './scenes-preview-look-stack.js'

export const STORAGE_KEY = 'casparcg_timelines_v1'

/** Default timeline output routing (PRV-only until PGM or Take). */
export const DEFAULT_SEND_TO = { preview: true, program: false, screenIdx: 0 }

/** Ms after last clip/flag end when auto-growing `timeline.duration`. */
export const CONTENT_END_PADDING_MS = 2000

/** @type {readonly ['pause', 'play', 'jump', 'companion_press']} */
export const FLAG_TYPES = ['pause', 'play', 'jump', 'companion_press']

export function isValidFlagType(type) {
	return FLAG_TYPES.includes(type)
}

/** Whether the selected timeline dest has a separate PRV bus (not PGM-only). */
export function previewBusAvailableForSendTo(cm, sendTo) {
	const screenCount = Math.max(1, cm?.screenCount ?? 1)
	if (sendTo?.screenIdx === null) {
		for (let i = 0; i < screenCount; i++) {
			if (isPreviewBusAvailable(cm, i)) return true
		}
		return false
	}
	const s = Number.isFinite(Number(sendTo?.screenIdx)) ? Number(sendTo.screenIdx) : 0
	return isPreviewBusAvailable(cm, Math.max(0, s))
}

/** PGM-only outputs: route timeline to program; hide/disable PRV dest. */
export function coerceTimelineSendTo(cm, sendTo) {
	if (!sendTo || typeof sendTo !== 'object') return sendTo
	if (!previewBusAvailableForSendTo(cm, sendTo)) {
		sendTo.preview = false
		sendTo.program = true
	}
	return sendTo
}

/**
 * Whether canvas timeline compose should paint the edit stack on a PRV/PGM cell.
 * @param {{ preview?: boolean, program?: boolean } | null | undefined} sendTo
 * @param {'pgm' | 'prv' | string | undefined} composeCell
 */
export function timelineComposeCellShowsTimeline(sendTo, composeCell) {
	if (!composeCell) return true
	if (composeCell === 'prv') return sendTo?.preview !== false
	if (composeCell === 'pgm') return !!sendTo?.program
	return true
}

export function defaultTimelineSendTo(cm) {
	return coerceTimelineSendTo(cm, { ...DEFAULT_SEND_TO })
}

/**
 * @param {object | null | undefined} raw
 * @returns {{ preview: boolean, program: boolean, screenIdx: number | null }}
 */
export function normalizeSendTo(raw) {
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_SEND_TO }
	const screenIdx =
		raw.screenIdx === null || raw.screenIdx === 'all'
			? null
			: Number.isFinite(Number(raw.screenIdx))
				? Number(raw.screenIdx)
				: DEFAULT_SEND_TO.screenIdx
	return {
		preview: raw.preview !== false,
		program: !!raw.program,
		screenIdx,
	}
}

export function ensureTimelineSendTo(tl) {
	if (!tl || typeof tl !== 'object') return
	tl.sendTo = normalizeSendTo(tl.sendTo)
}

export function uid() {
	return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

export function flagUid() {
	return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function defaultClip(source, startTime, duration) {
	const clip = {
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
		/** Base clip opacity (0..1); honored by timeline playback as the hold value under opacity keyframes. */
		opacity: 1,
		/** When true (default), changing W or H keeps media aspect when known — same as look editor. */
		aspectLocked: true,
		/** @type {'native' | 'fill-canvas' | 'horizontal' | 'vertical' | 'stretch'} */
		contentFit: 'native',
		/**
		 * When taking a look to program: seek media from trim start, or match timeline playhead on this layer.
		 * @type {'beginning' | 'relativeToPrevious'}
		 */
		startBehaviour: 'beginning',
	}
	applyTimelineClipDefaults(clip)
	return clip
}

export function defaultLayer(name) {
	return { id: uid(), name: name || 'Layer', clips: [] }
}

export function defaultTimeline(opts) {
	return {
		id: opts?.id || uid(),
		name: opts?.name || 'Timeline',
		duration: opts?.duration || 30000,
		fps: opts?.fps || 25,
		flags: Array.isArray(opts?.flags) ? opts.flags : [],
		sendTo: normalizeSendTo(opts?.sendTo),
		layers: opts?.layers || [
			defaultLayer('Layer 1'),
			defaultLayer('Layer 2'),
			defaultLayer('Layer 3'),
		],
	}
}

/**
 * Latest end time of any clip or flag (ms).
 * @param {object} tl
 */
export function computeContentEndMs(tl) {
	let end = 0
	for (const layer of tl.layers || []) {
		for (const c of layer.clips || []) {
			const e = (c.startTime || 0) + (c.duration || 0)
			if (e > end) end = e
		}
	}
	for (const f of tl.flags || []) {
		if (typeof f.timeMs === 'number' && f.timeMs > end) end = f.timeMs
	}
	return end
}

/** @param {object} tl
 * @param {number} layerIdx
 * @param {string} clipId
 */
export function findClipOnTimeline(tl, layerIdx, clipId) {
	if (!tl?.layers[layerIdx]) return null
	return tl.layers[layerIdx].clips.find((c) => c.id === clipId) || null
}

/** Clip under timeline ms on a layer (first match). */
export function findClipAtTimeOnTimeline(tl, layerIdx, timeMs) {
	const layer = tl?.layers?.[layerIdx]
	if (!layer?.clips?.length) return null
	const t = Number(timeMs) || 0
	return (
		layer.clips.find((c) => t >= c.startTime && t < c.startTime + (c.duration || 0)) || null
	)
}

export function normalizeLoadedTimelines(timelines) {
	for (const tl of timelines) {
		if (!Array.isArray(tl.flags)) tl.flags = []
		ensureLayerHeights(tl)
		ensureTimelineSendTo(tl)
		for (const layer of tl.layers || []) {
			for (const c of layer.clips || []) {
				if (c.startBehaviour == null) c.startBehaviour = 'beginning'
			}
		}
	}
}

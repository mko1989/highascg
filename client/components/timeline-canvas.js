/**
 * Timeline canvas — rendering + interaction orchestrator.
 * Scroll: vertical wheel = zoom (time axis at cursor). Horizontal wheel / trackpad = pan time.
 * Alt+vertical = pan layers. Shift+vertical = horizontal time pan (for mice without horizontal wheel).
 * Ruler click/drag = seek (sends SEEK command on every move event).
 * Empty track click = deselect only (playhead moves on ruler only).
 * Clip drag = move clip. Clip edge drag = resize.
 * @see main_plan.md Prompt 17
 */

import {
	ensureLayerHeights,
	totalTracksHeight,
	layerIndexAtCanvasY,
} from '../lib/timeline-track-heights.js'
import {
	RULER_H,
	HEADER_W,
	resizeTimelineCanvas,
	drawTimelineCanvas,
} from './timeline-canvas-render.js'
import { attachTimelinePointerEvents } from './timeline-canvas-pointer.js'
import {
	MIN_PX_MS,
	MAX_PX_MS,
	ZOOM_FACTOR,
	attachTimelineWheelAndDrop,
} from './timeline-canvas-wheel.js'

export { fmtSmpte, parseTcInput, fmtHms, parseHmsInput } from './timeline-canvas-utils.js'

export function initTimelineCanvas(container, opts) {
	const {
		getTimeline,
		getPlayback,
		getView,
		onSeek,
		onSeekEnd,
		onSelectClip,
		onDropSource,
		onMoveClip,
		onResizeClip,
		onClipResizePreview,
		onLayerContextMenu,
		onLayerClick,
		getThumbnailUrl,
		getWaveformUrl,
		getSourceDurationMs,
		isAudioOnlySource,
		onSelectKeyframe,
		onDblClickAddKeyframe,
		onAddLayer,
		onMoveKeyframe,
		onSelectFlag,
		onMoveFlagTime,
		getClipSelection,
		getFlagSelection,
		onLayerHeightsChange,
		onKeyframeDragEnd,
		onClipDragEnd,
		onMoveLayer,
		onLayerDragEnd,
	} = opts

	const thumbCache = new Map()
	const waveformCache = new Map()

	container.innerHTML = '<canvas class="tl-canvas"></canvas>'
	const canvas = container.querySelector('canvas')
	const ctx = canvas.getContext('2d')

	let raf = null

	const api = {
		pxPerMs: 0.1,
		scrollX: 0,
		scrollY: 0,
		drag: null,
		/** Last keyframe grabbed on the canvas: { clipId, layerIdx, property, time } | null. */
		selectedKeyframe: null,
		lastSeekMs: 0,
		wheelZoomAccum: 0,
		wheelZoomLastSign: 0,
		followAutoScroll: false,
		followLastMs: 0,
		HEADER_W,
		getTimeline,
		getPlayback,
		getView,
		onSeek,
		onSeekEnd,
		onSelectClip,
		onDropSource,
		onMoveClip,
		onResizeClip,
		onClipResizePreview,
		onLayerContextMenu,
		onLayerClick,
		onSelectKeyframe,
		onDblClickAddKeyframe,
		onAddLayer,
		onMoveKeyframe,
		onSelectFlag,
		onMoveFlagTime,
		onLayerHeightsChange,
		onKeyframeDragEnd,
		onClipDragEnd,
		onMoveLayer,
		onLayerDragEnd,
		msAt(canvasX) {
			return (canvasX - HEADER_W) / api.pxPerMs + api.scrollX
		},
		xAt(ms) {
			return HEADER_W + (ms - api.scrollX) * api.pxPerMs
		},
		layerAt(canvasY, tl) {
			if (!tl) return 0
			return layerIndexAtCanvasY(tl, canvasY, api.scrollY, RULER_H)
		},
		maxScrollY(tl) {
			if (!tl) return 0
			return Math.max(0, totalTracksHeight(tl) - (canvas.height - RULER_H))
		},
		clampScrollX(ms) {
			const tl = getTimeline()
			const trackW = canvas.width - HEADER_W
			const maxScroll = tl && trackW > 0 && api.pxPerMs > 0
				? Math.max(0, tl.duration - trackW / api.pxPerMs)
				: 0
			api.scrollX = Math.max(0, Math.min(maxScroll, ms))
		},
		schedDraw: null,
	}

	function draw() {
		resizeTimelineCanvas(container, canvas)
		const tl = getTimeline()
		if (tl) {
			ensureLayerHeights(tl)
			const m = api.maxScrollY(tl)
			if (api.scrollY > m) api.scrollY = m
		}
		drawTimelineCanvas({
			ctx,
			canvas,
			getTimeline,
			getPlayback,
			xAt: api.xAt.bind(api),
			layerAt: api.layerAt.bind(api),
			scrollX: api.scrollX,
			scrollY: api.scrollY,
			pxPerMs: api.pxPerMs,
			drag: api.drag,
			selectedKeyframe: api.selectedKeyframe,
			schedDraw: api.schedDraw,
			thumbCache,
			waveformCache,
			getClipSelection,
			getFlagSelection,
			getThumbnailUrl,
			getWaveformUrl,
			getSourceDurationMs,
			isAudioOnlySource,
		})
	}

	function schedDraw() {
		if (raf) return
		raf = requestAnimationFrame(() => {
			raf = null
			draw()
		})
	}
	api.schedDraw = schedDraw

	attachTimelinePointerEvents(canvas, api)
	attachTimelineWheelAndDrop(canvas, api)

	window.addEventListener('resize', schedDraw)
	schedDraw()

	return {
		redraw: schedDraw,
		notifyVisible() {
			const r = container.getBoundingClientRect()
			const w = Math.round(r.width)
			const h = Math.round(r.height)
			if (w > 0 && h > 0) {
				canvas.width = w
				canvas.height = h
			}
			schedDraw()
		},
		setPlayheadPosition(_ms) {
			schedDraw()
		},
		zoom(dir) {
			api.pxPerMs = Math.max(MIN_PX_MS, Math.min(MAX_PX_MS, api.pxPerMs * (dir > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)))
			schedDraw()
		},
		zoomFit() {
			const tl = getTimeline()
			if (!tl) return
			api.pxPerMs = Math.max(MIN_PX_MS, (canvas.width - HEADER_W - 20) / tl.duration)
			api.scrollX = 0
			api.scrollY = 0
			schedDraw()
		},
		followPlayhead(ms, opts = {}) {
			const trackW = canvas.width - HEADER_W
			if (trackW <= 0 || api.pxPerMs <= 0) return

			const margin = 80
			const rightEdge = canvas.width - margin
			const leftEdge = HEADER_W + margin

			if (opts.playing && api.followAutoScroll) {
				api.scrollX += ms - api.followLastMs
				api.followLastMs = ms
				api.clampScrollX(api.scrollX)
				if (api.xAt(ms) < rightEdge - 24) api.followAutoScroll = false
				return
			}

			api.followLastMs = ms
			const x = api.xAt(ms)

			if (x > rightEdge) {
				if (opts.playing) {
					api.followAutoScroll = true
					api.scrollX = ms - (rightEdge - HEADER_W) / api.pxPerMs
					api.clampScrollX(api.scrollX)
				} else {
					api.followAutoScroll = false
					api.clampScrollX(ms - (trackW - margin) / api.pxPerMs)
				}
			} else if (x < leftEdge) {
				api.followAutoScroll = false
				api.clampScrollX(ms - margin / api.pxPerMs)
			} else {
				api.followAutoScroll = false
			}
		},
		resetFollowScroll() {
			api.followAutoScroll = false
			api.followLastMs = 0
		},
	}
}

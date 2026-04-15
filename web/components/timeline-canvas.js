/**
 * Timeline canvas — rendering + interaction.
 * Scroll: vertical wheel = zoom (time axis at cursor). Horizontal wheel / trackpad = pan time.
 * Alt+vertical = pan layers. Shift+vertical = horizontal time pan (for mice without horizontal wheel).
 * Ruler click/drag = seek (sends SEEK command on every move event).
 * Clip drag = move clip. Clip edge drag = resize.
 * @see main_plan.md Prompt 17
 */

import {
	ensureLayerHeights,
	totalTracksHeight,
	layerIndexAtCanvasY,
	hitLayerDivider,
	layerHeightAt,
	trackTopForLayer,
} from '../lib/timeline-track-heights.js'
import {
	RULER_H,
	HEADER_W,
	resizeTimelineCanvas,
	drawTimelineCanvas,
	hitClip,
	edgeZone,
	hitFlag,
	hitKeyframe,
	applyLayerDividerMouseMove,
} from './timeline-canvas-render.js'

export { fmtSmpte, parseTcInput } from './timeline-canvas-utils.js'

/** Minimum zoom: px per ms (lower = more zoomed out). 0.0001 ≈ 100px per 1000s. */
const MIN_PX_MS = 0.0001
const MAX_PX_MS = 5.0   // 5000px/s
/** Toolbar zoom +/- buttons */
const ZOOM_FACTOR = 1.18
/** Per wheel “step” (smaller than old 1.35 — trackpads emit many events) */
const WHEEL_ZOOM_STEP = 1.1
/** Accumulate this much delta (px, mode 0) or lines before applying one zoom step */
const WHEEL_ZOOM_ACCUM_THRESHOLD = 50

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
		/** While trimming a clip, report timeline ms at the active edge so preview can seek (WO 21). */
		onClipResizePreview,
		onLayerContextMenu,
		onLayerClick,
		getThumbnailUrl,
		getWaveformUrl,
		/** Media file duration (ms) for waveform trim mapping; null if unknown. */
		getSourceDurationMs,
		/** Skip video thumbnail when source is audio-only (filename / CLS type). */
		isAudioOnlySource,
		onSelectKeyframe,
		onMoveKeyframe,
		onSelectFlag,
		onMoveFlagTime,
		getClipSelection,
		getFlagSelection,
		/** @type {(timelineId: string, heights: number[], isFinal?: boolean) => void} */
		onLayerHeightsChange,
	} = opts

	const thumbCache = new Map() // url -> HTMLImageElement (or 'loading' | 'error')
	const waveformCache = new Map() // url -> number[] peaks (or 'loading' | 'error')

	container.innerHTML = '<canvas class="tl-canvas"></canvas>'
	const canvas = container.querySelector('canvas')
	const ctx = canvas.getContext('2d')

	let pxPerMs = 0.1     // zoom: pixels per millisecond
	let scrollX = 0       // ms offset of the left edge of the track area
	let scrollY = 0       // px offset of track area top
	let drag = null       // active drag state
	let lastSeekMs = 0    // last seek position (for onSeekEnd flush)
	let hoverClip = null  // { layerIdx, clipId } — for cursor changes
	let raf = null
	let wheelZoomAccum = 0
	let wheelZoomLastSign = 0

	// ── Coordinate helpers ────────────────────────────────────────────────────

	function msAt(canvasX) {
		return (canvasX - HEADER_W) / pxPerMs + scrollX
	}

	function xAt(ms) {
		return HEADER_W + (ms - scrollX) * pxPerMs
	}

	function layerAt(canvasY, tl) {
		if (!tl) return 0
		return layerIndexAtCanvasY(tl, canvasY, scrollY, RULER_H)
	}

	function maxScrollY(tl) {
		if (!tl) return 0
		return Math.max(0, totalTracksHeight(tl) - (canvas.height - RULER_H))
	}

	// ── Drawing ───────────────────────────────────────────────────────────────

	function draw() {
		resizeTimelineCanvas(container, canvas)
		const tl = getTimeline()
		if (tl) {
			ensureLayerHeights(tl)
			const m = maxScrollY(tl)
			if (scrollY > m) scrollY = m
		}
		drawTimelineCanvas({
			ctx,
			canvas,
			getTimeline,
			getPlayback,
			xAt,
			layerAt,
			scrollX,
			scrollY,
			pxPerMs,
			drag,
			schedDraw,
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

	// ── Events ────────────────────────────────────────────────────────────────

	canvas.addEventListener('mousedown', (e) => {
		const rect = canvas.getBoundingClientRect()
		const cx = e.clientX - rect.left
		const cy = e.clientY - rect.top
		const ms = msAt(cx)
		const tl = getTimeline()

		// Ruler → flag drag or seek
		if (cy < RULER_H) {
			const hf = tl ? hitFlag(tl, cx, cy, xAt) : null
			if (hf && tl) {
				onSelectFlag?.({ timelineId: tl.id, flagId: hf.flag.id, flag: hf.flag })
				drag = { type: 'flag-move', flagId: hf.flag.id, origMs: ms }
				lastSeekMs = Math.max(0, hf.flag.timeMs)
				schedDraw()
				return
			}
			drag = { type: 'seek' }
			lastSeekMs = Math.max(0, ms)
			onSeek(lastSeekMs)
			schedDraw()
			return
		}

		if (!tl) return
		ensureLayerHeights(tl)

		const divIdx = hitLayerDivider(cy, tl, scrollY, RULER_H)
		if (divIdx != null && e.button === 0 && onLayerHeightsChange) {
			drag = {
				type: 'layer-divider',
				dividerIdx: divIdx,
				origHeights: [...tl.layerHeights],
				startClientY: e.clientY,
				shiftKey: e.shiftKey,
			}
			schedDraw()
			return
		}

		const li = layerAt(cy, tl)

		// Left-click on layer header → open layer inspector
		if (cx < HEADER_W && li >= 0 && li < tl.layers.length && e.button === 0) {
			onLayerClick?.(tl.id, li, tl.layers[li])
			return
		}
		const clip = li < tl.layers.length ? hitClip(tl, li, ms) : null

		if (clip) {
			const trackY = trackTopForLayer(tl, li, scrollY, RULER_H)
			const kfIdx = hitKeyframe(clip, trackY, layerHeightAt(tl, li), cx, cy, canvas, xAt, pxPerMs)
			if (kfIdx != null && onSelectKeyframe) {
				onSelectClip({ layerIdx: li, clipId: clip.id, timelineId: tl.id, clip })
				onSelectKeyframe({ timelineId: tl.id, layerIdx: li, clipId: clip.id, keyframeIdx: kfIdx, keyframe: clip.keyframes[kfIdx] })
				drag = { type: 'keyframe-drag', layerIdx: li, clipId: clip.id, keyframeIdx: kfIdx, origTime: clip.keyframes[kfIdx].time, origMs: ms }
			} else {
				const edge = edgeZone(clip, ms, pxPerMs)
				onSelectClip({ layerIdx: li, clipId: clip.id, timelineId: tl.id, clip })
				if (edge) {
					drag = {
						type: 'clip-resize',
						edge,
						layerIdx: li,
						clipId: clip.id,
						origStart: clip.startTime,
						origDur: clip.duration,
						origMs: ms,
						origInPoint: clip.inPoint ?? 0,
					}
				} else {
					drag = { type: 'clip-move', layerIdx: li, clipId: clip.id,
						origStart: clip.startTime, origMs: ms }
				}
			}
		} else {
			onSelectClip(null)
			drag = null
		}
		schedDraw()
	})

	canvas.addEventListener('mousemove', (e) => {
		const rect = canvas.getBoundingClientRect()
		const cx = e.clientX - rect.left
		const cy = e.clientY - rect.top
		const ms = msAt(cx)
		const tl = getTimeline()

		if (!drag) {
			// Update cursor based on hover
			if (cy < RULER_H) {
				const hf = tl ? hitFlag(tl, cx, cy, xAt) : null
				canvas.style.cursor = hf ? 'pointer' : 'col-resize'
			} else if (tl) {
				ensureLayerHeights(tl)
				if (onLayerHeightsChange && hitLayerDivider(cy, tl, scrollY, RULER_H) != null) {
					canvas.style.cursor = 'ns-resize'
				} else {
					const li = layerAt(cy, tl)
					const clip = li < tl.layers.length ? hitClip(tl, li, ms) : null
					if (clip) {
						canvas.style.cursor = edgeZone(clip, ms, pxPerMs) ? 'ew-resize' : 'grab'
					} else {
						canvas.style.cursor = 'default'
					}
				}
			}
			return
		}

		if (drag.type === 'layer-divider' && tl && onLayerHeightsChange) {
			applyLayerDividerMouseMove(drag, e.clientY, tl, onLayerHeightsChange, schedDraw)
			return
		}

		if (drag.type === 'flag-move' && tl && onMoveFlagTime) {
			const clamped = Math.max(0, Math.min(ms, tl.duration))
			onMoveFlagTime(tl.id, drag.flagId, clamped)
		} else if (drag.type === 'seek') {
			const clamped = Math.max(0, tl ? Math.min(ms, tl.duration) : ms)
			lastSeekMs = clamped
			onSeek(clamped)
		} else if (drag.type === 'clip-move') {
			const delta = ms - drag.origMs
			const newStart = Math.max(0, drag.origStart + delta)
			onMoveClip(drag.layerIdx, drag.clipId, newStart)
		} else if (drag.type === 'clip-resize') {
			if (drag.edge === 'left') {
				const newStart = Math.max(0, ms)
				const newDur = drag.origStart + drag.origDur - newStart
				if (newDur > 200) {
					const fps = Math.max(1, tl?.fps || 25)
					const deltaMs = newStart - drag.origStart
					const deltaFrames = Math.floor((deltaMs * fps) / 1000)
					const newInPoint = Math.max(0, (drag.origInPoint ?? 0) + deltaFrames)
					onResizeClip(drag.layerIdx, drag.clipId, {
						startTime: newStart,
						duration: newDur,
						inPoint: newInPoint,
					})
					onClipResizePreview?.({ edge: 'left', timelineMs: newStart, layerIdx: drag.layerIdx, clipId: drag.clipId })
				}
			} else {
				const newDur = Math.max(200, ms - drag.origStart)
				const changes = { duration: newDur }
				// Extending right: play from source frame 0 for the new length (restart from file start).
				if (newDur > drag.origDur) {
					changes.inPoint = 0
				}
				onResizeClip(drag.layerIdx, drag.clipId, changes)
				onClipResizePreview?.({
					edge: 'right',
					timelineMs: drag.origStart + newDur,
					layerIdx: drag.layerIdx,
					clipId: drag.clipId,
				})
			}
		} else if (drag.type === 'keyframe-drag' && onMoveKeyframe && tl) {
			const clip = tl.layers[drag.layerIdx]?.clips?.find((c) => c.id === drag.clipId)
			if (clip) {
				const newTime = Math.max(0, Math.min(ms - clip.startTime, clip.duration))
				onMoveKeyframe(tl.id, drag.layerIdx, drag.clipId, drag.keyframeIdx, newTime)
			}
		}
		schedDraw()
	})

	canvas.addEventListener('mouseup', () => {
		const wasDivider = drag?.type === 'layer-divider'
		const tl0 = getTimeline()
		if (drag?.type === 'seek' && onSeekEnd) {
			const tl = getTimeline()
			if (tl) onSeekEnd(Math.max(0, Math.min(lastSeekMs, tl.duration)))
		}
		if (wasDivider && tl0 && onLayerHeightsChange) {
			ensureLayerHeights(tl0)
			onLayerHeightsChange(tl0.id, [...tl0.layerHeights], true)
		}
		drag = null
		canvas.style.cursor = 'default'
		schedDraw()
	})
	canvas.addEventListener('mouseleave', () => {
		if (drag?.type === 'layer-divider') {
			const tl = getTimeline()
			if (tl && onLayerHeightsChange) {
				ensureLayerHeights(tl)
				onLayerHeightsChange(tl.id, [...tl.layerHeights], true)
			}
		}
		drag = null
	})

	// Right-click on layer header → context menu (rename, add layer, remove layer)
	canvas.addEventListener('contextmenu', (e) => {
		const rect = canvas.getBoundingClientRect()
		const cx = e.clientX - rect.left
		const cy = e.clientY - rect.top
		if (cx >= HEADER_W || cy < RULER_H) return
		const tl = getTimeline()
		if (!tl) return
		const li = layerAt(cy, tl)
		if (li < 0 || li >= tl.layers.length) return
		e.preventDefault()
		onLayerContextMenu?.(tl.id, li, tl.layers[li], e.clientX, e.clientY)
	})

	canvas.addEventListener('wheel', (e) => {
		e.preventDefault()
		const rect = canvas.getBoundingClientRect()
		const cx = e.clientX - rect.left
		const tl = getTimeline()
		const dx = e.deltaX
		const dy = e.deltaY

		// Alt + vertical wheel = pan layers up/down
		if (e.altKey && Math.abs(dy) >= Math.abs(dx)) {
			wheelZoomAccum = 0
			wheelZoomLastSign = 0
			const maxY = maxScrollY(tl)
			scrollY = Math.max(0, Math.min(maxY, scrollY + dy * 0.5))
			schedDraw()
			return
		}

		// Shift + vertical wheel = horizontal time pan (wheel-only mice)
		if (e.shiftKey && !e.altKey && Math.abs(dy) >= Math.abs(dx)) {
			wheelZoomAccum = 0
			wheelZoomLastSign = 0
			scrollX = Math.max(0, scrollX + dy / pxPerMs * 0.5)
			schedDraw()
			return
		}

		// Dominant horizontal delta = pan time axis (trackpad two-finger horizontal, etc.)
		if (Math.abs(dx) > Math.abs(dy)) {
			wheelZoomAccum = 0
			wheelZoomLastSign = 0
			scrollX = Math.max(0, scrollX + dx / pxPerMs * 0.5)
			schedDraw()
			return
		}

		// Vertical wheel (incl. pinch-zoom with Ctrl on macOS) = zoom centred on cursor X.
		// Accumulate delta so one physical scroll gesture ≈ one step (trackpads fire many events).
		const dyNorm = e.deltaMode === 1 ? dy * 16 : e.deltaMode === 2 ? dy * 400 : dy
		const sign = Math.sign(dyNorm)
		if (sign !== 0 && sign !== wheelZoomLastSign) wheelZoomAccum = 0
		wheelZoomLastSign = sign || wheelZoomLastSign
		wheelZoomAccum += dyNorm
		if (Math.abs(wheelZoomAccum) < WHEEL_ZOOM_ACCUM_THRESHOLD) {
			schedDraw()
			return
		}
		wheelZoomAccum = 0
		const msUnder = msAt(cx)
		const factor = dyNorm > 0 ? 1 / WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP
		pxPerMs = Math.max(MIN_PX_MS, Math.min(MAX_PX_MS, pxPerMs * factor))
		scrollX = Math.max(0, msUnder - (cx - HEADER_W) / pxPerMs)
		schedDraw()
	}, { passive: false })

	// Drag-drop from sources panel
	canvas.addEventListener('dragover', (e) => {
		e.preventDefault()
		e.dataTransfer.dropEffect = 'copy'
	})

	canvas.addEventListener('drop', (e) => {
		e.preventDefault()
		const rect = canvas.getBoundingClientRect()
		const cx = e.clientX - rect.left
		const cy = e.clientY - rect.top
		let source = null
		try { source = JSON.parse(e.dataTransfer.getData('application/json')) } catch { return }
		if (!source?.value) return
		const ms = Math.max(0, msAt(cx))
		const tl = getTimeline()
		const li = tl ? Math.max(0, Math.min(layerAt(cy, tl), tl.layers.length)) : 0
		onDropSource(source, li, ms)
		schedDraw()
	})

	// ── Animation loop ────────────────────────────────────────────────────────

	function schedDraw() {
		if (raf) return
		raf = requestAnimationFrame(() => { raf = null; draw() })
	}

	window.addEventListener('resize', schedDraw)
	schedDraw()

	// ── Public API ────────────────────────────────────────────────────────────

	return {
		redraw: schedDraw,
		/** Called when the containing tab becomes visible. Forces a fresh resize + redraw. */
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
		setPlayheadPosition(_ms) { schedDraw() },
		zoom(dir) {
			pxPerMs = Math.max(MIN_PX_MS, Math.min(MAX_PX_MS, pxPerMs * (dir > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)))
			schedDraw()
		},
		zoomFit() {
			const tl = getTimeline()
			if (!tl) return
			pxPerMs = Math.max(MIN_PX_MS, (canvas.width - HEADER_W - 20) / tl.duration)
			scrollX = 0; scrollY = 0
			schedDraw()
		},
		followPlayhead(ms) {
			const x = xAt(ms)
			const margin = 80
			if (x > canvas.width - margin) {
				scrollX = Math.max(0, ms - (canvas.width - HEADER_W - margin) / pxPerMs)
			} else if (x < HEADER_W + margin) {
				scrollX = Math.max(0, ms - margin / pxPerMs)
			}
			schedDraw()
		},
	}
}

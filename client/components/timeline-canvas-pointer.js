/**
 * Timeline canvas pointer interaction: seek, clip drag, resize, keyframes, layer ops.
 */
import {
	ensureLayerHeights,
	hitLayerDivider,
	layerHeightAt,
	trackTopForLayer,
} from '../lib/timeline-track-heights.js'
import {
	RULER_H,
	HEADER_W,
	hitClip,
	edgeZone,
	hitFlag,
	hitKeyframe,
	applyLayerDividerMouseMove,
} from './timeline-canvas-render.js'
import {
	collectTimelineSnapCandidates,
	resolveSnappedStart,
	resolveSnappedEdge,
} from './timeline-canvas-snap.js'

const SNAP_THRESHOLD_PX = 8

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} api
 */
export function attachTimelinePointerEvents(canvas, api) {
	const {
		getTimeline,
		getPlayback,
		msAt,
		xAt,
		layerAt,
		schedDraw,
		onSeek,
		onSeekEnd,
		onSelectClip,
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
		onLayerDragEnd,
		onMoveLayer,
	} = api

	canvas.addEventListener('mousedown', (e) => {
		const rect = canvas.getBoundingClientRect()
		const cx = e.clientX - rect.left
		const cy = e.clientY - rect.top
		const ms = msAt(cx)
		const tl = getTimeline()

		if (cy < RULER_H) {
			canvas.dataset.lastClicked = 'ruler'
			const hf = tl ? hitFlag(tl, cx, cy, xAt) : null
			if (hf && tl) {
				onSelectFlag?.({ timelineId: tl.id, flagId: hf.flag.id, flag: hf.flag })
				api.drag = { type: 'flag-move', flagId: hf.flag.id, origMs: ms }
				api.lastSeekMs = Math.max(0, hf.flag.timeMs)
				schedDraw()
				return
			}
			api.drag = { type: 'seek' }
			api.lastSeekMs = Math.max(0, ms)
			onSeek(api.lastSeekMs)
			schedDraw()
			return
		}

		if (!tl) return
		ensureLayerHeights(tl)

		const divIdx = hitLayerDivider(cy, tl, api.scrollY, RULER_H)
		if (divIdx != null && e.button === 0 && onLayerHeightsChange) {
			canvas.dataset.lastClicked = 'divider'
			api.drag = {
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

		if (cx < HEADER_W && li >= 0 && li < tl.layers.length && e.button === 0) {
			canvas.dataset.lastClicked = 'header'
			api.drag = { type: 'layer-move', layerIdx: li, startClientY: e.clientY }
			onLayerClick?.(tl.id, li, tl.layers[li])
			return
		}
		const clip = li < tl.layers.length ? hitClip(tl, li, ms) : null

		if (clip) {
			canvas.dataset.lastClicked = 'clip'
			const trackY = trackTopForLayer(tl, li, api.scrollY, RULER_H)
			const kfIdx = hitKeyframe(clip, trackY, layerHeightAt(tl, li), cx, cy, canvas, xAt, api.pxPerMs)
			if (kfIdx != null && onSelectKeyframe) {
				onSelectClip({ layerIdx: li, clipId: clip.id, timelineId: tl.id, clip })
				onSelectKeyframe({
					timelineId: tl.id,
					layerIdx: li,
					clipId: clip.id,
					keyframeIdx: kfIdx,
					keyframe: clip.keyframes[kfIdx],
				})
				api.drag = {
					type: 'keyframe-drag',
					layerIdx: li,
					clipId: clip.id,
					keyframeIdx: kfIdx,
					origTime: clip.keyframes[kfIdx].time,
					origMs: ms,
				}
			} else {
				const edge = edgeZone(clip, ms, api.pxPerMs)
				onSelectClip({ layerIdx: li, clipId: clip.id, timelineId: tl.id, clip })
				if (edge) {
					api.drag = {
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
					api.drag = {
						type: 'clip-move',
						layerIdx: li,
						clipId: clip.id,
						origStart: clip.startTime,
						origMs: ms,
					}
				}
			}
		} else {
			canvas.dataset.lastClicked = 'track'
			onSelectClip(null)
			if (li >= 0 && li < tl.layers.length) {
				onLayerClick?.(tl.id, li, tl.layers[li])
			}
		}
		schedDraw()
	})

	canvas.addEventListener('mousemove', (e) => {
		const rect = canvas.getBoundingClientRect()
		const cx = e.clientX - rect.left
		const cy = e.clientY - rect.top
		const ms = msAt(cx)
		const tl = getTimeline()
		const drag = api.drag

		if (!drag) {
			if (cy < RULER_H) {
				const hf = tl ? hitFlag(tl, cx, cy, xAt) : null
				canvas.style.cursor = hf ? 'pointer' : 'col-resize'
			} else if (tl) {
				ensureLayerHeights(tl)
				if (onLayerHeightsChange && hitLayerDivider(cy, tl, api.scrollY, RULER_H) != null) {
					canvas.style.cursor = 'ns-resize'
				} else {
					const li = layerAt(cy, tl)
					const clip = li < tl.layers.length ? hitClip(tl, li, ms) : null
					if (clip) {
						canvas.style.cursor = edgeZone(clip, ms, api.pxPerMs) ? 'ew-resize' : 'grab'
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

		if (drag.type === 'layer-move' && tl) {
			const targetLi = layerAt(cy, tl)
			if (targetLi >= 0 && targetLi < tl.layers.length && targetLi !== drag.layerIdx) {
				onMoveLayer?.(drag.layerIdx, targetLi)
				drag.layerIdx = targetLi
				schedDraw()
			}
			return
		}

		if (drag.type === 'flag-move' && tl && onMoveFlagTime) {
			const clamped = Math.max(0, Math.min(ms, tl.duration))
			onMoveFlagTime(tl.id, drag.flagId, clamped)
		} else if (drag.type === 'seek') {
			const clamped = Math.max(0, tl ? Math.min(ms, tl.duration) : ms)
			api.lastSeekMs = clamped
			onSeek(clamped)
		} else if (drag.type === 'clip-move') {
			const delta = ms - drag.origMs
			const rawStart = drag.origStart + delta
			const clip = tl.layers[drag.layerIdx]?.clips?.find((c) => c.id === drag.clipId)
			const dur = clip ? clip.duration : drag.origDur
			const thresholdMs = SNAP_THRESHOLD_PX / api.pxPerMs
			const { candidates, nowPointer } = collectTimelineSnapCandidates(tl, getPlayback, {
				layerIdx: drag.layerIdx,
				clipId: drag.clipId,
			})
			const newStart = resolveSnappedStart(rawStart, dur, candidates, thresholdMs, nowPointer)
			const targetLi = layerAt(cy, tl)
			const validTargetLi = targetLi >= 0 && targetLi < tl.layers.length ? targetLi : drag.layerIdx
			onMoveClip(drag.layerIdx, drag.clipId, newStart, validTargetLi)
			if (validTargetLi !== drag.layerIdx) drag.layerIdx = validTargetLi
		} else if (drag.type === 'clip-resize') {
			const thresholdMs = SNAP_THRESHOLD_PX / api.pxPerMs
			const { candidates, nowPointer } = collectTimelineSnapCandidates(tl, getPlayback, {
				layerIdx: drag.layerIdx,
				clipId: drag.clipId,
			})
			if (drag.edge === 'left') {
				const rawStart = ms
				let newStart = resolveSnappedEdge(rawStart, candidates, thresholdMs, nowPointer)
				newStart = Math.max(0, newStart)
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
				const rawEnd = ms
				let newEnd = resolveSnappedEdge(rawEnd, candidates, thresholdMs, nowPointer)
				const newDur = Math.max(200, newEnd - drag.origStart)
				const changes = { duration: newDur }
				if (newDur > drag.origDur) changes.inPoint = 0
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
		const drag = api.drag
		const wasDivider = drag?.type === 'layer-divider'
		const wasLayerDrag = drag?.type === 'layer-move'
		const wasKeyframeDrag = drag?.type === 'keyframe-drag'
		const wasClipDrag = drag?.type === 'clip-move' || drag?.type === 'clip-resize'
		const tl0 = getTimeline()
		if (drag?.type === 'seek' && onSeekEnd) {
			const tl = getTimeline()
			if (tl) onSeekEnd(Math.max(0, Math.min(api.lastSeekMs, tl.duration)))
		}
		if (wasDivider && tl0 && onLayerHeightsChange) {
			ensureLayerHeights(tl0)
			onLayerHeightsChange(tl0.id, [...tl0.layerHeights], true)
		}
		if (wasLayerDrag && tl0 && onLayerDragEnd) onLayerDragEnd(tl0.id)
		if (wasKeyframeDrag && tl0 && onKeyframeDragEnd) onKeyframeDragEnd(tl0.id)
		if (wasClipDrag && tl0 && onClipDragEnd) {
			const li = drag.layerIdx
			const clip = tl0.layers?.[li]?.clips?.find((c) => c.id === drag.clipId)
			let changed = false
			if (clip && drag.type === 'clip-move') {
				changed = clip.startTime !== drag.origStart
			} else if (clip && drag.type === 'clip-resize') {
				changed =
					clip.startTime !== drag.origStart ||
					clip.duration !== drag.origDur ||
					(clip.inPoint ?? 0) !== (drag.origInPoint ?? 0)
			}
			if (changed) onClipDragEnd(tl0.id)
		}
		api.drag = null
		canvas.style.cursor = 'default'
		schedDraw()
	})

	canvas.addEventListener('mouseleave', () => {
		if (api.drag?.type === 'layer-divider') {
			const tl = getTimeline()
			if (tl && onLayerHeightsChange) {
				ensureLayerHeights(tl)
				onLayerHeightsChange(tl.id, [...tl.layerHeights], true)
			}
		}
		api.drag = null
	})

	canvas.addEventListener('dblclick', (e) => {
		if (!onDblClickAddKeyframe && !onAddLayer) return
		const rect = canvas.getBoundingClientRect()
		const cx = e.clientX - rect.left
		const cy = e.clientY - rect.top
		if (cy < RULER_H) return
		const tl = getTimeline()
		if (!tl) return
		const li = layerAt(cy, tl)
		const ms = msAt(cx)

		if (cx >= HEADER_W && li >= 0) {
			if (li < tl.layers.length) {
				const clip = hitClip(tl, li, ms)
				if (clip && onDblClickAddKeyframe) {
					e.preventDefault()
					const localMs = Math.max(0, Math.min(Math.round(ms - clip.startTime), clip.duration || 0))
					onDblClickAddKeyframe({
						timelineId: tl.id,
						layerIdx: li,
						clipId: clip.id,
						clip,
						localMs,
					})
					return
				}
				if (!clip && onAddLayer) {
					e.preventDefault()
					onAddLayer(tl.id, li)
				}
			} else if (onAddLayer) {
				e.preventDefault()
				onAddLayer(tl.id, tl.layers.length - 1)
			}
			return
		}

		if (cx < HEADER_W && onAddLayer && li >= 0) {
			e.preventDefault()
			onAddLayer(tl.id, li >= tl.layers.length ? tl.layers.length - 1 : li)
		}
	})

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
}

/**
 * Timeline canvas — rendering + interaction.
 * Scroll: vertical wheel = zoom (time axis at cursor). Horizontal wheel / trackpad = pan time.
 * Alt+vertical = pan layers. Shift+vertical = horizontal time pan (for mice without horizontal wheel).
 * Ruler click/drag = seek (sends SEEK command on every move event).
 * Clip drag = move clip. Clip edge drag = resize.
 * @see main_plan.md Prompt 17
 */

import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import {
	DEFAULT_LAYER_H,
	MIN_LAYER_H,
	MAX_LAYER_H,
	ensureLayerHeights,
	totalTracksHeight,
	layerIndexAtCanvasY,
	hitLayerDivider,
	layerHeightAt,
	trackTopForLayer,
} from '../lib/timeline-track-heights.js'
import { fmtTimecode } from './timeline-canvas-utils.js'
import { drawTimelineClip } from './timeline-canvas-clip.js'

export { fmtSmpte, parseTcInput } from './timeline-canvas-utils.js'

const RULER_H = 30
const HEADER_W = 112
/** Minimum zoom: px per ms (lower = more zoomed out). 0.0001 ≈ 100px per 1000s. */
const MIN_PX_MS = 0.0001
const MAX_PX_MS = 5.0   // 5000px/s
const ZOOM_FACTOR = 1.35

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

	/** Match clip drawing: row content clipped so it does not draw into the ruler. */
	function clipRowRect(trackY, trackH) {
		const rawTop = trackY + 4
		const rawBottom = trackY + trackH - 4
		const clipTop = Math.max(rawTop, RULER_H)
		const clipBottom = Math.min(rawBottom, canvas.height)
		const h = Math.max(0, clipBottom - clipTop)
		return { y: clipTop, h }
	}

	// ── Drawing ───────────────────────────────────────────────────────────────

	function resize() {
		const r = container.getBoundingClientRect()
		const w = Math.round(r.width)
		const h = Math.round(r.height)
		// Don't collapse to 0×0 when the container is hidden (display:none tab)
		if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
			canvas.width = w
			canvas.height = h
		}
	}

	function draw() {
		resize()
		const tl = getTimeline()
		if (tl) {
			ensureLayerHeights(tl)
			const m = maxScrollY(tl)
			if (scrollY > m) scrollY = m
		}
		const pb = getPlayback()
		ctx.clearRect(0, 0, canvas.width, canvas.height)
		drawBackground(tl)
		drawRuler(tl, pb)
		if (tl) drawFlags(tl, getFlagSelection)
		if (tl) drawTracks(tl)
		drawPlayhead(pb)
		drawHeaders(tl)
	}

	function drawBackground(tl) {
		ctx.fillStyle = '#0d1117'
		ctx.fillRect(0, 0, canvas.width, canvas.height)
	}

	function drawHeaders(tl) {
		// Header column background (drawn last so it stays on top of clips)
		ctx.fillStyle = '#161b22'
		ctx.fillRect(0, RULER_H, HEADER_W, canvas.height - RULER_H)
		// Top-left corner
		ctx.fillStyle = '#0d1117'
		ctx.fillRect(0, 0, HEADER_W, RULER_H)
		// Separator line
		ctx.fillStyle = '#30363d'
		ctx.fillRect(HEADER_W, 0, 1, canvas.height)

		if (!tl) return
		ensureLayerHeights(tl)
		ctx.font = `12px ${UI_FONT_FAMILY}`
		ctx.textAlign = 'left'
		for (let li = 0; li < tl.layers.length; li++) {
			const layer = tl.layers[li]
			const trackY = trackTopForLayer(tl, li, scrollY, RULER_H)
			const th = layerHeightAt(tl, li)
			if (trackY + th < RULER_H || trackY > canvas.height) continue
			ctx.fillStyle = '#8b949e'
			ctx.fillText(layer.name || `L${li + 1}`, 8, trackY + th / 2 + 4)
		}
	}

	function drawRuler(tl, pb) {
		ctx.fillStyle = '#161b22'
		ctx.fillRect(HEADER_W, 0, canvas.width - HEADER_W, RULER_H)
		ctx.fillStyle = '#30363d'
		ctx.fillRect(HEADER_W, RULER_H - 1, canvas.width - HEADER_W, 1)

		if (!tl) return
		const fps = tl.fps || 25

		// Pick a "nice" tick interval so ticks are at least 55px apart
		const rawIntervalMs = 55 / pxPerMs
		const NICE = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000]
		const intervalMs = NICE.find((n) => n >= rawIntervalMs) || 300000

		const startMs = scrollX
		const endMs = startMs + (canvas.width - HEADER_W) / pxPerMs
		const firstTick = Math.ceil(startMs / intervalMs) * intervalMs

		ctx.font = `10px ${UI_FONT_FAMILY}`
		ctx.textAlign = 'left'

		for (let t = firstTick; t <= Math.min(endMs, tl.duration + intervalMs); t += intervalMs) {
			const x = xAt(t)
			ctx.fillStyle = '#21262d'
			ctx.fillRect(x, 0, 1, RULER_H)
			ctx.fillStyle = '#58a6ff'
			ctx.fillRect(x, RULER_H - 6, 1, 6)
			ctx.fillStyle = '#8b949e'
			ctx.fillText(fmtTimecode(t, fps), x + 3, RULER_H - 8)
		}

		// Sub-ticks (5 per interval)
		const subMs = intervalMs / 5
		if (subMs * pxPerMs >= 5) {
			const firstSub = Math.ceil(startMs / subMs) * subMs
			for (let t = firstSub; t <= endMs; t += subMs) {
				if (t % intervalMs < 1) continue
				const x = xAt(t)
				ctx.fillStyle = '#30363d'
				ctx.fillRect(x, RULER_H - 4, 1, 4)
			}
		}

		// End marker
		const endX = xAt(tl.duration)
		if (endX >= HEADER_W && endX <= canvas.width) {
			ctx.fillStyle = '#f85149'
			ctx.fillRect(endX, 0, 2, RULER_H)
		}
	}

	function drawFlags(tl, getFlagSel) {
		const flags = tl.flags
		if (!flags?.length) return
		const sel = getFlagSel?.()
		for (const f of flags) {
			const x = xAt(f.timeMs)
			if (x < HEADER_W - 2 || x > canvas.width + 2) continue
			const t = f.type || 'pause'
			const color = t === 'play' ? '#3fb950' : t === 'jump' ? '#a371f7' : '#f85149'
			const isSel = sel && sel.timelineId === tl.id && sel.flagId === f.id
			ctx.strokeStyle = isSel ? '#58a6ff' : color
			ctx.lineWidth = isSel ? 2 : 1
			ctx.beginPath()
			ctx.moveTo(x, 0)
			ctx.lineTo(x, RULER_H - 14)
			ctx.stroke()
			ctx.beginPath()
			ctx.moveTo(x - 6, RULER_H - 2)
			ctx.lineTo(x + 6, RULER_H - 2)
			ctx.lineTo(x, RULER_H - 13)
			ctx.closePath()
			ctx.fillStyle = color
			ctx.fill()
			if (isSel) {
				ctx.strokeStyle = '#58a6ff'
				ctx.lineWidth = 2
				ctx.stroke()
			}
		}
	}

	function drawTracks(tl) {
		ensureLayerHeights(tl)
		for (let li = 0; li < tl.layers.length; li++) {
			const layer = tl.layers[li]
			const trackY = trackTopForLayer(tl, li, scrollY, RULER_H)
			const th = layerHeightAt(tl, li)
			if (trackY + th < RULER_H || trackY > canvas.height) continue

			// Row background
			ctx.fillStyle = li % 2 === 0 ? '#0d1117' : '#0f1319'
			ctx.fillRect(HEADER_W, trackY, canvas.width - HEADER_W, th)

			// Row separator
			ctx.fillStyle = '#21262d'
			ctx.fillRect(HEADER_W, trackY + th - 1, canvas.width - HEADER_W, 1)

			for (const clip of (layer.clips || [])) {
				drawTimelineClip(ctx, clip, li, trackY, tl.fps, {
					xAt,
					canvas,
					HEADER_W,
					trackHeight: th,
					rulerH: RULER_H,
					thumbCache,
					waveformCache,
					schedDraw,
					getThumbnailUrl,
					getWaveformUrl,
					getSourceDurationMs,
					isAudioOnlySource,
					drag,
					pxPerMs,
					selection: getClipSelection?.(),
					activeTimelineId: tl.id,
				})
			}
		}

		// "Add Layer" drop zone below last track
		const addY = RULER_H + totalTracksHeight(tl) - scrollY
		if (addY < canvas.height) {
			ctx.fillStyle = 'rgba(88,166,255,0.04)'
			ctx.fillRect(HEADER_W + 1, addY, canvas.width - HEADER_W - 1, DEFAULT_LAYER_H)
			ctx.fillStyle = '#30363d'
			ctx.textAlign = 'center'
			ctx.font = `11px ${UI_FONT_FAMILY}`
			ctx.fillText('+ drop here to add layer', HEADER_W + (canvas.width - HEADER_W) / 2, addY + DEFAULT_LAYER_H / 2 + 4)
		}
	}

	function drawPlayhead(pb) {
		const pos = pb?.position ?? 0
		const x = xAt(pos)
		if (x < HEADER_W || x > canvas.width) return

		ctx.strokeStyle = '#f85149'
		ctx.lineWidth = 1.5
		ctx.beginPath()
		ctx.moveTo(x, RULER_H)
		ctx.lineTo(x, canvas.height)
		ctx.stroke()

		// Triangle handle on ruler
		ctx.fillStyle = '#f85149'
		ctx.beginPath()
		ctx.moveTo(x - 6, 0); ctx.lineTo(x + 6, 0); ctx.lineTo(x, 12)
		ctx.closePath(); ctx.fill()
	}

	// ── Hit testing ───────────────────────────────────────────────────────────

	function hitClip(tl, li, ms) {
		if (!tl || li < 0 || li >= tl.layers.length) return null
		for (const c of tl.layers[li].clips) {
			if (ms >= c.startTime && ms < c.startTime + c.duration) return c
		}
		return null
	}

	/** Returns 'left', 'right', or null depending on proximity to clip edges. */
	function edgeZone(clip, ms) {
		const edgeMs = 6 / pxPerMs
		if (Math.abs(ms - clip.startTime) < edgeMs) return 'left'
		if (Math.abs(ms - (clip.startTime + clip.duration)) < edgeMs) return 'right'
		return null
	}

	/** @returns {{ flag: object } | null} */
	function hitFlag(tl, cx, cy) {
		if (cy >= RULER_H || !tl?.flags?.length) return null
		for (const f of tl.flags) {
			const x = xAt(f.timeMs)
			if (Math.abs(cx - x) <= 10 && cx >= HEADER_W) return { flag: f }
		}
		return null
	}

	/** Returns keyframe index if (cx, cy) hits a keyframe diamond, else null. */
	function hitKeyframe(clip, trackY, trackH, cx, cy) {
		if (!clip.keyframes?.length) return null
		const x = xAt(clip.startTime)
		const w = Math.max(3, clip.duration * pxPerMs)
		const { y, h } = clipRowRect(trackY, trackH)
		if (h < 8) return null
		const ky = y + h - 7
		// Diamond hit: roughly 10px wide, 12px tall
		if (cy < ky - 8 || cy > ky + 8) return null
		for (let i = 0; i < clip.keyframes.length; i++) {
			const kx = xAt(clip.startTime + clip.keyframes[i].time)
			if (Math.abs(cx - kx) <= 8) return i
		}
		return null
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
			const hf = tl ? hitFlag(tl, cx, cy) : null
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
			const kfIdx = hitKeyframe(clip, trackY, layerHeightAt(tl, li), cx, cy)
			if (kfIdx != null && onSelectKeyframe) {
				onSelectClip({ layerIdx: li, clipId: clip.id, timelineId: tl.id, clip })
				onSelectKeyframe({ timelineId: tl.id, layerIdx: li, clipId: clip.id, keyframeIdx: kfIdx, keyframe: clip.keyframes[kfIdx] })
				drag = { type: 'keyframe-drag', layerIdx: li, clipId: clip.id, keyframeIdx: kfIdx, origTime: clip.keyframes[kfIdx].time, origMs: ms }
			} else {
				const edge = edgeZone(clip, ms)
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
				const hf = tl ? hitFlag(tl, cx, cy) : null
				canvas.style.cursor = hf ? 'pointer' : 'col-resize'
			} else if (tl) {
				ensureLayerHeights(tl)
				if (onLayerHeightsChange && hitLayerDivider(cy, tl, scrollY, RULER_H) != null) {
					canvas.style.cursor = 'ns-resize'
				} else {
					const li = layerAt(cy, tl)
					const clip = li < tl.layers.length ? hitClip(tl, li, ms) : null
					if (clip) {
						canvas.style.cursor = edgeZone(clip, ms) ? 'ew-resize' : 'grab'
					} else {
						canvas.style.cursor = 'default'
					}
				}
			}
			return
		}

		if (drag.type === 'layer-divider' && tl && onLayerHeightsChange) {
			ensureLayerHeights(tl)
			const deltaY = e.clientY - drag.startClientY
			const orig = drag.origHeights
			let next
			if (drag.shiftKey) {
				next = orig.map((h) => Math.max(MIN_LAYER_H, Math.min(MAX_LAYER_H, Math.round(h + deltaY))))
			} else {
				const i = drag.dividerIdx
				const sum = orig[i] + orig[i + 1]
				let h0 = Math.round(orig[i] + deltaY)
				h0 = Math.max(MIN_LAYER_H, Math.min(MAX_LAYER_H, h0))
				let h1 = sum - h0
				if (h1 < MIN_LAYER_H) {
					h1 = MIN_LAYER_H
					h0 = sum - h1
				} else if (h1 > MAX_LAYER_H) {
					h1 = MAX_LAYER_H
					h0 = sum - h1
				}
				if (h0 < MIN_LAYER_H) {
					h0 = MIN_LAYER_H
					h1 = sum - h0
				} else if (h0 > MAX_LAYER_H) {
					h0 = MAX_LAYER_H
					h1 = sum - h0
				}
				next = [...orig]
				next[i] = h0
				next[i + 1] = h1
			}
			onLayerHeightsChange(tl.id, next, false)
			schedDraw()
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
			const maxY = maxScrollY(tl)
			scrollY = Math.max(0, Math.min(maxY, scrollY + dy * 0.5))
			schedDraw()
			return
		}

		// Shift + vertical wheel = horizontal time pan (wheel-only mice)
		if (e.shiftKey && !e.altKey && Math.abs(dy) >= Math.abs(dx)) {
			scrollX = Math.max(0, scrollX + dy / pxPerMs * 0.5)
			schedDraw()
			return
		}

		// Dominant horizontal delta = pan time axis (trackpad two-finger horizontal, etc.)
		if (Math.abs(dx) > Math.abs(dy)) {
			scrollX = Math.max(0, scrollX + dx / pxPerMs * 0.5)
			schedDraw()
			return
		}

		// Vertical wheel (incl. pinch-zoom with Ctrl on macOS) = zoom centred on cursor X
		const msUnder = msAt(cx)
		const factor = dy > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR
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

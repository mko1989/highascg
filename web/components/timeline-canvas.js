/**
 * Timeline canvas — rendering + interaction.
 * Scroll: up/down = vertical layer pan. Shift+scroll = horizontal pan. Ctrl/Cmd+scroll = zoom.
 * Ruler click/drag = seek (sends SEEK command on every move event).
 * Clip drag = move clip. Clip edge drag = resize.
 * @see main_plan.md Prompt 17
 */

import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { fmtTimecode } from './timeline-canvas-utils.js'
import { drawTimelineClip } from './timeline-canvas-clip.js'

export { fmtSmpte, parseTcInput } from './timeline-canvas-utils.js'

const RULER_H = 30
const TRACK_H = 54
const HEADER_W = 112
const MIN_PX_MS = 0.005 // 5px/s
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
		onLayerContextMenu,
		onLayerClick,
		getThumbnailUrl,
		getWaveformUrl,
		onSelectKeyframe,
		onMoveKeyframe,
		onSelectFlag,
		onMoveFlagTime,
		getClipSelection,
		getFlagSelection,
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

	function layerAt(canvasY) {
		return Math.floor((canvasY - RULER_H + scrollY) / TRACK_H)
	}

	function maxScrollY(tl) {
		return Math.max(0, (tl?.layers?.length || 0) * TRACK_H - (canvas.height - RULER_H))
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
		ctx.font = `12px ${UI_FONT_FAMILY}`
		ctx.textAlign = 'left'
		for (let li = 0; li < tl.layers.length; li++) {
			const layer = tl.layers[li]
			const y = RULER_H + li * TRACK_H - scrollY
			if (y + TRACK_H < RULER_H || y > canvas.height) continue
			ctx.fillStyle = '#8b949e'
			ctx.fillText(layer.name || `L${li + 1}`, 8, y + TRACK_H / 2 + 4)
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
		for (let li = 0; li < tl.layers.length; li++) {
			const layer = tl.layers[li]
			const trackY = RULER_H + li * TRACK_H - scrollY
			if (trackY + TRACK_H < RULER_H || trackY > canvas.height) continue

			// Row background
			ctx.fillStyle = li % 2 === 0 ? '#0d1117' : '#0f1319'
			ctx.fillRect(HEADER_W, trackY, canvas.width - HEADER_W, TRACK_H)

			// Row separator
			ctx.fillStyle = '#21262d'
			ctx.fillRect(HEADER_W, trackY + TRACK_H - 1, canvas.width - HEADER_W, 1)

			for (const clip of (layer.clips || [])) {
				drawTimelineClip(ctx, clip, li, trackY, tl.fps, {
					xAt,
					canvas,
					HEADER_W,
					TRACK_H,
					thumbCache,
					waveformCache,
					schedDraw,
					getThumbnailUrl,
					getWaveformUrl,
					drag,
					pxPerMs,
					selection: getClipSelection?.(),
					activeTimelineId: tl.id,
				})
			}
		}

		// "Add Layer" drop zone below last track
		const addY = RULER_H + tl.layers.length * TRACK_H - scrollY
		if (addY < canvas.height) {
			ctx.fillStyle = 'rgba(88,166,255,0.04)'
			ctx.fillRect(HEADER_W + 1, addY, canvas.width - HEADER_W - 1, TRACK_H)
			ctx.fillStyle = '#30363d'
			ctx.textAlign = 'center'
			ctx.font = `11px ${UI_FONT_FAMILY}`
			ctx.fillText('+ drop here to add layer', HEADER_W + (canvas.width - HEADER_W) / 2, addY + TRACK_H / 2 + 4)
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
	function hitKeyframe(clip, trackY, cx, cy) {
		if (!clip.keyframes?.length) return null
		const x = xAt(clip.startTime)
		const w = Math.max(3, clip.duration * pxPerMs)
		const h = TRACK_H - 8
		const y = trackY + 4
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
		const li = layerAt(cy)

		// Left-click on layer header → open layer inspector
		if (cx < HEADER_W && li >= 0 && li < tl.layers.length && e.button === 0) {
			onLayerClick?.(tl.id, li, tl.layers[li])
			return
		}
		const clip = hitClip(tl, li, ms)

		if (clip) {
			const trackY = RULER_H + li * TRACK_H - scrollY
			const kfIdx = hitKeyframe(clip, trackY, cx, cy)
			if (kfIdx != null && onSelectKeyframe) {
				onSelectClip({ layerIdx: li, clipId: clip.id, timelineId: tl.id, clip })
				onSelectKeyframe({ timelineId: tl.id, layerIdx: li, clipId: clip.id, keyframeIdx: kfIdx, keyframe: clip.keyframes[kfIdx] })
				drag = { type: 'keyframe-drag', layerIdx: li, clipId: clip.id, keyframeIdx: kfIdx, origTime: clip.keyframes[kfIdx].time, origMs: ms }
			} else {
				const edge = edgeZone(clip, ms)
				onSelectClip({ layerIdx: li, clipId: clip.id, timelineId: tl.id, clip })
				if (edge) {
					drag = { type: 'clip-resize', edge, layerIdx: li, clipId: clip.id,
						origStart: clip.startTime, origDur: clip.duration, origMs: ms }
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
				const li = layerAt(cy)
				const clip = hitClip(tl, li, ms)
				if (clip) {
					canvas.style.cursor = edgeZone(clip, ms) ? 'ew-resize' : 'grab'
				} else {
					canvas.style.cursor = 'default'
				}
			}
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
				if (newDur > 200) onResizeClip(drag.layerIdx, drag.clipId, { startTime: newStart, duration: newDur })
			} else {
				const newDur = Math.max(200, ms - drag.origStart)
				onResizeClip(drag.layerIdx, drag.clipId, { duration: newDur })
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
		if (drag?.type === 'seek' && onSeekEnd) {
			const tl = getTimeline()
			if (tl) onSeekEnd(Math.max(0, Math.min(lastSeekMs, tl.duration)))
		}
		drag = null
		canvas.style.cursor = 'default'
		schedDraw()
	})
	canvas.addEventListener('mouseleave', () => { drag = null })

	// Right-click on layer header → context menu (rename, add layer, remove layer)
	canvas.addEventListener('contextmenu', (e) => {
		const rect = canvas.getBoundingClientRect()
		const cx = e.clientX - rect.left
		const cy = e.clientY - rect.top
		if (cx >= HEADER_W || cy < RULER_H) return
		const tl = getTimeline()
		if (!tl) return
		const li = layerAt(cy)
		if (li < 0 || li >= tl.layers.length) return
		e.preventDefault()
		onLayerContextMenu?.(tl.id, li, tl.layers[li], e.clientX, e.clientY)
	})

	canvas.addEventListener('wheel', (e) => {
		e.preventDefault()
		const rect = canvas.getBoundingClientRect()
		const cx = e.clientX - rect.left
		const tl = getTimeline()
		const delta = e.deltaY

		if (e.ctrlKey || e.metaKey) {
			// Zoom centred on mouse X position
			const msUnder = msAt(cx)
			const factor = delta > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR
			pxPerMs = Math.max(MIN_PX_MS, Math.min(MAX_PX_MS, pxPerMs * factor))
			scrollX = Math.max(0, msUnder - (cx - HEADER_W) / pxPerMs)
		} else if (e.shiftKey) {
			// Horizontal pan
			scrollX = Math.max(0, scrollX + delta / pxPerMs * 0.5)
		} else {
			// Vertical pan (layers)
			const maxY = maxScrollY(tl)
			scrollY = Math.max(0, Math.min(maxY, scrollY + delta * 0.5))
		}
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
		const li = tl ? Math.max(0, Math.min(layerAt(cy), tl.layers.length)) : 0
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

import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import {
	DEFAULT_LAYER_H,
	MIN_LAYER_H,
	MAX_LAYER_H,
	ensureLayerHeights,
	totalTracksHeight,
	trackTopForLayer,
	layerHeightAt,
} from '../lib/timeline-track-heights.js'
import { fmtTimecode } from './timeline-canvas-utils.js'
import { drawTimelineClip } from './timeline-canvas-clip.js'

export const RULER_H = 30
export const HEADER_W = 112

export function resizeTimelineCanvas(container, canvas) {
	const r = container.getBoundingClientRect()
	const w = Math.round(r.width)
	const h = Math.round(r.height)
	if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
		canvas.width = w
		canvas.height = h
	}
}

/**
 * @param {object} deps
 * @param {CanvasRenderingContext2D} deps.ctx
 * @param {HTMLCanvasElement} deps.canvas
 * @param {() => object | null} deps.getTimeline
 * @param {() => object | null} deps.getPlayback
 * @param {(ms: number) => number} deps.xAt
 * @param {(canvasY: number, tl: object) => number} deps.layerAt
 * @param {number} deps.scrollX
 * @param {number} deps.scrollY
 * @param {number} deps.pxPerMs
 * @param {object | null} deps.drag
 * @param {() => void} deps.schedDraw
 * @param {Map} deps.thumbCache
 * @param {Map} deps.waveformCache
 * @param {() => object | undefined} [deps.getClipSelection]
 * @param {() => object | undefined} [deps.getFlagSelection]
 * @param {(...a: any[]) => string | null | undefined} [deps.getThumbnailUrl]
 * @param {(...a: any[]) => string | null | undefined} [deps.getWaveformUrl]
 * @param {() => number | null | undefined} [deps.getSourceDurationMs]
 * @param {(name: string) => boolean} [deps.isAudioOnlySource]
 */
export function drawTimelineCanvas(deps) {
	const {
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
	} = deps

	const tl = getTimeline()
	const pb = getPlayback()
	ctx.clearRect(0, 0, canvas.width, canvas.height)
	drawBackground(ctx, canvas)
	drawRuler(ctx, canvas, tl, pb, xAt, pxPerMs, scrollX)
	if (tl) drawFlags(ctx, canvas, tl, xAt, getFlagSelection)
	if (tl) drawTracks(ctx, canvas, tl, scrollY, xAt, pxPerMs, drag, schedDraw, thumbCache, waveformCache, getClipSelection, getThumbnailUrl, getWaveformUrl, getSourceDurationMs, isAudioOnlySource)
	drawPlayhead(ctx, canvas, pb, xAt, RULER_H)
	drawHeaders(ctx, canvas, tl, scrollY, layerAt)
}

function drawBackground(ctx, canvas) {
	ctx.fillStyle = '#0d1117'
	ctx.fillRect(0, 0, canvas.width, canvas.height)
}

function drawHeaders(ctx, canvas, tl, scrollY, layerAt) {
	ctx.fillStyle = '#161b22'
	ctx.fillRect(0, RULER_H, HEADER_W, canvas.height - RULER_H)
	ctx.fillStyle = '#0d1117'
	ctx.fillRect(0, 0, HEADER_W, RULER_H)
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

function drawRuler(ctx, canvas, tl, pb, xAt, pxPerMs, scrollX) {
	ctx.fillStyle = '#161b22'
	ctx.fillRect(HEADER_W, 0, canvas.width - HEADER_W, RULER_H)
	ctx.fillStyle = '#30363d'
	ctx.fillRect(HEADER_W, RULER_H - 1, canvas.width - HEADER_W, 1)

	if (!tl) return
	const fps = tl.fps || 25

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

	const endX = xAt(tl.duration)
	if (endX >= HEADER_W && endX <= canvas.width) {
		ctx.fillStyle = '#f85149'
		ctx.fillRect(endX, 0, 2, RULER_H)
	}
}

function drawFlags(ctx, canvas, tl, xAt, getFlagSel) {
	const flags = tl.flags
	if (!flags?.length) return
	const sel = getFlagSel?.()
	for (const f of flags) {
		const x = xAt(f.timeMs)
		if (x < HEADER_W - 2 || x > canvas.width + 2) continue
		const t = f.type || 'pause'
		const color = t === 'play' ? '#3fb950' : t === 'jump' ? '#a371f7' : t === 'companion_press' ? '#f0a030' : '#f85149'
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

function drawTracks(
	ctx,
	canvas,
	tl,
	scrollY,
	xAt,
	pxPerMs,
	drag,
	schedDraw,
	thumbCache,
	waveformCache,
	getClipSelection,
	getThumbnailUrl,
	getWaveformUrl,
	getSourceDurationMs,
	isAudioOnlySource,
) {
	ensureLayerHeights(tl)
	for (let li = 0; li < tl.layers.length; li++) {
		const layer = tl.layers[li]
		const trackY = trackTopForLayer(tl, li, scrollY, RULER_H)
		const th = layerHeightAt(tl, li)
		if (trackY + th < RULER_H || trackY > canvas.height) continue

		ctx.fillStyle = li % 2 === 0 ? '#0d1117' : '#0f1319'
		ctx.fillRect(HEADER_W, trackY, canvas.width - HEADER_W, th)

		ctx.fillStyle = '#21262d'
		ctx.fillRect(HEADER_W, trackY + th - 1, canvas.width - HEADER_W, 1)

		for (const clip of layer.clips || []) {
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

function drawPlayhead(ctx, canvas, pb, xAt, rulerH) {
	const pos = pb?.position ?? 0
	const x = xAt(pos)
	if (x < HEADER_W || x > canvas.width) return

	ctx.strokeStyle = '#f85149'
	ctx.lineWidth = 1.5
	ctx.beginPath()
	ctx.moveTo(x, rulerH)
	ctx.lineTo(x, canvas.height)
	ctx.stroke()

	ctx.fillStyle = '#f85149'
	ctx.beginPath()
	ctx.moveTo(x - 6, 0); ctx.lineTo(x + 6, 0); ctx.lineTo(x, 12)
	ctx.closePath(); ctx.fill()
}

/** Match clip drawing: row content clipped so it does not draw into the ruler. */
export function clipRowRect(canvas, trackY, trackH) {
	const rawTop = trackY + 4
	const rawBottom = trackY + trackH - 4
	const clipTop = Math.max(rawTop, RULER_H)
	const clipBottom = Math.min(rawBottom, canvas.height)
	const h = Math.max(0, clipBottom - clipTop)
	return { y: clipTop, h }
}

export function hitClip(tl, li, ms) {
	if (!tl || li < 0 || li >= tl.layers.length) return null
	for (const c of tl.layers[li].clips) {
		if (ms >= c.startTime && ms < c.startTime + c.duration) return c
	}
	return null
}

/** Returns 'left', 'right', or null depending on proximity to clip edges. */
export function edgeZone(clip, ms, pxPerMs) {
	const edgeMs = 6 / pxPerMs
	if (Math.abs(ms - clip.startTime) < edgeMs) return 'left'
	if (Math.abs(ms - (clip.startTime + clip.duration)) < edgeMs) return 'right'
	return null
}

/** @returns {{ flag: object } | null} */
export function hitFlag(tl, cx, cy, xAt) {
	if (cy >= RULER_H || !tl?.flags?.length) return null
	for (const f of tl.flags) {
		const x = xAt(f.timeMs)
		if (Math.abs(cx - x) <= 10 && cx >= HEADER_W) return { flag: f }
	}
	return null
}

/** Returns keyframe index if (cx, cy) hits a keyframe diamond, else null. */
export function hitKeyframe(clip, trackY, trackH, cx, cy, canvas, xAt, pxPerMs) {
	if (!clip.keyframes?.length) return null
	const x = xAt(clip.startTime)
	const w = Math.max(3, clip.duration * pxPerMs)
	const { y, h } = clipRowRect(canvas, trackY, trackH)
	if (h < 8) return null
	const ky = y + h - 7
	if (cy < ky - 8 || cy > ky + 8) return null
	for (let i = 0; i < clip.keyframes.length; i++) {
		const kx = xAt(clip.startTime + clip.keyframes[i].time)
		if (Math.abs(cx - kx) <= 8) return i
	}
	return null
}

export function applyLayerDividerMouseMove(drag, clientY, tl, onLayerHeightsChange, schedDraw) {
	ensureLayerHeights(tl)
	const deltaY = clientY - drag.startClientY
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
}

/**
 * Single timeline clip drawing (thumbnail, waveform, keyframes, resize handles).
 */

import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { enqueueWaveformFetch } from '../lib/waveform-fetch-queue.js'
import { roundRect } from './timeline-canvas-utils.js'

const CLIP_PALETTE = ['#1f6b36', '#0c5d8c', '#5a1e87', '#8c1a44', '#7a3100', '#005c54']

/** Stretch peak array to `targetCount` bars (linear). */
function interpolatePeaks(peaks, targetCount) {
	if (!Array.isArray(peaks) || peaks.length === 0 || targetCount < 1) return []
	if (peaks.length === targetCount) return peaks.slice()
	const out = []
	const last = peaks.length - 1
	for (let i = 0; i < targetCount; i++) {
		const t = last > 0 ? (i / (targetCount - 1)) * last : 0
		const i0 = Math.floor(t)
		const i1 = Math.min(i0 + 1, last)
		const f = t - i0
		out.push((peaks[i0] ?? 0) * (1 - f) + (peaks[i1] ?? 0) * f)
	}
	return out
}

/**
 * Map full-file peaks to the clip's visible source window (trim / inPoint).
 * Peaks are assumed uniformly spaced over [0, sourceDurationMs].
 * `inPoint` is in frames at timeline fps (same convention as server playback).
 * @param {number[]} peaks
 * @param {object} clip
 * @param {number} fps
 * @param {number | null} sourceDurationMs
 */
function slicePeaksToTrim(peaks, clip, fps, sourceDurationMs) {
	if (!Array.isArray(peaks) || peaks.length === 0 || !sourceDurationMs || sourceDurationMs <= 0) {
		return peaks
	}
	const fpsN = Math.max(1, fps || 25)
	const inFrames = Number(clip.inPoint) || 0
	const startMs = (inFrames / fpsN) * 1000
	const endMs = startMs + Math.max(0, clip.duration || 0)
	let startRatio = startMs / sourceDurationMs
	let endRatio = endMs / sourceDurationMs
	startRatio = Math.max(0, Math.min(1, startRatio))
	endRatio = Math.max(startRatio, Math.min(1, endRatio))
	const n = peaks.length
	if (n === 1) return peaks.slice()
	const t0 = startRatio * (n - 1)
	const t1 = endRatio * (n - 1)
	if (t1 - t0 < 1e-6) return [peaks[Math.round(t0)] ?? 0]
	const inner = Math.max(8, Math.min(n, Math.ceil(2 + (t1 - t0))))
	const out = []
	for (let i = 0; i < inner; i++) {
		const t = t0 + (i / Math.max(1, inner - 1)) * (t1 - t0)
		const i0 = Math.floor(t)
		const i1 = Math.min(i0 + 1, n - 1)
		const f = t - i0
		out.push((peaks[i0] ?? 0) * (1 - f) + (peaks[i1] ?? 0) * f)
	}
	return out
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} clip
 * @param {number} layerIdx
 * @param {number} trackY
 * @param {number} fps
 * @param {object} env
 */
export function drawTimelineClip(ctx, clip, layerIdx, trackY, _fps, env) {
	const {
		xAt,
		canvas,
		HEADER_W,
		trackHeight = 54,
		rulerH = 0,
		thumbCache,
		waveformCache,
		schedDraw,
		getThumbnailUrl,
		getWaveformUrl,
		getSourceDurationMs,
		isAudioOnlySource,
		drag,
		selection,
		activeTimelineId,
	} = env

	if (!clip.source?.value) return
	const x = xAt(clip.startTime)
	const w = Math.max(3, clip.duration * env.pxPerMs)
	const rawTop = trackY + 4
	const rawBottom = trackY + trackHeight - 4
	const clipTop = Math.max(rawTop, rulerH)
	const clipBottom = Math.min(rawBottom, canvas.height)
	const h = Math.max(0, clipBottom - clipTop)
	const y = clipTop

	if (x + w < HEADER_W + 1 || x > canvas.width) return
	if (h < 4) return

	const visX = Math.max(x, HEADER_W + 1)
	const visW = Math.min(x + w, canvas.width) - visX

	const col = CLIP_PALETTE[layerIdx % CLIP_PALETTE.length]
	const isDragSelected =
		(drag?.type === 'clip-move' && drag.clipId === clip.id) ||
		(drag?.type === 'clip-resize' && drag.clipId === clip.id)
	const isSelStatic =
		selection &&
		activeTimelineId &&
		selection.timelineId === activeTimelineId &&
		selection.clipId === clip.id &&
		selection.layerIdx === layerIdx
	const isSelected = isDragSelected || isSelStatic

	ctx.save()
	ctx.beginPath()
	roundRect(ctx, x, y, w, h, 3)
	ctx.fillStyle = col
	ctx.fill()
	ctx.restore()

	// Source start marker: gold solid = playback from file head (inPoint 0); orange dashed = trimmed in (inPoint > 0).
	const inFrames = Number(clip.inPoint) || 0
	if (w >= 10 && h >= 6) {
		const lx = Math.min(x + 5, x + w - 6)
		ctx.save()
		ctx.beginPath()
		roundRect(ctx, x, y, w, h, 3)
		ctx.clip()
		ctx.lineWidth = 2
		ctx.lineCap = 'butt'
		if (inFrames <= 0) {
			ctx.strokeStyle = 'rgba(255, 215, 0, 0.92)'
			ctx.setLineDash([])
		} else {
			ctx.strokeStyle = 'rgba(251, 146, 60, 0.92)'
			ctx.setLineDash([2, 3])
		}
		ctx.beginPath()
		ctx.moveTo(lx + 1, y + 3)
		ctx.lineTo(lx + 1, y + h - 3)
		ctx.stroke()
		ctx.restore()
	}

	const hasAudio = clip.hasAudio ?? (clip.source?.type === 'media')
	const audioOnlyThumb = isAudioOnlySource?.(clip.source) === true
	const thumbUrl = getThumbnailUrl?.(clip.source)
	if (thumbUrl && w >= 36 && h >= 20 && !audioOnlyThumb) {
		const thumbSize = Math.min(36, h - 4, w - 10)
		const tx = x + 5
		const ty = y + (h - thumbSize) / 2
		let img = thumbCache.get(thumbUrl)
		if (img === undefined) {
			thumbCache.set(thumbUrl, 'loading')
			const im = new Image()
			im.crossOrigin = 'anonymous'
			im.onload = () => {
				thumbCache.set(thumbUrl, im)
				schedDraw()
			}
			im.onerror = () => {
				thumbCache.set(thumbUrl, 'error')
			}
			im.src = thumbUrl
		} else if (img && img !== 'loading' && img !== 'error') {
			ctx.save()
			ctx.beginPath()
			roundRect(ctx, tx, ty, thumbSize, thumbSize, 2)
			ctx.clip()
			ctx.drawImage(img, tx, ty, thumbSize, thumbSize)
			ctx.restore()
		}
	}

	const wavePad = 4
	const waveH = Math.max(8, h - wavePad * 2)
	const waveY = y + wavePad
	const waveformUrl = getWaveformUrl?.(clip.source)
	let wf = waveformUrl ? waveformCache.get(waveformUrl) : undefined
	const serverNoAudio = wf === 'no-audio'
	const showWaveStrip =
		hasAudio &&
		!serverNoAudio &&
		clip.source?.type === 'media' &&
		clip.source?.value &&
		w >= 20 &&
		h >= wavePad * 2 + 8

	if (showWaveStrip && waveformUrl) {
		if (wf === undefined) {
			waveformCache.set(waveformUrl, 'loading')
			wf = 'loading'
			enqueueWaveformFetch(() => {
				fetch(waveformUrl)
					.then((r) => (r.ok ? r.json() : null))
					.then((d) => {
						if (d?.hasAudio === false) {
							waveformCache.set(waveformUrl, 'no-audio')
						} else if (Array.isArray(d?.peaks)) {
							waveformCache.set(waveformUrl, d.peaks)
						} else {
							waveformCache.set(waveformUrl, 'error')
						}
						schedDraw()
					})
					.catch(() => {
						waveformCache.set(waveformUrl, 'error')
						schedDraw()
					})
			})
		}

		if (wf !== 'loading' && wf !== undefined && wf !== 'no-audio') {
			const peaks = Array.isArray(wf) ? wf : null
			const useSynthetic = wf === 'error' || (Array.isArray(wf) && wf.length === 0)
			const barCount = Math.min(200, Math.max(16, Math.floor(w / 3)))
			const sourceDur = getSourceDurationMs?.(clip.source)
			const trimmed =
				!useSynthetic && peaks?.length
					? slicePeaksToTrim(peaks, clip, _fps, sourceDur)
					: null
			const bars = interpolatePeaks(
				trimmed?.length ? trimmed : peaks || [],
				barCount,
			)
			const nBars = bars.length || barCount
			const padX = 3
			const innerW = Math.max(1, w - padX * 2)
			const barW = Math.max(1, (innerW - (nBars - 1) * 1) / nBars)
			const gap = 1
			const cy = waveY + waveH / 2
			const maxHalf = waveH / 2 - 2
			const seed = String(clip.id || clip.source?.value || '')
				.split('')
				.reduce((a, c) => a + c.charCodeAt(0), 0)
			ctx.save()
			ctx.beginPath()
			ctx.rect(visX, waveY, visW, waveH)
			ctx.clip()
			ctx.fillStyle = 'rgba(0,0,0,0.2)'
			ctx.fillRect(x, waveY, w, waveH)
			ctx.fillStyle = 'rgba(255,255,255,0.75)'
			for (let i = 0; i < nBars; i++) {
				let v
				if (useSynthetic) {
					v = Math.abs(Math.sin(seed * 0.1 + (i / Math.max(1, nBars - 1)) * Math.PI * 4)) * 0.85
				} else {
					v = bars[i] ?? 0
				}
				const barH = (0.15 + 0.85 * v) * maxHalf
				const bx = x + padX + i * (barW + gap)
				ctx.fillRect(bx, cy - barH, barW, barH * 2)
			}
			ctx.restore()
		}
	}

	ctx.save()
	ctx.beginPath()
	ctx.rect(visX, y, visW, h)
	ctx.clip()
	ctx.fillStyle = 'rgba(255,255,255,0.88)'
	ctx.font = `11px ${UI_FONT_FAMILY}`
	ctx.textAlign = 'left'
	ctx.fillText(clip.source.label || clip.source.value, visX + 5, y + h / 2 + 4)
	ctx.restore()

	const KF_COLORS = { opacity: '#ffd700', volume: '#4ec9b0', fill_x: '#569cd6', fill_y: '#569cd6', scale_x: '#c586c0', scale_y: '#c586c0' }
	if (clip.keyframes?.length) {
		for (const kf of clip.keyframes) {
			const kx = xAt(clip.startTime + kf.time)
			if (kx < HEADER_W || kx > canvas.width) continue
			const ky = y + h - 7
			ctx.fillStyle = KF_COLORS[kf.property] || '#ffd700'
			ctx.beginPath()
			ctx.moveTo(kx, ky - 5); ctx.lineTo(kx + 4, ky)
			ctx.lineTo(kx, ky + 5); ctx.lineTo(kx - 4, ky)
			ctx.closePath(); ctx.fill()
		}
	}

	ctx.fillStyle = 'rgba(255,255,255,0.25)'
	ctx.fillRect(x, y, 4, h)
	ctx.fillRect(x + w - 4, y, 4, h)

	if (isSelected) {
		ctx.save()
		ctx.beginPath()
		roundRect(ctx, x, y, w, h, 3)
		ctx.strokeStyle = '#58a6ff'
		ctx.lineWidth = 2
		ctx.stroke()
		ctx.restore()
	}
}
